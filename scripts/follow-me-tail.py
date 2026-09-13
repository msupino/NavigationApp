#!/usr/bin/env python3
"""Tail a NavAid "Follow me" link from the command line.

The browser viewer draws the aeroplane on a map. This prints the same feed as text --
useful on the ground when someone wants a log of the flight, or to check the link is
actually publishing before blaming the phone.

It speaks the same protocol the app does: MQTT 3.1.1 over WebSocket to a PUBLIC broker,
subscribed to one unguessable topic, with the payload AES-GCM encrypted. The key is in
the link's FRAGMENT (after '#'), which a browser never sends to a server -- so paste the
WHOLE link, fragment included, or there is nothing to decrypt with.

    ./scripts/follow-me-tail.py 'https://navaid.supino.org/?follow=<id>#k=<key>'
    ./scripts/follow-me-tail.py --json '<link>' | tee flight.jsonl

Needs: paho-mqtt >= 2, cryptography.
"""

import argparse
import base64
import json
import math
import sys
import time
import urllib.parse

DEFAULT_BROKER = 'wss://broker.emqx.io:8084/mqtt'
TOPIC = 'navaid/follow/'
M_TO_FT = 3.28084
# The app's own default (tuning key magneticVariationDeg): magnetic = true + variation, so
# -5 means "subtract 5". The wire carries TRUE; every number a pilot reads is magnetic.
DEFAULT_VARIATION = -5.0


def b64url_decode(s):
    """The app writes base64url without padding; the stdlib insists on it."""
    return base64.urlsafe_b64decode(s + '=' * (-len(s) % 4))


def parse_link(link):
    """Pull the topic id and the key out of a share link.

    Also accepts 'id#key' or 'id key' for a link that lost its fragment in a chat app --
    but say so, because a truncated link is the usual reason a follower sees nothing.
    """
    u = urllib.parse.urlsplit(link)
    if u.scheme:
        follow = urllib.parse.parse_qs(u.query).get('follow', [''])[0]
        key = urllib.parse.parse_qs(u.fragment.lstrip('#')).get('k', [''])[0]
        if follow and not key:
            raise SystemExit(
                'link has no #k= fragment: the key is missing, so nothing can be decrypted.\n'
                "QUOTE THE LINK: an unquoted URL loses everything after '#' to the shell, "
                "which reads it as a comment (and '&' backgrounds the command).\n"
                "    ./scripts/follow-me-tail.py 'https://navaid.supino.org/?follow=...#k=...'")
        if not follow:
            raise SystemExit('link has no ?follow= id')
        return follow, key
    parts = link.replace('#', ' ').split()
    if len(parts) != 2:
        raise SystemExit('expected a share link, or "<id> <key>"')
    return parts[0], parts[1]


def unseal(key, payload):
    """iv (12 bytes) || AES-GCM ciphertext, exactly what the app seals."""
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM

    if len(payload) < 13:
        return None
    try:
        return json.loads(AESGCM(key).decrypt(payload[:12], payload[12:], None))
    except Exception:
        # Wrong key, or somebody else's traffic on a public broker. Not fatal: the next
        # message may well be ours.
        return None


def heading_text(fix, variation=DEFAULT_VARIATION):
    """The heading as the app prints it: magnetic, and marked when it is the compass.

    The wire carries TRUE. A stationary aeroplane reports no course at all, so the phone
    falls back to its compass and sends `hc` -- where the device points, not where anything
    is going. Printing that as a course is how a follower reads out a heading nobody is
    flying, so it keeps the same leading tilde the app's own readout shows.
    """
    trk = fix.get('trk')
    if not isinstance(trk, (int, float)) or isinstance(trk, bool):
        return None
    mag = round(trk + variation) % 360
    return '%s%03d°' % ('~' if fix.get('hc') else '', mag)


def fmt(fix, at, variation=DEFAULT_VARIATION):
    bits = ['%.5f, %.5f' % (fix['lat'], fix['lng'])]
    if isinstance(fix.get('alt'), (int, float)):
        bits.append('%d ft' % round(fix['alt'] * M_TO_FT))
    if isinstance(fix.get('kt'), (int, float)):
        bits.append('%d kt' % round(fix['kt']))
    heading = heading_text(fix, variation)
    if heading:
        bits.append(heading)
    age = int(max(0, time.time() - fix.get('t', 0) / 1000)) if fix.get('t') else None
    if age is not None:
        # A retained message can be hours old: the broker hands it to every new subscriber.
        bits.append('age %ds' % age)
    return '%s  %-8s %s' % (at, str(fix.get('reg', '?'))[:8], '  '.join(bits))


