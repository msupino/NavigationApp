# Testing Guide

## Static Checks

Run syntax checks on every changed JavaScript file:

```bash
node --check docs/app/core.js
node --check docs/app/draw.js
node --check docs/app/interact.js
node --check docs/app/io.js
node --check docs/app/ui.js
node --check docs/sw.js
node --check docs/i18n/he/strings.js
node --check docs/i18n/en/strings.js
```

Run spell check when touching user-facing English/Hebrew strings:

```bash
npm run lint:spell
```

## Local Browser Tests

Start a static server:

```bash
python3 -m http.server -d docs 8000 --bind 127.0.0.1
```

Run all tests:

```bash
BASE_URL=http://127.0.0.1:8000 npm test
```

Run a focused suite:

```bash
BASE_URL=http://127.0.0.1:8000 npx playwright test tests/bidi-regression.spec.js
```

Stop the server before finishing.

## Suite Map

Use this map to choose focused coverage:

- `bidi-regression.spec.js` - mixed Hebrew/Latin UI, directionality, units.
- `vor-overlay.spec.js` - VOR markers, radial/DME readouts, related inspector
  behavior.
- `ui-deep-coverage.spec.js` - inspector, satellite, modal, and UI edge cases.
- `flight-plan*.spec.js` - flight plan table, print/export behavior.
- `vertical-profile.spec.js` - flight-plan profile strip plus TOC/TOD marker
  distance rules.
- `route-templates.spec.js` - template routes and template modal behavior.
- `alt-pair-direction-columns.spec.js` - altitude pair columns and direction
  labels.
- `airfields-dataset.spec.js`, `airfield-arp.spec.js` - airfield data and ARP
  consistency.
- `msa-terrain.spec.js` - terrain and minimum-safe-altitude behavior.
- `pwa.spec.js`, `bugfix-178-180-sw.spec.js` - service worker/PWA behavior.

Check `tests/README.md` for the current CI vs deployed-e2e split.

## Deployed E2E

Deploy workflow runs a subset against the Pages preview. It excludes service
worker/PWA tests because deployed previews already have a live service worker.

Use relative navigation in tests:

```js
await page.goto('?lang=he');
```

Do not use root-relative paths like `/?lang=he`; they escape the `/pr/NNN/`
preview base path.

## Visual Checks

Use browser screenshots for:

- RTL/LTR layout.
- map overlays and selectable objects.
- satellite preview/modals.
- print layout.
- drag/gesture behavior.

For local visual verification, use the in-app browser or Playwright against the
local static server. Keep screenshots out of commits unless explicitly needed
as assets or fixtures.

## Docs-Only Changes

Docs-only changes do not need Playwright. Still run:

```bash
git diff --check
```

If Markdown examples include commands or paths, verify they are current.
