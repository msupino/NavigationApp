#!/usr/bin/env python3
"""
cvfr-bridge / fake (dev simulator).

A schema-driven dev backend that serves the cvfr-bridge JSON shape on
the same port as the real backends, using a synthetic in-flight
aircraft. Use it to develop, tweak, and demo the cvfr-map web UI when
X-Plane (and the real Python/C bridges) aren't available -- or to feed
NavAid's own "Connect to simulator" (it polls this exact port/shape
too), for testing in-flight features without a real flight or X-Plane.

Like python/cvfrmap-bridge.py, this script reads its schema (here
scripts/fake-sim-bridge-schema.json, the bridge repo's schema.json) at
startup as the single source of truth: port, endpoint, field order,
and per-field fallback values all come from there. Adding a field to
schema.json automatically adds it to the fake's output (with its
schema fallback) without a code change here.

Two flight modes, chosen by --route:

  Default (no --route): a synthetic figure-8 over the schema fallback --
  a right loop (CW, banked right) joined to a left loop (CCW, banked
  left), both passing through the schema's lat/lon. Each half-loop is
  a rate-1 turn (3 deg/s, 120 s per loop, 240 s per full eight).
  Longitude is corrected by cos(lat0) so the loops look visually round
  on the map at LLBG's latitude. Heading comes from the analytical
  velocity vector along the trajectory (continuous across the crossing
  point). Roll flips +-15 deg at each loop boundary (bank reversal at
  the crossing point, instantaneous -- we don't model the brief
  wings-level moment). Altitude steady at 2500 ft, vsi 0, pitch 0,
  ias a steady 90 kt.

  --route PATH: flies an actual planned route instead -- a JSON export
  from NavAid (docs/app/io.js's serializeRoute(): {waypoints, legs}).
  Each leg is flown as a straight great-circle track at its own
  planned altitude (legs[i].inboundAltitude) and speed
  (legs[i].flightSpeed), heading constant per leg (the leg's own
  bearing), altitude/IAS stepping at each waypoint (no climb/descent
  modeled -- same "steady, not smoothed" simplicity the figure-8 mode
  already has). Once the last waypoint is reached, loops back to the
  first so a dev server keeps running indefinitely across repeated
  test flights. Position is the standard intermediate-point-on-a-
  great-circle interpolation (not linear lat/lng, which drifts off
  the actual track on a longer leg) using the same formulas and Earth
  radius (3440.065 nm) NavAid's own geo() uses, so distances/times
  between the two agree.

  Both modes: sim_ready is always true (this is a fake sim -- it's
  always live).

--wind-dir DEG --wind-speed KT (route mode only): a constant surface wind,
reported in wind_dir/wind_speed AND actually flown -- heading stays the
leg's own planned bearing (a non-correcting pilot's compass reading), while
position follows the RESULTANT ground track that heading produces through
the wind, drifting off the plotted line whenever there's a crosswind
component. That's deliberate: it gives NavAid's own drift-off-course alert
a genuinely drifting aircraft to detect, which an on-track/wind-corrected
position never would. See resultant_track()'s docstring for the exact
distinction from a wind-CORRECTION calculation.

--speed-factor N scales the simulated clock (5 = fly 5x faster than real
time) without changing how often a client polls -- covers a route, or
waits out the drift alert's 2-minute check, much sooner.

--reverse (route mode only): after the last waypoint, fly the same route
backwards to the first before looping, instead of teleporting straight
back to the start. A reversed leg's altitude is the ORIGINAL leg's
outboundAltitude (the altitude departing a point, forward, is the altitude
arriving at that same point, in reverse) and its heading is a freshly
computed reciprocal bearing, not just the forward heading + 180.

Stdlib only, no X-Plane required. Not a real backend - intentionally
NOT listed in the README's "two backends, same wire format" table.
"""

from __future__ import annotations

import argparse
import json
import math
import signal
import socketserver
import sys
import time
from collections import OrderedDict
from http.server import BaseHTTPRequestHandler
from pathlib import Path
from typing import Any

