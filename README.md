# NavAid

Browser-based CVFR / Israel-area flight-route planner. Plain HTML +
CSS + JavaScript on top of Leaflet, no build step.

The repository also includes a Capacitor native wrapper under `mobile/` for
building iOS and Android apps from the same static `docs/` app.

## Links

- **Live (production):** https://navaid.supino.org/
- **Live (staging):** https://navaid.supino.org/staging/
- **Repo:** https://github.com/msupino/NavigationApp
- **Wiki:** https://github.com/msupino/NavigationApp/wiki — full documentation / תיעוד מלא

## Run locally

```bash
python3 -m http.server -d docs 8000
# http://localhost:8000
```

## Native mobile wrapper

```bash
cd mobile
npm install
npm run sync
npm run open:ios      # or: npm run open:android
```

The mobile workspace is intentionally separate from the root test package so
GitHub Pages remains a plain static deployment.

## Local MBTiles tile server (dev)

To test downloaded Flight Maps MBTiles for the app's chart layers:

```bash
python3 scripts/local-mbtiles-server.py --extract
# http://127.0.0.1:8000/?localTiles=1
```

`--extract` writes XYZ PNG tiles to `~/Downloads/flight-maps-tiles/` before
starting the server. Existing files are skipped; use `--force-extract` to
overwrite them, or `--extract-only` to extract and exit.

The script expects:

- `~/Downloads/flight-maps-mbtiles/CVFR.mbtiles`
- `~/Downloads/flight-maps-mbtiles/Israel-Navigation.mbtiles`
- `~/Downloads/flight-maps-mbtiles/LSA-Low-Altitude.mbtiles`
- `~/Downloads/flight-maps-mbtiles/Israel-Helicopters.mbtiles`

## Development docs

- `AGENTS.md` — required rules for AI and automation agents.
- `.ai/README.md` — AI handbook index for workflow, architecture, data,
  UI patterns, testing, and checklists.
- `.ai/navaid-dev.md` — detailed NavAid developer guide.

## License & data

NavAid is released under the [MIT License](LICENSE) — no warranty, no liability.

Charts © flight-maps.com / CAAI; imagery © Esri; map data © OpenStreetMap
contributors; VFR reporting points © ICAO / CAAI.

NavAid is a planning aid only and not certified for primary navigation.
