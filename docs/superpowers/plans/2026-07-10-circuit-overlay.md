# Circuit Overlay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a toggle in the toolbar Overlays group that shows per-airfield circuit/VFR plates as georeferenced `L.imageOverlay` layers on the Leaflet map, with an opacity slider.

**Architecture:** Pre-converted PNG files live in `docs/circuit-img/`. Each applicable airfield entry in `airfields.json` gains a `circuit_overlay` field with a PNG filename and `[sw, ne]` lat/lng bounds. A `L.layerGroup` is created lazily on first enable, populated with one `L.imageOverlay` per airfield, then added/removed from the map on toggle. Opacity is driven by `eachLayer(l => l.setOpacity(v))`.

**Tech Stack:** Plain HTML/CSS/JS (no build step), Leaflet `L.imageOverlay`, `pdftoppm` (image conversion), Playwright (tests).

## Global Constraints

- No build step — all JS is plain ES5-compatible global-scope scripts
- `?v=N` cache-bust query strings in `docs/index.html` must stay equal across all occurrences — CI lint enforces this; do NOT change the version number
- Every new i18n key added to `docs/app/core.js` (English default) MUST also appear in `docs/i18n/he/strings.js` (Hebrew); `tests/string-parity.spec.js` enforces this
- All PRs target `dev`, not `main`; every PR must reference a GitHub issue with `Fixes #N`
- Run `python3 -m http.server -d docs 8000` to serve the app locally for Playwright tests
- Default Playwright test timeout is 15 s; raise it per-suite only when justified

---

## File Map

| File | Change |
|------|--------|
| `docs/circuit-img/` | New directory — 8 PNG files (one per airfield) |
| `docs/data/airfields.json` | Add `circuit_overlay: {png, sw, ne}` to 8 entries |
| `docs/app/core.js` | 5 new i18n string defaults (English) |
| `docs/i18n/he/strings.js` | 5 new i18n string keys (Hebrew) |
| `docs/index.html` | New `circuit-cb` label + `circuit-controls` div in Overlays group |
| `docs/app/ui.js` | Globals, `circuitImgBase()`, `loadCircuitOverlays()`, toggle handler, opacity handler, init guard |
| `tests/circuit-overlay.spec.js` | New Playwright test suite |
| `tests/airfields-dataset.spec.js` | New test: validates `circuit_overlay` shape for the 8 entries |

---

## Task 1: Convert PDFs to PNGs

**Files:**
- Create: `docs/circuit-img/` (directory + 8 PNG files)

**Interfaces:**
- Produces: `docs/circuit-img/{ICAO}_circuit.png` — one file per row in the bounds table below

The conversion uses `pdftoppm` (part of `poppler-utils`; already available on the dev machine).

- [ ] **Step 1: Run conversion script**

```bash
mkdir -p /home/marco/NavigationApp/docs/circuit-img

declare -A SRC
SRC[LLBG]="LLBG_airport_VFR.pdf"
SRC[LLBS]="LLBS_airport_Annex Gimel.pdf"
SRC[LLER]="LLER_VFRTA_en.pdf"
SRC[LLHA]="LLHA_airport_Annex Gimel.pdf"
SRC[LLHZ]="LLHZ_airport_Annex Gimel.pdf"
SRC[LLIB]="LLIB_airport_Annex Gimel.pdf"
SRC[LLKS]="LLKS_airport_CVFR.pdf"
SRC[LLMG]="LLMG_airport_Circuit.pdf"

BYOP="/home/marco/NavigationApp/docs/byop"
OUT="/home/marco/NavigationApp/docs/circuit-img"

for ICAO in LLBG LLBS LLER LLHA LLHZ LLIB LLKS LLMG; do
  pdftoppm -r 150 -png -f 1 -l 1 "$BYOP/${SRC[$ICAO]}" "$OUT/${ICAO}_circuit"
  mv "$OUT/${ICAO}_circuit-1.png" "$OUT/${ICAO}_circuit.png"
  echo "OK: $ICAO → ${ICAO}_circuit.png"
done
```

Expected: 8 lines of `OK: LLXX → LLXX_circuit.png`, 8 PNG files in `docs/circuit-img/`.

- [ ] **Step 2: Verify each PNG visually**

