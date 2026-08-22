---
name: remove frequency changes at turning points
status: draft
updated_at: '2026-08-22T19:14:41+03:00'
---

# remove frequency changes at turning points

## Overview

NavAid correctly identifies a route's effective turning waypoint, but an existing frequency-change callout can remain there. Marking the point manually also leaves the callout in place, and the inspector or `Z` shortcut can recreate it. The inspector's current selected-state color also makes a non-destructive set/unset action look like a separate color-coded action.

## Progress

| Task | Status |
|---|---|
| T-1: Implement and verify the fix | 🔄 in-progress |

## Artifacts
- [investigation.md](investigation.md)
- [rca-report.md](rca-report.md)
