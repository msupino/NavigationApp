---
epic_key: explicit-hotspots-visible (bug)
title: Preserve waypoint hotspot overrides
main_service: ai
affected_services: [ai]
pr: https://github.com/msupino/NavigationApp/pull/1820
jira: n/a
archived_at: 2026-08-23T08:25:07+03:00
source: implementation-diff   # describes the shipped code, not the original plan
description: Explicit waypoint hotspot choices now override the global graph-default visibility setting and stay synchronized with the inspector.
---

# explicit-hotspots-visible — Preserve waypoint hotspot overrides

## Why
The global **Show hotspots** checkbox hid explicitly enabled waypoint hotspots even though the route retained the pilot's choice. It could also leave an open waypoint inspector showing a stale effective state. Explicit waypoint choices need to remain authoritative while the global setting controls only graph-derived defaults.

## Key decisions
- Preserve the existing tri-state route model: an own `hotspot: true` always shows, an own `hotspot: false` always hides, and only an unset value follows the global setting plus the graph-derived default.
- Centralize effective route-hotspot resolution in `routeWaypointHotspot()` and use it for both canvas drawing and inspector state so those surfaces cannot disagree.
- Refresh only an inspector that is already visible when global hotspot visibility changes; a deliberately closed inspector stays closed.
- Keep persistence unchanged: the global toggle updates only `navaid.showHotspots` and never mutates waypoint-level overrides stored with the route.

## What changed
**Added:** A shared effective route-hotspot predicate and browser regression coverage for explicit/unset precedence, persistence across reload, inspector refresh, and the closed-inspector case.
**Changed:** Route drawing and the waypoint inspector now honor explicit hotspot overrides independently of the global graph-default toggle. The global toggle refreshes a visible waypoint inspector, and the developer guide documents the precedence and storage behavior.
**Removed:** The global all-or-nothing gate that suppressed explicit route-waypoint hotspot selections.

## Verification
- Focused hotspot browser suite: 9/9 Chromium tests passed.
- Combined hotspot and route-direction suite: 51/51 Chromium tests passed, including hidden-direction suppression.
- Settings synchronization suites: 36/36 Chromium tests passed.
- `node --check` passed for all four changed JavaScript files; `git diff --check origin/dev...codex/fix-explicit-hotspots-visible` passed.
- The durable change matched the approved shape: five existing source/test/documentation files and 139 changed lines, with no new executable or tooling input.

## Review findings NOT fixed
- `[Advisory]` No visual reference anchor was supplied, so browser review validated live behavior and reuse of existing controls and styling without a pixel comparison against a design image.

## Links
- PR: https://github.com/msupino/NavigationApp/pull/1820
- Jira: n/a
