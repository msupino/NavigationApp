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

## Install the Android app

The APK is published on [GitHub Releases](https://github.com/msupino/NavigationApp/releases)
(`android-v*` tags, file `navaid-<version>.apk`). It carries the whole app and the CVFR chart
(z7–z12), so it starts without a network, and it takes web updates by itself: on Wi-Fi
automatically, or on mobile data from **Menu → App version → Download now**. A new APK is
needed only for native changes.

**Directly:** download the APK from the latest release, open it, allow *Install unknown apps*
for your browser if Android asks, and install. It updates an installed NavAid in place (same
signing key); don't uninstall first, that erases your saved routes.

**With [Obtainium](https://github.com/ImranR98/Obtainium)** — notified of every new APK release:

1. Install Obtainium: from its [releases](https://github.com/ImranR98/Obtainium/releases),
   download `app-arm64-v8a-release.apk` and install it (or get it from F-Droid / IzzyOnDroid).
2. In Obtainium tap **Add App**, source URL `https://github.com/msupino/NavigationApp`.
3. Under the additional options set
   - *Filter release titles by regular expression*: `NavAid Android APK`
   - *Filter APKs by regular expression*: `navaid-.*\.apk`
4. **Add**. An installed NavAid is picked up and tracked; **Update** installs a new release over
   it, keeping your data.

If Obtainium reports an update while you are already on the latest (the app says `1.10`, the
release is `android-v1.10.0`), turn off *version detection* in NavAid's settings in Obtainium.

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
