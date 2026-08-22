# Intent context

Source: issue #1796, PR #1797, approved RCA, and review-round-1 remediation.

When the route direction selector shows only the return half, route-bound hotspot projections and reference hit targets from the hidden outbound half must not remain visible or selectable. A waypoint whose outgoing leg retraces an earlier leg is the effective turning point and its ordinary route-waypoint inspector must show the existing turning-point state as selected. A route waypoint that resolves to an airfield must not show the route-only turning-point control.

Reference hits must be suppressed only when every matching route occurrence is hidden. If the same reference has a visible occurrence, it must remain available so the point chooser can merge its nav-waypoint or airfield identity into the editable route candidate. The implementation must preserve repeated-coordinate route behavior, keep rendered markers symmetric with hit testing, retain the manual turn action for non-retracing routes, and include browser coverage for hidden-only and hidden-plus-visible cases.
