#!/usr/bin/env python3
"""Publish a simulated NavAid route to a Follow Me MQTT link.

With no route argument this flies the built-in LLHZ -> LLHA CVFR template through
the route waypoints. An exported NavAid route JSON can be supplied instead.

    python3 scripts/follow-me-simulator.py
    python3 scripts/follow-me-simulator.py route.json --speed-kt 120 --interval 2
    python3 scripts/follow-me-simulator.py --speed-factor 10
    python3 scripts/follow-me-simulator.py --dry-run

The command prints a complete follower URL. Keep it private: its fragment contains
the AES key and therefore grants both viewing and publishing capability.

Needs: paho-mqtt >= 2, cryptography. Install with:

    python3 -m pip install -r scripts/requirements-follow-me.txt
"""

import argparse
import base64
import json
import math
import os
import sys
import threading
import time
import urllib.parse
from pathlib import Path


DEFAULT_BROKER = 'wss://broker.emqx.io:8084/mqtt'
DEFAULT_BASE_URL = 'https://navaid.supino.org/'
TOPIC_PREFIX = 'navaid/follow/'
NM_EARTH_RADIUS = 3440.065
FT_TO_M = 0.3048
DEFAULT_ROUTE = Path(__file__).resolve().parent / 'routes' / 'LLHZ-to-LLHA.json'


def b64url(value):
    return base64.urlsafe_b64encode(value).decode('ascii').rstrip('=')


def follower_link(base_url, session_id, key):
    root = base_url.rstrip('/') + '/'
    return '%s?follow=%s#k=%s' % (root, session_id, b64url(key))


def validate_waypoints(values):
    if not isinstance(values, list) or len(values) < 2:
        raise ValueError('route must contain at least two waypoints')
    route = []
    for index, raw in enumerate(values, 1):
        if not isinstance(raw, dict):
            raise ValueError('waypoint %d is not an object' % index)
        lat, lng = raw.get('lat'), raw.get('lng')
        numeric = lambda value: (isinstance(value, (int, float)) and
                                 not isinstance(value, bool) and math.isfinite(value))
        if not numeric(lat) or not -90 <= lat <= 90:
            raise ValueError('waypoint %d has an invalid latitude' % index)
        if not numeric(lng) or not -180 <= lng <= 180:
            raise ValueError('waypoint %d has an invalid longitude' % index)
        route.append({'name': str(raw.get('name') or 'WP%d' % index),
                      'lat': float(lat), 'lng': float(lng)})
    return route


def load_route_data(path=None):
    source_path = Path(path) if path else DEFAULT_ROUTE
    with source_path.open(encoding='utf-8') as source:
        data = json.load(source)
    if not isinstance(data, dict):
        raise ValueError('route JSON must be an object')
    route = validate_waypoints(data.get('waypoints'))
    legs = data.get('legs')
    if legs is None:
        legs = [{} for _ in range(len(route) - 1)]
    if not isinstance(legs, list) or len(legs) != len(route) - 1 or not all(
            isinstance(leg, dict) for leg in legs):
        raise ValueError('route must contain one leg object per waypoint pair')
    return route, legs


def load_route(path=None):
    """Compatibility helper used by tests and small scripts that only need waypoints."""
    return load_route_data(path)[0]


def _radians(point):
    return math.radians(point['lat']), math.radians(point['lng'])


def distance_nm(start, end):
    lat1, lon1 = _radians(start)
    lat2, lon2 = _radians(end)
    dlat, dlon = lat2 - lat1, lon2 - lon1
    a = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return NM_EARTH_RADIUS * 2 * math.atan2(math.sqrt(a), math.sqrt(max(0, 1 - a)))


def bearing_deg(start, end):
    lat1, lon1 = _radians(start)
    lat2, lon2 = _radians(end)
    y = math.sin(lon2 - lon1) * math.cos(lat2)
    x = math.cos(lat1) * math.sin(lat2) - math.sin(lat1) * math.cos(lat2) * math.cos(lon2 - lon1)
    return (math.degrees(math.atan2(y, x)) + 360) % 360


def interpolate(start, end, fraction):
    """Spherical interpolation, so long imported legs do not become flat-map chords."""
    fraction = min(1.0, max(0.0, fraction))
    lat1, lon1 = _radians(start)
    lat2, lon2 = _radians(end)
    angular = distance_nm(start, end) / NM_EARTH_RADIUS
    if angular < 1e-12:
        return {'lat': start['lat'], 'lng': start['lng']}
    sin_angular = math.sin(angular)
    a = math.sin((1 - fraction) * angular) / sin_angular
    b = math.sin(fraction * angular) / sin_angular
    x = a * math.cos(lat1) * math.cos(lon1) + b * math.cos(lat2) * math.cos(lon2)
    y = a * math.cos(lat1) * math.sin(lon1) + b * math.cos(lat2) * math.sin(lon2)
    z = a * math.sin(lat1) + b * math.sin(lat2)
    return {'lat': math.degrees(math.atan2(z, math.hypot(x, y))),
            'lng': math.degrees(math.atan2(y, x))}


