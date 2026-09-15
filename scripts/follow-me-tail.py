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
# The wire carries the numbers the cockpit is showing, in the cockpit's units: feet, knots,
# and a magnetic heading. This tool prints them and converts nothing -- a conversion here is
# one more way for two screens to disagree about one aeroplane.


def b64url_decode(s):
    """The app writes base64url without padding; the stdlib insists on it."""
    return base64.urlsafe_b64decode(s + '=' * (-len(s) % 4))


def verify_key(link):
    """The public half out of the link's fragment, when it carries one.

    A follower necessarily holds the AES key -- they could not read anything otherwise -- so
    the key alone cannot say WHO published. Every packet is signed by the aeroplane, and this
    is what checks it. A link without `v` is from before signing existed: it is read
    unverified, and said to be.
    """
    u = urllib.parse.urlsplit(link)
    raw = u.fragment.lstrip('#') if u.scheme else (link.split('#', 1)[1] if '#' in link else '')
    got = urllib.parse.parse_qs(raw).get('v', [''])[0]
    return got or ''


def check_signature(public_raw, fix):
    """True when `sig` is the aeroplane's, over the packet without it.

    The field is added last and the app removes it and re-serialises to check, so the bytes
    signed are the object as it went on the wire, minus its own signature.
    """
    from cryptography.hazmat.primitives import hashes
    from cryptography.hazmat.primitives.asymmetric import ec
    from cryptography.hazmat.primitives.asymmetric.utils import encode_dss_signature

    if not isinstance(fix, dict) or not isinstance(fix.get('sig'), str):
        return False
    raw = b64url_decode(fix['sig'])
    if len(raw) != 64:
        return False
    body = {k: v for k, v in fix.items() if k != 'sig'}
    signed = json.dumps(body, separators=(',', ':')).encode('utf-8')
    der = encode_dss_signature(int.from_bytes(raw[:32], 'big'), int.from_bytes(raw[32:], 'big'))
    key = ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), public_raw)
    try:
        key.verify(der, signed, ec.ECDSA(hashes.SHA256()))
        return True
    except Exception:
        return False


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


def heading_text(fix):
    """The heading as the aeroplane printed it: magnetic, and marked when it is the compass.

    A stationary aeroplane reports no course at all, so the phone falls back to its compass
    and sends `hc` -- where the device points, not where anything is going. Printing that as
    a course is how a follower reads out a heading nobody is flying, so it keeps the same
    leading tilde the app's own readout shows.
    """
    mag = fix.get('mh')
    if not isinstance(mag, (int, float)) or isinstance(mag, bool):
        return None
    return '%s%03d°' % ('~' if fix.get('hc') else '', round(mag) % 360)


def fmt(fix, at):
    bits = ['%.5f, %.5f' % (fix['lat'], fix['lng'])]
    # Printed, never converted: these are the cockpit's own numbers in the cockpit's own units.
    if isinstance(fix.get('af'), (int, float)):
        bits.append('%d ft' % round(fix['af']))
    if isinstance(fix.get('kt'), (int, float)):
        bits.append('%d kt' % round(fix['kt']))
    heading = heading_text(fix)
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
    ap.add_argument('--no-route', action='store_true',
                    help='do not print the shared flight plan')
    args = ap.parse_args()

    follow, key_b64 = parse_link(args.link)
    key = b64url_decode(key_b64)
    verify_raw = b64url_decode(verify_key(args.link)) if verify_key(args.link) else None
    if verify_raw is None:
        print('# no verify key in this link: packets cannot be attributed to the aeroplane',
              file=sys.stderr)
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
        # Anyone holding the link can encrypt; only the aeroplane can sign. A packet that
        # does not check out is somebody else's, and printing it as a position would be the
        # one thing this tool must not do.
        if verify_raw is not None and not check_signature(verify_raw, fix):
            print('# dropped a packet that is not signed by this aeroplane', file=sys.stderr)
            return
        last_order = order
        at = time.strftime('%H:%M:%S')
        print(json.dumps(fix) if args.json else fmt(fix, at), flush=True)
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