Open each file and confirm it is a georeferenced VFR/circuit chart (map-style, not a text document). LLES is intentionally omitted — its chart plate is a text document, not a map.

```bash
ls -lh /home/marco/NavigationApp/docs/circuit-img/
# Expected: 8 .png files, each 500 KB – 3 MB
```

- [ ] **Step 3: Commit images**

```bash
git add docs/circuit-img/
git commit -m "assets: add pre-converted circuit overlay PNG images (8 airfields)"
```

---

## Task 2: Add `circuit_overlay` data to `airfields.json` and dataset test

**Files:**
- Modify: `docs/data/airfields.json`
- Modify: `tests/airfields-dataset.spec.js`

**Interfaces:**
- Produces: `airfield.circuit_overlay` — `{png: string, sw: [lat, lng], ne: [lat, lng]}` on 8 entries
- Consumed by: Task 5 (`loadCircuitOverlays()`)

The bounds below are read from each plate's coordinate graticule at 150 DPI. They are accurate to ±0.05°; visually check alignment after Task 5 and nudge if needed.

- [ ] **Step 1: Write the failing dataset test**

Add to the bottom of `tests/airfields-dataset.spec.js`:

```js
test.describe('circuit_overlay field', () => {
  const EXPECTED = {
    LLBG: { png: 'LLBG_circuit.png', sw: [31.833, 34.75],  ne: [32.167, 35.0]   },
    LLBS: { png: 'LLBS_circuit.png', sw: [31.12,  34.65],  ne: [31.43,  34.87]  },
    LLER: { png: 'LLER_circuit.png', sw: [29.50,  34.75],  ne: [29.917, 35.083] },
    LLHA: { png: 'LLHA_circuit.png', sw: [32.667, 35.0],   ne: [32.917, 35.167] },
    LLHZ: { png: 'LLHZ_circuit.png', sw: [32.00,  34.83],  ne: [32.25,  35.08]  },
    LLIB: { png: 'LLIB_circuit.png', sw: [32.833, 35.417], ne: [33.167, 35.667] },
    LLKS: { png: 'LLKS_circuit.png', sw: [33.18,  35.55],  ne: [33.37,  35.70]  },
    LLMG: { png: 'LLMG_circuit.png', sw: [32.567, 35.20],  ne: [32.633, 35.267] },
  };

  test('eight airfields carry circuit_overlay with correct shape', async () => {
    const d = loadData();
    const byCode = new Map(d.airfields.map(a => [a.name, a]));
    for (const [code, exp] of Object.entries(EXPECTED)) {
      const af = byCode.get(code);
      expect(af, `${code} missing from airfields`).toBeTruthy();
      const co = af.circuit_overlay;
      expect(co, `${code} missing circuit_overlay`).toBeTruthy();
      expect(co.png).toBe(exp.png);
      expect(Array.isArray(co.sw) && co.sw.length === 2).toBe(true);
      expect(Array.isArray(co.ne) && co.ne.length === 2).toBe(true);
      // Rough sanity: SW south of NE, SW west of NE, coords in Israel envelope
      expect(co.sw[0]).toBeLessThan(co.ne[0]);     // sw lat < ne lat
      expect(co.sw[1]).toBeLessThan(co.ne[1]);     // sw lng < ne lng
      expect(co.sw[0]).toBeGreaterThan(29);
      expect(co.ne[0]).toBeLessThan(34);
      expect(co.sw[1]).toBeGreaterThan(34);
      expect(co.ne[1]).toBeLessThan(36);
    }
  });

  test('LLES has no circuit_overlay (text plate, not georeferenced)', async () => {
    const d = loadData();
    const lles = d.airfields.find(a => a.name === 'LLES');
    expect(lles).toBeTruthy();
    expect(lles.circuit_overlay).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /home/marco/NavigationApp
npx playwright test tests/airfields-dataset.spec.js --grep "circuit_overlay" 2>&1 | tail -20
```

Expected: FAIL — `LLBG missing circuit_overlay`

- [ ] **Step 3: Add `circuit_overlay` to `airfields.json`**

Find each of the 8 ICAO entries in `docs/data/airfields.json` and add the `circuit_overlay` field. The exact position in the object does not matter; insert after `runways` when present, after `plates` otherwise.

