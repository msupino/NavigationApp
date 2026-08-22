---
epic_key: turn-freq-change (bug)
title: Remove frequency changes at turning points
main_service: tests
affected_services: [tests]
pr: https://github.com/msupino/NavigationApp/pull/1804
jira: n/a
archived_at: 2026-08-22T20:00:33+03:00
source: implementation-diff   # describes the shipped code, not the original plan
description: Restored routes now remove persisted frequency-change callouts from effective turning points on their first render.
---

# turn-freq-change — Remove frequency changes at turning points

## Why
An imported or locally restored route could retain a persisted frequency-change callout at its effective turning point. That stale callout contradicts the route rule that the aircraft leaves the turn on the frequency used to arrive there.

## Key decisions
- Enforce the invariant at the beginning of `draw()` — import and startup install the complete route state before rendering, so both manual and geometry-derived turns are known when cleanup runs.
- Reuse `pruneTurnCommChangeNotes()` instead of broad communication-callout seeding — restoration removes only prohibited turn callouts while preserving supported read-only badges and unrelated notes.
- Keep restoration behavior under durable browser regression coverage — the test exercises import, startup restore, manual and derived turns, selection repair, and preservation of ordinary notes.

## What changed
**Added:** Browser coverage for imported and restored routes with manual or geometry-derived turns, including safe note-selection repair and preservation checks.
**Changed:** Every draw now prunes frequency-change notes attached to the effective turning point before rendering; the focused turn-frequency tests were consolidated around exact state assertions.
**Removed:** none

## Links
- PR: https://github.com/msupino/NavigationApp/pull/1804
- Jira: n/a
