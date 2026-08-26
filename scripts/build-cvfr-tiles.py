#!/usr/bin/env python3
"""Slice the CAA's CVFR sheets (north + south) into XYZ tiles, locally.

    python3 scripts/build-cvfr-tiles.py cvfr-north.pdf cvfr-south.pdf \
        --out ~/Downloads/flight-maps-tiles/cvfr

    python3 scripts/local-mbtiles-server.py
    open 'http://127.0.0.1:8000/?localTiles=1'      # CVFR layer now serves these

The sheets are vector, not scans: 9,883 words of real text on the north sheet, and the only
rasters are terrain shading and symbol stamps. So there is no resolution ceiling in the
source -- the render dpi is chosen from the target zoom, not from what the paper can give.

Geometry is the same conic model scripts/warp-ats-chart.py fits for the ATS sheet, for the
same reason: over a whole country the paper's meridians converge and Web Mercator's do not,
so laid down as printed the corners land kilometres out. The graticule is read off the sheet
(`pdftotext -bbox`), the apex where its meridians meet is the least-squares intersection of
them all, and a parallel is a circle about that apex. On both CVFR sheets the two ends of
each parallel agree to about 1 pt in 120,000, which is the check that the shape is right.

Cropping is two cuts. The first is the sheet's own neat line -- nothing outside the box the
ticks label is ever sampled. That is not enough on its own: the CAA prints the title, the
notes, the frequency table and the legend INSIDE that box, over sea and over Sinai, and
warped into place they land on Jordan and the Mediterranean as walls of Hebrew text. The
north sheet also carries an inset enlargement of the Tel Aviv area, drawn at 2019 pt/deg
against the sheet's 1262, sitting over the sea off Netanya.

So the second cut is a panel list per sheet, in PDF points, measured off the paper (see
PANELS). Cut panels become transparent rather than white: a tile that has no chart should
show the map underneath it, not a hole punched in white.

Where the two sheets overlap (31°20'N..31°30'N) the alpha ramps out over the last few pixels
of each frame, so the join blends instead of showing a seam.
"""

import argparse
import html
import math
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path

try:
    import numpy as np
    from PIL import Image
except ModuleNotFoundError as exc:                      # same message as warp-ats-chart.py
    raise SystemExit(
        f"Missing Python dependency {exc.name!r}; run "
        "python3 -m pip install -r scripts/requirements-georef.txt"
    ) from exc

Image.MAX_IMAGE_PIXELS = None                           # these renders are 150+ megapixels

WORD = re.compile(r'<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]*)</word>')
# The CVFR sheets label the hemisphere ("33°20'N"); the ATS sheet does not. The suffix is
# worth having: it says which edge a tick belongs to without guessing from its position.
DM = re.compile(r"^(\d{2})°(\d{2})'([NE])$")
BIDI = ''.join(chr(c) for c in (0x200e, 0x200f, 0x202a, 0x202b, 0x202c,
                                0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069))
# What the CAA prints inside the neat line, in PDF points, measured off the sheets at 36 dpi
# with a 100 pt grid laid over them. Every box here is paper furniture standing on chart
# coordinates: warped into place they land on Jordan, Sinai and the Mediterranean.
PANELS = {
    'north': [
        (15, 40, 1490, 348),        # title strip and the two columns of notes across the top
        (15, 40, 460, 470),         # title block and the "CVFR routes only" note under it
        (440, 280, 1120, 470),      # scale bars, 1:250,000
        (1470, 35, 1740, 200),      # ELEV ALT IN FEET / DIST IN NM / BRG ARE MAG
        (1600, 850, 1980, 2760),    # the numbered area notes, then the symbol legend
        (10, 1850, 415, 2620),      # aerodrome frequency table
        # "הגדלת אזור המרכז" -- the Tel Aviv enlargement, a second chart at 2019 pt/deg with a
        # graticule of its own, printed over the sea off Netanya. Its lower right corner is
        # cut on a diagonal, so it takes four boxes: one rectangle would reach across the
        # coast and take Ashdod and Palmachim off the sheet with it.
        (15, 400, 755, 1125),
        (15, 400, 640, 1350),
        (15, 400, 480, 1600),
        (15, 400, 370, 1900),
        (0, 2700, 1984, 2760),      # publication footer
    ],
    'south': [
        (20, 30, 240, 160),         # ELEV ALT IN FEET / DIST IN NM / BRG ARE MAG
        (1590, 30, 1970, 2280),     # the numbered area notes, then the symbol legend
        (1450, 2240, 1990, 2705),   # title block
        (30, 1650, 385, 1935),      # general notes
        (30, 1940, 510, 2475),      # aerodrome frequency table
        (40, 2515, 830, 2705),      # scale bars, 1:250,000
        (0, 2708, 1984, 2760),      # publication footer
    ],
}

