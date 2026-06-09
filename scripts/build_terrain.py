#!/usr/bin/env python3
"""Build docs/data/terrain.json (the MSA / terrain-clearance grid, issue #673)
from SRTM .hgt tiles — e.g. the OruxMaps elevation pack
(https://flight-maps.com/files/oruxmaps/misc/height.zip), which contains
standard 1°x1° SRTM .hgt files (NxxEyyy.hgt).

Each output cell stores the MAX elevation over its area (never understate the
highest terrain). Voids (-32768) are ignored.

Usage:
    python3 scripts/build_terrain.py path/to/hgt_dir \\
        [--out docs/data/terrain.json] \\
        [--bbox S W N E] [--cell 0.02]

Defaults: Israel bbox 29.4 34.2 33.4 35.9, cell 0.02 deg (~2 km).
No external dependencies (pure stdlib).
"""
import argparse
import glob
import json
import os
import re
import struct
import sys

VOID = -32768


def hgt_base(path):
    """SW-corner lat/lng from an NxxEyyy.hgt filename, or None."""
    m = re.search(r'([NS])(\d{2})([EW])(\d{3})', os.path.basename(path).upper())
    if not m:
        return None
    lat = int(m.group(2)) * (1 if m.group(1) == 'N' else -1)
    lng = int(m.group(4)) * (1 if m.group(3) == 'E' else -1)
    return lat, lng


def side_from_size(nbytes):
    """SRTM tile side length (samples) from file size: 3601 (1") or 1201 (3")."""
    for side in (3601, 1201):
        if nbytes == side * side * 2:
            return side
    # Fall back to nearest plausible square of int16 samples.
    import math
    side = int(round(math.sqrt(nbytes / 2)))
    return side


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('hgt_dir', help='directory containing .hgt tiles')
    ap.add_argument('--out', default='docs/data/terrain.json')
    ap.add_argument('--bbox', nargs=4, type=float, metavar=('S', 'W', 'N', 'E'),
                    default=[29.4, 34.2, 33.4, 35.9])
    ap.add_argument('--cell', type=float, default=0.02)
    args = ap.parse_args()

    south, west, north, east = args.bbox
    cell = args.cell
    rows = int(round((north - south) / cell))
    cols = int(round((east - west) / cell))
    if rows <= 0 or cols <= 0:
        sys.exit('bad bbox / cell')

    # grid[r][c]; row 0 = north edge, col 0 = west edge.
    grid = [[None] * cols for _ in range(rows)]

    tiles = sorted(glob.glob(os.path.join(args.hgt_dir, '**', '*.hgt'),
                             recursive=True))
    if not tiles:
        sys.exit('no .hgt files found under ' + args.hgt_dir)

    for path in tiles:
        base = hgt_base(path)
        if not base:
            print('skip (name):', path, file=sys.stderr)
            continue
        blat, blng = base
        nbytes = os.path.getsize(path)
        side = side_from_size(nbytes)
        step = 1.0 / (side - 1)
        with open(path, 'rb') as f:
            buf = f.read()
        vals = struct.unpack('>%dh' % (side * side), buf[:side * side * 2])
        # Quick reject tiles entirely outside the bbox.
        if blat + 1 < south or blat > north or blng + 1 < west or blng > east:
            continue
        for i in range(side):              # row 0 = north edge of the tile
            lat = blat + 1 - i * step
            if lat < south or lat > north:
                continue
            r = int((north - lat) / cell)
            if r == rows:                  # lat exactly on the south edge
                r = rows - 1
            if r < 0 or r >= rows:
                continue
            rowoff = i * side
            for j in range(side):
                e = vals[rowoff + j]
                if e == VOID:
                    continue
                lng = blng + j * step
                if lng < west or lng > east:
                    continue
                c = int((lng - west) / cell)
                if c == cols:              # lng exactly on the east edge
                    c = cols - 1
                if c < 0 or c >= cols:
                    continue
                if grid[r][c] is None or e > grid[r][c]:
                    grid[r][c] = e
        print('done', os.path.basename(path), file=sys.stderr)

    out = {
        'coverage': True,
        'units': 'm',
        'south': south, 'west': west, 'north': north, 'east': east,
        'rows': rows, 'cols': cols,
        'data': grid,
    }
    os.makedirs(os.path.dirname(args.out) or '.', exist_ok=True)
    with open(args.out, 'w') as f:
        json.dump(out, f, separators=(',', ':'))
    filled = sum(1 for row in grid for v in row if v is not None)
    print('wrote %s — %dx%d cells, %d filled' % (args.out, rows, cols, filled),
          file=sys.stderr)


if __name__ == '__main__':
    main()
