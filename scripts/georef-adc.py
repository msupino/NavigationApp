#!/usr/bin/env python3
"""Georeference an aerodrome chart (נספח א' -- "תרשים השדה" / "תרשים המנחת") for the map.

    python3 scripts/georef-adc.py "docs/byop/LLHZ_airport_Annex Alef.pdf" LLHZ \
        --runways runways.json --out docs/adc-img/LLHZ_adc.png

An aerodrome chart has no graticule to read, but it draws the one thing whose position is
known to a metre: the runway. So the fit anchors on it --

1. render the page; find the runway -- the long, dark, straight bar -- and its two ends;
2. take the same runway's two ends from OpenStreetMap (`--runways`: an Overpass `out geom`
   dump of `way[aeroway=runway]`), the nearest runway to the field whose direction matches;
3. fit a similarity (one scale, one rotation) through the two pairs, so the paper keeps its
   own proportions;
4. crop to the map frame (the box the runway sits in) and write the corners as tl/tr/bl.

It prints what to check: the rotation (charts are north-up, so near 0), the scale in metres
per pixel, and how far the field's ARP falls from the runway's middle. The result still
wants an eye -- see the overlay over satellite imagery before shipping it.
"""
import argparse, json, math, subprocess, sys, tempfile, os
import numpy as np
from PIL import Image
from scipy import ndimage

R = 6371000.0

def render(pdf, dpi, page=1):
    with tempfile.TemporaryDirectory() as d:
        subprocess.run(['pdftoppm', '-r', str(dpi), '-png', '-f', str(page), '-l', str(page), pdf, d + '/p'], check=True)
        f = [x for x in os.listdir(d) if x.endswith('.png')][0]
        return Image.open(os.path.join(d, f)).convert('RGB')

def runway_bars(img, min_width=8):
    """Long, dark, straight components: (endpoints a, b in px, length px, width px)."""
    a = np.asarray(img).astype(int)
    dark = (a.sum(axis=2) < 200)
    lab, n = ndimage.label(dark)
    out = []
    for i, sl in enumerate(ndimage.find_objects(lab)):
        ys, xs = np.nonzero(lab[sl] == i + 1)
        if len(xs) < 400:
            continue
        xs = xs + sl[1].start; ys = ys + sl[0].start
        pts = np.stack([xs, ys], 1).astype(float)
        c = pts.mean(0)
        u, s, vt = np.linalg.svd(pts - c, full_matrices=False)
        ax = vt[0]
        proj = (pts - c) @ ax
        perp = (pts - c) @ vt[1]
        length = proj.max() - proj.min()
        width = np.percentile(np.abs(perp), 95) * 2
        if width < min_width or length / max(width, 1) < 6:
            continue
        # The fill must be solid along the bar (a runway), not a thin line or text.
        fill = len(pts) / max(1, length * width)
        if fill < 0.55:
            continue
        a_ = c + ax * proj.min(); b_ = c + ax * proj.max()
        out.append((a_, b_, length, width))
    # The runway's markings (centre line, threshold bars, its designation) cut the dark bar into
    # pieces; join the pieces that lie on one line into the runway they are.
    merged = []
    used = [False] * len(out)
    for i, (a0, b0, l0, w0) in enumerate(out):
        if used[i]: continue
        used[i] = True
        d0 = (b0 - a0) / np.linalg.norm(b0 - a0)
        n0 = np.array([-d0[1], d0[0]])
        pts = [a0, b0]; widths = [w0]
        for j, (a1, b1, l1, w1) in enumerate(out):
            if used[j]: continue
            d1 = (b1 - a1) / np.linalg.norm(b1 - a1)
            if abs(abs(d0 @ d1) - 1) > 0.004: continue            # same direction (~5 deg)
            if abs((a1 - a0) @ n0) > max(w0, w1) or abs((b1 - a0) @ n0) > max(w0, w1): continue
            if abs(w1 - w0) > 0.4 * max(w0, w1): continue          # same width
            used[j] = True; pts += [a1, b1]; widths.append(w1)
        pr = [(p_ - a0) @ d0 for p_ in pts]
        lo, hi = pts[int(np.argmin(pr))], pts[int(np.argmax(pr))]
        merged.append((lo, hi, float(np.linalg.norm(hi - lo)), float(np.median(widths))))
    merged.sort(key=lambda t: -t[2])
    # The ends carry chevrons and threshold stripes, which break the fill: walk out along the
    # line while the strip across it is still mostly runway (dark edges + markings), so the
    # ends are the runway's, not the last solid piece's.
    grown = []
    for lo, hi, l, w in merged:
        d = (hi - lo) / np.linalg.norm(hi - lo)
        n = np.array([-d[1], d[0]])
        def runway_at(p_):
            ok = 0; tot = 0
            for k in np.linspace(-w / 2, w / 2, 9):
                q = p_ + n * k
                x, y = int(round(q[0])), int(round(q[1]))
                if 0 <= x < dark.shape[1] and 0 <= y < dark.shape[0]:
                    tot += 1; ok += dark[y, x]
            return tot and ok / tot >= 0.3
        def walk(p_, step):
            gap = 0; last = p_.copy(); q = p_.copy()
            while gap < 1.5 * w:
                q = q + step
                if not (0 <= q[0] < dark.shape[1] and 0 <= q[1] < dark.shape[0]): break
                if runway_at(q): last = q.copy(); gap = 0
                else: gap += 1
            return last
        lo2, hi2 = walk(lo, -d), walk(hi, d)
        grown.append((lo2, hi2, float(np.linalg.norm(hi2 - lo2)), w))
    return grown

