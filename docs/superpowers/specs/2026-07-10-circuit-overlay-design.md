# Circuit Overlay — Design Spec

**Date:** 2026-07-10  
**Status:** Approved

## Summary

Add a toggle in the toolbar's Overlays group that displays per-airfield circuit/CVFR plates as georeferenced image overlays on the Leaflet map, with an opacity slider.

## Scope

- 9 Israeli airfields with runway data: LLBG, LLBS, LLER, LLES, LLHA, LLHZ, LLIB, LLKS, LLMG
- One plate per airfield (hand-picked from existing `byop/` plates)
- Toggle + opacity slider persisted to localStorage
- No changes to `draw.js` or the canvas overlay

## Plate Selection

"Annex Gimel" (ג' = C) is consistently the circuit plate across Israeli GA airfields. Planned mapping:

| Airfield | Source PDF |
|----------|-----------|
| LLBG | `LLBG_airport_VFR.pdf` |
| LLBS | `LLBS_airport_Annex Gimel.pdf` |
| LLER | `LLER_VFRTA_en.pdf` |
| LLES | `LLES_airport_Chart.pdf` |
| LLHA | `LLHA_airport_Annex Gimel.pdf` |
| LLHZ | `LLHZ_airport_Annex Gimel.pdf` |
| LLIB | `LLIB_airport_Annex Gimel.pdf` |
| LLKS | `LLKS_airport_CVFR.pdf` |
| LLMG | `LLMG_airport_Circuit.pdf` |

Any airfield whose plate turns out to be a non-georeferenced schematic (not a map excerpt) is omitted from `circuit_overlay` in the data.

## Data Changes

### `docs/data/airfields.json`

Add `circuit_overlay` to each applicable airfield entry:

```json
{
  "name": "LLHZ",
  "circuit_overlay": {
    "png": "LLHZ_circuit.png",
    "sw": [swLat, swLng],
    "ne": [neLat, neLng]
  }
}
```

`sw` and `ne` are the SW and NE corners of the image in `[lat, lng]` order, read manually from each plate's coordinate graticule at 150 DPI resolution.

### `docs/circuit-img/` (new directory)

Pre-converted PNG files, one per airfield, named `{ICAO}_circuit.png`. Converted with:

```bash
pdftoppm -r 150 -png -f 1 -l 1 "SOURCE.pdf" "docs/circuit-img/LLHZ_circuit"
# output: docs/circuit-img/LLHZ_circuit-1.png → rename to LLHZ_circuit.png
```

Expected size: ~1–2 MB per file, ~8 files total (~12 MB committed to repo).

## UI — `docs/index.html`

Insert after the `airfield-cb` label block, in the **Overlays** group:

```html
<label class="navtoggle" data-i18n-title="tbShowCircuitTitle">
  <input type="checkbox" id="circuit-cb"> <span data-i18n="tbShowCircuit"></span>
</label>
<div id="circuit-controls" hidden>
  <label class="navtoggle" data-i18n-title="tbCircuitOpacityTitle">
    <span data-i18n="tbCircuitOpacity"></span>
    <input type="range" id="circuit-opacity" min="0.1" max="1" step="0.05" value="0.8">
    <span class="slider-val" id="circuit-opacity-val"></span>
    <button id="circuit-opacity-reset" class="slider-reset" type="button"
            data-i18n-title="tbCircuitOpacityReset">↻</button>
  </label>
</div>
```

The `circuit-controls` div is shown/hidden by the checkbox, matching the windfield pattern.

## i18n Strings

Add to both `docs/app/core.js` (English defaults) and `docs/i18n/he/strings.js` (Hebrew):

| Key | English | Hebrew |
|-----|---------|--------|
| `tbShowCircuit` | `Show circuit overlays` | `הצג שכבות הקפה` |
| `tbShowCircuitTitle` | `Overlay georeferenced circuit plates for Israeli airfields` | `הצג תרשימי הקפה מוקרנים לשדות תעופה ישראלים` |
| `tbCircuitOpacity` | `Circuit opacity` | `שקיפות הקפה` |
| `tbCircuitOpacityTitle` | `Adjust circuit overlay opacity` | `כוונן שקיפות שכבת הקפה` |
| `tbCircuitOpacityReset` | `Reset circuit opacity` | `אפס שקיפות הקפה` |

## JS — `docs/app/ui.js`

### Globals / constants

```js
const CIRCUIT_SHOW_KEY    = 'navaid.showCircuit';
const CIRCUIT_OPACITY_KEY = 'navaid.circuitOpacity';
const CIRCUIT_DEFAULT_OPACITY = 0.8;

window.showCircuit = localStorage.getItem(CIRCUIT_SHOW_KEY) === '1';
let circuitLayerGroup = null;   // null = not yet created
let circuitOpacity    = parseFloat(localStorage.getItem(CIRCUIT_OPACITY_KEY))
                        || CIRCUIT_DEFAULT_OPACITY;
```

### `loadCircuitOverlays()`

Called once on first enable. Iterates `airfields`, creates one `L.imageOverlay` per entry with a `circuit_overlay` field. URL constructed with `plateBase()` + `../circuit-img/` + filename — so the path resolves correctly on production, staging, and PR previews.

```js
function loadCircuitOverlays() {
  if (circuitLayerGroup) return;
  if (!airfields) return;
  circuitLayerGroup = L.layerGroup();
  for (const af of airfields) {
    const co = af.circuit_overlay;
    if (!co) continue;
    L.imageOverlay(
      plateBase() + '../circuit-img/' + encodeURIComponent(co.png),
      [co.sw, co.ne],
      { opacity: circuitOpacity, interactive: false, pane: 'overlayPane' }
    ).addTo(circuitLayerGroup);
  }
}
```

### Toggle handler

```js
const circuitCb       = document.getElementById('circuit-cb');
const circuitControls = document.getElementById('circuit-controls');

if (circuitCb) {
  circuitCb.checked = showCircuit;
  if (circuitControls) circuitControls.hidden = !showCircuit;

  circuitCb.onchange = async e => {
    showCircuit = e.target.checked;
    try { localStorage.setItem(CIRCUIT_SHOW_KEY, showCircuit ? '1' : '0'); } catch (_) {}
    if (circuitControls) circuitControls.hidden = !showCircuit;
    if (showCircuit) {
      if (!airfields) await loadAirfields();
      loadCircuitOverlays();
      if (circuitLayerGroup) circuitLayerGroup.addTo(map);
    } else {
      if (circuitLayerGroup) circuitLayerGroup.remove();
    }
  };
}
```

### Opacity slider handler

```js
const circuitOpacityEl    = document.getElementById('circuit-opacity');
const circuitOpacityVal   = document.getElementById('circuit-opacity-val');
const circuitOpacityReset = document.getElementById('circuit-opacity-reset');

function applyCircuitOpacity(v) {
  circuitOpacity = v;
  if (circuitOpacityVal) circuitOpacityVal.textContent = Math.round(v * 100) + '%';
  if (circuitLayerGroup) circuitLayerGroup.eachLayer(l => l.setOpacity(v));
}

if (circuitOpacityEl) {
  circuitOpacityEl.value = String(circuitOpacity);
  applyCircuitOpacity(circuitOpacity);
  circuitOpacityEl.oninput = () => {
    const v = parseFloat(circuitOpacityEl.value);
    try { localStorage.setItem(CIRCUIT_OPACITY_KEY, String(v)); } catch (_) {}
    applyCircuitOpacity(v);
  };
}

if (circuitOpacityReset) {
  circuitOpacityReset.onclick = () => {
    if (!circuitOpacityEl) return;
    circuitOpacityEl.value = String(CIRCUIT_DEFAULT_OPACITY);
    try { localStorage.setItem(CIRCUIT_OPACITY_KEY, String(CIRCUIT_DEFAULT_OPACITY)); } catch (_) {}
    applyCircuitOpacity(CIRCUIT_DEFAULT_OPACITY);
  };
}
```

### Initialisation (page load)

If `showCircuit` is already `true` on load (restored from localStorage), call `loadAirfields()` → `loadCircuitOverlays()` → add layer group to map — same pattern as `showAirfields`/`showVorStations` init guards already in `ui.js`.

## URL Path Resolution

`plateBase()` already normalises for production (`/`), staging (`/staging/`), and PR preview (`/pr/NNN/`) by stripping the suffix from `location.pathname`. Circuit images live one level deeper than `byop/` so `../circuit-img/` resolves correctly relative to `plateBase()`.

## Files Changed

| File | Change |
|------|--------|
| `docs/data/airfields.json` | Add `circuit_overlay` to 9 entries |
| `docs/circuit-img/*.png` | New directory, ~8 PNG files |
| `docs/index.html` | Add `circuit-cb` label + `circuit-controls` div |
| `docs/app/ui.js` | Globals, `loadCircuitOverlays()`, toggle + opacity handlers, init guard |
| `docs/app/core.js` | 5 new i18n string keys (English defaults) |
| `docs/i18n/he/strings.js` | 5 new i18n string keys (Hebrew) |

## Out of Scope

- Computing circuit geometry programmatically (deferred)
- Airfields without georeferenced plates
- Rotation/skew correction for plates that aren't axis-aligned
- PNG optimisation / CDN hosting (repo size ~12 MB is acceptable)
