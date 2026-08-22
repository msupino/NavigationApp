# Markdown Review Report

**Date:** 2026-08-22
**Diff:** PR #1797 at `09fec6771b927032d73958919f9a9103c840bc00`
**Files reviewed:** 6 (0 skill, 0 agent, 0 rule, 6 generic)
**HIGH:** 0 | **MEDIUM:** 0 | **LOW:** 3

## Findings

### Finding 1: The stated paint/hit invariant contradicts the implemented overlap behavior

**File:** [.ai/plans/bugs-return-route-turning-point/frontend/fe-resolution.md:28](../../../../../../bugs-return-route-turning-point/frontend/fe-resolution.md#L28)
**Category:** structural
**Severity:** LOW

**Description:** The grounding document requires marker painting and hit testing to be symmetric so an undrawn marker cannot remain selectable. The implementation intentionally preserves a navigation-waypoint or airfield hit candidate when the point has any visible route occurrence, although `drawNavWaypoints()` and `drawAirfields()` suppress the separate reference marker whenever the route occupies that point. This exception is required by the stated intent so the overlap chooser can merge reference metadata into the editable route candidate. The same inaccurate symmetry claim appears in `investigation.md` lines 27 and 61 and `rca-report.md` lines 56-57.

**Recommended fix:** Replace the symmetry claim in all three artifacts with the actual invariant: suppress a reference hit only when all matching route occurrences are hidden, and preserve it when a visible occurrence needs merged-reference metadata.

---

### Finding 2: The progress artifact still says implementation is pending

**File:** [.ai/plans/bugs-return-route-turning-point/progress_summary.md:17](../../../../../../bugs-return-route-turning-point/progress_summary.md#L17)
**Category:** structural
**Severity:** LOW

**Description:** The progress table marks “Implement and verify the fix” as pending, while this exact PR head contains the implementation and is already in code-review iteration 2. The frontmatter timestamp also predates implementation. This makes the tracked pipeline state disagree with the reviewed snapshot.

**Recommended fix:** Refresh the progress summary to identify implementation as complete and verification/review as the current phase, with an updated timestamp.

---

### Finding 3: The investigation promises a regression-file change that the PR does not contain

**File:** [.ai/plans/bugs-return-route-turning-point/investigation.md:64](../../../../../../bugs-return-route-turning-point/investigation.md#L64)
**Category:** structural
**Severity:** LOW

**Description:** The Affected Files section says `tests/routes.spec.js` will be extended, and the Test Gap section names that exact merged-chooser regression as missing. The reviewed diff changes only `tests/leg-direction-filter.spec.js`, while `rca-report.md` says there are no deferred follow-ups. The investigation therefore describes an unimplemented test as part of the planned change without recording whether the combined coverage is intentionally supplied elsewhere or still deferred.

**Recommended fix:** Either add the named merged-chooser assertion or revise the investigation to explain that the existing chooser test plus the new direction-filter inspector assertion jointly cover the boundary. If the end-to-end merged case remains desirable, list it explicitly under deferred follow-ups.

---

## Clarity findings (advisory)

### Clarity finding 1: Root-cause sentence combines both bypass paths and their consequences

**File:** [.ai/plans/bugs-return-route-turning-point/investigation.md:16](../../../../../../bugs-return-route-turning-point/investigation.md#L16)
**Category:** prose-clarity
**Severity:** CLARITY-ADVISORY

**Description:** STE §4.1 (`skills/technical-writing/references/writing-rules.md`). The sentence is substantially longer than the descriptive-sentence bound and nests two code paths, two comparisons, and the resulting UI behavior, which makes the causal chain easy to misparse.

**Recommended fix:** Give the hotspot projection and navigation-reference hit path one sentence each, then state their shared consequence in a third sentence.

---

### Clarity finding 2: The progress overview exceeds the descriptive-sentence bound

**File:** [.ai/plans/bugs-return-route-turning-point/progress_summary.md:11](../../../../../../bugs-return-route-turning-point/progress_summary.md#L11)
**Category:** prose-clarity
**Severity:** CLARITY-ADVISORY

**Description:** STE §4.1 (`skills/technical-writing/references/writing-rules.md`). The second sentence contains the route geometry, slicing behavior, inspector state, and persistence condition in one 30-word statement.

**Recommended fix:** Split the geometry-derived turn behavior from the missing inspector-state behavior while retaining the manual `turn` condition.

---

### Clarity finding 3: The test-gap assertion sentence packs several independent checks into one line

**File:** [.ai/plans/bugs-return-route-turning-point/investigation.md:77](../../../../../../bugs-return-route-turning-point/investigation.md#L77)
**Category:** prose-clarity
**Severity:** CLARITY-ADVISORY

**Description:** STE §4.1 (`skills/technical-writing/references/writing-rules.md`). The sentence combines chooser setup, three airfield assertions, and a separate positive assertion for ordinary turning points. A reader can miss which assertion belongs to which scenario.

**Recommended fix:** Present the merged-airfield assertions as a short list, then state the ordinary-waypoint positive control in a separate sentence.

---

## Summary

**HIGH:** 0 | **MEDIUM:** 0 | **LOW:** 3
**Clarity (advisory, non-blocking):** 3

**Merge recommendation:** APPROVE

The changed documentation contains no credential, disclosure, or broken-link concerns. Three low-severity consistency issues should be cleaned up so the pipeline artifacts accurately describe the exact implementation and its deliberate visible-overlap exception.

## Cleared

Areas actively reviewed and found clean:
- Credentials and disclosure: no secrets, tokens, sensitive environment values, or external disclosure instructions were added.
- Links and references: the three relative artifact links in `progress_summary.md` resolve, and no obviously dead external Markdown links were introduced.
- Developer guide: `.ai/navaid-dev.md` accurately records direction-aware hotspot suppression, effective retrace-turn selection, and the airfield inspector exclusion.
- Decision record: `internal/decisions.md` records the accepted route-aware behavior and airfield exclusion without introducing unsafe instructions.
- Prose clarity: all six generic Markdown files were checked against the live STE100 catalog; the three advisories above are non-blocking.
