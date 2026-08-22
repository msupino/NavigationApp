# RCA — hide hotspots from the unselected route direction

## Root cause

`routePointOnlyInHiddenDirection()` used only coordinate proximity to bind a graph reference
to route occurrences. A named route waypoint with older imported coordinates was therefore
treated as unrelated to the graph reference and escaped direction filtering.

## Fix

Treat canonical waypoint-name equality as the primary identity signal, with the existing
coordinate tolerance as a fallback when names are absent or differ. Keep a hotspot visible
when any matching route occurrence is in the selected direction. Apply the same gate to the
frequency-change ring and its hit target.

## Verification

The browser regressions cover a shifted named hotspot on the hidden outbound half.
They also cover coordinate fallback and a repeated visible occurrence on the return half.
The supplied LLHZ loop verifies hotspot projections, frequency-change rings, hit targets,
and linked notes in both directions.