TILE = 256
EARTH_C = 40075016.685578488                            # equatorial circumference, metres
FEATHER_PT = 6.0                                        # frame-edge alpha ramp, PDF points


# --- the sheet's graticule ---------------------------------------------------------

def labels(pdf):
    """Every DD°MM'{N,E} tick label on page 1, as (degrees, x, y, hemisphere) in points."""
    out = subprocess.run(['pdftotext', '-bbox', '-f', '1', '-l', '1', str(pdf), '-'],
                         capture_output=True, text=True, check=True).stdout
    rows = []
    for x0, y0, x1, y1, word in WORD.findall(out):
        t = html.unescape(word).replace('’', "'").strip().strip(BIDI).strip()
        m = DM.match(t)
        if m:
            rows.append((int(m.group(1)) + int(m.group(2)) / 60.0,
                         (float(x0) + float(x1)) / 2, (float(y0) + float(y1)) / 2,
                         m.group(3)))
    return rows


def frame(rows):
    """The four edge tick tables, found by the bands the edge labels line up on.

    The north sheet's inset enlargement has a graticule of its own, at a different scale.
    It is kept out by the count: an inset edge musters five ticks, the sheet's own thirteen.
    """
    lat = [r for r in rows if r[3] == 'N']
    lng = [r for r in rows if r[3] == 'E']
    if len(lat) < 16 or len(lng) < 16:
        raise SystemExit(f'only {len(lat)} lat / {len(lng)} lon ticks — is this a CVFR sheet?')

    def band(vals, pick):
        hist = {}
        for v in vals:
            hist[round(v)] = hist.get(round(v), 0) + 1
        return pick(hist)

    y_top = band([r[2] for r in lng], lambda h: min(k for k, n in h.items() if n >= 8))
    y_bot = band([r[2] for r in lng], lambda h: max(k for k, n in h.items() if n >= 8))
    x_left = band([r[1] for r in lat], lambda h: min(k for k, n in h.items() if n >= 8))
    x_right = band([r[1] for r in lat], lambda h: max(k for k, n in h.items() if n >= 8))
    near = lambda a, b: abs(a - b) < 4
    T = {
        'top':    sorted((v, x) for v, x, y, _ in lng if near(y, y_top)),
        'bottom': sorted((v, x) for v, x, y, _ in lng if near(y, y_bot)),
        'left':   sorted((v, y) for v, x, y, _ in lat if near(x, x_left)),
        'right':  sorted((v, y) for v, x, y, _ in lat if near(x, x_right)),
        'Y_TOP': float(y_top), 'Y_BOT': float(y_bot),
        'X_L': float(x_left), 'X_R': float(x_right),
    }
    for k in ('top', 'bottom', 'left', 'right'):
        if len(T[k]) < 8:
            raise SystemExit(f"only {len(T[k])} ticks on the {k} edge — is this a CVFR sheet?")
    return T


def cone(T):
    """The sheet's conic frame: the apex its meridians meet at, and r(latitude) about it."""
    tops, bots = dict(T['top']), dict(T['bottom'])
    rows, rhs = [], []
    for v in sorted(set(tops) & set(bots)):
        p = np.array([tops[v], T['Y_TOP']])
        d = np.array([bots[v] - tops[v], T['Y_BOT'] - T['Y_TOP']])
        d = d / np.hypot(*d)
        n = np.array([-d[1], d[0]])                     # a point is on the line iff n·(X-p)=0
        rows.append(n)
        rhs.append(n @ p)
    apex, *_ = np.linalg.lstsq(np.array(rows), np.array(rhs), rcond=None)

    lefts, rights = dict(T['left']), dict(T['right'])
    lats, radii, worst = [], [], 0.0
    for v in sorted(set(lefts) & set(rights)):
        rl = np.hypot(T['X_L'] - apex[0], lefts[v] - apex[1])
        rr = np.hypot(T['X_R'] - apex[0], rights[v] - apex[1])
        worst = max(worst, abs(rr - rl))
        lats.append(v)
        radii.append((rl + rr) / 2)
    # A parallel that is not a circle about this apex shows up here as its two ends
    # disagreeing. Refuse rather than tile a chart placed on a shape the paper does not use.
    if worst > 0.001 * float(np.mean(radii)):
        raise SystemExit(f'parallel radii disagree by {worst:.1f} pt — not a conic sheet?')
    return apex, np.array(lats), np.array(radii), worst


