---
status: draft
---

# RCA — mobile-legend: keep the legend visible on phones

**Tier**: lean   ·   **Confidence**: HIGH   ·   **Service(s)**: NavAid static web app

## What's happening

On a short phone viewport, the expanded floating toolbar covers more than 100 px of the map legend in both English and Hebrew. A legend dragged near the bottom of a taller viewport also remains partly outside the screen after a live resize or orientation change.

## Root cause

`makeLegendDraggable()` in `docs/app/ui.js` clamps and avoids the toolbar only at startup and while the legend itself is dragged. Toolbar expansion/movement and viewport or visual-viewport resizing do not reconcile the legend, and the existing toolbar-avoidance helper can move only vertically even when the short column cannot fit both controls.

## Suggested fix

- `docs/app/ui.js` — expose one legend-position reconciler that clamps to the current usable viewport and chooses a fully visible, non-overlapping placement when possible. Invoke it after toolbar collapse/expand or movement and viewport/visual-viewport resize, while preserving language-scoped drag persistence.
- `docs/app/style.css` — make only a bounded mobile layout adjustment if JavaScript placement cannot avoid overlap; do not alter the desktop menubar or stacking model.
- `tests/mobile-menu-affordance.spec.js` — keep the three written geometry regressions for English, Hebrew, and dragged-then-resized behavior, including reload persistence.
- `.ai/navaid-dev.md` — document responsive legend containment and toolbar collision avoidance.

**Expected shape**: 4 files, ~120 lines · extend the existing legend drag/positioning code and mobile browser spec; CSS remains optional within this bound · new test files: 0

## Failing test (written, red)

`tests/mobile-menu-affordance.spec.js` (browser integration) — three focused cases assert full viewport containment and no toolbar intersection for English and Hebrew at `390×664`, plus live resize and reload persistence after a drag. All three fail on the current implementation.

## Verification plan

- Unit/integration: run the three new mobile legend cases and the adjacent mobile-menu, legend-drag, toolbar, and RTL cases.
- Syntax/lint: run `node --check` on every changed shipped JavaScript file and `git diff --check`.
- E2E + live env: CI/deployed E2E and direct browser checks at short/tall phone sizes in English and Hebrew.
- New executable(s): none.

## Deferred / follow-ups

Explicit safe-area inset support is deferred because the page does not request `viewport-fit=cover` and it was not independently reproduced. The fix still uses the current visual viewport so browser chrome changes reconcile correctly.
