"""Step 3 of the aerodrome-chart georef: refit each chart so its runway lands on the runway symbol
of the CVFR / Low Alt chart (which draws airports larger than true and up to ~300 m off), not on
the OSM runway. Reads fits.jsonl, runways.json and the adc-vfr-capture.js output from the work
dir; writes fits-vfr.jsonl with the new overlay corners and green-line check crops.
usage: adc-fit-vfr.py <work dir/>"""
import json, sys, math, numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage
S = sys.argv[1]
fits = [json.loads(l) for l in open(S + 'fits.jsonl')]
rw = json.load(open(S + 'runways.json'))['elements']
def osm_ends(f):
    # the OSM runway the fit used: nearest way whose ref matches
    best = None
    for e in rw:
        g = e.get('geometry') or []
        if len(g) < 2 or (e.get('tags', {}).get('ref') or '') != f['osmRunway']: continue
        a, b = (g[0]['lat'], g[0]['lon']), (g[-1]['lat'], g[-1]['lon'])
        c = ((a[0]+b[0])/2, (a[1]+b[1])/2)
        o = f['overlay']; oc = ((o['tr'][0]+o['bl'][0])/2, (o['tr'][1]+o['bl'][1])/2)
        d = (c[0]-oc[0])**2 + (c[1]-oc[1])**2
        if best is None or d < best[0]: best = (d, a, b)
    return best[1], best[2]
def symbol(lay, icao, meta, axis_ll):
    im = np.asarray(Image.open(f'{S}sym-{lay}-{icao}.png').convert('RGB')).astype(int)
    H, W, _ = im.shape
    R, G, B = im[..., 0], im[..., 1], im[..., 2]
    mag = (R > 170) & (G < 120) & (B > 90) & (R - G > 90)
    blu = (B > 140) & (R < 120) & (B - R > 60)
    m = meta[icao]; nw, se = m['nw'], m['se']
    ll2px = lambda lat, lng: ((lng - nw[1]) / (se[1] - nw[1]) * W, (lat - nw[0]) / (se[0] - nw[0]) * H)
    px2ll = lambda x, y: (nw[0] + y / H * (se[0] - nw[0]), nw[1] + x / W * (se[1] - nw[1]))
    ax, ay = ll2px(*m['af'])
    best = None
    for mask in (mag, blu):
        lab, n = ndimage.label(ndimage.binary_closing(mask, iterations=2))
        for k in range(1, n + 1):
            ys, xs = np.nonzero(lab == k)
            if len(xs) < 300: continue
            d = np.min((xs - ax) ** 2 + (ys - ay) ** 2) ** .5
            if d > 40: continue
            # elongation
            P = np.c_[xs, ys].astype(float); c = P.mean(0); u, s, vt = np.linalg.svd(P - c, full_matrices=False)
            el = s[0] / max(s[1], 1)
            score = len(xs) * min(el, 6) / (1 + d)
            if best is None or score > best[0]: best = (score, xs, ys, c, vt[0], mask)
    if best is None: return None
    _, xs, ys, c, _v, cmask = best
    # Axis = the true runway direction (symbols are drawn true); PCA is thrown by side arms (LLIB)
    # and by labels/symbols sitting on the bar (LLRS).
    (la, lo), (lb, lob) = axis_ll
    pa, pb = np.array(ll2px(la, lo)), np.array(ll2px(lb, lob)); v = (pb - pa) / np.linalg.norm(pb - pa)
    P = np.c_[xs, ys].astype(float) - c
    t = P @ v; nrm = P @ np.array([-v[1], v[0]])
    # the bar is the densest band across the axis, about one symbol wide (~36 px at z14)
    BW = 36; lo_ = int(nrm.min()); hi_ = int(nrm.max())
    cnt = [(np.sum((nrm >= x) & (nrm < x + BW)), x) for x in range(lo_, max(lo_ + 1, hi_ - BW + 2))]
    x0 = max(cnt)[1]; keep = (nrm >= x0) & (nrm < x0 + BW)
    c = c + np.array([-v[1], v[0]]) * (x0 + BW / 2); t = t[keep]
    t0, t1 = np.percentile(t, [0.5, 99.5])
    # a label crossing the bar splits it: grow along the band over gaps under 30 px
    my, mx = np.nonzero(cmask); Q = np.c_[mx, my].astype(float) - c
    qt = Q @ v; qn = Q @ np.array([-v[1], v[0]])
    qt = np.sort(qt[np.abs(qn) < BW / 2])
    for _ in range(2):
        nxt = qt[(qt > t1) & (qt < t1 + 30)]
        while len(nxt): t1 = nxt.max(); nxt = qt[(qt > t1) & (qt < t1 + 30)]
        prv = qt[(qt < t0) & (qt > t0 - 30)]
        while len(prv): t0 = prv.min(); prv = qt[(qt < t0) & (qt > t0 - 30)]
    e1, e2 = c + v * t0, c + v * t1
    return px2ll(*e1), px2ll(*e2), (e1, e2, ax, ay)
