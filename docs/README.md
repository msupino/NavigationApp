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