# Copied into NavigationApp from msupino/cvfr-bridge (tools/cvfrmap-fake.py @ 5eaddf8) as
# fake-sim-bridge.py; its schema.json sits beside it as fake-sim-bridge-schema.json. The bridge repo stays the source of truth:
# when its schema or this script change there, copy both again.
DEFAULT_SCHEMA = Path(__file__).resolve().parent / "fake-sim-bridge-schema.json"

# Same mean Earth radius NavAid's own geo() uses (docs/app/core.js), so a route flown here
# covers the same distance/time NavAid itself would compute for the identical route.
EARTH_NM = 3440.065


def haversine_nm(a: dict, b: dict) -> float:
    """Great-circle distance between {"lat","lng"} points, in nm."""
    phi1, phi2 = math.radians(a["lat"]), math.radians(b["lat"])
    dphi = math.radians(b["lat"] - a["lat"])
    dlam = math.radians(b["lng"] - a["lng"])
    h = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlam / 2) ** 2
    return 2 * EARTH_NM * math.asin(min(1.0, math.sqrt(h)))


def bearing_deg(a: dict, b: dict) -> float:
    """Initial great-circle bearing from a to b, in degrees true, 0-360."""
    phi1, phi2 = math.radians(a["lat"]), math.radians(b["lat"])
    dlam = math.radians(b["lng"] - a["lng"])
    y = math.sin(dlam) * math.cos(phi2)
    x = math.cos(phi1) * math.sin(phi2) - math.sin(phi1) * math.cos(phi2) * math.cos(dlam)
    return (math.degrees(math.atan2(y, x)) + 360.0) % 360.0


def intermediate_point(a: dict, b: dict, dist_nm: float, frac: float) -> tuple[float, float]:
    """Point a fraction `frac` (0..1) of the way from a to b along their great circle.
    Standard slerp-style intermediate-point formula -- NOT linear lat/lng interpolation,
    which visibly drifts inside the arc on anything but a very short leg."""
    if dist_nm <= 0:
        return a["lat"], a["lng"]
    d = dist_nm / EARTH_NM
    sin_d = math.sin(d)
    if abs(sin_d) < 1e-12:
        return a["lat"], a["lng"]
    A = math.sin((1 - frac) * d) / sin_d
    B = math.sin(frac * d) / sin_d
    phi1, lam1 = math.radians(a["lat"]), math.radians(a["lng"])
    phi2, lam2 = math.radians(b["lat"]), math.radians(b["lng"])
    x = A * math.cos(phi1) * math.cos(lam1) + B * math.cos(phi2) * math.cos(lam2)
    y = A * math.cos(phi1) * math.sin(lam1) + B * math.cos(phi2) * math.sin(lam2)
    z = A * math.sin(phi1) + B * math.sin(phi2)
    lat = math.degrees(math.atan2(z, math.sqrt(x * x + y * y)))
    lon = math.degrees(math.atan2(y, x))
    return lat, lon


def destination_point(start: dict, bearing_deg_: float, dist_nm: float) -> tuple[float, float]:
    """Point dist_nm along great-circle bearing bearing_deg_ from start. The direct/forward
    geodesic problem -- given where you are, which way you're pointed, and how far you've
    gone, where are you now. Standard formula, the natural counterpart to bearing_deg()
    and haversine_nm() above (which solve the INVERSE problem: given two points, what
    bearing/distance connects them)."""
    if dist_nm <= 0:
        return start["lat"], start["lng"]
    d = dist_nm / EARTH_NM
    brg = math.radians(bearing_deg_)
    phi1, lam1 = math.radians(start["lat"]), math.radians(start["lng"])
    phi2 = math.asin(math.sin(phi1) * math.cos(d) + math.cos(phi1) * math.sin(d) * math.cos(brg))
    lam2 = lam1 + math.atan2(math.sin(brg) * math.sin(d) * math.cos(phi1),
                              math.cos(d) - math.sin(phi1) * math.sin(phi2))
    return math.degrees(phi2), math.degrees(lam2)


