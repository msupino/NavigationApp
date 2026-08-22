# Intent context

Source: issue #1796, PR #1797, and the approved RCA.

When the route direction selector shows only the return half, route-bound hotspot projections and reference hit targets from the hidden outbound half must not remain visible or selectable. A waypoint whose outgoing leg retraces an earlier leg is the effective turning point and its ordinary route-waypoint inspector must show the existing turning-point state as selected. A route waypoint that resolves to an airfield must not show the route-only turning-point control.

The implementation must reuse the existing route-direction and retrace predicates, preserve repeated-coordinate route behavior, keep rendered markers symmetric with hit testing, retain the existing manual turn action for non-retracing routes, add focused browser regression coverage, and update the developer guide. The accepted design exception makes the `?hotspots=1` review overlay route-aware only for graph hotspots whose matching route occurrences are all hidden by the selected direction.
