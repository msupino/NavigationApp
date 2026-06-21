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
