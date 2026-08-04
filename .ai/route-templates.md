# Updating a Route Template

Route templates are **starter routes** in `docs/data/route-templates.json`. They
are deliberately lighter than a saved route: a template seeds the route shape and
its comm/frequency plan, then the app fills the rest from the shared datasets.

Contrast with **Save route** (the route library, `navaid.routes` in
localStorage): a saved route is a full snapshot and keeps **everything** —
exact waypoint coordinates, every leg's altitudes/speeds, marker label offsets,
notes, wind, and comm-change suppressions. A template intentionally does not.

## What a template KEEPS

- `id`, `name`, `he`, `description`, `heDescription` — identity + localized text.
- `defaultSpeed` — applied to every leg on build.
- `waypoints` — an array of **canonical codes** (e.g. `"LLHZ"`, `"SFAIM"`), not
  coordinates and not localized labels. Coordinates are resolved from
  active `<prefix>-nav-waypoints.json` / `airfields.json` at build time.
- `notes` — **lean** freq-change callouts keyed by `cc` (waypoint code) with
  `freqName` (+ optional `freqAuto`). No `freq`, `lat`, or `lng` — frequency
  is derived from the active `<prefix>-comm-change.json`, and the callout position is derived from
  that waypoint at build time (same default offset as auto-seeding).
  `text`/`color`/`shape` default to the standard freq-change box.
- `commChangeSuppressions` — array of waypoint codes whose auto comm-change note
  should be suppressed on build (so seeding doesn't re-add them).

## What a template DROPS (resolved at build time instead)

- **Per-leg altitudes.** Do **not** store a `legs` array for known CVFR
  segments — altitudes come from the active `<prefix>-leg-altitude.json` (the single source of
  truth). `defaultSpeed` sets the speed; altitudes are inferred. (`legs` is
  accepted by the loader for the rare custom-altitude template, but prefer
  leaving it out.)
- **Coordinates** — neither waypoints nor notes store `lat`/`lng`; both are
  resolved/derived from the datasets by name/code at build time.
- **Marker label offsets, wind, selection, view** — not persisted.

## How to update a template

1. Build/verify the route in the app and use it to read off the intended
   waypoint order, freq-change notes, and which comm points to suppress.
2. Edit the matching entry in `docs/data/route-templates.json`:
   - Set `waypoints` to the code list.
   - Set `notes` to the freq-change callouts (keep `cc` / `freqName`; add
     `freqAuto` only when the callout should keep following route defaults).
   - Set `commChangeSuppressions` for points that should stay silent.
   - Leave `legs` out so altitudes track the active prefixed altitude dataset.
3. If a waypoint code is missing from the active prefixed waypoint dataset / `airfields.json`,
   add it there first — the build throws on an unknown code.
4. Validate JSON and run the template tests:
   ```bash
   node -e "JSON.parse(require('fs').readFileSync('docs/data/route-templates.json','utf8'))"
   ./node_modules/.bin/playwright test route-templates
   ```

## Apply path (for reference)

`normalizeRouteTemplateData` → `routeFromTemplate` (resolves codes to coords,
builds legs from the active prefixed altitude dataset, copies notes + `commChangeSuppressions`)
→ `applyRouteTemplate` (sets state, seeds non-suppressed comm-change notes).