def resultant_track(heading_true_deg: float, tas_kt: float, wind_dir_deg: float,
                     wind_speed_kt: float) -> tuple[float, float]:
    """Ground track (bearing_deg, gs_kt) resulting from HOLDING heading_true_deg at tas_kt
    through a wind, WITHOUT correcting for it -- the drift a pilot who dialled in the
    planned course and never adjusted for wind actually flies. (This is deliberately not a
    wind-correction/intercept calculation -- see windTriangle() in NavAid's own
    docs/app/core.js for that; this fake tool exists to feed NavAid's DRIFT alert a
    genuinely drifting aircraft to detect, not to arrive at a heading that avoids drifting
    at all.) Plain vector addition: TAS vector at the held heading, plus the wind's own
    velocity vector (wind_dir is the FROM direction, so the air mass moves TOWARD
    wind_dir+180). No-wind (wind_speed_kt <= 0) returns (heading_true_deg, tas_kt) exactly,
    i.e. the held heading with no drift at all."""
    if not (wind_speed_kt > 0):
        return heading_true_deg, tas_kt
    hx = tas_kt * math.sin(math.radians(heading_true_deg))
    hy = tas_kt * math.cos(math.radians(heading_true_deg))
    wind_to_deg = (wind_dir_deg + 180.0) % 360.0
    wx = wind_speed_kt * math.sin(math.radians(wind_to_deg))
    wy = wind_speed_kt * math.cos(math.radians(wind_to_deg))
    vx, vy = hx + wx, hy + wy
    return math.degrees(math.atan2(vx, vy)) % 360.0, math.hypot(vx, vy)


class Route:
    """A parsed NavAid route export, ready to be flown on a loop.

    Each entry in `legs` is one leg: {from, to, dist_nm, duration_s, alt_ft, ias_kt,
    bearing_true}. `cum_s` is each leg's START time within one lap (so a given elapsed
    time only needs a linear scan, not per-request re-derivation of the whole route).
    """

    def __init__(self, waypoints: list[dict], raw_legs: list[dict], reverse: bool = False) -> None:
        if len(waypoints) < 2:
            raise ValueError("route needs at least 2 waypoints")
        if len(raw_legs) != len(waypoints) - 1:
            raise ValueError(
                f"route has {len(waypoints)} waypoints but {len(raw_legs)} legs "
                f"(expected {len(waypoints) - 1})"
            )
        self.waypoints = waypoints
        self.reverse = reverse
        self.legs: list[dict] = []
        cum_s = 0.0
        for i, raw in enumerate(raw_legs):
            a, b = waypoints[i], waypoints[i + 1]
            dist_nm = haversine_nm(a, b)
            speed_kt = float(raw.get("flightSpeed") or 0) or 90.0  # never divide by zero
            duration_s = (dist_nm / speed_kt) * 3600.0
            alt_ft = raw.get("inboundAltitude")
            self.legs.append({
                "from": a, "to": b, "dist_nm": dist_nm, "duration_s": duration_s,
                "cum_s": cum_s, "alt_ft": alt_ft if isinstance(alt_ft, (int, float)) else 0,
                "ias_kt": speed_kt, "bearing_true": bearing_deg(a, b),
            })
            cum_s += duration_s
        self.forward_total_s = cum_s
        if reverse:
            # The same waypoints, flown last-to-first, appended right after the forward
            # pass so one lap is "there and back" rather than an instant teleport to the
            # start -- a straight extension of the SAME cum_s timeline position() already
            # scans linearly, so position() itself needs no changes at all.
            #
            # Altitude: raw_legs[i]'s inboundAltitude is "the altitude arriving at
            # waypoints[i+1], flying forward" -- flown in reverse, arriving back at
            # waypoints[i+1] means DEPARTING it in the forward sense, i.e. exactly what
            # outboundAltitude already records at that same point. Reported live: "using
            # the reverse alt (outboundAltitude in json)".
            #
            # Heading: bearing_deg(b, a) freshly computed for the b->a direction, not
            # just the forward bearing + 180 -- the true reciprocal only coincides with
            # the other direction's initial bearing on a rhumb line; a great-circle leg's
            # does not (negligibly for CVFR-length legs, but there is no reason to guess
            # when the real formula is one call away).
            for i in range(len(raw_legs) - 1, -1, -1):
                raw = raw_legs[i]
                a, b = waypoints[i + 1], waypoints[i]   # swapped: flying b<-a in reverse
                dist_nm = haversine_nm(a, b)
                speed_kt = float(raw.get("flightSpeed") or 0) or 90.0
                duration_s = (dist_nm / speed_kt) * 3600.0
                alt_ft = raw.get("outboundAltitude")
                self.legs.append({
                    "from": a, "to": b, "dist_nm": dist_nm, "duration_s": duration_s,
                    "cum_s": cum_s, "alt_ft": alt_ft if isinstance(alt_ft, (int, float)) else 0,
                    "ias_kt": speed_kt, "bearing_true": bearing_deg(a, b),
                })
                cum_s += duration_s
        self.total_s = cum_s

    def position(self, t: float, wind_dir_deg: "float | None" = None,
                 wind_speed_kt: "float | None" = None) -> tuple[float, float, float, float, float]:
        """(lat, lon, heading_true, altitude_ft, ias_kt) at elapsed time t, looping back
        to the start once the route completes. heading_true is always the leg's own
        planned bearing -- the compass heading actually held, whether or not wind is
        drifting the aircraft off of it (a non-correcting pilot's heading indicator
        doesn't know it's drifting either).

        No wind: position is the intended track (intermediate_point along from->to) --
        unchanged from before wind support existed. With wind: position instead follows
        the RESULTANT ground track of holding that heading at ias_kt through the wind
        (resultant_track + destination_point) -- a straight line from the leg's start, at
        the resultant's own bearing/speed, which is NOT the from->to line whenever there's
        a crosswind component. This is what actually gives NavAid's drift alert something
        to detect; a corrected/on-track position never would (see resultant_track's own
        docstring for why this isn't a wind-CORRECTED heading).
        """
        t = t % self.total_s if self.total_s > 0 else 0.0
        leg = self.legs[-1]
        for candidate in self.legs:
            if t < candidate["cum_s"] + candidate["duration_s"]:
                leg = candidate
                break
        elapsed_s = max(0.0, t - leg["cum_s"])
        if leg["duration_s"] > 0:
            elapsed_s = min(elapsed_s, leg["duration_s"])
        if wind_dir_deg is not None and wind_speed_kt is not None and wind_speed_kt > 0:
            track_deg, gs_kt = resultant_track(leg["bearing_true"], leg["ias_kt"],
                                                wind_dir_deg, wind_speed_kt)
            dist_flown_nm = gs_kt * (elapsed_s / 3600.0)
            lat, lon = destination_point(leg["from"], track_deg, dist_flown_nm)
        else:
            frac = (elapsed_s / leg["duration_s"]) if leg["duration_s"] > 0 else 0.0
            lat, lon = intermediate_point(leg["from"], leg["to"], leg["dist_nm"], frac)
        return lat, lon, leg["bearing_true"], leg["alt_ft"], leg["ias_kt"]


