# Architecture Notes

NavAid is a static Leaflet application with one canvas overlay. All app scripts
share a browser global scope and are loaded in a fixed order from
`docs/index.html`.

## Ordered Scripts

The order matters:

1. `docs/app/core.js` - constants, global state, migrations, geometry helpers,
   map/layer setup, default English strings.
2. `docs/app/route-graph-shapes.js` - shared route-graph schema helpers.
3. `docs/app/terrain.js` - terrain-grid and MSA helpers.
4. `docs/app/draw.js` - canvas rendering, overlays, dataset lookups.
5. `docs/app/interact.js` - hit testing, gestures, inspector, modals.
6. `docs/app/io.js` - route save/load, flight plan, exports, chart modals.
7. `docs/app/alt-pair-directions.js` - altitude-pair direction helpers.
8. `docs/app/gdrive.js` - optional Google Drive route library integration.
9. `docs/app/gps.js` - device GPS, simulator state and flight alerts.
10. `docs/app/ui.js` - toolbar wiring, persistence toggles, boot.
11. `docs/app/editor.js` - route-graph editing helpers.
12. `docs/app/assistant.js` - optional AI assistant.
13. `docs/app/offline-tiles.js` - native/offline chart-pack controls.

Do not introduce modules, bundlers, transpilers, or new runtime dependencies
without explicit approval.

## Core State

`state` is the route document:

- `state.waypoints[]` - `{ lat, lng, name }`.
- `state.legs[]` - per-leg speeds, altitudes, label offsets, wind overrides,
  VOR metadata, and blocked/one-way flags.
- `state.notes[]` - free text notes and frequency-change callout notes.
- `state.selected` - selected item, such as `{ type: 'wp', index: 0 }`.
- `state.mode` - add waypoint, note, or inspect mode.

Invariant:

```text
state.legs.length === max(0, state.waypoints.length - 1)
```

Use `syncLegs()` after changing waypoint count unless the helper you are using
already preserves the invariant.

## Rendering

Leaflet owns the base map. The app draws route geometry, labels, kites, notes,
reference points, callouts, and overlays on `#overlay`, a canvas above the map.
CVFR, Navigation, Low Alt, and Helicopters chart tiles load live from
`https://flight-maps.com`. Their `exportUrl` layer options point at
`https://navaid-tiles.supino.org` so PNG export/download can fetch readable
mirror tiles for canvas composition. NavAid-generated layers are kept separate:
CVFR (AIP) loads and exports from
`https://msupino.github.io/NavigationApp-owned-tiles/CVFR-AIP/`.

Rendering flow:

- Convert lat/lng to screen coordinates with `proj(wp)`.
- Draw in `draw()` and related helpers in `draw.js`.
- Redraw on map move, zoom, rotate, resize, state edits, and dataset toggles.

Canvas hit testing mirrors rendering math in `interact.js`; when changing
geometry, update both the draw helper and the matching hit-test helper.

## Interaction Priority

Pointer selection generally resolves in this order:

1. route waypoint
2. note / comm-change arrow
3. leg label/kite
4. route leg
5. reference point or other overlay candidate

Close or overlapping objects should use the multiple-point chooser instead of
forcing the user to zoom in.

## Inspector

`showInspector()` in `interact.js` renders the selected item.

Common patterns:

- Read-only titles for legs, airfields, VORs, and standalone nav waypoints.
- Route waypoint title resolves snapped references when possible.
- Shared title helpers should be reused for route and standalone reference
  points so Hebrew/English behavior stays aligned.
- Satellite snippets should appear below frequency/weather details for
  airfields and below coordinates for points.

When modifying inspector content, consider refresh, language change, and chart
modal behavior. Stored open state uses `sessionStorage` for reloads.

## Persistence

Use existing `navaid.*` keys. Important keys:

- `navaid.route` - current route document.
- `navaid.routes` - saved route library.
- `navaid.view` - map center, zoom, bearing.
- `navaid.layer` - current base layer.
- `navaid.lang` - UI language.
- `navaid.selected` - selected item for reload/language-change restore.
- `navaid.openChartModal` - chart modal restore across language change.
- `navaid.showNavWP`, `navaid.showAirfields`, `navaid.showFreqChanges`,
  `navaid.showVorStations`, `navaid.vorRef` - overlay/readout toggles.
- `navaid.limitLegKites` - clamp leg kites between endpoints.

Before adding a key:

```bash
rg "localStorage\\.setItem|sessionStorage\\.setItem" docs
```

Then update `.ai/navaid-dev.md` and relevant `.ai` docs.

## I18n And Bidi

Default strings live in `window.S` in `core.js`; Hebrew overrides live in
`docs/i18n/he/strings.js`.

Mixed Hebrew/Latin text is fragile. Use existing helpers and CSS patterns:

- `dir="auto"` and `unicode-bidi: plaintext` for plain input titles.
- Isolated spans for modal titles that mix codes, Hebrew names, and
  coordinates.
- Explicit LTR for coordinates, frequencies, VOR radials, and numeric units
  where the map/readout expects aviation formatting.

When touching mixed-direction UI, add or update `tests/bidi-regression.spec.js`.