def designator_runway(pdf, page, img, dpi):
    """A runway drawn too thin or broken to detect as a bar: find it from its designators.

    The chart prints the runway numbers ("09" ... "27") at its two ends. The reciprocal pair
    whose joining line runs over the most dark pixels is the runway; walk out along that line
    from its middle to where the dark run ends -- the runway's ends, short of the labels."""
    import re
    out = subprocess.run(['pdftotext', '-bbox', '-f', str(page), '-l', str(page), pdf, '-'],
                         capture_output=True, text=True).stdout
    k = dpi / 72.0
    words = []
    for m in re.finditer(r'xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">(\d{2})<', out):
        x0, y0, x1, y1 = map(float, m.groups()[:4]); n = int(m.group(5))
        if 1 <= n <= 36:
            words.append((n, np.array([(x0 + x1) / 2 * k, (y0 + y1) / 2 * k])))
    a_ = np.asarray(img).astype(int)
    dark = (a_.sum(axis=2) < 300)
    H, W = dark.shape
    def dark_at(p_, d, half=3):
        nrm = np.array([-d[1], d[0]])
        for t in range(-half, half + 1):
            q = p_ + nrm * t
            x, y = int(round(q[0])), int(round(q[1]))
            if 0 <= x < W and 0 <= y < H and dark[y, x]: return True
        return False
    best = None
    for i, (na, pa_) in enumerate(words):
        for nb, pb_ in words[i + 1:]:
            if (na - nb) % 36 != 18 and (nb - na) % 36 != 18: continue
            L = np.linalg.norm(pb_ - pa_)
            if L < 100: continue
            d = (pb_ - pa_) / L
            hits = sum(dark_at(pa_ + d * t, d) for t in np.linspace(0.15 * L, 0.85 * L, 200))
            score = hits / 200 * L
            if best is None or score > best[0]: best = (score, pa_, pb_, d)
    if best is None: return []
    _, pa_, pb_, d = best
    mid = (pa_ + pb_) / 2
    def walk(step):
        q = mid.copy(); last = mid.copy(); gap = 0
        while gap < 12:
            q = q + step
            if not (0 <= q[0] < W and 0 <= q[1] < H): break
            if dark_at(q, d, 2): last = q.copy(); gap = 0
            else: gap += 1
        return last
    lo, hi = walk(-d), walk(d)
    return [(lo, hi, float(np.linalg.norm(hi - lo)), 0.0)]

def enu(lat0, lng0, lat, lng):
    return np.array([math.radians(lng - lng0) * R * math.cos(math.radians(lat0)),
                     math.radians(lat - lat0) * R])

def inv_enu(lat0, lng0, e):
    return (lat0 + math.degrees(e[1] / R), lng0 + math.degrees(e[0] / (R * math.cos(math.radians(lat0)))))