def load_route(path: Path, reverse: bool = False) -> Route:
    with path.open() as f:
        data = json.load(f)
    waypoints = data.get("waypoints")
    legs = data.get("legs")
    if not isinstance(waypoints, list) or not isinstance(legs, list):
        raise ValueError(f"{path}: expected a NavAid route export ({{waypoints, legs}})")
    return Route(waypoints, legs, reverse=reverse)

# Animated demo flight constants. Kept at module scope so they show up
# in the startup banner and are easy to tweak without hunting through
# the request handler. The vsi peak is the analytical derivative of
# the altitude sinusoid, so non-zero ALT_AMPLITUDE_FT will automatically
# drive a non-zero VSI swing - keep them coherent.
ORBIT_RADIUS_DEG = 0.02       # ~1.2 NM at LLBG (Tel Aviv) latitude
ORBIT_RATE_DEG_S = 3.0        # rate-1 per loop (3 deg/s, 120 s/loop)
BANK_DEG = 15.0               # the bank that yields rate-1 at ~100 kt
ALT_CENTER_FT = 2500.0
ALT_AMPLITUDE_FT = 0.0        # 0 -> level turn; bump for an oscillation
ALT_PERIOD_S = 50.0
PITCH_AMPLITUDE_DEG = 0.0     # 0 -> nose level; couples to ALT_AMPLITUDE
IAS_KT = 90.0
LOOP_PERIOD_S = 360.0 / ORBIT_RATE_DEG_S   # 120 s per single loop
PATTERN_PERIOD_S = 2.0 * LOOP_PERIOD_S     # 240 s per full figure-8