def simulated_points(route, speed_kt=None, interval=2, legs=None, altitude_ft=None,
                     speed_factor=1):
    """Return positions spaced by the publication interval along every route leg."""
    if speed_kt is not None and (not math.isfinite(speed_kt) or speed_kt <= 0):
        raise ValueError('speed must be greater than zero')
    if not math.isfinite(interval) or interval <= 0:
        raise ValueError('interval must be greater than zero')
    if not math.isfinite(speed_factor) or speed_factor <= 0:
        raise ValueError('speed factor must be greater than zero')
    legs = legs or [{} for _ in range(len(route) - 1)]
    if len(legs) != len(route) - 1:
        raise ValueError('route must contain one leg per waypoint pair')
    def leg_value(index, key, override, fallback):
        value = override if override is not None else legs[index].get(key)
        return float(value) if isinstance(value, (int, float)) and value > 0 else fallback

    first_speed = leg_value(0, 'flightSpeed', speed_kt, 90)
    first_altitude = leg_value(0, 'inboundAltitude', altitude_ft, 1500)
    points = []
    first_track = bearing_deg(route[0], route[1])
    points.append({'lat': route[0]['lat'], 'lng': route[0]['lng'], 'trk': first_track,
                   'waypoint': route[0]['name'], 'speed_kt': first_speed,
                   'altitude_ft': first_altitude})
    for leg_index, (start, end) in enumerate(zip(route, route[1:])):
        leg_speed = leg_value(leg_index, 'flightSpeed', speed_kt, 90)
        leg_altitude = leg_value(leg_index, 'inboundAltitude', altitude_ft, 1500)
        leg_nm = distance_nm(start, end)
        leg_seconds = leg_nm / leg_speed * 3600 / speed_factor
        steps = max(1, math.ceil(leg_seconds / interval))
        for step in range(1, steps + 1):
            point = interpolate(start, end, step / steps)
            point['trk'] = bearing_deg(point, end) if step < steps else bearing_deg(start, end)
            point['waypoint'] = end['name'] if step == steps else None
            point['leg'] = leg_index
            point['speed_kt'] = leg_speed
            point['altitude_ft'] = leg_altitude
            points.append(point)
    return points


def make_fix(point, code, speed_kt, altitude_ft, sequence, now_ms):
    return {
        'reg': code,
        'lat': round(point['lat'], 5),
        'lng': round(point['lng'], 5),
        'alt': round(altitude_ft * FT_TO_M),
        'trk': round(point['trk']),
        'kt': round(speed_kt),
        't': now_ms,
        'seq': sequence,
    }


def seal(key, fix):
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM

    iv = os.urandom(12)
    plaintext = json.dumps(fix, separators=(',', ':')).encode('utf-8')
    return iv + AESGCM(key).encrypt(iv, plaintext, None)


def mqtt_client(broker, topic, connected):
    import paho.mqtt.client as mqtt

    url = urllib.parse.urlsplit(broker)
    if url.scheme not in ('ws', 'wss') or not url.hostname:
        raise ValueError('broker must be a ws:// or wss:// URL')
    port = url.port or (443 if url.scheme == 'wss' else 80)
    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2,
                         client_id='navaid-sim-' + b64url(os.urandom(6)),
                         protocol=mqtt.MQTTv311, transport='websockets')
    client.ws_set_options(path=url.path or '/mqtt')
    if url.scheme == 'wss':
        client.tls_set()
    client.will_set(topic, payload=b'', qos=0, retain=True)

    def on_connect(_client, _userdata, _flags, reason_code, _properties=None):
        if reason_code == 0:
            connected.error = None
        else:
            connected.error = 'broker refused connection: %s' % reason_code
        connected.set()

    client.on_connect = on_connect
    client.connect(url.hostname, port, keepalive=30)
    return client


