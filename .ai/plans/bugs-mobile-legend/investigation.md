---
status: approved
---

# Investigation: mobile legend is partially hidden

## Outcome

- **Tier:** lean
- **Confidence:** high
- **Bug surface:** frontend
- **Affected service:** the static NavAid web application in `docs/`

The defect reproduces from the checked-out `origin/dev` snapshot without a backend dependency. The collapsed phone toolbar leaves the bottom-left legend unobstructed. The layout does not reconcile when the toolbar grows or the usable viewport shrinks. The toolbar then covers the legend. A previously dragged legend can also remain outside the new viewport.

## Reproduction and evidence

### Expanded mobile toolbar

At a Chromium viewport of `390 x 664`, with `navaid.toolbarCollapsed=0` before boot:

| Language | Legend bounds | Toolbar bounds | Covered legend height |
|---|---:|---:|---:|
| English | `x=10, y=463.66, w=169, h=152.34` | `x=8, y=8, w=240, h=565` | `109.34 px` |
| Hebrew | `x=10, y=463.66, w=176.36, h=152.34` | `x=8, y=8, w=240, h=568` | `112.34 px` |

The toolbar has `z-index: 1100`; the legend's Leaflet control has `z-index: 800` inside a `leaflet-bottom leaflet-left` corner at `z-index: 1000`. The overlapping part of the legend is therefore hidden behind the toolbar, not merely adjacent to it.

This is height-dependent. At `375 x 812` the same expanded English toolbar ends at `y=573` and the legend starts at `y=612`, so there is no overlap. Existing tests use this taller phone viewport and do not expose the defect.

### Resize or orientation change after dragging

At `390 x 844`, dragging the legend to a valid fixed position recorded `navaid.legendPos.en={"x":0,"y":650.65625}`; the legend bottom was about `803`, inside that viewport. Shrinking the live viewport to `390 x 664` left the legend at the same `y=650.65625`, with its bottom about `139 px` beyond the viewport. No resize reconciliation ran.

Reloading at the smaller size does clamp the stored value because startup calls `applyPos`; the broken path is the live resize/orientation transition. This also explains why the problem can appear device- or orientation-specific and then seem healed after reload.

## Root cause

The legend has two positioning modes, and neither is reconciled against all mobile chrome changes:

1. `docs/app/ui.js` creates a Leaflet `bottomleft` control. When there is no saved drag position, it stays in Leaflet's corner flow. The mobile CSS in `docs/app/style.css` raises that corner `36 px` above attribution, but it knows nothing about the independently positioned toolbar.
2. Once dragged or restored, `makeLegendDraggable()` changes the legend to `position: fixed`. Its private `applyPos()` clamps to `window.innerWidth/innerHeight` and invokes `clearOfToolbar()`, but only at startup restore and during a legend drag. There is no `window.resize`, `orientationchange`, `visualViewport.resize`, toolbar collapse/expand, toolbar drag, or toolbar-size observer hook for the legend.
3. `clearOfToolbar()` can only move an overlapping legend downward. On a short phone the expanded toolbar plus the `152 px` legend do not fit vertically in that column. `clearOfToolbar()` first returns `toolbar.bottom + 6`, then `applyPos()` clamps that value back to `maxY`; this can reintroduce the same overlap. It does not search for a horizontal or otherwise nearest non-overlapping placement.
4. The toolbar is intentionally above Leaflet controls, so any overlap hides legend content. That stacking order is not itself erroneous; the missing placement reconciliation is.

The route-summary row makes the legend taller but is not the cause. The card reserves that row so it does not resize under the cursor. Similarly, the VOR row changes content visibility but does not create the missing relayout hook.

## Safe-area and viewport findings

- The legend clamp uses the layout viewport (`window.innerWidth/innerHeight`) only.
- There is no legend use of `window.visualViewport` or CSS `env(safe-area-inset-*)`.
- The page does not request `viewport-fit=cover`. Therefore, desktop Chromium did not reproduce a safe-area inset defect. The current code also lacks a usable-viewport abstraction. Smaller visual viewports or overlaid browser chrome can still produce stale or clipped positions.
- The toolbar partly avoids dynamic-browser-chrome problems with `100dvh`; the legend's JavaScript does not have an equivalent live usable-height update.

The minimal regression should assert observable in-viewport/non-overlap behavior rather than pinning a specific safe-area implementation.

## Affected files

- `docs/app/ui.js`
  - `legendCtrl` establishes the default Leaflet position.
  - `makeLegendDraggable()`, especially `clearOfToolbar()` and `applyPos()`, owns drag persistence and clamping but has no responsive reconciliation.
  - The mobile toolbar's `setCollapsed()`/resize handling changes the obstacle without notifying the legend.
- `docs/app/style.css`
  - `.map-legend`, the mobile `.leaflet-bottom.leaflet-left` offset, toolbar sizing, and the respective stacking contexts determine the visible overlap.
  - A fix may need a small mobile-only layout rule if JavaScript cannot provide a collision-free position on short screens.
- `tests/mobile-menu-affordance.spec.js` is the closest focused mobile layout suite.
- `tests/ui-audit-round2.spec.js` and `tests/zulu-clock.spec.js` cover legend drag/restore and toolbar avoidance, but only at desktop/default viewport behavior.
- `.ai/navaid-dev.md` documents the legend and persisted position; update it if the responsive positioning contract changes.

## Precise missing regression

Add focused Playwright coverage that fails on this snapshot and proves:

1. At `390 x 664`, boot with the toolbar expanded. Assert that the complete legend remains inside the viewport and outside the toolbar. Run the assertion in English and Hebrew.
2. Start in a taller phone viewport, drag the legend near the bottom, then resize to a shorter phone viewport (representing mobile browser resize/orientation). Assert all four legend edges are within the new viewport and it does not intersect the toolbar.
3. Preserve the existing drag persistence behavior and the tall-phone/desktop placement. The test should compare geometry, not hard-code one exact target coordinate, so RTL and future text metrics remain valid.

The current `mobile-menu-affordance.spec.js` test only checks legend versus attribution/mode chip at `375 x 812` with the toolbar collapsed. The existing `ui-audit-round2.spec.js` tests verify drag-time toolbar avoidance and persistence, but they never expand the mobile toolbar or resize after the drag.

## Suggested implementation boundary

Keep one legend-position reconciler in `docs/app/ui.js`. Invoke it after toolbar layout, movement, and usable-viewport changes. Choose a fully visible non-overlapping position when possible. Use a deterministic constrained fallback otherwise. Preserve the desktop menubar layout and the language-specific persistence keys.
