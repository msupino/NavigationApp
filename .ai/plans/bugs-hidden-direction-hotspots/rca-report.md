# RCA — hide hotspots from the unselected route direction

## Root cause

`routePointOnlyInHiddenDirection()` used only coordinate proximity to bind a graph reference
to route occurrences. A named route waypoint with older imported coordinates was therefore
treated as unrelated to the graph reference and escaped direction filtering.

## Fix

Treat canonical waypoint-name equality as the primary identity signal, with the existing
coordinate tolerance as the fallback for unnamed points. Keep a hotspot visible when any
matching route occurrence is in the selected direction.

## Verification

The browser regression covers a shifted named hotspot on the hidden outbound half, the
reference hit target, and a repeated visible occurrence on the return half.