```json
// LLBG entry — add:
"circuit_overlay": { "png": "LLBG_circuit.png", "sw": [31.833, 34.75],  "ne": [32.167, 35.0]   }

// LLBS entry — add:
"circuit_overlay": { "png": "LLBS_circuit.png", "sw": [31.12,  34.65],  "ne": [31.43,  34.87]  }

// LLER entry — add:
"circuit_overlay": { "png": "LLER_circuit.png", "sw": [29.50,  34.75],  "ne": [29.917, 35.083] }

// LLHA entry — add:
"circuit_overlay": { "png": "LLHA_circuit.png", "sw": [32.667, 35.0],   "ne": [32.917, 35.167] }

// LLHZ entry — add:
"circuit_overlay": { "png": "LLHZ_circuit.png", "sw": [32.00,  34.83],  "ne": [32.25,  35.08]  }

// LLIB entry — add:
"circuit_overlay": { "png": "LLIB_circuit.png", "sw": [32.833, 35.417], "ne": [33.167, 35.667] }

// LLKS entry — add:
"circuit_overlay": { "png": "LLKS_circuit.png", "sw": [33.18,  35.55],  "ne": [33.37,  35.70]  }

// LLMG entry — add:
"circuit_overlay": { "png": "LLMG_circuit.png", "sw": [32.567, 35.20],  "ne": [32.633, 35.267] }
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx playwright test tests/airfields-dataset.spec.js --grep "circuit_overlay" 2>&1 | tail -10
```

Expected: 2 tests PASS

- [ ] **Step 5: Run full airfields dataset suite to check no regressions**

```bash
npx playwright test tests/airfields-dataset.spec.js 2>&1 | tail -10
```

Expected: all tests PASS

- [ ] **Step 6: Commit**

```bash
git add docs/data/airfields.json tests/airfields-dataset.spec.js
git commit -m "feat: add circuit_overlay bounds data to 8 airfields in airfields.json"
```

---

## Task 3: Add i18n strings

**Files:**
- Modify: `docs/app/core.js`
- Modify: `docs/i18n/he/strings.js`

**Interfaces:**
- Produces: string keys `tbShowCircuit`, `tbShowCircuitTitle`, `tbCircuitOpacity`, `tbCircuitOpacityTitle`, `tbCircuitOpacityReset`
- Consumed by: Task 4 (`data-i18n` attributes) and Task 5 (JS fallback `S.key`)

- [ ] **Step 1: Write the failing string-parity test extension**

The `string-parity.spec.js` already has a test that checks every HE key exists in EN. Adding the new keys to EN but not HE (or vice versa) will cause that suite to fail. Verify the test currently passes before touching anything:

```bash
npx playwright test tests/string-parity.spec.js 2>&1 | tail -5
```

Expected: PASS (baseline)

- [ ] **Step 2: Add English defaults to `docs/app/core.js`**

Find the `tbShowAirfields` / `tbShowAirfieldsTitle` block (around line 866) and insert immediately after it:

```js
  tbShowCircuit: 'Show circuit overlays',
  tbShowCircuitTitle: 'Overlay georeferenced circuit/VFR plates for Israeli airfields',
  tbCircuitOpacity: 'Circuit opacity',
  tbCircuitOpacityTitle: 'Adjust circuit overlay opacity',
  tbCircuitOpacityReset: 'Reset opacity',
```

- [ ] **Step 3: Add Hebrew strings to `docs/i18n/he/strings.js`**

Find the `tbShowAirfields` / `tbShowAirfieldsTitle` block (around line 381) and insert immediately after it:

```js
  tbShowCircuit: 'הצג שכבות הקפה',
  tbShowCircuitTitle: 'הצג תרשימי הקפה/VFR מוקרנים לשדות תעופה ישראלים',
  tbCircuitOpacity: 'שקיפות הקפה',
  tbCircuitOpacityTitle: 'כוונן שקיפות שכבת הקפה',
  tbCircuitOpacityReset: 'אפס שקיפות',
```

- [ ] **Step 4: Run string-parity test**

```bash
npx playwright test tests/string-parity.spec.js 2>&1 | tail -5
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add docs/app/core.js docs/i18n/he/strings.js
git commit -m "i18n: add circuit overlay string keys to EN and HE"
```

