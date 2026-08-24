#!/usr/bin/env python3
"""Reproject the CAA's ATS routes sheet (ENR 6.1) into Web Mercator, for docs/ats-img/.

    python3 scripts/warp-ats-chart.py ATS.pdf --out docs/ats-img/ats-routes.png \
        --bounds docs/data/ats-chart.json

Why a warp at all, when every other overlay in this app is placed as printed: the airfield
plates cover a few miles, where the difference between the paper's projection and the map's
is smaller than the ink. This sheet covers the whole FIR. Its meridians converge -- measured
on the sheet itself, a degree of longitude takes 92.7 pt at the top edge and 96.6 pt at the
bottom, tracking cos(latitude) to a third of a percent, which is what "conformal" means and
what Web Mercator is NOT (Mercator holds longitude constant and stretches latitude instead).
Laid down as printed, the sheet reads about four kilometres out at its corners.

The model is the sheet's own graticule, read with pdftotext -bbox:

  * a meridian is a straight line between its top and bottom edge ticks;
  * a parallel is taken as a straight line between its left and right edge ticks. On this
    sheet the two ends of a parallel differ by ~5 pt in y over 1518 pt of width, so the chord
    stands in for the arc to well under a pixel of the shipped raster.

A geographic position is then the intersection of its meridian and its parallel, and the
output raster is filled by sampling that mapping -- bilinear, one pass, no dependencies
beyond numpy/Pillow (there is no GDAL in this repo's toolchain).

Only the box the sheet labels on all four sides is shipped: nothing is extrapolated past the
outermost tick. The insets and the legend panels are inside that box on the paper, so they
come along -- they sit over the sea and over Sinai, which is where the paper puts them.
"""

import argparse, html, json, re, subprocess, sys

try:
    import numpy as np
    from PIL import Image
except ModuleNotFoundError as exc:                      # same message as georef-plate.py
    raise SystemExit(
        f"Missing Python dependency {exc.name!r}; run "
        "python3 -m pip install -r scripts/requirements-georef.txt"
    ) from exc

WORD = re.compile(r'<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]*)</word>')
DM = re.compile(r"^(\d{2})°(\d{2})'$")


def labels(pdf):
    """Every DD°MM' label on page 1, as (degrees, x, y) in PDF points."""
    out = subprocess.run(['pdftotext', '-bbox', '-f', '1', '-l', '1', pdf, '-'],
                         capture_output=True, text=True, check=True).stdout
    rows = []
    for x0, y0, x1, y1, word in WORD.findall(out):
        m = DM.match(html.unescape(word).strip().replace('’', "'"))
        if m:
            rows.append((int(m.group(1)) + int(m.group(2)) / 60.0,
                         (float(x0) + float(x1)) / 2, (float(y0) + float(y1)) / 2))
    return rows


def frame(rows):
    """The four edge tick tables, found by the bands the edge labels line up on.

    The sheet also carries inset enlargements with graticules of their own, and radials that
    read like degrees. Taking only the labels that sit on the frame's own bands is what keeps
    those out: an inset label is nowhere near the edge its value would have to be on.
    """
    def band(vals, pick):
        hist = {}
        for v in vals:
            hist[round(v)] = hist.get(round(v), 0) + 1
        return pick(hist)
    ys = [y for _, _, y in rows]
    xs = [x for _, x, _ in rows]
    y_top = band(ys, lambda h: min(k for k, n in h.items() if n >= 8))
    y_bot = band(ys, lambda h: max(k for k, n in h.items() if n >= 8))
    x_left = band(xs, lambda h: min(k for k, n in h.items() if n >= 8))
    x_right = band(xs, lambda h: max(k for k, n in h.items() if n >= 8))
    near = lambda a, b: abs(a - b) < 3
    T = {
        'top':    sorted((v, x) for v, x, y in rows if near(y, y_top)),
        'bottom': sorted((v, x) for v, x, y in rows if near(y, y_bot)),
        'left':   sorted((v, y) for v, x, y in rows if near(x, x_left)),
        'right':  sorted((v, y) for v, x, y in rows if near(x, x_right)),
        'Y_TOP': float(y_top), 'Y_BOT': float(y_bot),
        'X_L': float(x_left), 'X_R': float(x_right),
    }
    for k in ('top', 'bottom', 'left', 'right'):
        if len(T[k]) < 4:
            raise SystemExit(f"only {len(T[k])} ticks on the {k} edge — is this the ATS sheet?")
    return T


