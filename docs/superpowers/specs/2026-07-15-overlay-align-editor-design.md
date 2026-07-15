# Overlay Align Editor — design

## Problem
Chart overlays (Extra layers: circuit / training / cvfr / heli / commfail) are
placed by lat/long bounds in `airfields.json`. Many are misaligned, and 7 have
no graticule source to auto-georeference from. Users need an in-app way to
align an overlay by eye (pan / scale / rotate) and export the corrected coords.

## Scope (v1)
- Enter/exit an **align mode** from the Extra-layers panel.
- Select any currently-shown overlay (click it on the map).
- **Pan / scale / rotate** the selected overlay with on-map handles.
- Persist edits locally (survives reload) and **export** corrected coords as
  JSON to hand back for baking into `airfields.json`. Plus per-overlay + all Reset.
- Out of scope: free skew, editing multiple overlays at once, undo stack.

## Rendering
Leaflet `L.imageOverlay` is axis-aligned only. Add the CDN plugin
`leaflet-imageoverlay-rotated` (`L.imageOverlay.rotated(tl,tr,bl,opts)`,
`.reposition(tl,tr,bl)`), loaded in `index.html` alongside the other Leaflet
plugins. Overlays render as today's `L.imageOverlay` when axis-aligned; switch
to the rotated overlay once rotation is applied.

## Geometry model
Editor state per selected overlay: `{ center:[lat,lng], a, b, rot }` where `a`
is the N–S half-height (deg), `b` the E–W half-width (deg-equiv, i.e. metric
`lngHalf·cos(lat)`), `rot` the rotation (deg). Corners computed in a
cos(lat)-corrected planar frame so rotation looks right on the map.
- **pan** = drag centre handle → set `center`.
- **rotate** = drag rotate handle (beyond top edge) → set `rot` from bearing.
- **scale** = drag a corner handle → symmetric-about-centre resize (`a`,`b`).
Initial state derived from the overlay's current geometry (sw/ne → rot 0).

## Data / persistence
- `localStorage['navaid.overlayBoundsOverrides']` = `{ "<png>": geom }` where
  geom is `{sw,ne}` (rot≈0) or `{tl,tr,bl}` (rotated).
- A shared `buildOverlayLayer(base, ov, ver)` helper merges any override over
  the `airfields.json` value, picks rect vs rotated rendering, and tags the
  layer (`_ovPng`, `_ovType`) so the editor can find/select it. The 5
  `loadXOverlays()` loaders call it.
- **Export**: "Copy overrides" → clipboard JSON keyed by PNG. **Reset**:
  per-overlay and all. Exported coords get baked into `airfields.json` via PR.

## Files
- `docs/index.html` — add rotated-overlay plugin; bump `?v`.
- `docs/app/ui.js` — `buildOverlayLayer`, override merge in the 5 loaders,
  align-mode (enter/exit, select, handles, export/reset panel).
- `docs/app/style.css` — handle + align-panel styles.
- `docs/i18n/*/strings.js` — align-mode strings.
- `tests/overlay-align.spec.js` — coverage.

## Testing
Playwright: enter align mode, select an overlay, assert a drag updates its
bounds and writes the localStorage override; reload keeps the override; export
produces JSON; reset clears it.
