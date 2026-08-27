---
name: iOS app does not request location permission
status: review
updated_at: '2026-08-27T13:04:00+03:00'
---

# iOS app does not request location permission

## Overview

Before the fix, the installed iOS app never registered for foreground location access. The connected iPad reproduced the missing permission and GPS position.

## Progress

| Task | Status |
|---|---|
| T-1: Implement and verify the fix | ✅ complete |
| T-2: Finish PR checks | 🔄 in-progress |

## Artifacts
- [investigation.md](investigation.md)
- [rca-report.md](rca-report.md)
- [frontend/fe-resolution.md](frontend/fe-resolution.md)