meta = {l: json.load(open(f'{S}sym-{l}.json')) for l in ('CVFR', 'LowAlt')}
def toxy(p, lat0): return complex(p[1] * math.cos(math.radians(lat0)), p[0])
def fromxy(z, lat0): return [round(z.imag, 5), round(z.real / math.cos(math.radians(lat0)), 5)]
out = []
for f in fits:
    icao = f['icao']; a, b = osm_ends(f); lat0 = a[0]
    syms = []
    for lay in ('CVFR', 'LowAlt'):
        r = symbol(lay, icao, meta[lay], (a, b))
        if r:
            p, q = r[0], r[1]
            # pair symbol ends with OSM ends by direction
            d = (toxy(q, lat0) - toxy(p, lat0)) * (toxy(b, lat0) - toxy(a, lat0)).conjugate()
            if d.real < 0: p, q = q, p
            syms.append((p, q))
            im = Image.open(f'{S}sym-{lay}-{icao}.png').convert('RGB'); d = ImageDraw.Draw(im)
            e1, e2, ax, ay = r[2]; d.line([tuple(e1), tuple(e2)], fill=(0, 255, 0), width=3); d.ellipse([ax-4, ay-4, ax+4, ay+4], outline=(0, 0, 0), width=2)
            im.crop((150, 150, 650, 650)).save(f'{S}symchk-{lay}-{icao}.png')
    if not syms: print(icao, 'NO SYMBOL'); continue
    # one layer can hide part of the bar under a VOR rose or a label: if lengths disagree, trust the longer
    Ls = [abs(toxy(s[1], lat0) - toxy(s[0], lat0)) for s in syms]
    if len(syms) == 2 and min(Ls) < 0.85 * max(Ls): syms = [syms[Ls.index(max(Ls))]]
    P = [sum(toxy(s[0], lat0) for s in syms) / len(syms), sum(toxy(s[1], lat0) for s in syms) / len(syms)]
    A, Bz = toxy(a, lat0), toxy(b, lat0)
    k = (P[1] - P[0]) / (Bz - A)  # similarity: z -> k (z - A) + P0
    o = f['overlay']; T = lambda ll: fromxy(k * (toxy(ll, lat0) - A) + P[0], lat0)
    no = dict(o, tl=T(o['tl']), tr=T(o['tr']), bl=T(o['bl']))
    shift = abs((P[0] + P[1]) / 2 - (A + Bz) / 2) * 111320
    spread = abs(toxy(syms[0][0], lat0) - toxy(syms[-1][0], lat0)) * 111320 if len(syms) > 1 else 0
    print(f"{icao} scale {abs(k):.2f} rot {math.degrees(math.atan2(k.imag, k.real)):+.1f}° shift {shift:.0f} m  layers {len(syms)} cvfr-vs-lowalt {spread:.0f} m")
    out.append(dict(f, overlay=no, vfrScale=round(abs(k), 3)))
with open(S + 'fits-vfr.jsonl', 'w') as fh:
    for f in out: fh.write(json.dumps(f) + '\n')
