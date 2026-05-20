#!/usr/bin/env python3
"""Composite the Unity CVFR2020 chart (4 parts) into one web map + georeference.

The four cvfr_pt{1..4}.png files are equal horizontal slices of a single
Israel CVFR chart sheet (north -> south). They are stacked as-is (already
north-up / east-right) into one image.

Georeferencing is read from the chart's own lat/lon graticule, then expressed
in the app's scene-coordinate model (see sceneToCoord in app.js):

  longitude  34deg40'E at full-res x = 16 px,  520 px per 10'
  latitude   33deg20'N at full-res y = 200 px, 548 px per 10'   (part 1)

Output: map.jpg  and the MAP_BOUNDS constant for app.js.
"""
from PIL import Image

SRC = "../Assets/Resources/CVFR2020"
PARTS = ["cvfr_pt1", "cvfr_pt2", "cvfr_pt3", "cvfr_pt4"]
PART_PX = 4096                       # native part dimension (square)
COMP_W = 1200                        # output width; height = 4 * COMP_W

# --- chart graticule (full-res part pixels) --------------------------
TEN_MIN = 0.16666667                 # 10 arc-minutes in degrees
LON_REF_DEG, LON_REF_PX, LON_PX_PER_10 = 34.0 + 40 / 60, 16, 520
LAT_REF_DEG, LAT_REF_PX, LAT_PX_PER_10 = 33.0 + 20 / 60, 200, 548

# --- scene-coordinate model (must match app.js) ----------------------
LON_RATE, LAT_RATE = 8.392355, 10.00674
LON_ORIGIN, LAT_ORIGIN = 35.0, 33.0

def lon_at(cx):                      # composite x px -> longitude
    return LON_REF_DEG + (cx - LON_REF_PX) / LON_PX_PER_10 * TEN_MIN
def lat_at(cy):                      # composite y px -> latitude
    return LAT_REF_DEG + (LAT_REF_PX - cy) / LAT_PX_PER_10 * TEN_MIN
def scene_x(lon): return (lon - LON_ORIGIN) / TEN_MIN * LON_RATE
def scene_z(lat): return (lat - LAT_ORIGIN) / TEN_MIN * LAT_RATE

# --- composite -------------------------------------------------------
canvas = Image.new("RGB", (COMP_W, COMP_W * 4), (35, 31, 32))
for i, name in enumerate(PARTS):
    part = Image.open(f"{SRC}/{name}.png").convert("RGB")
    part = part.resize((COMP_W, COMP_W), Image.LANCZOS)
    canvas.paste(part, (0, i * COMP_W))
canvas.save("map.jpg", quality=80, optimize=True)

# --- bounds (full-res composite is PART_PX wide, 4*PART_PX tall) -----
x_min = scene_x(lon_at(0))
x_max = scene_x(lon_at(PART_PX))
z_max = scene_z(lat_at(0))
z_min = scene_z(lat_at(PART_PX * 4))

print(f"map.jpg  {canvas.size[0]}x{canvas.size[1]}")
print(f"lon {lon_at(0):.4f}..{lon_at(PART_PX):.4f}E   "
      f"lat {lat_at(PART_PX*4):.4f}..{lat_at(0):.4f}N")
print("MAP_BOUNDS = { xMin: %.3f, xMax: %.3f, zMin: %.3f, zMax: %.3f };"
      % (x_min, x_max, z_min, z_max))
