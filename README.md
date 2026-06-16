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
open http://127.0.0.1:8000/?localTiles=1
```

Tile resolution order (each step is tried in sequence):
1. **Pre-extracted PNGs** — `./flight-maps-tiles/` (`--tile-dir`)
2. **Live download** — fetched from `flight-maps.com` on demand, cached in `/tmp/navaid-tiles/`
   with a SHA-256 sidecar for integrity verification
3. **MBTiles SQLite** — `./flight-maps-mbtiles/*.mbtiles` (`--mbtiles-dir`)

### Download MBTiles for offline use

Download all four chart MBTiles files (~500 MB total) from flight-maps.com:

```bash
python3 scripts/local-mbtiles-server.py --get-mbtiles
```

Files are saved to `./flight-maps-mbtiles/`. Existing files are skipped.

### Run fully offline (no live downloads)

After downloading MBTiles, pass `--no-download` so the server never contacts
flight-maps.com — it serves only from local files:

```bash
python3 scripts/local-mbtiles-server.py --no-download
open http://127.0.0.1:8000/?localTiles=1
```

404s for individual tiles are normal — they mean those grid cells are outside
the chart's published coverage area (the CVFR MBTiles covers route corridors,
not the entire country at every zoom level).

### Bulk-extract MBTiles to PNG files

If you have the MBTiles files and want the fastest possible tile serving
(no SQLite overhead), pre-extract them to individual PNGs:

```bash
python3 scripts/local-mbtiles-server.py --extract        # extract then serve
python3 scripts/local-mbtiles-server.py --extract-only   # extract and exit
python3 scripts/local-mbtiles-server.py --force-extract  # overwrite existing PNGs
```

### Custom paths

```bash
python3 scripts/local-mbtiles-server.py \
  --mbtiles-dir /path/to/mbtiles \
  --tile-dir    /path/to/tiles \
  --download-cache /path/to/cache
```
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