def load_schema(path: Path) -> dict:
    with path.open() as f:
        return json.load(f)


def base_snapshot(fields: list[dict]) -> "OrderedDict[str, Any]":
    """Build the initial snapshot: every schema field at its fallback,
    in schema declaration order. Re-built per request so a hot edit of
    schema.json + restart is the only thing needed to add a field."""
    snap: OrderedDict[str, Any] = OrderedDict()
    for f in fields:
        snap[f["name"]] = f["fallback"]
    return snap


def figure_eight(t: float, lat0: float, lon0: float) -> tuple[float, float, float, float]:
    """Compute (lat, lon, heading_deg, bank_deg) along a figure-8.

    Two circles tangent at (lat0, lon0):
      - Right loop: centred 1 radius EAST of origin, traversed CW,
        bank +15 deg. The aircraft enters at the origin heading north
        and exits there 120 s later still heading north.
      - Left loop: centred 1 radius WEST of origin, traversed CCW,
        bank -15 deg. Same entry/exit geometry as the right loop.

    Heading comes from the analytical velocity vector, so the nose
    points along the trajectory continuously across the crossing
    point. Bank flips instantaneously at the crossing (which is
    actually what a pilot does in a real figure-8).

    Longitude is divided by cos(lat0) so the loops render visually
    round on the leaflet map at LLBG's latitude (~32 deg)."""
    lat_factor = math.cos(math.radians(lat0)) or 1.0
    R = ORBIT_RADIUS_DEG

    pat_t = t % PATTERN_PERIOD_S
    if pat_t < LOOP_PERIOD_S:
        # Right loop: theta starts at pi (origin = west tangent of the
        # east-of-centre circle) and DECREASES (clockwise). One full
        # period sweeps theta by -2*pi.
        theta = math.pi - math.radians(ORBIT_RATE_DEG_S * pat_t)
        # Position relative to right-circle centre (lon0+R*scaled, lat0).
        lat = lat0 + R * math.sin(theta)
        lon = lon0 + (R + R * math.cos(theta)) / lat_factor
        # CW velocity = (sin(theta), -cos(theta)) (up to scale).
        # Compass heading = atan2(east, north).
        heading = math.degrees(math.atan2(math.sin(theta), -math.cos(theta)))
        bank = +BANK_DEG
    else:
        # Left loop: theta starts at 0 (origin = east tangent of the
        # west-of-centre circle) and INCREASES (counter-clockwise).
        loop_t = pat_t - LOOP_PERIOD_S
        theta = math.radians(ORBIT_RATE_DEG_S * loop_t)
        lat = lat0 + R * math.sin(theta)
        lon = lon0 + (-R + R * math.cos(theta)) / lat_factor
        # CCW velocity = (-sin(theta), cos(theta)).
        heading = math.degrees(math.atan2(-math.sin(theta), math.cos(theta)))
        bank = -BANK_DEG

    return lat, lon, heading % 360.0, bank


