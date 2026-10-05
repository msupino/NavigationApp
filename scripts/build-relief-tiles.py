#!/usr/bin/env python3
"""Cut the world relief background into Web Mercator tiles, packed: docs/relief/*.pack + index.json.

Source: Natural Earth I with shaded relief, water and drainages (NE1_LR_LC_SR_W.tif, 16200 x
8100, public domain -- naturalearthdata.com). It is drawn under the world outlines and every
chart, so the map outside the charts shows land, relief and sea instead of flat colour, and it
ships with the app, so it works offline like the outlines do.

Each zoom is resampled from the equirectangular source (area-averaged when shrinking), then
every tile's 256 rows are taken at their own Mercator latitudes. Zooms 0-6 make 5,461 WebP
tiles, about 11 MB; open ocean compresses to almost nothing.

The tiles are not written as 5,461 files. They go into three packs -- zooms 0-4, zoom 5,
zoom 6 -- each the tiles' bytes end to end, in z / x / y order, and index.json gives every
pack's zooms and the byte offset of each tile in it (n + 1 offsets for n tiles). The app
fetches a pack once (from the app itself, so offline too) and cuts tiles out of it.

usage: build-relief-tiles.py <NE1_LR_LC_SR_W.tif> [--quality 72] [--out docs/relief]
"""
import argparse, io, json, math, os
import numpy as np
from PIL import Image

Image.MAX_IMAGE_PIXELS = None
T = 256
PACKS = [[0, 1, 2, 3, 4], [5], [6]]


def tiles_for_zoom(src, z, quality):
    """Yield (x, y, webp bytes) for every tile of zoom z, x-major then y."""
    n = 2 ** z
    W = T * n
    H = W // 2                                    # equirectangular: 360 x 180 degrees
    eq = np.asarray(src.resize((W, H), Image.LANCZOS if W < src.width else Image.BICUBIC))
    out = {}
    for ty in range(n):
        # latitude of each of this tile row's 256 pixel centres, in the Mercator projection
        y = (ty * T + np.arange(T) + 0.5) / W
        lat = np.degrees(np.arctan(np.sinh(math.pi * (1 - 2 * y))))
        rows = np.clip(((90 - lat) / 180 * H).astype(int), 0, H - 1)
        band = eq[rows]                           # 256 x W x 3
        for tx in range(n):
            buf = io.BytesIO()
            Image.fromarray(band[:, tx * T:(tx + 1) * T]).save(buf, 'WEBP', quality=quality, method=6)
            out[(tx, ty)] = buf.getvalue()
    for tx in range(n):
        for ty in range(n):
            yield tx, ty, out[(tx, ty)]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('src')
    ap.add_argument('--quality', type=int, default=72)
    ap.add_argument('--out', default='docs/relief')
    a = ap.parse_args()
    src = Image.open(a.src).convert('RGB')
    os.makedirs(a.out, exist_ok=True)
    index = {'tile': T, 'maxZoom': PACKS[-1][-1], 'packs': []}
    for zooms in PACKS:
        name = 'z%d.pack' % zooms[0] if len(zooms) == 1 else 'z%d-%d.pack' % (zooms[0], zooms[-1])
        offsets, pos = [0], 0
        with open(os.path.join(a.out, name), 'wb') as f:
            for z in zooms:
                for _, _, data in tiles_for_zoom(src, z, a.quality):
                    f.write(data)
                    pos += len(data)
                    offsets.append(pos)
        index['packs'].append({'file': name, 'zooms': zooms, 'offsets': offsets})
        print(f'{name}: {len(offsets) - 1} tiles, {pos / 1048576:.1f} MB', flush=True)
    with open(os.path.join(a.out, 'index.json'), 'w') as f:
        json.dump(index, f, separators=(',', ':'))


if __name__ == '__main__':
    main()
