# Code Review Summary

**Label:** bugs-turn-freq-change  
**Date:** 2026-08-22  
**Diff:** `origin/dev...codex/fix-turn-freq-restore`  
**Description:** Follow-up restoration-path reconciliation for issue #1799.

---

| index | file | lines | category | feedback | priority | blocking |
|---|---|---|---|---|---|---|
| 1 | `docs/app/core.js` | 4067 | regression | Calling `seedCommChangeNotes()` unconditionally from generic `syncLegs()` seeds editable callouts in flows that intentionally show only read-only comm-change information; three adjacent comm-change tests regress. | high | no |
| 2 | `tests/leg-direction-filter.spec.js` | restore/import coverage | quality | Add a geometry-derived retrace restore/import case; current durable restoration coverage uses only an explicit `wp.turn`. | low | no |
| 3 | `docs/app/core.js` | 4063 | quality | Split the added 32-word comment sentence. | low | no |

---

## Overall Recommendation

APPROVE WITH WARNINGS

The restoration invariant and selection repair work in the focused turn suite, but the chosen common boundary is too broad and changes existing read-only communication-change flows. The regression must be corrected before final verification and merge readiness.

## Must Fix Before Merge

- Reconcile/removal on restore without triggering general callout seeding during every `syncLegs()` call.

## Pre-Merge Actions

- Re-run `tests/comm-change.spec.js` and the full focused turn-direction spec after narrowing the lifecycle hook.