---

## Task 4: Add HTML toggle and controls

**Files:**
- Modify: `docs/index.html`

**Interfaces:**
- Produces: `#circuit-cb` (checkbox), `#circuit-controls` (collapsible div), `#circuit-opacity` (range), `#circuit-opacity-val` (span), `#circuit-opacity-reset` (button)
- Consumed by: Task 5 (JS wires up all these elements)

- [ ] **Step 1: Locate the insertion point**

In `docs/index.html`, find the `airfield-cb` block — it looks like:

```html
        <label class="navtoggle" data-i18n-title="tbShowAirfieldsTitle">
          <input type="checkbox" id="airfield-cb" checked> <span data-i18n="tbShowAirfields"></span>
        </label>
```

- [ ] **Step 2: Insert circuit toggle immediately after that block**

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

- [ ] **Step 3: Verify `?v=` values are still consistent**

The CI lint checks that all `?v=N` query strings in `docs/index.html` agree. No `?v=` appears in the new HTML, so no change needed — but confirm the file still parses cleanly:

```bash
python3 -c "
import re, sys
txt = open('docs/index.html').read()
vs = set(re.findall(r'\?v=(\d+)', txt))
print('v= values:', vs)
sys.exit(0 if len(vs) <= 1 else 1)
"
```

Expected: `v= values: {'1'}` (or whatever single value was there before), exit 0

- [ ] **Step 4: Smoke-test the page loads**

```bash
python3 -m http.server -d docs 8000 &
sleep 1
npx playwright test tests/smoke.spec.js 2>&1 | tail -5
kill %1
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add docs/index.html
git commit -m "ui: add circuit overlay toggle and opacity slider to toolbar Overlays group"
```

---

## Task 5: Implement JS logic in `ui.js`

**Files:**
- Modify: `docs/app/ui.js`

**Interfaces:**
- Consumes: `airfields` (global array, loaded by `loadAirfields()`), `plateBase()` (function, defined earlier in `ui.js`), elements `#circuit-cb`, `#circuit-controls`, `#circuit-opacity`, `#circuit-opacity-val`, `#circuit-opacity-reset`
- Produces: `window.showCircuit` (bool), `window.circuitLayerGroup` (L.layerGroup or null), `circuitImgBase()` (function), `loadCircuitOverlays()` (function)

All code below goes into `docs/app/ui.js`. Insert each block at the location described.

- [ ] **Step 1: Add constants and globals**

Find the `AIRFIELDS_KEY` block (around line 2675). Insert the following block immediately before it:

```js
// ── Circuit overlay ──────────────────────────────────────────────────────────
const CIRCUIT_SHOW_KEY    = 'navaid.showCircuit';
const CIRCUIT_OPACITY_KEY = 'navaid.circuitOpacity';
const CIRCUIT_DEFAULT_OPACITY = 0.8;

window.showCircuit = localStorage.getItem(CIRCUIT_SHOW_KEY) === '1';
window.circuitLayerGroup = null;
let circuitOpacity = (() => {
  const v = parseFloat(localStorage.getItem(CIRCUIT_OPACITY_KEY));
  return isNaN(v) ? CIRCUIT_DEFAULT_OPACITY : v;
})();
```

- [ ] **Step 2: Add `circuitImgBase()` helper**

Insert immediately after the `plateBase()` function definition (search for `function plateBase(`):

```js
function circuitImgBase(pathname) {
  let dir = (pathname || location.pathname).replace(/[^/]*$/, '');
  dir = dir.replace(/(staging|pr\/[^/]+|branch\/[^/]+)\/$/, '');
  return dir + 'circuit-img/';
}
```

- [ ] **Step 3: Add `loadCircuitOverlays()` and `applyCircuitOpacity()`**

Insert immediately after the `circuitImgBase` function:

```js
function loadCircuitOverlays() {
  if (circuitLayerGroup) return;
  if (!airfields) return;
  circuitLayerGroup = L.layerGroup();
  for (const af of airfields) {
    const co = af.circuit_overlay;
    if (!co) continue;
    L.imageOverlay(
      circuitImgBase() + encodeURIComponent(co.png),
      [co.sw, co.ne],
      { opacity: circuitOpacity, interactive: false, pane: 'overlayPane' }
    ).addTo(circuitLayerGroup);
  }
}

function applyCircuitOpacity(v) {
  circuitOpacity = v;
  const valEl = document.getElementById('circuit-opacity-val');
  if (valEl) valEl.textContent = Math.round(v * 100) + '%';
  if (circuitLayerGroup) circuitLayerGroup.eachLayer(l => l.setOpacity(v));
}
```

