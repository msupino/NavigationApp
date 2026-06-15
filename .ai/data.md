# Data And Source Of Truth

All shipped operational data lives under `docs/data/`. Keep data changes
separate from UI refactors when possible.

## Dataset Index

- `airfields.json` - airfields, ARPs, names, runways, plates, frequencies,
  ATIS/clearance, and metadata used by inspectors and charts.
- `nav-waypoints.json` - Israeli CVFR reporting points with canonical code,
  Hebrew label, and coordinates.
- `leg-altitude.json` - known altitude pairs for CVFR route segments.
- `route-templates.json` - ready-made route templates. Do not duplicate leg
  altitude values here when they belong in `leg-altitude.json`.
- `comm-change.json` - frequency-change boundaries and call-sign defaults.
- `vor.json` - VOR stations used by radial/DME readouts.
- `terrain.json` - coarse elevation grid for MSA warnings.
- `wx.json` - weather metadata/source configuration.
- `sigmet.json` - SIGMET/FIR display data.

## Naming Rules

- Waypoint `name` is the canonical code used in route storage and lookups.
- Hebrew labels use `he`; English display labels use `en` when available.
- Airfield `name` is ICAO.
- Route templates should store waypoint codes, not localized labels, unless the
  point is genuinely user-defined.

## Nav Waypoints

`nav-waypoints.json` contains published Israeli VFR reporting points:

```json
{ "name": "BAZRA", "he": "בצרה", "lat": 32.21861, "lng": 34.8825 }
```

The IAA CVFR waypoint reference table is the source of truth. Airfield ARPs do
not belong here; richer airfield records belong in `airfields.json`.

When updating:

1. Regenerate from the published table.
2. Keep `{ name, he, lat, lng }`.
3. Round coordinates consistently.
4. Diff code/name changes manually.
5. Run waypoint/dataset tests.

## Airfields

Airfields power:

- map triangles and labels
- route waypoint snap/title resolution
- inspector frequencies, ATIS, clearance, weather, runways, plates
- BYOP chart modal

The radio-frequency PDF supplied by the maintainer is the source of truth for
primary, clearance, and ATIS fields when present.

When changing airfields:

```bash
node scripts/sync-airfield-test-arps.js
npx playwright test tests/airfields-dataset.spec.js tests/airfield-arp.spec.js
```

## Leg Altitudes

`leg-altitude.json` stores per-direction values for known CVFR legs.

Use `null` for no known value in a direction, and mark blocked/one-way paths
with the existing schema. Do not infer altitudes from route templates once the
leg is known; migrate the value into `leg-altitude.json` and strip it from the
template.

The altitude-pairs chart is an editing/viewing surface for this dataset. If you
change schema or status semantics, update the chart tests and the UI copy in
both languages.

## Route Templates

Templates are starter routes, not a second source of truth for leg metadata.

Rules:

- Use canonical waypoint codes.
- Keep user-editable display names out unless necessary.
- Keep speed/profile defaults in the template.
- Store leg altitudes in `leg-altitude.json`, not in the template, when the leg
  is a known CVFR segment.

## Terrain / MSA

`terrain.json` is a planning-aid elevation grid. The app computes:

```text
MSA = ceil((max terrain along leg + 1000 ft) / 100) * 100
```

If coverage is false or missing, show no MSA rather than a misleading value.

Rebuild from SRTM `.hgt` files:

```bash
python3 scripts/build_terrain.py /path/to/hgt --out docs/data/terrain.json
```

## BYOP PDFs

`docs/byop/` is intentionally public and stable. Deploy keeps one production
copy and points staging/PR previews at it to avoid huge Pages artifacts.

Do not move or duplicate these PDFs without updating:

- `docs/byop/README.md`
- `plateBase()` behavior in `docs/app/io.js`
- deploy assembly comments/tests if relevant