def animate(snap: "OrderedDict[str, Any]", t: float, lat0: float, lon0: float,
            route: "Route | None" = None, variation_deg: float = 0.0,
            wind_dir_deg: "float | None" = None,
            wind_speed_kt: "float | None" = None) -> None:
    """Overlay synthesized flight values onto the schema-default
    snapshot. Only touches fields that participate in the demo flight;
    everything else stays at its schema fallback so new schema fields
    keep working without a change here."""
    if route is not None:
        # Straight legs, no maneuvering to model -- level, wings-level between waypoints
        # (a real climb/descent/turn isn't simulated, same "steady, not smoothed"
        # simplicity the figure-8 mode already has for its own altitude/vsi/pitch). Wind
        # drift, if any, is baked into (lat, lon) already -- see Route.position()'s own
        # docstring. heading_true is always the constant, HELD leg bearing: what the
        # aircraft is pointed at, whether or not the wind is quietly drifting it sideways.
        lat, lon, heading_true, alt, ias_kt = route.position(t, wind_dir_deg, wind_speed_kt)
        heading = (heading_true - variation_deg) % 360.0   # magnetic, matching the schema's
        bank = 0.0                                          # own "heading" field semantics
        vsi_fpm = 0.0
        pitch_norm = 0.0
        ias = ias_kt
    else:
        lat, lon, heading, bank = figure_eight(t, lat0, lon0)
        ias = IAS_KT
        if ALT_AMPLITUDE_FT != 0.0 and ALT_PERIOD_S > 0.0:
            omega = 2.0 * math.pi / ALT_PERIOD_S
            alt = ALT_CENTER_FT + ALT_AMPLITUDE_FT * math.sin(omega * t)
            vsi_fpm = ALT_AMPLITUDE_FT * omega * math.cos(omega * t) * 60.0
            pitch_norm = math.cos(omega * t)
        else:
            alt = ALT_CENTER_FT
            vsi_fpm = 0.0
            pitch_norm = 0.0

    if "latitude" in snap:
        snap["latitude"] = round(lat, 6)
    if "longitude" in snap:
        snap["longitude"] = round(lon, 6)
    if "altitude" in snap:
        snap["altitude"] = int(round(alt))
    if "heading" in snap:
        snap["heading"] = round(heading, 1)
    if "pitch" in snap:
        snap["pitch"] = round(PITCH_AMPLITUDE_DEG * pitch_norm, 2)
    if "roll" in snap:
        snap["roll"] = round(bank, 2)
    if "vsi" in snap:
        snap["vsi"] = int(round(vsi_fpm))
    if "ias" in snap:
        snap["ias"] = round(ias, 1)
    if "sim_ready" in snap:
        snap["sim_ready"] = True


class _QuietServer(socketserver.TCPServer):
    """A client resetting the connection before/while the server even reads its request
    line (NavAid's 900 ms abort timeout; a page navigating away mid-poll) raises inside
    socketserver's OWN request-reading machinery -- before do_GET() ever runs, so the
    try/except around the response-write in do_GET can't see it. socketserver's default
    handle_error() prints a full traceback per occurrence for exactly this benign,
    once-a-second-poll-rate outcome (reported live: a ConnectionResetError traceback at
    self._sock.recv_into(b), i.e. reading the request, the read-side twin of the
    BrokenPipeError already handled on the write side in do_GET). Suppress only the two
    benign disconnect exceptions; anything else still prints normally."""
    def handle_error(self, request, client_address) -> None:
        exc = sys.exc_info()[1]
        if isinstance(exc, (BrokenPipeError, ConnectionResetError)):
            return
        super().handle_error(request, client_address)


