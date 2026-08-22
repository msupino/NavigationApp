# Regression Report

**Date:** 2026-08-22  
**Diff:** `origin/dev...codex/fix-turn-freq-change` at `20ac662acc359ba694d350041f6e88c736dc7fe5`  
**High Risk Deltas:** 0 | **Medium:** 4 | **Low:** 1

## Behavioral Deltas

### Delta 1: Effective turns now delete all linked frequency-change callouts

**File:** [`docs/app/draw.js`](../../../../../../docs/app/draw.js)  
**Function / Path:** `pruneTurnCommChangeNotes()` / `seedCommChangeNotes()`  
**Risk:** MEDIUM

**Before:** `seedCommChangeNotes()` withheld a newly generated automatic callout at the effective turn, but an existing automatic callout could survive and an existing manual or hand-edited callout was deliberately retained. The function returned without changing notes whenever Show/Add Frequency Changes was off.

**After:** reconciliation first removes every callout whose canonical communication-change point is in range of the effective turn, whether the callout is automatic or manual. This pruning also runs while Show/Add Frequency Changes is off or before the communication-change map has loaded.

**Why This Matters:** A previously persisted, pilot-edited callout at the turn is now deleted from route state, including when its layer is hidden. This is the central intended behavior, but it is a user-visible and persisted-data delta.

---

### Delta 2: Turn pruning preserves or invalidates selection by object identity

**File:** [`docs/app/draw.js`](../../../../../../docs/app/draw.js)  
**Function / Path:** `pruneTurnCommChangeNotes()`  
**Risk:** LOW

**Before:** There was no turn-specific removal, so deleting turn callouts could not shift a selected ordinary-note index or a waypoint's cached `freqNoteIndex` in this path.

**After:** after filtering notes, a selected surviving ordinary note is reindexed, a selected waypoint's surviving linked frequency note is reindexed, and a removed linked frequency selection is cleared without dropping the selected waypoint.

**Why This Matters:** Consumers of `state.selected` continue to address the same object after the note array shrinks instead of silently selecting the following note.

---

### Delta 3: Manual frequency-change creation is rejected at the effective turn

**File:** [`docs/app/interact.js`](../../../../../../docs/app/interact.js)  
**Function / Path:** `addCommChangeNoteForWaypoint()` / `appendAddFreqChangeButton()` / `Z` shortcut caller  
**Risk:** MEDIUM

**Before:** the waypoint inspector rendered Add Frequency Change at an effective turn, and both that button and the `Z` shortcut could create a manual callout there.

**After:** the inspector omits the button and the shared add helper returns `-1` when the exact route waypoint object is the index returned by `legRetraceTurnIndex()`. The `Z` caller consequently creates no note and records no frequency-note selection.

**Why This Matters:** Workflows that intentionally placed a manual radio reminder at a turn can no longer do so; callers must treat `-1` as a valid rejected-add result. Both shipped callers already do.

---

### Delta 4: Clicking the turning-point control immediately performs full callout reconciliation

**File:** [`docs/app/interact.js`](../../../../../../docs/app/interact.js)  
**Function / Path:** `showInspector()` turning-point button handler  
**Risk:** MEDIUM

**Before:** clicking the control changed the waypoint's `turn` flag, persisted, refreshed turn-dependent controls, and redrew, but did not reconcile communication-change notes in that event.

**After:** the handler calls `seedCommChangeNotes()` before persistence and redraw. The new turn's callouts disappear immediately; clearing or moving the turn allows the normal automatic seeding pass to reconsider the old turn, while unrelated callouts also receive the reconciler's existing stale/default update behavior.

**Why This Matters:** The saved state and open inspector now reflect the invariant immediately. The full seeder can also update other route callouts during the click rather than waiting for another route reconciliation trigger.

---

### Delta 5: Latched inspector actions use weight rather than amber styling

**File:** [`docs/app/style.css`](../../../../../../docs/app/style.css)  
**Function / Path:** `.insp-btn.insp-btn-on`  
**Risk:** MEDIUM

**Before:** active turning-point and hotspot controls used a fixed amber foreground, background, border, and hover background in both themes.

**After:** active controls retain their theme-specific safe-action foreground, background, border, and hover styling, and use `font-weight: 900` as the latched-state signal. Destructive buttons retain the base red style.

**Why This Matters:** Both set/unset surfaces that share `insp-btn-on` change appearance. The active state is no longer color-coded as a distinct action, while delete controls remain visually destructive.

## Independent Runtime Checks

- `tests/leg-direction-filter.spec.js`: **39 passed**. This covers manual and geometry-derived turns, immediate removal, unrelated-note preservation, straight routes, hidden-half selection behavior, the `Z` guard, and set/unset styling.
- `tests/comm-change-note.spec.js`: **60 passed**. Adjacent automatic seeding, manual editing, deletion/suppression, dragging, route reversal, inspector, shortcut-related helper behavior, and same-frequency suppression remain green.
- Additional browser probe: selected ordinary notes and selected waypoint-linked callouts retained object identity after a preceding turn callout was removed; a removed `freqNoteIndex` was cleared without clearing its waypoint selection.
- Additional browser probe: moving the manual turn from TYONA to SFAIM restored TYONA's eligible automatic callout, removed SFAIM's callout, and created no suppression. Clearing a turn also created no suppression; normal route-frequency rules remained responsible for deciding whether TYONA needed reseeding.
- Additional browser probe in light and dark themes: active turn styling preserved safe-action foreground/background/border and increased computed weight from `700` to `900`; the delete action remained `rgb(176, 54, 54)` red.

## Unintended Findings

None found.

## Recommendation

**APPROVE.** The observable deltas match the supplied intent, and focused plus adjacent runtime coverage found no unintended regression.

## Cleared

Functions/paths inspected and confirmed to have no unintended behavioral change:

- `pruneTurnCommChangeNotes()`: removes only `cc` notes in range of the effective turning waypoint; ordinary notes and unrelated communication callouts retain identity.
- `seedCommChangeNotes()`: still preserves every frequency change on a route with no effective turn and does not add a turn-based suppression.
- `addCommChangeNoteForWaypoint()` and `appendAddFreqChangeButton()`: non-turn waypoint add behavior remains exercised by the adjacent communication-change suite.
- Turning-point inspector handler: marking, moving, clearing, persistence, route-direction filtering, and dependent controls remain green.
- `.insp-btn.insp-btn-on`: safe colors remain stable across active/inactive states in both themes; destructive action styling remains red.

**Analysis incomplete:** false
