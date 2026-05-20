# Plotter — HTML5

HTML5/Canvas port of the Unity `NavigationApp` map plotter. Plain HTML + CSS +
JavaScript, no dependencies, no build step.

## Run locally

Open `index.html` directly, or serve the folder:

```bash
python3 -m http.server -d docs 8000
# http://localhost:8000
```

## Use

- **Add** mode — click the map to drop waypoints; legs connect them automatically.
- **Edit** mode — click/drag waypoints, click a leg to edit it.
- Scroll to zoom, drag empty space to pan, **Fit** to frame the route.
- Click a leg → set speed, inbound/outbound altitude, mid-leg indication.
- **Save** / **Load** — JSON compatible with the Unity build's scene format
  (`waypoints` + `legs`).

## Coordinate model

Conversion rates, magnetic deviation, and time formatting are ported from
`Assets/Scripts/Main.cs`. Origin is 33°N 35°E; the graticule is one cell per
10′ of latitude/longitude. Distance and bearing use a spherical great-circle
calculation.

## Background chart

`map.jpg` is the Israel CVFR chart, downscaled by `build_map.py` from the
single-image source `Assets/Resources/LLLL_CVFR.png`. (The CVFR2020 four-part
set is sliced with overlaps that do not tile cleanly, so the single sheet is
used instead.) It is georeferenced from the chart's own lat/lon graticule into
the scene-coordinate model, so waypoints align with the chart. To rebuild:

```bash
pip install Pillow
cd docs && python build_map.py        # writes map.jpg + prints MAP_BOUNDS
```

If the chart drifts relative to dropped waypoints, adjust the graticule
reference pixels in `build_map.py` and copy the printed `MAP_BOUNDS` into
`app.js`.
