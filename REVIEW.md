# NavAid code review — outstanding items

Snapshot review of `dev` at `e305d77` (2026-05-22). Hand-off doc for the
follow-up agent. Items are ordered by priority. File:line references use
the working tree as of `e305d77`.

Workflow rules to follow when fixing:

- Work on `dev`. `main` is branch-protected.
- After editing `app.js` (any of the `core/draw/interact/io/ui/sw.js` modules),
  run `node --check docs/<file>.js`.
- Bump `?v=N` on **every** change to `core.js`, `draw.js`, `interact.js`,
  `io.js`, `ui.js`, `style.css`, or any locale `strings.js`. The bump goes
  in **both** `docs/index.html` and `docs/en/index.html` (and update
  `sw.js`'s cache name `navaid-vN` if you want to invalidate stale SW caches).
- Each logical change = one commit, then push to `dev` (deploys staging).
- Promote to production with a PR `dev → main` once verified.
- Read `.claude/skills/navaid-dev/SKILL.md` first if you haven't already.

This file lives at repo root and is **not** deployed (Pages publishes
`docs/` only). Delete or update it as items are resolved.

---

## P1 — Real bugs / regressions

### 1. Map bearing persistence regression

**Symptom**: rotating the map and reloading reverts to north-up.
**Where**: `docs/ui.js` rotate-dial section (no `BEARING_KEY` exists).
**History**: commit `cec7f47` *"Persist map rotation"* added it; a
follow-up rotate-dial commit (`4c7a88c` / `af4ebfc`) silently removed the
4 lines without updating the message.

**Fix**: re-add at the end of the rotate-dial section in `ui.js`,
mirroring the pattern used by other `navaid.*` keys:

```js
const BEARING_KEY = 'navaid.bearing';
try {
  const sb = parseFloat(localStorage.getItem(BEARING_KEY));
  if (!isNaN(sb)) map.setBearing(sb);
} catch (e) { /* storage unavailable */ }
map.on('rotate', () => {
  try { localStorage.setItem(BEARING_KEY, String(mapBearing())); }
  catch (err) { /* storage unavailable */ }
});
```

The existing `map.on('rotate', () => { refreshDial(); draw(); })` line
already exists — either chain into that callback or add a separate one.
Place the **read** before any code that calls `setBearing` (so the
restore happens before `exportPNG` could touch the bearing).

---

### 2. Layer-name migration: `'OSM'` → `'OpenStreetMap'`

**Symptom**: existing users who had picked OSM are silently reverted to
CVFR on next load. Once they re-pick the layer, the new key persists.

**Where**: commit `da24b3f` renamed the layer key in `docs/core.js`:

```161:163:docs/core.js
  'OpenStreetMap': L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    { minZoom: 6, maxZoom: 18, subdomains: 'abc',
      attribution: '© OpenStreetMap contributors' }),
```

But `localStorage['navaid.layer']` may still be `'OSM'`. The lookup
`layers[saved]` returns `undefined` and falls back to CVFR.

**Fix** in `docs/core.js`, just after reading `LAYER_KEY` from storage:

```js
const LAYER_KEY = 'navaid.layer';
let initialLayer = layers.CVFR;
try {
  let saved = localStorage.getItem(LAYER_KEY);
  if (saved === 'OSM') {                       // legacy key
    saved = 'OpenStreetMap';
    localStorage.setItem(LAYER_KEY, saved);
  }
  if (saved && layers[saved]) initialLayer = layers[saved];
} catch (e) { /* storage unavailable */ }
```

---

### 3. Flight-plan print listener race — body stays in print mode

**Symptom**: after clicking the new "Print" button in the Flight Plan
modal, the toolbar / map can stay hidden (only the table visible) until
the page is reloaded. Reproducible in browsers where `afterprint` fires
synchronously inside `window.print()` (Firefox in particular; Chrome can
also race depending on dialog handling).

**Where**:

```206:218:docs/io.js
  printBtn.onclick = () => {
    document.body.classList.add('printing-plan');
    window.print();
    window.addEventListener('afterprint', () => {
      document.body.classList.remove('printing-plan');
    }, { once: true });
  };
```

The listener is registered AFTER `window.print()` returns — too late if
`afterprint` already fired.

**Fix**: register the listener first, and add a defensive timeout for
browsers that never fire `afterprint` (Safari on iOS sometimes doesn't):

```js
printBtn.onclick = () => {
  const cleanup = () => {
    document.body.classList.remove('printing-plan');
    window.removeEventListener('afterprint', cleanup);
  };
  window.addEventListener('afterprint', cleanup, { once: true });
  document.body.classList.add('printing-plan');
  window.print();
  setTimeout(cleanup, 4000);                  // belt-and-braces
};
```

---

### 4. `exportPNG` early return leaks bearing

**Symptom**: if the active base layer somehow has no `_url` (Leaflet
internals — should not happen with the current layer set, but the guard
exists), `exportPNG` returns having set bearing to 0 without restoring
the user's rotation.

**Where**:

```269:279:docs/io.js
  const exportBearing = map.getBearing ? map.getBearing() : 0;
  if (exportBearing) map.setBearing(0);

  const fr = pageFrameRect() || { x: 0, y: 0, w: vw(), h: vh() };
  if (fr.w < 4 || fr.h < 4) { if (exportBearing) map.setBearing(exportBearing); return; }

  let base = null, baseName = 'map';
  for (const n in layers) {
    if (map.hasLayer(layers[n])) { base = layers[n]; baseName = n; }
  }
  if (!base || !base._url) return;       // ← leak
```

**Fix**: mirror the existing `fr.w < 4` branch on this line:

```js
if (!base || !base._url) {
  if (exportBearing) map.setBearing(exportBearing);
  return;
}
```

---

### 5. Orphan `<span id="rotate-n">N</span>` in the rotate dial

**Symptom**: a bare letter "N" floats inside the compass dial. The
commit `cec7f47` claimed it *"replaces the separate N mark"* but the JS
still creates the span and wires its handlers, and there are no CSS
rules for `#rotate-n` anywhere in `docs/style.css`.

**Where**:

```42:46:docs/ui.js
  wrap.innerHTML = '<span id="rotate-dial" role="slider" tabindex="0">' +
                   '<span id="rotate-needle"></span>' +
                   '<span id="rotate-n" title="Reset map to north">N</span>' +
                   '</span>';
```

```87:92:docs/ui.js
const rotN = document.getElementById('rotate-n');
rotN.addEventListener('pointerdown', e => e.stopPropagation());
rotN.addEventListener('click', e => {
  e.stopPropagation();
  map.setBearing(0);
});
```

**Fix**: remove the `<span id="rotate-n">N</span>` from the
`wrap.innerHTML` string and delete lines 87-92 (the three `rotN` lines).
Single-click-without-drag already calls `map.setBearing(0)` via
`rotEnd()` (line 78-82), so click-anywhere-on-the-dial keeps resetting
to north — same UX, minus the visual artifact.

---

### 6. Dead `dblclick` reset on the rotate dial

**Where**:

```85:85:docs/ui.js
rotDial.addEventListener('dblclick', () => map.setBearing(0));
```

A single click without movement already calls `map.setBearing(0)` via
`rotEnd()`, so a dblclick is redundant (it triggers two resets). Just
remove the line. Low impact but it's dead code.

---

## P2 — Smaller bugs / inconsistencies

### 7. Inconsistent toggle persistence

`showWpNames`, `wpNameAngle`, `showNavWP`, `yellowAlpha`, `wpSize`,
`magVar`, `layer`, `toolbarPos`, `toolbarCollapsed` are all persisted
to `navaid.*` localStorage keys.

`showReturn`, `showMidLeg`, `highlightDiff` are NOT — they reset to
their defaults on every reload (`false`, `false`, `false`). Pattern is
inconsistent.

**Fix**: copy the pattern used by the existing `navaid.showNavWP`
handler in `docs/ui.js` (lines 205-218) for each of the three. Three
keys, three small wiring blocks. Defaults stay `false` for never-set
storage; saved `'1'` / `'0'` overrides.

### 8. Search input doesn't clear on close

When the user clicks outside `.navsearch`, `closeSearch()` hides the
results dropdown but leaves whatever text was in `#wp-search`. Refocus
the input later → no results until the user types again. Minor UX.

**Where**: `docs/ui.js` `closeSearch` (~line 99).

**Fix** (optional): clear the input value in `closeSearch`, or refire
the input event on focus.

### 9. `drawInfo` text labels are hardcoded English

```432:436:docs/draw.js
  document.getElementById('info').textContent =
    `Waypoints  ${state.waypoints.length}\n` +
    `Legs       ${state.legs.length}\n` +
    `Distance   ${totalDist.toFixed(1)} NM\n` +
    `Total time ${totalH > 0 ? toHMS(totalH) : '--'}`;
```

Hebrew users see the route summary in English. Add `S.summaryWaypoints`
/ `Legs` / `Distance` / `TotalTime` to `core.js` defaults and
`docs/he/strings.js`. Same pattern as the existing `S.fpHeaders` etc.

### 10. KML and layer-name strings are not localized

`flyRoute()` in `docs/io.js` writes `<name>NavAid flythrough</name>`,
`<name>Route</name>`, `<name>Fly the route</name>` literally. The layer
dropdown options (`'CVFR'`, `'Nav'`, `'Low Alt'`, `'Heli'`,
`'Satellite'`, `'OpenStreetMap'`) are also static.

Layer names are aviation/standard abbreviations and might be fine to
keep in English in Hebrew too — your call. KML labels are only seen
inside Google Earth, again low priority.

### 11. `wpPrefix: 'WP '` even in Hebrew

Hebrew users see `WP 3` for unnamed waypoints. Likely acceptable in
aviation context (Latin abbreviations are normal) but worth a glance.
Set `wpPrefix: 'נק׳ '` in `docs/he/strings.js` if you want it in Hebrew.

---

## P3 — Dead code / minor cleanup

### 12. `boolRow`, `textInputRow` in `docs/interact.js`

Defined but never called from anywhere. Safe to delete.

### 13. `<thead>` `position: sticky` for the printed flight plan

```451:457:docs/style.css
.flight-table th {
  position: sticky;
  top: 0;
  ...
}
```

Sticky positioning is honored by browsers in screen mode (good — the
header sticks while you scroll the modal). Most browsers ignore it in
print: the header prints once at the top of the table and pages break
in the middle of rows on long routes. Acceptable for routes ≤ ~30 legs.
If long flight plans are a concern, override inside the
`body.printing-plan` block to use `display: table-header-group` (which
some browsers do honor as "repeat on each page").

### 14. PWA cache name

`docs/sw.js` is at `navaid-v2`. Consider bumping to `navaid-v3` whenever
the SW logic itself changes (not for `?v=N` asset bumps, which already
land via cache-first lookup misses).

---

## Out of scope / informational

- The **hardcoded waypoint snap threshold** (18 px) in
  `applyNavSnap`/`nearestNavWaypoint` is fine but a single named
  constant in `core.js` would be cleaner.
- `nav-waypoints.json` is a **snapshot** — 238 entries — originating
  from a ForeFlight Mobile user-waypoints export by the upstream
  Lior Ben-Horin (`liorbenhorin/NavigationApp:clean`). Q-named
  waypoints (e.g. BENQO) are missing. Refresh path: export your own
  ForeFlight library to KML/GPX and run a small converter.

---

## How to verify after fixes

For each fix:

1. `node --check docs/<file>.js` (must be clean).
2. Bump `?v=N` in both `docs/index.html` and `docs/en/index.html`.
3. Commit + push to `dev`.
4. Wait for the Pages workflow to finish:
   `gh run list --workflow=deploy.yml --branch=dev --limit 1`.
5. Smoke-test on https://msupino.github.io/NavigationApp/staging/ and
   https://msupino.github.io/NavigationApp/staging/en/ .

For specific items above, here are the smoke checks:

- **#1 bearing persist**: rotate map ~45° via dial → reload → expect to
  see the dial still tilted and the chart still rotated.
- **#2 layer migration**: in DevTools console set
  `localStorage.setItem('navaid.layer', 'OSM')` → reload → expect
  OpenStreetMap selected (not CVFR).
- **#3 print race**: open Flight Plan → Print → Cancel the print
  dialog → expect the modal still visible and the toolbar/map back.
- **#4 export bearing**: rotate map → click Save PNG → expect the
  exported PNG to be north-up, AND the on-screen map back to its
  rotated state once the export finishes.
- **#5 / #6 dial**: visually inspect the rotate-dial — no stray "N"
  letter; single-click resets to north; dblclick is removed.
- **#7 toggles**: toggle "Show return path" / "Show leg dist" /
  "Highlight diff" → reload → expect them to stay in their chosen state.

When done with a batch, open a `dev → main` PR and merge.