def make_handler(schema: dict, t0: float, route: "Route | None",
                  variation_deg: float, wind_dir: "float | None" = None,
                  wind_speed: "float | None" = None, speed_factor: float = 1.0) -> type:
    """Build a request-handler class closed over the loaded schema, a single shared
    start time, and (route mode) the parsed route + magnetic variation. Every GET
    re-derives the snapshot from schema.json + the elapsed time since t0 - no
    per-request state."""
    endpoint = schema["endpoint"]
    fields = schema["fields"]
    by_name = {f["name"]: f for f in fields}
    lat0 = float(by_name["latitude"]["fallback"]) if "latitude" in by_name else 0.0
    lon0 = float(by_name["longitude"]["fallback"]) if "longitude" in by_name else 0.0

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self) -> None:
            if self.path != endpoint:
                self.send_response(404)
                self.send_header("Content-Length", "0")
                self.end_headers()
                return
            snap = base_snapshot(fields)
            # Scales the SIMULATED clock, not the poll rate -- a 5x factor means the
            # aircraft covers 5x the ground per real second (and the figure-8's loops and
            # the route's leg-boundary/loop-back timing all run 5x too), without changing
            # how often NavAid (or cvfr-map) actually asks for a fix.
            animate(snap, (time.monotonic() - t0) * speed_factor, lat0, lon0, route,
                    variation_deg, wind_dir, wind_speed)
            # Constant for the whole session -- a fake tool has no reason to vary wind
            # over time, and neither backend does either (both report live sim/rref wind,
            # which just doesn't change fast enough to matter here). Overrides the schema
            # fallback (0/0) only when explicitly passed; otherwise animate()'s own
            # untouched fields (still 0/0) stand.
            if wind_dir is not None and "wind_dir" in snap:
                snap["wind_dir"] = wind_dir
            if wind_speed is not None and "wind_speed" in snap:
                snap["wind_speed"] = wind_speed
            # Always reported (unlike wind, which only overrides when explicitly passed) --
            # 1.0 is a legitimate, meaningful value here (real time), not "nothing set", so
            # a client can always trust this field instead of needing to assume 1 when absent.
            if "speed_factor" in snap:
                snap["speed_factor"] = speed_factor
            body = json.dumps(snap).encode()
            try:
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.send_header("Cache-Control", "no-store")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
            except (BrokenPipeError, ConnectionResetError):
                # The client (NavAid's own 900 ms abort timeout; a page navigating away
                # mid-poll) closed the connection before this response finished sending --
                # a normal outcome at a once-a-second poll rate, not a real error. Silently
                # dropping this one response is correct; the client just tries again next
                # poll. Left uncaught, this crashed the whole request-handling thread with a
                # traceback per occurrence, drowning the terminal exactly where a fake dev
                # tool is supposed to stay out of the way.
                pass

        def log_message(self, *_args: Any, **_kwargs: Any) -> None:
            # Per-request access logs would otherwise drown the terminal
            # at the cvfr-map polling rate. Match the real Python bridge.
            pass

    return Handler


def banner(schema: dict, host: str, port: int, route: "Route | None",
           route_path: "Path | None", wind_dir: "float | None" = None,
           wind_speed: "float | None" = None, speed_factor: float = 1.0) -> None:
    version = schema.get("version", "0.0.0")
    by_name = {f["name"]: f for f in schema["fields"]}
    print("cvfr-bridge / fake (dev simulator)")
    print(f"  schema  : schema.json v{version}")
    print(f"  serving : http://{host}:{port}/")
    if wind_dir is not None or wind_speed is not None:
        print(f"  wind    : {wind_dir if wind_dir is not None else 0:.0f}° @ "
              f"{wind_speed if wind_speed is not None else 0:.0f} kt")
    if speed_factor != 1.0:
        print(f"  clock   : {speed_factor:g}x real time")
    if route is not None:
        names = " -> ".join(wp.get("name") or "?" for wp in route.waypoints)
        if route.reverse:
            names += " -> " + " -> ".join(
                (wp.get("name") or "?") for wp in reversed(route.waypoints[:-1]))
        total_nm = sum(leg["dist_nm"] for leg in route.legs)
        lap_min = route.total_s / speed_factor / 60
        print(f"  route   : {route_path} ({names})")
        print(
            f"  flight  : {total_nm:.1f} nm, {lap_min:.1f} min/lap real time, "
            f"loops indefinitely -- per-leg altitude/speed from the route" +
            (" (there and back -- reverse leg uses outboundAltitude)" if route.reverse else "")
        )
    else:
        lat0 = float(by_name.get("latitude", {}).get("fallback", 0.0))
        lon0 = float(by_name.get("longitude", {}).get("fallback", 0.0))
        if ALT_AMPLITUDE_FT != 0.0:
            alt_desc = f"~{int(ALT_CENTER_FT)} ft \u00b1 {int(ALT_AMPLITUDE_FT)} ft"
        else:
            alt_desc = f"level @ {int(ALT_CENTER_FT)} ft"
        print(
            f"  pattern : figure-8 around {lat0:.4f},{lon0:.4f} "
            f"(R={ORBIT_RADIUS_DEG}\u00b0, rate-1 per loop, "
            f"\u00b1{BANK_DEG:.0f}\u00b0 bank, "
            f"{int(PATTERN_PERIOD_S)} s/cycle), {alt_desc}, "
            f"IAS {IAS_KT:.0f} kt"
        )
    print("Ctrl-C to stop.")


