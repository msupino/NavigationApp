---
epic_key: return-route-turning-point (bug)
title: Fix return-route hotspot visibility and turning-point inspector state
main_service: ai
affected_services: [ai]
pr: https://github.com/msupino/NavigationApp/pull/1797
jira: n/a
archived_at: 2026-08-22T18:19:50+03:00
source: implementation-diff   # describes the shipped code, not the original plan
description: Return-route filtering now hides direction-inapplicable hotspot references while preserving visible overlaps and correct inspector state.
---

# return-route-turning-point — Fix return-route hotspot visibility and turning-point inspector state

## Why
Selecting the return half of a route could leave an outbound-only hotspot visible and selectable. The inspector also failed to represent a geometry-derived turning point, while coincident route-airfield selections exposed a route-only turning-point action that airfields should not have.

## Key decisions
- Make the selected outbound/return slice authoritative for route-bound graph references: suppress a reference only when every matching route occurrence is hidden, so a coincident occurrence on the visible half remains available.
- Derive inspector selection from the existing retraced-leg turn calculation instead of adding a second turn algorithm; retain the existing action so pilots can still persist an explicit manual turn.
- Treat a route waypoint resolved to an airfield as an airfield for inspector actions and omit the turning-point control, including after the overlap chooser preserves the editable route waypoint selection.

## What changed
**Added:** A shared predicate identifies chart references whose matching route occurrences all fall outside the selected direction; focused browser regressions cover hidden hotspots, visible repeated references, effective turn state, and merged route-airfield inspectors.
**Changed:** The hotspot review overlay and navigation/airfield hit testing now suppress only hidden-direction route references. Ordinary waypoint inspectors show geometry-derived turns as selected, and airfield-resolved waypoint inspectors omit the turning-point button. The developer guide documents these invariants.
**Removed:** none

## Links
- PR: https://github.com/msupino/NavigationApp/pull/1797
- Jira: n/a
