# Code Review Summary

**Label:** bugs-turn-freq-change  
**Date:** 2026-08-22  
**Diff:** `origin/dev...codex/fix-turn-freq-change`  
**Description:** Bug fix for turning-point frequency callouts and non-destructive inspector selected-state styling.

---

| index | file | lines | category | feedback | priority | blocking |
|---|---|---|---|---|---|---|
| 1 | `docs/app/io.js`, `docs/app/draw.js` | route restore / callout reconciliation | quality | Saved-route import/startup restore can bypass `seedCommChangeNotes()`, leaving a persisted turning-point callout until another edit reconciles the route. | medium | no |
| 2 | `tests/leg-direction-filter.spec.js` | focused turn tests | quality | Add durable assertions for selected-note repair and automatic reseeding after the turn moves or clears. | low | no |
| 3 | `docs/app/style.css`, `.ai/navaid-dev.md` | changed prose/style | quality | Remove trailing whitespace and split long added prose where practical. | low | no |
| 4 | `.ai/plans/bugs-turn-freq-change/rca-report.md` | 15 | markdown | Describe the two old survival paths accurately: manual preservation was deliberate; automatic survival was an early-continue reconciliation bug. | low | no |

2 CLARITY-ADVISORY findings (advisory, non-blocking — never changes the recommendation)

---

## Overall Recommendation

APPROVE WITH WARNINGS

The runtime behavior is otherwise sound: regression review found no unintended deltas and independently passed 99 focused and adjacent browser tests, including style, selection, and reseeding probes. The saved-route/startup path should be fixed before the final verification loop so the invariant also holds immediately after importing or restoring a route.

## Must Fix Before Merge

- Reconcile turning-point frequency callouts during saved-route import/startup restoration.

## Pre-Merge Actions

- Re-run focused route-load, turn-callout, inspector-style, selection, and reseeding coverage after the fix.