# Bundled default: NavAid's own LLHZ -> LLHA route export, so `python3 fake-sim-bridge.py`
# with no arguments flies a real planned route out of the box instead of an arbitrary
# orbit. Use --figure-eight for the old synthetic pattern, or --route for a different one.
DEFAULT_ROUTE = Path(__file__).resolve().parent / "routes" / "LLHZ-to-LLHA.json"


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(
        description="A fake simulator bridge: serves a synthetic aircraft on the bridge's port for NavAid's Connect to simulator (and cvfr-map).",
    )
    p.add_argument("--schema", type=Path, default=DEFAULT_SCHEMA,
                   help=f"Path to schema.json (default: {DEFAULT_SCHEMA})")
    p.add_argument("--route", type=Path, default=DEFAULT_ROUTE,
                   help="NavAid route export to fly (JSON: {waypoints, legs} -- "
                        f"see docs/app/io.js's serializeRoute()). Default: bundled "
                        f"{DEFAULT_ROUTE.name}")
    p.add_argument("--figure-eight", action="store_true",
                   help="Fly the old synthetic figure-8 pattern instead of a route")
    p.add_argument("--reverse", action="store_true",
                   help="Route mode only: after the last waypoint, fly the same route "
                        "backwards to the first before looping -- 'there and back' "
                        "instead of teleporting to the start. Reversed legs use each "
                        "leg's outboundAltitude (the altitude arriving back at that "
                        "point, flying in reverse) and a freshly-computed reciprocal "
                        "bearing, not just the forward heading + 180.")
    p.add_argument("--wind-dir", type=float, default=None,
                   help="Constant surface wind FROM direction, deg magnetic "
                        "(default: schema fallback, 0)")
    p.add_argument("--wind-speed", type=float, default=None,
                   help="Constant surface wind speed, kt (default: schema fallback, 0)")
    p.add_argument("--speed-factor", type=float, default=1.0,
                   help="Scale the simulated clock (e.g. 5 = fly 5x faster than real "
                        "time -- covers a route, or waits out the drift alert's 2-minute "
                        "check, much sooner). Does not change how often a client polls. "
                        "Default: 1 (real time)")
    p.add_argument("--port", type=int, default=None,
                   help="Override the schema's port")
    p.add_argument("--bind", default="0.0.0.0",
                   help="Bind address (default: 0.0.0.0)")
    p.add_argument("--quiet", action="store_true",
                   help="Suppress the startup banner")
    args = p.parse_args(argv)

    if not (args.speed_factor > 0):
        print(f"error: --speed-factor must be positive, got {args.speed_factor}", file=sys.stderr)
        return 1

    schema = load_schema(args.schema)
    port = args.port if args.port is not None else int(schema["port"])

    route: Route | None = None
    variation_deg = 0.0
    if not args.figure_eight:
        if not args.route.exists():
            print(f"error: route file not found: {args.route}", file=sys.stderr)
            print("       pass --figure-eight for the old synthetic pattern instead.",
                  file=sys.stderr)
            return 1
        try:
            route = load_route(args.route, reverse=args.reverse)
        except (ValueError, json.JSONDecodeError, KeyError) as e:
            print(f"error: couldn't load route {args.route}: {e}", file=sys.stderr)
            return 1
        by_name = {f["name"]: f for f in schema["fields"]}
        variation_deg = float(by_name.get("variation", {}).get("fallback", 0.0))
    elif args.reverse:
        print("error: --reverse only applies to route mode (drop --figure-eight)", file=sys.stderr)
        return 1

    socketserver.TCPServer.allow_reuse_address = True
    handler_cls = make_handler(schema, t0=time.monotonic(), route=route,
                                variation_deg=variation_deg, wind_dir=args.wind_dir,
                                wind_speed=args.wind_speed, speed_factor=args.speed_factor)
    server = _QuietServer((args.bind, port), handler_cls)

    def _shutdown(_sig: int, _frame: Any) -> None:
        server.server_close()
        sys.exit(0)

    signal.signal(signal.SIGINT, _shutdown)
    signal.signal(signal.SIGTERM, _shutdown)

    if not args.quiet:
        banner(schema, args.bind, port, route, args.route if route else None,
               args.wind_dir, args.wind_speed, args.speed_factor)

    try:
        server.serve_forever()
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
