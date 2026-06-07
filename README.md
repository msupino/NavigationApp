# NavAid

Browser-based CVFR / Israel-area flight-route planner. Plain HTML +
CSS + JavaScript on top of Leaflet, no build step.

## Links

- **Live (production):** https://msupino.github.io/NavigationApp/
- **Live (staging):** https://msupino.github.io/NavigationApp/staging/
- **Repo:** https://github.com/msupino/NavigationApp
- **Wiki:** https://github.com/msupino/NavigationApp/wiki — full documentation / תיעוד מלא

## Run locally

```bash
python3 -m http.server -d docs 8000
# http://localhost:8000
```

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

## License & data

NavAid is released under the [MIT License](LICENSE) — no warranty, no liability.

Charts © flight-maps.com / CAAI; imagery © Esri; map data © OpenStreetMap
contributors; VFR reporting points © ICAO / CAAI.

NavAid is a planning aid only and not certified for primary navigation.
