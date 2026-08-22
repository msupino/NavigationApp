#!/usr/bin/env python3
"""Georeference an AIP plate from its own graticule, for docs/data/airfields.json.

    python3 scripts/georef-plate.py "docs/byop/LLBS_airport_Annex Gimel.pdf" LLBS
    python3 scripts/georef-plate.py PLATE.pdf LLBO --lon 34:55=292.5 35:00=572.5 \
                                                   --lat 32:45=245.5 32:40=577.5

It reads the plate's degree labels with pdftotext, decides which screen axis each degree
axis runs along (the plates are printed both north-up and rotated ninety degrees), snaps the
fit to the minute ticks in the gutter between the double neat line, and crops to that neat
line. Plates whose labels are drawn as outlines carry no extractable text -- measure their
label centres off the render and pass them with --lon/--lat.

Two numbers say whether the result can be trusted, and both are printed:

  conformality  a degree of longitude covers cos(latitude) as much ground as a degree of
                latitude, so a correct fit sits at 1.00. A stretch or a misread axis does not.
  arp_frac      where the dataset already says the airfield is, as a fraction of the frame:
                compare it with where the plate draws the field.

Install the pinned Python packages with
`python3 -m pip install -r scripts/requirements-georef.txt`. The `pdftotext`, `pdfinfo`,
and `pdftoppm` commands come from Poppler (`brew install poppler` on macOS).
"""

import math, re, subprocess
try:
    import numpy as np
    from PIL import Image
except ModuleNotFoundError as exc:
    raise SystemExit(
        f"Missing Python dependency {exc.name!r}; run "
        "python3 -m pip install -r scripts/requirements-georef.txt"
    ) from exc

DMS = re.compile(r"^(\d{2})°(\d{2})['’]?([NEWS]?)$")

def labels(pdf):
    xml = subprocess.run(['pdftotext','-bbox',pdf,'-'], capture_output=True, text=True).stdout
    out = []
    for m in re.finditer(r'xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">(.*?)</word>', xml):
        x0,y0,x1,y1,t = float(m[1]),float(m[2]),float(m[3]),float(m[4]),m[5].replace('&apos;',"'")
        g = DMS.match(t)
        if not g: continue
        deg = int(g[1]) + int(g[2])/60.0
        w, h = x1-x0, y1-y0
        if g[3]:                      # a trailing N/E is drawn past the tick: trim it back
            n = len(t)
            if h > w: y1 -= h/n
            else:     x1 -= w/n
        out.append({'text': t, 'deg': deg, 'cx': (x0+x1)/2, 'cy': (y0+y1)/2})
    return out

def _fit(vals, key):
    xs = np.array([v[key] for v in vals]); ys = np.array([v['deg'] for v in vals])
    A = np.vstack([xs, np.ones(len(xs))]).T
    (m, b), *_ = np.linalg.lstsq(A, ys, rcond=None)
    return m, b, float(np.max(np.abs(A @ [m, b] - ys)))

def axis(vals):
    """Which pixel coordinate this degree axis runs along, and its best line fit.

    The same tick is labelled on both sides of the plate, and the two rows sit a few points
    apart because the text is aligned differently on each. Mixing them costs an order of
    magnitude in residual, so fit each row on its own and keep the tightest.
    """
    mx, bx, rx = _fit(vals, 'cx')
    my, by, ry = _fit(vals, 'cy')
    along, const = ('cx', 'cy') if rx <= ry else ('cy', 'cx')
    groups = {}
    for v in vals:
        groups.setdefault(round(v[const] / 20), []).append(v)
    best = None
    for g in groups.values():
        if len(g) < 2: continue
        m, b, r = _fit(g, along)
        if best is None or (r, -len(g)) < (best[3], -best[4]):
            best = (along, m, b, r, len(g))
    if best is None:
        return (along, mx, bx, rx) if along == 'cx' else (along, my, by, ry)
    return best[0], best[1], best[2], best[3]

