---
name: Return-route hotspots and turning-point inspector state
status: draft
updated_at: '2026-08-22T18:06:57+03:00'
---

# Return-route hotspots and turning-point inspector state

## Overview

In Return-only view, a hotspot that belongs to the hidden outbound route half can remain projected and selectable through the graph-reference paths. The waypoint where the next leg reverses the preceding leg correctly drives route slicing. Its inspector did not show the derived turn as selected without a redundant manual `turn` flag. A route waypoint that resolves to an airfield also incorrectly receives the turning-point control; airfield inspectors must not expose that route-only action.

## Progress

| Task | Status |
|---|---|
| T-1: Implement and verify the fix | 🔄 in-progress |

## Artifacts
- [investigation.md](investigation.md)
- [rca-report.md](rca-report.md)
- [frontend/fe-resolution.md](frontend/fe-resolution.md)
