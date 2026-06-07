# NavAid — HTML5

Browser-based CVFR / Israel-area flight-route planner. Plain HTML +
CSS + JavaScript on top of Leaflet, no build step.

- **Live (production):** https://msupino.github.io/NavigationApp/
- **Live (staging):** https://msupino.github.io/NavigationApp/staging/
- **Wiki:** https://github.com/msupino/NavigationApp/wiki — full documentation / תיעוד מלא

## Run locally

Serve the folder so Leaflet's CDN tiles load over HTTPS:

```bash
python3 -m http.server -d docs 8000
# http://localhost:8000
```

To test local Flight Maps MBTiles instead of the online chart tiles, run from
the repository root:

```bash
python3 scripts/local-mbtiles-server.py --extract
# http://127.0.0.1:8000/?localTiles=1
```

`--extract` writes XYZ PNG tiles to `~/Downloads/flight-maps-tiles/` before
starting the server. Existing files are skipped; use `--force-extract` to
overwrite them, or `--extract-only` to extract and exit.

The script expects these local files:

- `~/Downloads/flight-maps-mbtiles/CVFR.mbtiles`
- `~/Downloads/flight-maps-mbtiles/Israel-Navigation.mbtiles`
- `~/Downloads/flight-maps-mbtiles/LSA-Low-Altitude.mbtiles`
- `~/Downloads/flight-maps-mbtiles/Israel-Helicopters.mbtiles`

## Layout

- `index.html`, `sw.js`, `manifest.json`, `robots.txt`, `sitemap.xml`, and
  `BingSiteAuth.xml` stay at the web root because browsers, crawlers, or Pages
  workflows address them directly.
- `app/` holds the plain JavaScript and CSS loaded by `index.html`.
- `data/` holds shipped JSON datasets.
- `i18n/` holds locale string bundles.
- `assets/` holds icons and social preview images.
- `byop/` keeps the published chart PDFs at their stable public URL.
- `legacy/` holds the old static-map generator artifacts.

## License & data

NavAid is released under the [MIT License](../LICENSE) — no warranty, no liability.

Charts © flight-maps.com / CAAI; imagery © Esri; map data © OpenStreetMap
contributors; VFR reporting points © ICAO / CAAI.

NavAid is a planning aid only and not certified for primary navigation.
