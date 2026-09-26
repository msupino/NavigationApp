#!/usr/bin/env python3
"""Build docs/data/world-countries.json: a small, always-offline world map.

Source: Natural Earth 1:50m admin-0 countries (public domain),
https://github.com/nvkelso/natural-earth-vector/blob/master/geojson/ne_50m_admin_0_countries.geojson

Kept: each country's outline, its English and Hebrew name, and Natural Earth's own label
point and label rank. Outlines are simplified (Douglas-Peucker) and rounded to 0.02 degrees (about 2 km), and
repeated points after rounding are dropped: enough to see coastlines and borders from an airliner,
small enough to ship inside the app.

Usage: python3 scripts/build-world-countries.py path/to/ne_50m_admin_0_countries.geojson
"""
import json
import sys

STEP = 0.02


def q(v):
    return round(round(v / STEP) * STEP, 2)


def simplify(pts, tol):
    """Douglas-Peucker, iterative: drop points within `tol` degrees of the line between
    the points kept either side of them."""
    if len(pts) < 3:
        return pts
    keep = [False] * len(pts)
    keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        a, b = stack.pop()
        ax, ay = pts[a]
        bx, by = pts[b]
        dx, dy = bx - ax, by - ay
        norm = (dx * dx + dy * dy) ** 0.5
        best, idx = 0.0, None
        for i in range(a + 1, b):
            px, py = pts[i]
            d = abs(dy * px - dx * py + bx * ay - by * ax) / norm if norm else ((px - ax) ** 2 + (py - ay) ** 2) ** 0.5
            if d > best:
                best, idx = d, i
        if idx is not None and best > tol:
            keep[idx] = True
            stack.append((a, idx))
            stack.append((idx, b))
    return [p for p, k in zip(pts, keep) if k]


def ring(coords):
    out = []
    for lng, lat in simplify([list(c[:2]) for c in coords], STEP):
        p = [q(lng), q(lat)]
        if not out or out[-1] != p:
            out.append(p)
    return out if len(out) >= 4 else None


def polys(geom):
    parts = geom['coordinates'] if geom['type'] == 'MultiPolygon' else [geom['coordinates']]
    out = []
    for poly in parts:
        rings = [r for r in (ring(r) for r in poly) if r]
        if rings:
            out.append(rings)
    return out


def main(src, dst='docs/data/world-countries.json'):
    d = json.load(open(src, encoding='utf-8'))
    countries = []
    for f in d['features']:
        p = f['properties']
        shape = polys(f['geometry'])
        if not shape:
            continue
        countries.append({
            'en': p.get('NAME_EN') or p.get('NAME'),
            'he': p.get('NAME_HE') or p.get('NAME_EN') or p.get('NAME'),
            'at': [round(p['LABEL_Y'], 2), round(p['LABEL_X'], 2)],
            'rank': p.get('LABELRANK', 5),
            'p': shape,
        })
    out = {
        'version': 1,
        'source': 'Natural Earth 1:50m admin-0 countries (public domain), simplified and rounded to 0.02 deg',
        'countries': countries,
    }
    with open(dst, 'w', encoding='utf-8') as fh:
        json.dump(out, fh, ensure_ascii=False, separators=(',', ':'))


if __name__ == '__main__':
    main(*sys.argv[1:])