def render(pdf, dpi):
    png = subprocess.run(['pdftoppm', '-png', '-r', str(dpi), '-f', '1', '-l', '1', pdf],
                         capture_output=True, check=True).stdout
    import io as _io
    return np.asarray(Image.open(_io.BytesIO(png)).convert('RGB'))


def warp(src, T, dpi, out_w, lon0, lon1, lat0, lat1):
    merc = lambda lat: np.log(np.tan(np.pi / 4 + np.radians(lat) / 2))
    imerc = lambda y: np.degrees(2 * np.arctan(np.exp(y)) - np.pi / 2)
    k = dpi / 72.0
    H, W, _ = src.shape
    y_top, y_bot = merc(lat1), merc(lat0)
    out_h = int(round(out_w * (y_top - y_bot) / np.radians(lon1 - lon0)))
    lon = lon0 + (np.arange(out_w) + 0.5) / out_w * (lon1 - lon0)
    lat = imerc(y_top - (np.arange(out_h) + 0.5) / out_h * (y_top - y_bot))
    LON, LAT = np.meshgrid(lon, lat)

    cols = lambda t: (np.array([a for a, _ in T[t]]), np.array([b for _, b in T[t]]))
    tv, tx = cols('top'); bv, bx = cols('bottom')
    lv, ly = cols('left'); rv, ry = cols('right')
    xt = np.interp(LON, tv, tx); xb = np.interp(LON, bv, bx)
    yl = np.interp(LAT, lv, ly); yr = np.interp(LAT, rv, ry)
    mx, my = xb - xt, T['Y_BOT'] - T['Y_TOP']            # meridian direction
    px, py = T['X_R'] - T['X_L'], yr - yl                # parallel direction
    s = ((T['X_L'] - xt) * (-py) + px * (yl - T['Y_TOP'])) / (mx * (-py) + px * my)
    X = (xt + s * mx) * k
    Y = (T['Y_TOP'] + s * my) * k

    x0 = np.clip(np.floor(X).astype(np.int32), 0, W - 2)
    y0 = np.clip(np.floor(Y).astype(np.int32), 0, H - 2)
    fx = np.clip(X - x0, 0, 1)[..., None]
    fy = np.clip(Y - y0, 0, 1)[..., None]
    out = (src[y0, x0] * (1 - fx) * (1 - fy) + src[y0, x0 + 1] * fx * (1 - fy) +
           src[y0 + 1, x0] * (1 - fx) * fy + src[y0 + 1, x0 + 1] * fx * fy).astype(np.uint8)
    out[(X < 0) | (X > W - 1) | (Y < 0) | (Y > H - 1)] = 255      # never invent chart
    return Image.fromarray(out)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('pdf')
    ap.add_argument('--out', default='docs/ats-img/ats-routes.png')
    ap.add_argument('--bounds', default='docs/data/ats-chart.json')
    ap.add_argument('--dpi', type=float, default=150.0)
    ap.add_argument('--width', type=int, default=2400, help='shipped raster width in px')
    ap.add_argument('--colors', type=int, default=128, help='palette size (0 keeps RGB)')
    args = ap.parse_args()

    T = frame(labels(args.pdf))
    # The box both tick rows cover: outside it a meridian or a parallel would be extrapolated.
    lon0 = max(T['top'][0][0], T['bottom'][0][0])
    lon1 = min(T['top'][-1][0], T['bottom'][-1][0])
    lat0 = max(T['left'][0][0], T['right'][0][0])
    lat1 = min(T['left'][-1][0], T['right'][-1][0])
    print(f'graticule box  lat {lat0:.4f}..{lat1:.4f}  lon {lon0:.4f}..{lon1:.4f}')

    img = warp(render(args.pdf, args.dpi), T, args.dpi, args.width, lon0, lon1, lat0, lat1)
    if args.colors:
        img = img.convert('P', palette=Image.ADAPTIVE, colors=args.colors)
    img.save(args.out, optimize=True)
    print(f'wrote {args.out}  {img.width}×{img.height}')

    try:
        meta = json.load(open(args.bounds, encoding='utf-8'))
    except FileNotFoundError:
        meta = {'png': args.out.rsplit('/', 1)[-1]}
    meta['sw'] = [round(lat0, 6), round(lon0, 6)]
    meta['ne'] = [round(lat1, 6), round(lon1, 6)]
    with open(args.bounds, 'w', encoding='utf-8') as fh:
        json.dump(meta, fh, ensure_ascii=False, indent=2)
        fh.write('\n')
    print(f'wrote {args.bounds}')


if __name__ == '__main__':
    main()
