# Intent context

Source: issue #1796, PR #1797, approved RCA, and prior review remediation.

Return-only mode must suppress a route-bound hotspot projection and reference hit when every matching route occurrence is hidden. A visible matching occurrence must preserve the reference candidate so the chooser can merge its metadata into the editable route waypoint. An ordinary waypoint whose outgoing leg retraces an earlier leg must show the existing selected turning-point state. A route waypoint that resolves to an airfield must omit the turning-point control.

The final delta from the clean runtime review adds the exact merged LLHA chooser assertion and clarifies planning documentation. Application runtime files are unchanged from review round two.