def meridian_angle(T, apex):
    """Angle from the apex as a function of longitude. On a conic it is exactly linear."""
    tv = np.array([a for a, _ in T['top']])
    tx = np.array([b for _, b in T['top']])
    ux, uy = tx - apex[0], T['Y_TOP'] - apex[1]
    un = np.hypot(ux, uy)
    ang = np.unwrap(np.arctan2(ux / un, uy / un))
    slope, intercept = np.polyfit(tv, ang, 1)
    return float(slope), float(intercept)


def _extend(v, xs, ys):
    """np.interp, but continuing the end segment instead of flattening at the last point.

    The outermost ticks sit inside the neat line, so a strip of real chart lies past them.
    Flattening there would smear that strip into a column of repeated pixels.
    """
    v = np.asarray(v, dtype=float)
    out = np.interp(v, xs, ys)
    lo, hi = v < xs[0], v > xs[-1]
    if np.any(lo):
        out = np.where(lo, ys[0] + (v - xs[0]) * (ys[1] - ys[0]) / (xs[1] - xs[0]), out)
    if np.any(hi):
        out = np.where(hi, ys[-1] + (v - xs[-1]) * (ys[-1] - ys[-2]) / (xs[-1] - xs[-2]), out)
    return out


class Sheet:
    """One CVFR PDF: its conic model, its rendered raster, and the box it may be sampled in."""

    def __init__(self, pdf, dpi, masks=()):
        self.pdf = Path(pdf)
        self.T = frame(labels(self.pdf))
        self.apex, self.plats, self.pradii, self.worst = cone(self.T)
        self.slope, self.intercept = meridian_angle(self.T, self.apex)
        self.dpi = float(dpi)
        self.k = self.dpi / 72.0
        self.masks = list(masks)
        self.img = None
        # Which sheet this is, asked of the paper rather than the filename: the two overlap
        # by ten minutes of latitude and nothing else about them is ambiguous.
        self.which = 'north' if self.plats.max() > 32.5 else 'south'

    def pt_per_deg_lat(self):
        return float(abs(np.polyfit(self.plats, self.pradii, 1)[0]))

    def bounds(self):
        """lat0, lat1, lon0, lon1 of the sheet's own frame corners."""
        lon_of = lambda a: (a - self.intercept) / self.slope
        lons, lats = [], []
        for x in (self.T['X_L'], self.T['X_R']):
            for y in (self.T['Y_TOP'], self.T['Y_BOT']):
                dx, dy = x - self.apex[0], y - self.apex[1]
                h = math.hypot(dx, dy)
                lons.append(lon_of(math.atan2(dx / h, dy / h)))
                lats.append(float(_extend(h, self.pradii[::-1], self.plats[::-1])))
        return min(lats), max(lats), min(lons), max(lons)

    def render(self):
        if self.img is not None:
            return self.img
        with tempfile.TemporaryDirectory() as tmp:
            stem = os.path.join(tmp, 'page')
            subprocess.run(['pdftoppm', '-png', '-r', str(int(round(self.dpi))),
                            '-f', '1', '-l', '1', str(self.pdf), stem],
                           capture_output=True, check=True)
            png = sorted(Path(tmp).glob('page*.png'))[0]
            self.img = np.asarray(Image.open(png).convert('RGB'))
        return self.img

    def sample(self, lat, lon):
        """Bilinear RGBA for a grid of positions. Alpha ramps to 0 at the neat line."""
        src = self.render()
        H, W, _ = src.shape
        A = self.intercept + self.slope * lon
        R = _extend(lat, self.plats, self.pradii)
        Xp = self.apex[0] + R * np.sin(A)                # PDF points
        Yp = self.apex[1] + R * np.cos(A)
        X, Y = Xp * self.k, Yp * self.k

        x0 = np.clip(np.floor(X).astype(np.int32), 0, W - 2)
        y0 = np.clip(np.floor(Y).astype(np.int32), 0, H - 2)
        fx = np.clip(X - x0, 0, 1)[..., None]
        fy = np.clip(Y - y0, 0, 1)[..., None]
        rgb = (src[y0, x0] * (1 - fx) * (1 - fy) + src[y0, x0 + 1] * fx * (1 - fy) +
               src[y0 + 1, x0] * (1 - fx) * fy + src[y0 + 1, x0 + 1] * fx * fy)

        # Inside the neat line, in points, with a short ramp so two sheets can meet.
        d = np.minimum.reduce([Xp - self.T['X_L'], self.T['X_R'] - Xp,
                               Yp - self.T['Y_TOP'], self.T['Y_BOT'] - Yp])
        # A printed panel is a hole in the chart, cut in the paper's own coordinates so it
        # costs nothing at render time and stays put at any dpi.
        for x0, y0, x1, y1 in self.masks:
            d = np.minimum(d, -np.minimum.reduce([Xp - x0, x1 - Xp, Yp - y0, y1 - Yp]))
        alpha = np.clip(d / FEATHER_PT, 0, 1)
        alpha[(X < 0) | (X > W - 1) | (Y < 0) | (Y > H - 1)] = 0     # never invent chart
        out = np.empty(rgb.shape[:2] + (4,), dtype=np.uint8)
        out[..., :3] = rgb.astype(np.uint8)
        out[..., 3] = (alpha * 255).astype(np.uint8)
        return out