def frame(png, scale, lo, hi):
    a = np.array(Image.open(png).convert('L')); H, W = a.shape
    dark = a < 100
    def runs(idx):
        g = []
        for i in idx:
            if g and i - g[-1][-1] <= 2: g[-1].append(i)
            else: g.append([i])
        return [(x[0]+x[-1])//2 for x in g]
    rows = runs([y for y in range(H) if dark[y].sum() > W*0.55])
    cols = runs([x for x in range(W) if dark[:,x].sum() > H*0.55])
    return rows, cols, W, H


def _even(ticks, tol=0.06):
    """Is this a graticule scale? Evenly spaced marks, at least five of them."""
    if len(ticks) < 5: return False
    d = np.diff(ticks)
    return d.mean() > 4 and d.std() / d.mean() < tol

def ticks_along(png, edge, lo, hi, inner):
    """The minute ticks drawn in the gutter between the plate's double neat line.

    Their positions are the truth: the same tick is labelled on both sides of the plate and
    only one of the two label rows is actually centred on it, so fitting text positions can
    put the whole chart a few hundred metres out.
    """
    a = np.array(Image.open(png).convert('L'))
    best = None
    for depth in range(2, 34):
        for thick in (3, 5, 7):
            if edge == 'top':    band = a[inner-depth-thick:inner-depth, :]
            elif edge == 'bottom': band = a[inner+depth:inner+depth+thick, :]
            elif edge == 'left':  band = a[:, inner-depth-thick:inner-depth].T
            else:                 band = a[:, inner+depth:inner+depth+thick].T
            if band.size == 0 or band.shape[0] == 0: continue
            d = band < 180
            hits = [i for i in range(lo, hi+1) if d[:, i].sum() >= max(2, band.shape[0]-1)]
            g = []
            for i in hits:
                if g and i - g[-1][-1] <= 3: g[-1].append(i)
                else: g.append([i])
            marks = [(x[0]+x[-1])/2 for x in g]
            if _even(marks) and (best is None or len(marks) > len(best)):
                best = marks
    return best or []

def snap(vals, key, marks, scale):
    """Move each label onto the tick it belongs to, in PDF points."""
    if not marks: return vals
    out = []
    for v in vals:
        px = v[key] * scale
        near = min(marks, key=lambda m: abs(m - px))
        # A label more than a minute and a half from any tick is not a graticule label.
        step = float(np.median(np.diff(marks))) if len(marks) > 1 else 1e9
        if abs(near - px) > step * 1.5: continue
        w = dict(v); w[key] = near / scale
        out.append(w)
    return out or vals

def georef(pdf, png, arp):
    ls = labels(pdf)
    lon = [l for l in ls if l['deg'] >= 34.0]          # Israel: lon 34.2+, lat below 33.5
    lat = [l for l in ls if l['deg'] < 34.0]
    if len(lon) < 2 or len(lat) < 2:
        return {'error': f'graticule labels lon={len(lon)} lat={len(lat)}'}
    lat_key, mlat, blat, rlat = axis(lat)
    lon_key, mlon, blon, rlon = axis(lon)
    if lat_key == lon_key:
        return {'error': f'both axes fit {lat_key}'}
    page = subprocess.run(['pdfinfo', pdf], capture_output=True, text=True).stdout
    pw, ph = (float(v) for v in re.search(r'Page size:\s+([\d.]+) x ([\d.]+)', page).groups())
    im = Image.open(png); W, H = im.size
    scale = W / pw
    rows, cols, _, _ = frame(png, scale, None, None)
    xs = [l['cx']*scale for l in ls]; ys = [l['cy']*scale for l in ls]
    xlab = [l['cx']*scale for l in (lat if lat_key=='cx' else lon)]
    ylab = [l['cy']*scale for l in (lat if lat_key=='cy' else lon)]
    left  = max([c for c in cols if c <= min(xlab)] or [cols[0]])
    right = min([c for c in cols if c >= max(xlab)] or [cols[-1]])
    top    = max([r for r in rows if r <= min(ylab)] or [rows[0]])
    bottom = min([r for r in rows if r >= max(ylab)] or [rows[-1]])
    # Re-fit against the ticks themselves wherever they can be found.
    xs_lo, xs_hi = int(left), int(right)
    ys_lo, ys_hi = int(top), int(bottom)
    tx = ticks_along(png, 'top', xs_lo, xs_hi, int(top)) or ticks_along(png, 'bottom', xs_lo, xs_hi, int(bottom))
    ty = ticks_along(png, 'left', ys_lo, ys_hi, int(left)) or ticks_along(png, 'right', ys_lo, ys_hi, int(right))
    lat_marks = ty if lat_key == 'cy' else tx
    lon_marks = tx if lat_key == 'cy' else ty
    lat_s = snap(lat, lat_key, lat_marks, scale)
    lon_s = snap(lon, lon_key, lon_marks, scale)
    # Snapping is only an improvement when the labels really did land on those marks: on a
    # plate whose gutter holds something else, it makes the fit worse, and the fit says so.
    if len(lat_s) >= 2:
        m2, b2, r2 = _fit(lat_s, lat_key)
        if r2 <= rlat: mlat, blat, rlat = m2, b2, r2
    if len(lon_s) >= 2:
        m2, b2, r2 = _fit(lon_s, lon_key)
        if r2 <= rlon: mlon, blon, rlon = m2, b2, r2
    at = lambda m, b, px: m*(px/scale) + b
    LAT = lambda px: at(mlat, blat, px)
    LON = lambda px: at(mlon, blon, px)
    north_up = (lat_key == 'cy')
    if north_up:
        box = {'sw': [round(LAT(bottom),5), round(LON(left),5)],
               'ne': [round(LAT(top),5),    round(LON(right),5)]}
        corners = {'tl': (LAT(top), LON(left)), 'tr': (LAT(top), LON(right)),
                   'bl': (LAT(bottom), LON(left))}
    else:
        # Rotated print: latitude runs across the page, longitude up it.
        box = {'tl': [round(LAT(left),5),  round(LON(top),5)],
               'tr': [round(LAT(right),5), round(LON(top),5)],
               'bl': [round(LAT(left),5),  round(LON(bottom),5)]}
        corners = {'tl': (LAT(left), LON(top)), 'tr': (LAT(right), LON(top)),
                   'bl': (LAT(left), LON(bottom))}
    # Conformality: a degree of longitude is cos(lat) as wide on the ground as a degree of
    # latitude, so a correct fit has this at 1.00. A stretch or a misread axis does not.
    span_lat = abs(corners['tl'][0] - corners['bl'][0]) if north_up else abs(corners['tr'][0]-corners['tl'][0])
    span_lon = abs(corners['tr'][1] - corners['tl'][1]) if north_up else abs(corners['bl'][1]-corners['tl'][1])
    px_lat = (bottom-top) if north_up else (right-left)
    px_lon = (right-left) if north_up else (bottom-top)
    midlat = (corners['tl'][0] + corners['bl'][0]) / 2 if north_up else (corners['tl'][0]+corners['tr'][0])/2
    conform = ((span_lon*math.cos(math.radians(midlat))/px_lon) / (span_lat/px_lat))
    out = {'frame': (left, top, right, bottom), 'north_up': north_up,
           'resid_deg': (round(rlon,5), round(rlat,5)), 'conformality': round(conform,4)}
    out.update(box)
    if arp:
        # Where the dataset says the field is, as a fraction of the frame.
        if north_up:
            fx = (arp[1]-corners['tl'][1])/(corners['tr'][1]-corners['tl'][1])
            fy = (corners['tl'][0]-arp[0])/(corners['tl'][0]-corners['bl'][0])
        else:
            fx = (corners['tl'][0]-arp[0])/(corners['tl'][0]-corners['tr'][0])
            fy = (corners['tl'][1]-arp[1])/(corners['tl'][1]-corners['bl'][1])
        out['arp_frac'] = (round(fx,3), round(fy,3))
    return out



def georef_manual(pdf, png, lon_px, lat_px, arp):
    """Same fit, from label centres measured by hand.

    Some plates draw their degree labels as outlines, so there is no text to read: measure
    each label's centre in the rendered page and pass it in. A trailing N or E lengthens the
    text and pulls its centre off the tick -- trim that before measuring.
    """
    import numpy as _np
    rows, cols, W, H = frame(png, 1, None, None)
    xs = sorted(lon_px.values()); ys = sorted(lat_px.values())
    left  = max([c for c in cols if c <= min(xs)] or [cols[0]])
    right = min([c for c in cols if c >= max(xs)] or [cols[-1]])
    top    = max([r for r in rows if r <= min(ys)] or [rows[0]])
    bottom = min([r for r in rows if r >= max(ys)] or [rows[-1]])
    def line(d):
        px = _np.array(list(d.values())); deg = _np.array(list(d.keys()))
        A = _np.vstack([px, _np.ones(len(px))]).T
        (m, b), *_ = _np.linalg.lstsq(A, deg, rcond=None)
        return m, b, float(_np.max(abs(A @ [m, b] - deg)))
    mlon, blon, rlon = line(lon_px)
    mlat, blat, rlat = line(lat_px)
    LON = lambda x: mlon*x + blon
    LAT = lambda y: mlat*y + blat
    west, east, north, south = LON(left), LON(right), LAT(top), LAT(bottom)
    mid = (north + south) / 2
    conform = (abs(1/mlon) / math.cos(math.radians(mid))) / abs(1/mlat)
    out = {'frame': (left, top, right, bottom), 'north_up': True,
           'resid_deg': (round(rlon, 6), round(rlat, 6)), 'conformality': round(conform, 4),
           'sw': [round(south, 5), round(west, 5)], 'ne': [round(north, 5), round(east, 5)]}
    if arp:
        out['arp_frac'] = (round((arp[1]-west)/(east-west), 3),
                           round((north-arp[0])/(north-south), 3))
    return out


def _anchor(arg):
    """--lon 34:55=292.5 -> (34.9167, 292.5), a label centre measured off the render."""
    dms, px = arg.split('=')
    d, m = dms.split(':')
    return int(d) + int(m)/60.0, float(px)


def validate_fit(out):
    """Return human-readable reasons a generated overlay must not be written."""
    errors = []
    if not isinstance(out, dict) or 'error' in out:
        return [str((out or {}).get('error', 'missing fit result'))]

    def finite_seq(value, size):
        return isinstance(value, (list, tuple)) and len(value) == size and all(
            isinstance(v, (int, float)) and math.isfinite(v) for v in value)

    frame_value = out.get('frame')
    if not finite_seq(frame_value, 4) or not (
            frame_value[0] < frame_value[2] and frame_value[1] < frame_value[3]):
        errors.append('frame must have finite increasing left/top/right/bottom bounds')

    residuals = out.get('resid_deg')
    if not finite_seq(residuals, 2) or any(abs(v) > 0.01 for v in residuals):
        errors.append('longitude/latitude fit residuals must each be at most 0.01°')

    conformality = out.get('conformality')
    if not isinstance(conformality, (int, float)) or not math.isfinite(conformality) or not (
            0.8 <= conformality <= 1.2):
        errors.append('conformality must be within 0.80–1.20')

    arp = out.get('arp_frac')
    if arp is not None and (not finite_seq(arp, 2) or any(v < 0 or v > 1 for v in arp)):
        errors.append('airfield reference point must fall inside the plate')

    if finite_seq(out.get('sw'), 2) and finite_seq(out.get('ne'), 2):
        sw, ne = out['sw'], out['ne']
        if not (sw[0] < ne[0] and sw[1] < ne[1]):
            errors.append('south-west/north-east bounds are reversed or empty')
    elif all(finite_seq(out.get(k), 2) for k in ('tl', 'tr', 'bl')):
        tl, tr, bl = out['tl'], out['tr'], out['bl']
        width = math.hypot((tr[0] - tl[0]) * 111.0,
                           (tr[1] - tl[1]) * 111.0 * math.cos(math.radians(tl[0])))
        height = math.hypot((bl[0] - tl[0]) * 111.0,
                            (bl[1] - tl[1]) * 111.0 * math.cos(math.radians(tl[0])))
        if width <= 0.01 or height <= 0.01:
            errors.append('rotated plate bounds are empty')
    else:
        errors.append('fit must contain either sw/ne or tl/tr/bl bounds')
    return errors


def main(argv):
    import argparse, glob, json, os, shutil, subprocess, sys
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument('pdf')
    ap.add_argument('icao')
    ap.add_argument('--png', help='rendered page 1 (default: alongside the PDF in docs/byop)')
    ap.add_argument('--lon', nargs='*', default=[], help='DEG:MIN=px for plates without text')
    ap.add_argument('--lat', nargs='*', default=[], help='DEG:MIN=px for plates without text')
    ap.add_argument('--write', action='store_true', help='write docs/cvfr-img/<ICAO>_cvfr.png')
    ap.add_argument('--width', type=int, default=780, help='overlay width in px')
    a = ap.parse_args(argv)

    missing = [name for name in ('pdftotext', 'pdfinfo', 'pdftoppm') if not shutil.which(name)]
    if missing:
        print('missing required Poppler command(s): ' + ', '.join(missing), file=sys.stderr)
        return 2

    png = a.png or a.pdf[:-4] + '-p01.png'
    data = json.load(open('docs/data/airfields.json', encoding='utf-8'))
    fields = data['airfields'] if isinstance(data, dict) else data
    field = next((f for f in fields if f['name'] == a.icao), None)
    arp = (field['lat'], field['lng']) if field else None

    if a.lon and a.lat:
        out = georef_manual(a.pdf, png, dict(_anchor(x) for x in a.lon),
                            dict(_anchor(x) for x in a.lat), arp)
    else:
        out = georef(a.pdf, png, arp)
    print(json.dumps(out, indent=1, default=float))
    if 'error' in out or not a.write:
        return 0 if 'error' not in out else 1

    fit_errors = validate_fit(out)
    if fit_errors:
        print('refusing --write: ' + '; '.join(fit_errors), file=sys.stderr)
        return 2

    from PIL import Image as _I
    tmp = '/tmp/georef-plate'
    for f in glob.glob(tmp + '*.png'):
        os.remove(f)
    subprocess.run(['pdftoppm', '-png', '-r', '220', a.pdf, tmp, '-f', '1', '-l', '1'],
                   capture_output=True)
    hi = _I.open(sorted(glob.glob(tmp + '*.png'))[0]).convert('RGB')
    k = hi.size[0] / _I.open(png).size[0]
    l, t, r, b = out['frame']
    crop = hi.crop((round(l*k), round(t*k), round(r*k), round(b*k)))
    crop = crop.resize((a.width, round(crop.height * a.width / crop.width)), _I.LANCZOS)
    dest = f'docs/cvfr-img/{a.icao}_cvfr.png'
    crop.convert('P', palette=_I.ADAPTIVE, colors=192).save(dest, optimize=True)
    print(f'wrote {dest} {crop.size[0]}x{crop.size[1]}')
    return 0


if __name__ == '__main__':
    import sys
    raise SystemExit(main(sys.argv[1:]))
