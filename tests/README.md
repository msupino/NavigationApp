# NavAid e2e tests (Playwright)

Browser-driven smoke + regression suite for the app under `docs/`.

## Setup

```bash
npm install
npx playwright install --with-deps chromium
```

## Run

```bash
npm test                 # headless
npm run test:headed      # see the browser
npm run test:ui          # Playwright UI mode (debug)
```

The config starts `python3 -m http.server -d docs 8000` automatically.

## What's covered

- App boots in English and Hebrew, with the correct `<html lang>` / `dir`.
- Language switch preserves existing query params (#87).
- Mag var input clamps to ±30 and the field shows the clamped value (#85).
- Search returns a mix of airfields and nav-waypoints on broad queries (#124).
- `normLegLabel` is gone from the global scope (#126).
- `state.waypoints` mutation triggers leg sync and a redraw.
- `🗑 Clear map` empties `state.waypoints`.

## Adding tests

`tests/*.spec.js`. `beforeEach` pre-opens all toolbar sections via
`navaid.sec.*` localStorage keys; otherwise buttons are hidden behind
collapsed `<div class="tb-section">` containers.

Use `page.evaluate(() => state.waypoints = ...)` to set up routes
without simulating clicks — the canvas overlay sits on top of the map and
makes coordinate-based clicks brittle. The `state` global is exposed by
`docs/core.js`.