def main():
    parser = argparse.ArgumentParser(description='Fly a NavAid route through Follow Me MQTT.')
    parser.add_argument('route', nargs='?', help='exported NavAid route JSON '
                        '(default: bundled routes/LLHZ-to-LLHA.json)')
    parser.add_argument('--code', default='TEST', help='aircraft code (default: %(default)s)')
    parser.add_argument('--speed-kt', type=float, default=None,
                        help='override every leg groundspeed (default: route flightSpeed)')
    parser.add_argument('--altitude-ft', type=float, default=None,
                        help='override every leg altitude (default: route inboundAltitude)')
    parser.add_argument('--interval', type=float, default=2, help='seconds between fixes (default: %(default)s)')
    parser.add_argument('--speed-factor', type=float, default=1,
                        help='simulated clock multiplier without changing reported speed (default: %(default)s)')
    parser.add_argument('--broker', default=DEFAULT_BROKER, help='MQTT WebSocket URL')
    parser.add_argument('--base-url', default=DEFAULT_BASE_URL, help='base URL used in the follower link')
    parser.add_argument('--once', action='store_true', help='stop after one flight (default: loop indefinitely)')
    parser.add_argument('--dry-run', action='store_true', help='validate and summarize without connecting')
    args = parser.parse_args()

    code = args.code.strip().upper()[:12]
    if not code:
        raise SystemExit('aircraft code cannot be empty')
    try:
        route, legs = load_route_data(args.route)
        points = simulated_points(route, args.speed_kt, args.interval, legs,
                                  args.altitude_ft, args.speed_factor)
    except (OSError, ValueError, json.JSONDecodeError) as error:
        raise SystemExit(str(error)) from error

    session_id, key = b64url(os.urandom(16)), os.urandom(32)
    link = follower_link(args.base_url, session_id, key)
    total_nm = sum(distance_nm(a, b) for a, b in zip(route, route[1:]))
    print('Route: %s (%0.1f NM, %d fixes)' %
          (' -> '.join(point['name'] for point in route), total_nm, len(points)), file=sys.stderr)
    timing = ', %.1fx clock' % args.speed_factor if args.speed_factor != 1 else ''
    print('Aircraft: %s, route speed/altitude, every %.1f s%s' %
          (code, args.interval, timing), file=sys.stderr)
    print('Follower link:\n%s' % link, flush=True)
    if args.dry_run:
        return

    topic = TOPIC_PREFIX + session_id
    connected = threading.Event()
    client = None
    loop_started = False
    broker_connected = False
    interrupted = False
    try:
        try:
            client = mqtt_client(args.broker, topic, connected)
            client.loop_start()
            loop_started = True
        except ImportError as error:
            raise SystemExit('%s\nInstall: python3 -m pip install -r '
                             'scripts/requirements-follow-me.txt' % error) from error
        except ValueError as error:
            raise SystemExit(str(error)) from error
        except (OSError, RuntimeError) as error:
            raise SystemExit('could not connect to %s: %s' % (args.broker, error)) from error

        if not connected.wait(15):
            raise SystemExit('timed out connecting to %s' % args.broker)
        connection_error = getattr(connected, 'error', None)
        if connection_error:
            raise SystemExit('%s (%s)' % (connection_error, args.broker))
        broker_connected = True
        print('Publishing to %s. Press Ctrl-C to stop.' % args.broker, file=sys.stderr)

        sequence = int(time.time() * 1000)
        while True:
            started = time.monotonic()
            for index, point in enumerate(points):
                now_ms = int(time.time() * 1000)
                sequence = max(sequence + 1, now_ms)
                fix = make_fix(point, code, point['speed_kt'], point['altitude_ft'], sequence, now_ms)
                client.publish(topic, seal(key, fix), qos=0, retain=True)
                if point.get('waypoint'):
                    print('%s  %s' % (time.strftime('%H:%M:%S'), point['waypoint']), file=sys.stderr)
                deadline = started + (index + 1) * args.interval
                time.sleep(max(0, deadline - time.monotonic()))
            if args.once:
                break
    except (OSError, RuntimeError, ValueError) as error:
        raise SystemExit('publishing failed: %s' % error) from error
    except KeyboardInterrupt:
        interrupted = True
    finally:
        if client is not None:
            # Remove the retained last position only after CONNACK. Before then there is no
            # position to clear, and cleanup calls on a half-created client can obscure the
            # useful DNS/connection error with a second exception.
            if broker_connected:
                try:
                    info = client.publish(topic, b'', qos=1, retain=True)
                    info.wait_for_publish(timeout=10)
                except KeyboardInterrupt:
                    interrupted = True
                except Exception:
                    pass
            try:
                client.disconnect()
            except KeyboardInterrupt:
                interrupted = True
            except Exception:
                pass
            if loop_started:
                try:
                    client.loop_stop()
                except KeyboardInterrupt:
                    interrupted = True
                except Exception:
                    pass
    if interrupted:
        print('\nStopping.', file=sys.stderr)
        return 130
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