- [ ] **Step 4: Wire up toggle and opacity handlers**

Find the `AIRFIELDS_KEY` / `airfield-cb` handler block. Insert the following after the closing brace of the `airfield-cb` `onchange` handler (just before the `VOR_STATIONS_KEY` block):

```js
// Circuit overlay toggle
(function () {
  const cb       = document.getElementById('circuit-cb');
  const controls = document.getElementById('circuit-controls');
  const opEl     = document.getElementById('circuit-opacity');
  const opVal    = document.getElementById('circuit-opacity-val');
  const opReset  = document.getElementById('circuit-opacity-reset');

  if (cb) {
    cb.checked = showCircuit;
    if (controls) controls.hidden = !showCircuit;

    cb.onchange = async function (e) {
      window.showCircuit = e.target.checked;
      try { localStorage.setItem(CIRCUIT_SHOW_KEY, showCircuit ? '1' : '0'); } catch (_) {}
      if (controls) controls.hidden = !showCircuit;
      if (showCircuit) {
        if (!airfields) await loadAirfields();
        loadCircuitOverlays();
        if (circuitLayerGroup) circuitLayerGroup.addTo(map);
      } else {
        if (circuitLayerGroup) circuitLayerGroup.remove();
      }
    };
  }

  if (opEl) {
    opEl.value = String(circuitOpacity);
    applyCircuitOpacity(circuitOpacity);    // sets val label on load
    opEl.oninput = function () {
      const v = parseFloat(opEl.value);
      try { localStorage.setItem(CIRCUIT_OPACITY_KEY, String(v)); } catch (_) {}
      applyCircuitOpacity(v);
    };
  }

  if (opReset) {
    opReset.onclick = function () {
      if (!opEl) return;
      opEl.value = String(CIRCUIT_DEFAULT_OPACITY);
      try { localStorage.setItem(CIRCUIT_OPACITY_KEY, String(CIRCUIT_DEFAULT_OPACITY)); } catch (_) {}
      applyCircuitOpacity(CIRCUIT_DEFAULT_OPACITY);
    };
  }
})();
```

- [ ] **Step 5: Add init guard**

Find the `loadAirfields().then(() => {` block at the bottom of `ui.js` (around line 3735). Inside the `.then(...)` callback, add circuit init after the existing `draw()` call:

```js
loadAirfields().then(() => {
  retryPendingInspectorSelection();
  snapExistingWaypoints();
  applyLegAltitudesToRoute();
  if (showCommChange && typeof seedCommChangeNotes === 'function') seedCommChangeNotes();
  draw();
  if (state.selected) showInspector();
  // Circuit overlay: add to map if already toggled on (restored from localStorage)
  if (showCircuit) {
    loadCircuitOverlays();
    if (circuitLayerGroup) circuitLayerGroup.addTo(map);
  }
});
```

- [ ] **Step 6: Manual browser verification**

```bash
python3 -m http.server -d docs 8000
# Open http://localhost:8000 → View section → Overlays
```

Check:
1. "Show circuit overlays" checkbox appears after "Show/pin airfields"
2. Checking it reveals the opacity slider
3. At least one circuit plate image appears on the map (zoom to Israel)
4. Opacity slider changes image transparency
5. Reset button restores 80%
6. Uncheck removes all circuit images
7. Reload with checkbox on → circuit images reappear

For each airfield with a plate, zoom in and confirm the image aligns roughly with the airfield marker. If an image is visibly offset (>1 km), adjust the `sw`/`ne` bounds in `airfields.json` and reload.

- [ ] **Step 7: Commit**

```bash
git add docs/app/ui.js
git commit -m "feat: implement circuit overlay toggle and opacity in ui.js"
```

---

## Task 6: Write Playwright tests

**Files:**
- Create: `tests/circuit-overlay.spec.js`

