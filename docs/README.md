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

To use local Flight Maps chart layers instead of the live CDN tiles, run from
the repository root:

```bash
python3 scripts/local-mbtiles-server.py
# http://127.0.0.1:8000/?localTiles=1
```

Tile resolution order:
1. **Pre-extracted PNGs** — `./flight-maps-tiles/` (`--tile-dir`; populate with `--extract`)
2. **Live download** — fetched from `flight-maps.com` on demand, cached in
   `/tmp/navaid-tiles/` with a SHA-256 sidecar for integrity verification
3. **MBTiles SQLite** — `./flight-maps-mbtiles/*.mbtiles` (`--mbtiles-dir`; optional fallback)

MBTiles files are **not required** at startup — tiles download automatically on
first request. Pass `--no-download` to enforce offline-only mode.

Use `--extract` / `--extract-only` / `--force-extract` to bulk-extract MBTiles
into the pre-extracted tile dir. Use `--download-cache` to override the default
`/tmp/navaid-tiles` cache location.

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