# --- Web Mercator ------------------------------------------------------------------

def lon2x(lon, z):
    return (lon + 180.0) / 360.0 * (1 << z)


def lat2y(lat, z):
    s = math.sin(math.radians(lat))
    return (0.5 - math.log((1 + s) / (1 - s)) / (4 * math.pi)) * (1 << z)


def tile_grid(z, x, y):
    """(lat, lon) at the centre of every pixel of tile z/x/y."""
    n = 1 << z
    lon = (x + (np.arange(TILE) + 0.5) / TILE) / n * 360.0 - 180.0
    yy = (y + (np.arange(TILE) + 0.5) / TILE) / n
    lat = np.degrees(2 * np.arctan(np.exp(np.pi * (1 - 2 * yy))) - np.pi / 2)
    return np.meshgrid(lon, lat)[::-1]                   # LAT, LON


def over(dst, src):
    """src over dst, both uint8 RGBA."""
    sa = src[..., 3:4].astype(np.float32) / 255.0
    da = dst[..., 3:4].astype(np.float32) / 255.0
    oa = sa + da * (1 - sa)
    rgb = np.where(oa > 0,
                   (src[..., :3] * sa + dst[..., :3] * da * (1 - sa)) / np.maximum(oa, 1e-6),
                   0)
    out = np.empty_like(dst)
    out[..., :3] = np.clip(rgb, 0, 255).astype(np.uint8)
    out[..., 3] = (oa[..., 0] * 255).astype(np.uint8)
    return out


