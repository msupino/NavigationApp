# Investigation — hidden-direction hotspots

Issue: #1806

The direction filter suppressed graph hotspot references only when the route waypoint and
reference coordinates were within about 22 metres. Imported routes can contain the same
canonical named waypoint at coordinates from an older chart. In that case the hidden route
waypoint disappeared, but its graph hotspot projection and hit target remained visible.

The focused regression shifts hidden outbound HADRA beyond the coordinate tolerance while
retaining its canonical name. Before the fix, the test rendered one hotspot and returned a
`navwp` hit. The fix matches route occurrences by canonical name or coordinate and preserves
the reference when any matching occurrence belongs to the selected direction.
