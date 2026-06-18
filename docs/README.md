# NavAid — HTML5

Browser-based CVFR / Israel-area flight-route planner. Plain HTML +
CSS + JavaScript on top of Leaflet, no build step.

- **Live (production):** https://navaid.supino.org/
- **Live (staging):** https://navaid.supino.org/staging/
- **Wiki:** https://github.com/msupino/NavigationApp/wiki — full documentation / תיעוד מלא

## Run locally

Serve the folder so Leaflet's CDN tiles load over HTTPS:

```bash
python3 -m http.server -d docs 8000
# http://localhost:8000
```

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
- `../scripts/` holds build tools (e.g. `build_terrain.py`).
- `../.ai/` holds the AI handbook for workflow, architecture, data, UI
  patterns, testing, and checklists.

## Terrain / MSA dataset

`data/terrain.json` is a coarse elevation grid used to show a **Minimum Safe
Altitude (MSA)** per leg in the leg inspector — `ceil((max terrain along the
leg + 1000 ft) / 100) * 100` — flagged red when a planned altitude is below
it. The engine lives in `app/terrain.js`. If `coverage` is `false` the app
shows no MSA at all (never a false "safe" value).

The shipped grid is the Israel area at ~2 km cells (200×85, metres, max-pooled
so a cell never understates the highest terrain), built from SRTM `.hgt`
tiles. Rebuild / extend it with:

```bash
# e.g. the flight-maps.com OruxMaps height pack (SRTM .hgt tiles)
unzip height.zip -d /tmp/hgt
python3 scripts/build_terrain.py /tmp/hgt          # → docs/data/terrain.json
# options: --bbox S W N E   --cell 0.02   --out <path>
```

**Safety:** MSA is a planning aid only — not a terrain-avoidance system.

## License & data

NavAid is released under the [MIT License](../LICENSE) — no warranty, no liability.

Charts © flight-maps.com / CAAI; imagery © Esri; map data © OpenStreetMap
contributors; VFR reporting points © ICAO / CAAI; terrain elevation from SRTM
(NASA, public domain).

NavAid is a planning aid only and not certified for primary navigation.
