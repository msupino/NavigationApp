# Markdown Review Report

**Date:** 2026-08-22
**Diff:** `origin/dev...codex/fix-turn-freq-change` at `20ac662a`
**Files reviewed:** 5 (0 skill, 0 agent, 0 rule, 5 generic)
**HIGH:** 0 | **MEDIUM:** 0 | **LOW:** 1

## Findings

### Finding 1: The RCA misstates why automatic turn callouts survived

**File:** [.ai/plans/bugs-turn-freq-change/rca-report.md:15](../../../../../../bugs-turn-freq-change/rca-report.md#L15)
**Category:** structural
**Severity:** LOW

**Description:** The RCA says the former seeder “deliberately preserves existing automatic and manual notes.” The base implementation deliberately preserved a manual note, but an automatic note survived accidentally because the early `continue` bypassed all existing-note reconciliation. The investigation states this distinction correctly at lines 18 and 39. Collapsing the two causes makes the concise RCA disagree with both the source and its detailed evidence artifact.

**Recommended fix:** State that the old branch deliberately preserved manual callouts and inadvertently retained already-seeded automatic callouts by continuing before reconciliation.

---

## Clarity findings (advisory)

### Clarity finding 1: The detailed root-cause sentence overloads the two survival paths

**File:** [.ai/plans/bugs-turn-freq-change/investigation.md:18](../../../../../../bugs-turn-freq-change/investigation.md#L18)
**Category:** prose-clarity
**Severity:** CLARITY-ADVISORY

**Description:** STE §4.1 (`skills/technical-writing/references/writing-rules.md`). The second sentence combines the intentional manual-note path, the accidental automatic-note path, the route-extension condition, and the unreachable cleanup logic. A reader can easily assign the early `continue` to both note types.

**Recommended fix:** Give the manual-note fall-through and automatic-note early-return paths separate sentences, then state their shared visible result.

---

### Clarity finding 2: The concise RCA combines distinct code paths in one sentence

**File:** [.ai/plans/bugs-turn-freq-change/rca-report.md:15](../../../../../../bugs-turn-freq-change/rca-report.md#L15)
**Category:** prose-clarity
**Severity:** CLARITY-ADVISORY

**Description:** STE §4.1 (`skills/technical-writing/references/writing-rules.md`). The sentence joins seeding behavior, persistence behavior, three source ranges, and immediate enforcement into one long causal statement. This compression contributes to the factual ambiguity in Finding 1.

**Recommended fix:** Describe the seeder defect first. Use a second sentence for the missing enforcement in `setTurnWaypoint()` and the inspector and keyboard paths.

---

## Summary

**HIGH:** 0 | **MEDIUM:** 0 | **LOW:** 1
**Clarity (advisory, non-blocking):** 2

**Merge recommendation:** APPROVE

The developer guide accurately documents the new invariant, and the generic artifacts introduce no security or link concerns. Correct the low-severity RCA wording when refreshing the pipeline artifacts so the short root-cause summary matches the detailed investigation.

## Cleared

Areas actively reviewed and found clean:
- Developer-guide consistency: `.ai/navaid-dev.md` accurately records removal of automatic and manual turn callouts, the absence of a persistent suppression, and the inspector/`Z` guards.
- Pipeline state: `progress_summary.md` correctly leaves implementation-and-verification in progress while review and verification remain active; its two relative artifact links resolve.
- Decision record: `internal/decisions.md` matches the approved styling scope and identifies the implementation commit.
- Credentials and disclosure: no secrets, tokens, private endpoints, sensitive environment values, or disclosure instructions were added.
- Trust and embedded instructions: no unsafe authorization change, prompt injection, remote execution instruction, or new dependency appears in the changed Markdown.
- Structure and links: headings, lists, tables, Mermaid syntax, local references, and changed Markdown structure are coherent.
- Prose clarity: all five generic Markdown files were checked against the live STE100 catalog; the two advisories above are non-blocking.
