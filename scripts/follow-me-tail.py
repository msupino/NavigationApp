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
            raise SystemExit('link has no #k= fragment: the key is missing, so nothing can '
                             'be decrypted. Copy the link again, including everything after #')
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


def fmt(fix, at):
    bits = ['%.5f, %.5f' % (fix['lat'], fix['lng'])]
    if isinstance(fix.get('alt'), (int, float)):
        bits.append('%d ft' % round(fix['alt'] * M_TO_FT))
    if isinstance(fix.get('kt'), (int, float)):
        bits.append('%d kt' % round(fix['kt']))
    if isinstance(fix.get('trk'), (int, float)):
        bits.append('%03d°' % round(fix['trk']))
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


def main():
    import paho.mqtt.client as mqtt

    ap = argparse.ArgumentParser(description='Print positions from a NavAid Follow me link.')
    ap.add_argument('link', help='the share link, with its #k= fragment')
    ap.add_argument('--broker', default=DEFAULT_BROKER,
                    help='wss:// URL of the MQTT broker (default: %(default)s)')
    ap.add_argument('--json', action='store_true', help='one JSON object per line, unformatted')
    ap.add_argument('--once', action='store_true', help='print the first position and exit')
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

    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, transport='websockets')
    client.ws_set_options(path=u.path or '/mqtt')
    if u.scheme == 'wss':
        client.tls_set()

    def on_connect(c, userdata, flags, reason_code, properties=None):
        if reason_code != 0:
            raise SystemExit('broker refused the connection: %s' % reason_code)
        print('# watching %s on %s' % (topic, args.broker), file=sys.stderr)
        c.subscribe(topic, qos=0)

    last_order = -1

    def on_message(c, userdata, msg):
        nonlocal last_order
        if not msg.payload:
            return                      # the empty retained message: sharing has stopped
        fix = unseal(key, msg.payload)
        order = accepted_order(fix, last_order)
        if order is None:
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
