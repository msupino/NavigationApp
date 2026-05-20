# Plotter — HTML5

Browser-based CVFR / Israel-area flight-route plotter. Plain HTML + CSS +
JavaScript on top of Leaflet, no build step.

**Live:** https://msupino.github.io/NavigationApp/

## Run locally

Serve the folder so Leaflet's CDN tiles load over HTTPS:

```bash
python3 -m http.server -d docs 8000
# http://localhost:8000
```

## Use

The toolbar has a `⋮⋮` grip on the left — drag it anywhere on screen
(its position is remembered).

- **Add** — click the map to drop a waypoint; legs connect them.
- **Edit** — click / drag waypoints, click a leg to edit it.
- **Note** — drop a free-text annotation box at the click point.
- **Reverse** / **Clear** — invert the route, or wipe everything (with
  confirm).
- **Save** / **Load** — JSON file with the full route + notes.
- **Fit** — frame the route in view.
- **Show return path** — render the outbound (return-direction) marker.
- **Show mid-leg dist** — yellow distance badge in the middle of each leg.
- **Highlight diff** — purple halo on legs whose altitude differs from
  the adjacent leg, marking the climb / descent point.
- **Labels** slider — opacity of every yellow label background.
- **A3** / **A4** — show a print-frame rectangle at 1:250 000; clicking
  the same button again clears it. A modal asks Landscape vs Portrait.
- **Print** — opens the browser print dialog. With a frame chosen, the
  output is cropped to that exact rectangle, full-bleed.

Click a waypoint to open the inspector — the title doubles as the
editable name. If a name is set it's drawn inside the circle (replacing
the sequence number); otherwise the number is shown.

## Map layers

CVFR · Nav · Low Altitude · Helicopters · Satellite (Esri) · OSM. The
selected base layer is remembered across reloads.

## Storage

Route, notes, current view, label opacity, toolbar position, and base
layer are kept in `localStorage` so a reload picks up where you left off.

## License & data

Charts are © flight-maps.com / CAAI — public deploys need permission.
Imagery: © Esri (World Imagery). Map data: © OpenStreetMap contributors.