def frame_box(img, bar):
    """The map frame around the runway: the nearest long dark rule on each side."""
    a = np.asarray(img).astype(int)
    dark = (a.sum(axis=2) < 300)
    H, W = dark.shape
    xs = [bar[0][0], bar[1][0]]; ys = [bar[0][1], bar[1][1]]
    x0, x1, y0, y1 = int(min(xs)), int(max(xs)), int(min(ys)), int(max(ys))
    def run_rows(rows, lo, hi):
        for y in rows:
            seg = dark[y, lo:hi]
            if seg.mean() > 0.85: return y
        return None
    def run_cols(cols, lo, hi):
        for x in cols:
            seg = dark[lo:hi, x]
            if seg.mean() > 0.85: return x
        return None
    # Searched from clear of the runway's own width (25 px), so the bar is never its own frame.
    # A frame rule spans a good part of the page, not just the runway: a near-vertical runway
    # is a few pixels wide, and any short dark run across that (the runway itself) passed.
    cx, cy = (x0 + x1) // 2, (y0 + y1) // 2
    hx0, hx1 = max(0, min(x0, cx - int(0.2 * W))), min(W, max(x1, cx + int(0.2 * W)))
    top = run_rows(range(y0 - 25, 0, -1), hx0, hx1) or 0
    bot = run_rows(range(y1 + 25, H), hx0, hx1) or H - 1
    vy0, vy1 = max(top + 2, min(y0, cy - int(0.2 * H))), min(bot - 2, max(y1, cy + int(0.2 * H)))
    left = run_cols(range(x0 - 25, 0, -1), vy0, vy1) or 0
    right = run_cols(range(x1 + 25, W), vy0, vy1) or W - 1
    return left + 3, top + 3, right - 3, bot - 3

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('pdf'); ap.add_argument('icao')
    ap.add_argument('--runways', required=True)
    ap.add_argument('--airfields', default='docs/data/airfields.json')
    ap.add_argument('--out', required=True)
    ap.add_argument('--page', type=int, default=1)
    ap.add_argument('--dpi', type=int, default=200)
    ap.add_argument('--bar', type=int, default=0, help='which detected bar (0 = longest)')
    ap.add_argument('--ends', help='the runway ends by hand, "x1,y1 x2,y2" in pixels at --dpi, '
                    'for a strip drawn too thin or broken to detect')
    a = ap.parse_args()
    af = next(x for x in json.load(open(a.airfields))['airfields'] if x['name'] == a.icao)
    lat0, lng0 = af['lat'], af['lng']
    img = render(a.pdf, a.dpi, a.page)
    if a.ends:
        e1, e2 = [np.array([float(v) for v in t.split(',')]) for t in a.ends.split()]
        bars = [(e1, e2, float(np.linalg.norm(e2 - e1)), 0.0)]
    else:
        bars = runway_bars(img)
    if not bars:
        # Some strips are drawn as a thin line, or broken by what crosses them: find the runway
        # from its designators instead.
        bars = designator_runway(a.pdf, a.page, img, a.dpi)
    if not bars:
        sys.exit(json.dumps({'error': 'no runway bar found'}))
    pa, pb, plen, pw = bars[a.bar]
    # Pixel direction, with y flipped to point north.
    vpx = np.array([pb[0] - pa[0], -(pb[1] - pa[1])])
    # OSM runways near the field.
    rw = []
    for e in json.load(open(a.runways))['elements']:
        g = e.get('geometry') or []
        if len(g) < 2: continue
        A = enu(lat0, lng0, g[0]['lat'], g[0]['lon']); B = enu(lat0, lng0, g[-1]['lat'], g[-1]['lon'])
        mid = (A + B) / 2
        if np.hypot(*mid) > 4000: continue
        rw.append((e['tags'].get('ref'), A, B))
    if not rw:
        sys.exit(json.dumps({'error': 'no OSM runway within 4 km'}))
    best = None
    for ref, A, B in rw:
        for P, Q in ((A, B), (B, A)):
            v = Q - P
            ang = math.atan2(vpx[0] * v[1] - vpx[1] * v[0], vpx @ v)    # rotation px -> geo
            score = abs(ang) - 0.0001 * np.hypot(*v)                   # north-up first, then longest
            if best is None or score < best[0]:
                best = (score, ref, P, Q, ang)
    _, ref, P, Q, ang = best
    # Similarity z_geo = s * e^{i ang} * z_px + t  (px with y up).
    zp_a = complex(pa[0], -pa[1]); zp_b = complex(pb[0], -pb[1])
    zg_a = complex(*P); zg_b = complex(*Q)
    m = (zg_b - zg_a) / (zp_b - zp_a)
    t = zg_a - m * zp_a
    to_geo = lambda x, y: inv_enu(lat0, lng0, ((m * complex(x, -y) + t).real, (m * complex(x, -y) + t).imag))
    L, T, Rr, B_ = frame_box(img, (pa, pb))
    crop = img.crop((L, T, Rr, B_))
    os.makedirs(os.path.dirname(a.out), exist_ok=True)
    crop.convert('P', palette=Image.ADAPTIVE, colors=64).save(a.out, optimize=True)
    tl = to_geo(L, T); tr = to_geo(Rr, T); bl = to_geo(L, B_)
    # Checks.
    arp_px = None
    zinv = (complex(0, 0) - t) / m           # the ARP (local origin) in pixel space
    arp_px = (zinv.real, -zinv.imag)
    mid_px = ((pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2)
    print(json.dumps({
        'icao': a.icao, 'osmRunway': ref, 'rotationDeg': round(math.degrees(math.atan2(m.imag, m.real)), 2),
        'metresPerPx': round(abs(m), 3), 'runwayPx': round(plen), 'runwayM': round(float(np.hypot(*(Q - P)))),
        'arpFromRunwayMidM': round(math.hypot(arp_px[0] - mid_px[0], arp_px[1] - mid_px[1]) * abs(m)),
        'crop': [L, T, Rr, B_], 'bars': len(bars),
        'overlay': {'png': os.path.basename(a.out), 'tl': [round(tl[0], 5), round(tl[1], 5)],
                    'tr': [round(tr[0], 5), round(tr[1], 5)], 'bl': [round(bl[0], 5), round(bl[1], 5)]},
    }, ensure_ascii=False))

if __name__ == '__main__':
    main()