**Interfaces:**
- Consumes: `#circuit-cb`, `#circuit-controls`, `#circuit-opacity`, `#circuit-opacity-val`, `#circuit-opacity-reset`, `window.showCircuit`, `window.circuitLayerGroup`

- [ ] **Step 1: Write the test file**

```js
// @ts-check
// Circuit overlay: georeferenced VFR/circuit plate images toggled from the
// Overlays group in the View toolbar section.
const { test, expect } = require('./_setup');

const PNG_RE = /circuit-img\/.*\.png/;

// 1×1 transparent PNG
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMCAYAAAB7P3qAAAAAAElFTkSuQmCC',
  'base64'
);

async function boot(page) {
  await page.route(PNG_RE, r =>
    r.fulfill({ status: 200, contentType: 'image/png', body: PNG })
  );
  await page.addInitScript(() => {
    try {
      // Open the View section so controls are interactable
      localStorage.setItem('navaid.sec.view', '1');
    } catch (e) {}
  });
  await page.goto('?lang=en');
  await page.waitForFunction(
    () => typeof map !== 'undefined' && document.getElementById('circuit-cb')
  );
}

test('circuit-cb is unchecked by default and controls are hidden', async ({ page }) => {
  await boot(page);
  await expect(page.locator('#circuit-cb')).not.toBeChecked();
  await expect(page.locator('#circuit-controls')).toBeHidden();
});

test('checking circuit-cb reveals controls and adds image overlays', async ({ page }) => {
  await boot(page);
  await page.locator('#circuit-cb').check();
  await expect(page.locator('#circuit-controls')).toBeVisible();
  // At least one leaflet image overlay should appear in the overlay pane
  const imgs = page.locator('.leaflet-overlay-pane img.leaflet-image-layer');
  await expect(imgs.first()).toBeVisible();
  const count = await imgs.count();
  expect(count).toBeGreaterThanOrEqual(1);
});

test('unchecking removes all circuit overlays from the map', async ({ page }) => {
  await boot(page);
  await page.locator('#circuit-cb').check();
  await expect(page.locator('.leaflet-overlay-pane img.leaflet-image-layer').first()).toBeVisible();
  await page.locator('#circuit-cb').uncheck();
  await expect(page.locator('#circuit-controls')).toBeHidden();
  // All circuit images gone (IMS or other overlays may add their own — check count dropped)
  const count = await page.evaluate(() => {
    let n = 0;
    if (window.circuitLayerGroup) window.circuitLayerGroup.eachLayer(() => n++);
    return n;
  });
  // circuitLayerGroup was created but removed from map — layer count unchanged,
  // but the group itself must not be on the map
  const onMap = await page.evaluate(
    () => window.circuitLayerGroup ? map.hasLayer(window.circuitLayerGroup) : false
  );
  expect(onMap).toBe(false);
});

test('opacity slider drives overlay opacity', async ({ page }) => {
  await boot(page);
  await page.locator('#circuit-cb').check();
  await expect(page.locator('.leaflet-overlay-pane img.leaflet-image-layer').first()).toBeVisible();

  const result = await page.evaluate(() => {
    const slider = document.getElementById('circuit-opacity');
    const valEl  = document.getElementById('circuit-opacity-val');
    slider.value = '0.3';
    slider.dispatchEvent(new Event('input'));
    const img = document.querySelector('.leaflet-overlay-pane img.leaflet-image-layer');
    return {
      opacity: parseFloat(img.style.opacity),
      label: valEl.textContent,
    };
  });
  expect(result.opacity).toBeCloseTo(0.3, 2);
  expect(result.label).toBe('30%');
});

test('opacity reset restores default 0.8', async ({ page }) => {
  await boot(page);
  await page.locator('#circuit-cb').check();
  await expect(page.locator('.leaflet-overlay-pane img.leaflet-image-layer').first()).toBeVisible();

  const result = await page.evaluate(() => {
    const slider = document.getElementById('circuit-opacity');
    slider.value = '0.3';
    slider.dispatchEvent(new Event('input'));
    document.getElementById('circuit-opacity-reset').click();
    const img = document.querySelector('.leaflet-overlay-pane img.leaflet-image-layer');
    return {
      sliderVal: slider.value,
      opacity: parseFloat(img.style.opacity),
      label: document.getElementById('circuit-opacity-val').textContent,
    };
  });
  expect(parseFloat(result.sliderVal)).toBeCloseTo(0.8, 2);
  expect(result.opacity).toBeCloseTo(0.8, 2);
  expect(result.label).toBe('80%');
});

test('toggle state and opacity persist across reload', async ({ page }) => {
  await boot(page);
  await page.locator('#circuit-cb').check();
  await expect(page.locator('.leaflet-overlay-pane img.leaflet-image-layer').first()).toBeVisible();

  // Set a custom opacity before reloading
  await page.evaluate(() => {
    const s = document.getElementById('circuit-opacity');
    s.value = '0.5';
    s.dispatchEvent(new Event('input'));
  });

  await page.reload();
  await page.waitForFunction(
    () => typeof map !== 'undefined' && document.getElementById('circuit-cb')
  );
  // Re-route images after reload
  await page.route(PNG_RE, r =>
    r.fulfill({ status: 200, contentType: 'image/png', body: PNG })
  );

  await expect(page.locator('#circuit-cb')).toBeChecked();
  await expect(page.locator('#circuit-controls')).toBeVisible();
  expect(await page.evaluate(() => document.getElementById('circuit-opacity').value)).toBe('0.5');
  await expect(page.locator('.leaflet-overlay-pane img.leaflet-image-layer').first()).toBeVisible();
});

test('circuit overlay PNG URLs resolve through circuitImgBase()', async ({ page }) => {
  const urls = [];
  await page.route(PNG_RE, r => {
    urls.push(r.request().url());
    return r.fulfill({ status: 200, contentType: 'image/png', body: PNG });
  });
  await page.addInitScript(() => {
    try { localStorage.setItem('navaid.sec.view', '1'); } catch (e) {}
  });
  await page.goto('?lang=en');
  await page.waitForFunction(() => typeof map !== 'undefined' && document.getElementById('circuit-cb'));
  await page.locator('#circuit-cb').check();
  await page.waitForFunction(() => {
    let n = 0;
    if (window.circuitLayerGroup) window.circuitLayerGroup.eachLayer(() => n++);
    return n > 0;
  });
  // Every PNG URL must contain /circuit-img/ and end in _circuit.png
  expect(urls.length).toBeGreaterThanOrEqual(1);
  for (const u of urls) {
    expect(u).toMatch(/\/circuit-img\/[A-Z]{4}_circuit\.png/);
  }
});
```

