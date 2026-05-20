#!/usr/bin/env python3
"""Downscale + georeference the LLLL_CVFR Israel chart into the web map.

LLLL_CVFR.png is a single complete CVFR chart (6202x15867) — used instead of
the CVFR2020 four-part set, which is sliced with overlaps that do not tile
cleanly. Georeferencing is read from the chart's own lat/lon graticule and
expressed in the app's scene-coordinate model (see sceneToCoord in app.js).

  longitude  34deg10'E at native x = 237.7 px,  485.8 px per 10'
  latitude   33deg20'N at native y = 195   px,  613   px per 10'
"""
from PIL import Image

Image.MAX_IMAGE_PIXELS = None            # the source is a large chart, not a bomb

SRC = "../Assets/Resources/LLLL_CVFR.png"
OUT_W = 1800                             # web output width

TEN_MIN = 1.0 / 6.0                      # 10 arc-minutes in degrees
LON_RATE, LAT_RATE = 8.392355, 10.00674  # scene units per 10' (match app.js)

LON_REF_DEG, LON_REF_PX, LON_PX10 = 34 + 10 / 60, 237.7, 485.8
LAT_REF_DEG, LAT_REF_PX, LAT_PX10 = 33 + 20 / 60, 195.0, 613.0

src = Image.open(SRC).convert("RGB")
W, H = src.size
out = src.resize((OUT_W, round(H * OUT_W / W)), Image.LANCZOS)
out.save("map.jpg", quality=82, optimize=True)

def lon_at(x): return LON_REF_DEG + (x - LON_REF_PX) / LON_PX10 * TEN_MIN
def lat_at(y): return LAT_REF_DEG - (y - LAT_REF_PX) / LAT_PX10 * TEN_MIN
def scene_x(lon): return (lon - 35.0) / TEN_MIN * LON_RATE
def scene_z(lat): return (lat - 33.0) / TEN_MIN * LAT_RATE

x_min, x_max = scene_x(lon_at(0)), scene_x(lon_at(W))
z_max, z_min = scene_z(lat_at(0)), scene_z(lat_at(H))

print(f"map.jpg  {out.size[0]}x{out.size[1]}")
print(f"lon {lon_at(0):.4f}..{lon_at(W):.4f}E   lat {lat_at(H):.4f}..{lat_at(0):.4f}N")
print("MAP_BOUNDS = { xMin: %.3f, xMax: %.3f, zMin: %.3f, zMax: %.3f };"
      % (x_min, x_max, z_min, z_max))
