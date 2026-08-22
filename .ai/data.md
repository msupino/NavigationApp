# Data And Source Of Truth

All shipped operational data lives under `docs/data/`. Keep data changes
separate from UI refactors when possible.

The IMS chart workflow finalizes PWX and SIGWX manifests category-by-category.
A category is replaced only when every PNG referenced by its candidate manifest
was converted successfully; otherwise its complete last-good manifest is kept.
After both decisions, PNGs not referenced by either live manifest are pruned.

## Dataset Index

- `airfields.json` - airfields, ARPs, names, runways, plates, frequencies,
  ATIS/clearance, and metadata used by inspectors and charts.
- `cvfr-route-graph.json`, `lsa-route-graph.json`, and
  `heli-route-graph.json` - the layer-specific route graphs. Each graph stores
  canonical point records under `nodes`, directed adjacency under `edges`, and
  communication metadata under `commMeta`. The active `navDataPrefix` selects
  the runtime graph; waypoint, leg-altitude, and communication-change views are
  projections of this one source.
- `route-templates.json` - ready-made route templates. Do not duplicate leg
  altitude values here when they belong on an edge in the active route graph.
- `vor.json` - VOR stations used by radial/DME readouts.
- `terrain.json` - coarse elevation grid for MSA warnings.
- `wx.json` - weather metadata/source configuration.
- `sigmet.json` - SIGMET/FIR display data.
- `notam.json` - offline fallback for the NOTAM layer (empty stub). Live data is
  the `notam-data` orphan branch, published daily by
  `.github/workflows/notam.yml` from autorouter (Eurocontrol EAD) for the Israel
  FIR (LLLL). The app fetches the branch first and falls back to this file.
- `notam-borders.json` - Israel international border arcs (per neighbour:
  Lebanon/Syria/Egypt/Jordan; Israel-side `[lat,lng]` vertices, from
  geoBoundaries ADM0). Used to geocode prose "border buffer" NOTAMs
  ("FM LEBANON BOUNDARY TO 8KM") into polygons. Planning-grade, not survey.

## NOTAMs

The NOTAM layer is fed by a scheduled Action, not a hand-maintained file:

- `.github/workflows/notam.yml` pulls Israel-FIR NOTAMs from autorouter
  (Eurocontrol EAD) and force-pushes `notam.json` to the `notam-data` branch.
- The app reads that branch (raw.githubusercontent) and renders areas from each
  NOTAM's `geom` (polygon / circle / line), with airport count badges for
  coordinate-less airport NOTAMs and a full-text list modal.
- Geometry the source omits is derived client-side: CVFR route closures resolve
  named fixes against the active nav-waypoint dataset / `airfields.json` /
  `vor.json`;
  prose border NOTAMs are buffered from `notam-borders.json`.
- The list modal decodes the ICAO Q-code + abbreviations (Raw toggle for source
  text); a timeline slider scrubs which NOTAMs are active at a future time.

## Naming Rules

- Waypoint `name` is the canonical code used in route storage and lookups.
- Hebrew labels use `he`; English display labels use `en` when available.
- Airfield `name` is ICAO.
- Route templates should store waypoint codes, not localized labels, unless the
  point is genuinely user-defined.

## Nav Waypoints

`cvfr-route-graph.json` contains 172 CVFR-layer waypoint members keyed by code
under `nodes`. The runtime projection renders the 170 active members. The graph
also carries 22 minimal airfield endpoint nodes so route edges remain connected:

```json
{ "name": "ZLHAV", "en": "Lehavim Junction", "he": "צומת להבים", "lat": 31.3725, "lng": 34.79333, "report": "mandatory" }
```

The IAA CVFR waypoint reference table is the source of truth for waypoint nodes.
Airfield nodes in this graph contain only topology identity and coordinates;
richer ARP, runway, plate, frequency and elevation records belong in
`airfields.json`.

When updating:

1. Regenerate the CVFR graph from the published sources.
2. Keep canonical node identity, labels, coordinates, kind, layers and report metadata.
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

The active `<prefix>-route-graph.json` stores per-direction values in each
`edges.<from>[]` entry for its chart family.

Use `null` for no known value in a direction, and mark blocked/one-way paths
with the existing schema. Do not infer altitudes from route templates once the
leg is known; migrate the value into the matching route-graph edge and strip it
from the template.

The altitude-pairs chart is an editing/viewing surface for this dataset. If you
change schema or status semantics, update the chart tests and the UI copy in
both languages.

## Route Templates

Templates are starter routes, not a second source of truth for leg metadata.

Rules:

- Use canonical waypoint codes.
- Keep user-editable display names out unless necessary.
- Keep speed/profile defaults in the template.
- Store leg altitudes in the matching route-graph edge, not in the template,
  when the leg is a known chart segment.
- A template also keeps minimal `notes` (freq-change callouts: `cc`,
  `freqName`, optional `freqAuto`) and `commChangeSuppressions`; it does not
  store coordinates, literal frequencies, or per-leg altitudes.
  See `.ai/route-templates.md` for the full keeps-vs-drops list and the
  contrast with "Save route" (which keeps everything).

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
copy and staging resolves plates against that shared root URL.

Do not move or duplicate these PDFs without updating:

- `docs/byop/README.md`
- `plateBase()` behavior in `docs/app/io.js`
- deploy assembly comments/tests if relevant