- [ ] **Step 2: Run the tests**

```bash
cd /home/marco/NavigationApp
python3 -m http.server -d docs 8000 &
sleep 1
npx playwright test tests/circuit-overlay.spec.js --reporter=list 2>&1 | tail -20
kill %1
```

Expected: all 6 tests PASS

- [ ] **Step 3: Fix any failures, then run full suite smoke check**

```bash
python3 -m http.server -d docs 8000 &
sleep 1
npx playwright test --reporter=list 2>&1 | tail -20
kill %1
```

Expected: no new failures introduced by this feature

- [ ] **Step 4: Commit**

```bash
git add tests/circuit-overlay.spec.js
git commit -m "test: add Playwright suite for circuit overlay toggle and opacity"
```

---

## Self-Review

**Spec coverage:**
- [x] Toggle in extra layers group → Task 4 + 5
- [x] Opacity slider → Task 4 + 5
- [x] One plate per airfield, hand-picked → Task 1 + 2
- [x] Pre-convert PDFs to PNG, commit to repo → Task 1
- [x] `circuit_overlay` in `airfields.json` with bounds → Task 2
- [x] `L.imageOverlay` via Leaflet layer group → Task 5
- [x] `circuitImgBase()` resolves correctly for prod/staging/PR → Task 5 step 2
- [x] localStorage persistence for show + opacity → Task 5 step 4
- [x] i18n EN + HE keys → Task 3
- [x] Init guard: overlay appears on reload if previously enabled → Task 5 step 5
- [x] LLES omitted (text doc) → Task 2 test

**No placeholders found.**

**Type consistency:** `circuitLayerGroup` used consistently. `applyCircuitOpacity(v)` called the same way in slider and reset. `loadCircuitOverlays()` called before `circuitLayerGroup.addTo(map)` in both toggle handler and init guard.
