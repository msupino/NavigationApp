# E2E verification report — PR #1804, iteration 3

**Verdict:** PASS  
**Incomplete:** false  
**Branch:** `codex/fix-turn-freq-restore` at `e11bc26f4654a3162a5f721284c1f488ff8b1e67`  
**Base:** `origin/dev` at `3c2898fe`  
**Environment:** local Chromium against `python3 -m http.server 8000 --directory docs`

## Summary

The final branch removes prohibited frequency-change callouts at manual and geometry-derived turning points, preserves unrelated notes and selection identity, prevents inspector/keyboard recreation, and retains the supported read-only inspector badge states. Both complete focused browser suites and all static checks pass.

## Functional verification

### Full focused browser suites

| Suite | Result | Evidence |
|---|---|---|
| `tests/leg-direction-filter.spec.js` | PASS | 40/40 passed |
| `tests/comm-change.spec.js` | PASS | 26/26 passed |

Both suites ran concurrently in Chromium against the same exact local source snapshot.

### Prior read-only badge regressions

PASS. All three cases that failed in verification iteration 1 passed in the full communication suite:

- `tests/comm-change.spec.js:561` — canonical TYONA read-only badge;
- `tests/comm-change.spec.js:634` — Hebrew-labelled TYONA read-only badge;
- `tests/comm-change.spec.js:665` — BAZRA note-only badge without a frequency row.

The final effective diff contains no `docs/app/core.js` or `docs/app/io.js` change. Generic `syncLegs()` therefore does not seed communication callouts, and the supported read-only badge remains until a callout is explicitly present.

### Turning-point lifecycle behavior

PASS:

- `tests/leg-direction-filter.spec.js:434` removes every callout at a geometry-derived turn while preserving an unrelated callout, an ordinary note, and an empty suppression list;
- `tests/leg-direction-filter.spec.js:598` covers route import plus manual-turn and geometry-derived startup restoration cleanup;
- the same combined restoration test verifies that selection of the removed note clears and selection of the following ordinary note repairs to index 0;
- `tests/leg-direction-filter.spec.js:653` verifies moving/clearing the turn re-seeds its old frequency point without creating a suppression;
- `tests/leg-direction-filter.spec.js:677` verifies inspector marking removes the callout immediately and the set state uses bold emphasis while retaining the safe foreground, background, and border colors rather than destructive red;
- `tests/leg-direction-filter.spec.js:719` verifies `Z` cannot recreate a callout at the effective turn;
- straight-route coverage verifies no callout is removed when there is no effective turn.

The runtime reconciliation now calls `pruneTurnCommChangeNotes()` at the start of `draw()`. Import and startup reach `draw()` only after complete route state has been installed, while ordinary draws with no effective turn are a no-op. Manual turn interaction already redraws immediately, so the same invariant is applied without broad callout seeding.

## Static checks

| Check | Result | Evidence |
|---|---|---|
| Changed JavaScript syntax | PASS | `node --check docs/app/draw.js` and `node --check docs/app/interact.js` |
| Current PR diff whitespace | PASS | `git diff --check origin/dev...HEAD` |
| Residual broad-hook files | PASS | No effective issue diff in `docs/app/core.js` or `docs/app/io.js` |
| Typecheck | NOT APPLICABLE | No typecheck command exists for this plain JavaScript app |
| New-executable corpus run | PASS (nothing to run) | No executable, workflow, lint, or code-generation input was added or changed |

## Test Gap verification

PASS. The branch contains browser regressions matching every gap named by the investigation: derived and manual turns, import/startup restoration, unrelated-note preservation, selection repair, inspector and `Z` prevention, straight-route preservation, and non-permanent suppression with re-seeding.

## Declared-shape verification

PASS. The approved RCA declares **5 files and about 115 lines**. Relative to the issue's pre-fix base `1253522c`, the effective source/test/documentation change is exactly **5 files and 230 changed lines**:

- `.ai/navaid-dev.md`: 4
- `docs/app/draw.js`: 47
- `docs/app/interact.js`: 7
- `docs/app/style.css`: 11
- `tests/leg-direction-filter.spec.js`: 161

This is exactly 2× the rough estimate, not greater than the verifier's “more than approximately 2×” material-overage threshold. The file topology matches the approved five files, no undeclared application file remains, and no tooling input scope changed.

## Reproduction re-run

SKIPPED: no `reproduction.md` exists. The code-level browser regressions were executed locally.

## Final classification

PASS, incomplete false. No blocking, fix-worthy, or surfaced verification finding remains at exact head `e11bc26f4654a3162a5f721284c1f488ff8b1e67`.
