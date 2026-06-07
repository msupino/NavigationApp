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

To use local Flight Maps chart layers instead of the live CDN tiles:

```bash
python3 scripts/local-mbtiles-server.py
# http://127.0.0.1:8000/?localTiles=1
```

Tile resolution order:
1. **Pre-extracted PNGs** — `~/Downloads/flight-maps-tiles/` (fastest; populate with `--extract`)
2. **Live download** — tiles fetched from `flight-maps.com` on demand and cached in
   `/tmp/navaid-tiles/` with a SHA-256 sidecar for integrity verification
3. **MBTiles SQLite** — `~/Downloads/flight-maps-mbtiles/*.mbtiles` (optional fallback)

MBTiles files are no longer required at startup. If absent, the server downloads
tiles on first request and caches them in `/tmp`.

**Bulk-extract MBTiles to a local tile dir** (if you have the `.mbtiles` files):

```bash
python3 scripts/local-mbtiles-server.py --extract        # extract then serve
python3 scripts/local-mbtiles-server.py --extract-only   # extract and exit
python3 scripts/local-mbtiles-server.py --force-extract  # overwrite existing PNGs
```

**Disable live download** (requires MBTiles or pre-extracted tiles):

```bash
python3 scripts/local-mbtiles-server.py --no-download
```

**Custom cache location** (default `/tmp/navaid-tiles`):

```bash
python3 scripts/local-mbtiles-server.py --download-cache /path/to/cache
```

## License & data

NavAid is released under the [MIT License](LICENSE) — no warranty, no liability.

Charts © flight-maps.com / CAAI; imagery © Esri; map data © OpenStreetMap
contributors; VFR reporting points © ICAO / CAAI.

NavAid is a planning aid only and not certified for primary navigation.