def save_tile(path, arr, colors):
    if not arr[..., 3].any():
        return False
    path.parent.mkdir(parents=True, exist_ok=True)
    img = Image.fromarray(arr, 'RGBA')
    if colors:
        # Quantise the colour, keep the alpha binary-ish: these are flat chart inks, and a
        # palette costs a third of the bytes for no visible difference.
        a = arr[..., 3]
        img = img.convert('RGB').quantize(colors=colors, method=Image.MEDIANCUT).convert('RGBA')
        img.putalpha(Image.fromarray(a))
    tmp = path.with_name(path.name + '.tmp')
    img.save(tmp, 'PNG', optimize=True)
    os.replace(tmp, path)
    return True


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('pdfs', nargs='+', help='the CVFR sheets, in any order')
    ap.add_argument('--out', required=True, help='tile root; tiles land at {z}/{x}/{y}.png')
    ap.add_argument('--min-zoom', type=int, default=8)
    ap.add_argument('--max-zoom', type=int, default=13)
    ap.add_argument('--dpi', type=float, default=0,
                    help='render dpi (default: whatever matches --max-zoom)')
    ap.add_argument('--colors', type=int, default=128, help='palette size (0 keeps RGB)')
    ap.add_argument('--mask', action='append', default=[], metavar='SHEET:x0,y0,x1,y1',
                    help='cut an extra box, in PDF points, from north|south')
    ap.add_argument('--no-crop', action='store_true',
                    help='keep the printed panels (title, notes, tables, legend, inset)')
    args = ap.parse_args()

    extra = {}
    for spec in args.mask:
        who, box = spec.split(':', 1)
        extra.setdefault(who, []).append(tuple(float(v) for v in box.split(',')))

    sheets = []
    for pdf in args.pdfs:
        s = Sheet(pdf, 1)                                # dpi fixed below, once we know scale
        s.masks = [] if args.no_crop else list(PANELS[s.which]) + extra.get(s.which, [])
        sheets.append(s)

    # One dpi for every sheet, chosen so a source pixel is about an output pixel at the
    # deepest zoom: sampling much below 1:1 throws away ink, much above only costs time.
    res = EARTH_C * math.cos(math.radians(31.5)) / (TILE * (1 << args.max_zoom))
    finest = max(111320.0 / s.pt_per_deg_lat() for s in sheets)      # metres per point
    dpi = args.dpi or math.ceil(72.0 * finest / res / 10) * 10
    for s in sheets:
        s.dpi = dpi
        s.k = dpi / 72.0

    print(f'target z{args.max_zoom}: {res:.1f} m/px; sheets are {finest:.1f} m/pt '
          f'-> rendering at {dpi:.0f} dpi')
    for s in sheets:
        lat0, lat1, lon0, lon1 = s.bounds()
        print(f'  {s.pdf.name}: lat {lat0:.4f}..{lat1:.4f} lon {lon0:.4f}..{lon1:.4f}; '
              f'parallels agree to {s.worst:.2f} pt in {s.pradii.mean():.0f}; '
              f'{s.which} sheet, {len(s.masks)} panel(s) cut')

    root = Path(os.path.expanduser(args.out))
    z = args.max_zoom
    written = 0
    for s in sheets:
        lat0, lat1, lon0, lon1 = s.bounds()
        x_lo, x_hi = int(lon2x(lon0, z)), int(lon2x(lon1, z))
        y_lo, y_hi = int(lat2y(lat1, z)), int(lat2y(lat0, z))
        total = (x_hi - x_lo + 1) * (y_hi - y_lo + 1)
        print(f'  {s.pdf.name}: z{z} x {x_lo}..{x_hi} y {y_lo}..{y_hi} ({total} tiles)')
        s.render()
        print(f'    rendered {s.img.shape[1]}×{s.img.shape[0]} px')
        done = 0
        for tx in range(x_lo, x_hi + 1):
            for ty in range(y_lo, y_hi + 1):
                LAT, LON = tile_grid(z, tx, ty)
                arr = s.sample(LAT, LON)
                if not arr[..., 3].any():
                    continue
                path = root / str(z) / str(tx) / f'{ty}.png'
                if path.exists():
                    old = np.asarray(Image.open(path).convert('RGBA'))
                    arr = over(old, arr)
                if save_tile(path, arr, args.colors):
                    written += 1
                done += 1
                if done % 250 == 0:
                    print(f'    {done} tiles', flush=True)
        s.img = None                                     # 500 MB; do not hold two at once

    print(f'z{z}: {written} tiles')

    # Lower zooms are a pyramid, not another warp: four children average into a parent, which
    # is both faster and softer on the eye than resampling the sheet six more times.
    for z in range(args.max_zoom - 1, args.min_zoom - 1, -1):
        kids = root / str(z + 1)
        parents = {}
        for xd in kids.iterdir():
            if not xd.is_dir():
                continue
            for f in xd.glob('*.png'):
                parents.setdefault((int(xd.name) // 2, int(f.stem) // 2), []).append(
                    (int(xd.name), int(f.stem), f))
        n = 0
        for (px, py), children in sorted(parents.items()):
            canvas = Image.new('RGBA', (TILE * 2, TILE * 2), (0, 0, 0, 0))
            for cx, cy, f in children:
                canvas.paste(Image.open(f).convert('RGBA'),
                             ((cx - px * 2) * TILE, (cy - py * 2) * TILE))
            arr = np.asarray(canvas.resize((TILE, TILE), Image.LANCZOS))
            if save_tile(root / str(z) / str(px) / f'{py}.png', arr, args.colors):
                n += 1
        print(f'z{z}: {n} tiles')

    size = sum(f.stat().st_size for f in root.rglob('*.png'))
    count = sum(1 for _ in root.rglob('*.png'))
    print(f'{count} tiles, {size / 1048576:.0f} MB under {root}')


if __name__ == '__main__':
    main()