def accepted_order(fix, last_order=-1, now_ms=None):
    """Return this fix's ordering value, or None when the browser would reject it."""
    if not isinstance(fix, dict):
        return None
    lat, lng, sent, seq = fix.get('lat'), fix.get('lng'), fix.get('t'), fix.get('seq')
    order = sent if seq is None else seq  # compatibility with pre-sequence publishers
    numeric = lambda value: (isinstance(value, (int, float)) and
                             not isinstance(value, bool) and math.isfinite(value))
    now = time.time() * 1000 if now_ms is None else now_ms
    if (not numeric(lat) or not -90 <= lat <= 90 or
            not numeric(lng) or not -180 <= lng <= 180 or
            not numeric(sent) or sent <= 0 or sent > now + 300000 or
            not numeric(order) or not float(order).is_integer() or
            order < 0 or order > 9007199254740991 or order <= last_order):
        return None
    return int(order)


def fmt_route(envelope):
    """One line for the shared plan: who it is between, and the waypoints in order.

    A publisher may have compressed it (`gz` with `zf` naming the format). Deflating it is
    two lines of stdlib, and a route nobody can read is the same as no route at all.
    """
    route = envelope.get('route')
    if route is None and isinstance(envelope.get('gz'), str):
        import zlib
        raw = b64url_decode(envelope['gz'])
        fmt_name = envelope.get('zf')
        # gzip carries its own header (wbits 16+15); deflate-raw carries none (-15).
        wbits = -15 if fmt_name == 'deflate-raw' else 16 + zlib.MAX_WBITS
        try:
            route = json.loads(zlib.decompress(raw, wbits))
        except Exception:
            return '# route: could not be read (%s)' % (fmt_name or 'unknown format')
    names = []
    if isinstance(route, dict) and isinstance(route.get('waypoints'), list):
        names = [str(w.get('name') or '?') for w in route['waypoints'] if isinstance(w, dict)]
    named = ' -> '.join(filter(None, [str(envelope.get('from') or ''), str(envelope.get('to') or '')]))
    return '# route %s (%d waypoints)%s' % (named or '?', len(names),
                                            ': ' + ' '.join(names) if names else '')


def main():
    import paho.mqtt.client as mqtt

    ap = argparse.ArgumentParser(description='Print positions from a NavAid Follow me link.')
    ap.add_argument('link', help='the share link, with its #k= fragment')
    ap.add_argument('--broker', default=DEFAULT_BROKER,
                    help='wss:// URL of the MQTT broker (default: %(default)s)')
    ap.add_argument('--json', action='store_true', help='one JSON object per line, unformatted')
    ap.add_argument('--once', action='store_true', help='print the first position and exit')
    ap.add_argument('--variation', type=float, default=DEFAULT_VARIATION,
                    help='magnetic variation in degrees, negative for east '
                         '(default: %(default)s, the app\'s own)')
    ap.add_argument('--no-route', action='store_true',
                    help='do not print the shared flight plan')
    args = ap.parse_args()

    follow, key_b64 = parse_link(args.link)
    key = b64url_decode(key_b64)
    if len(key) not in (16, 24, 32):
        raise SystemExit('key is %d bytes; expected a 128/192/256-bit AES key' % len(key))

    u = urllib.parse.urlsplit(args.broker)
    if u.scheme not in ('ws', 'wss'):
        raise SystemExit('broker must be a ws:// or wss:// URL')
    port = u.port or (443 if u.scheme == 'wss' else 80)
    topic = TOPIC + follow
    route_topic = topic + '/route'

    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, transport='websockets')
    client.ws_set_options(path=u.path or '/mqtt')
    if u.scheme == 'wss':
        client.tls_set()

    def on_connect(c, userdata, flags, reason_code, properties=None):
        if reason_code != 0:
            raise SystemExit('broker refused the connection: %s' % reason_code)
        print('# watching %s on %s' % (topic, args.broker), file=sys.stderr)
        c.subscribe(topic, qos=0)
        # The plan travels on its own retained topic -- the pilot's route, offered to
        # followers. Same key, same envelope.
        if not args.no_route:
            c.subscribe(route_topic, qos=0)

    last_order = -1

    def on_message(c, userdata, msg):
        nonlocal last_order
        if not msg.payload:
            return                      # the empty retained message: sharing has stopped
        if msg.topic == route_topic:
            envelope = unseal(key, msg.payload)
            if isinstance(envelope, dict):
                print(json.dumps(envelope) if args.json else fmt_route(envelope), flush=True)
            return
        fix = unseal(key, msg.payload)
        order = accepted_order(fix, last_order)
        if order is None:
            return
        last_order = order
        at = time.strftime('%H:%M:%S')
        print(json.dumps(fix) if args.json else fmt(fix, at, args.variation), flush=True)
        if args.once:
            c.disconnect()

    client.on_connect = on_connect
    client.on_message = on_message
    client.connect(u.hostname, port, keepalive=30)
    try:
        client.loop_forever()
    except KeyboardInterrupt:
        client.disconnect()


if __name__ == '__main__':
    main()
