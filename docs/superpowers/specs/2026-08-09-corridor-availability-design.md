# Corridor availability at filing time

**Date:** 2026-08-09
**Status:** built (same PR)

## The problem

Expansion chooses among published corridors with no notion of whether a corridor is
usable at the planned departure. Observed: LLHZ→LLHA expanded through the inland
FRDIS→HASID chain — a corridor the filing services' own data marks closed — instead of
the coastal FRDIS→BOREN→HOTRM→DAROM→GALIM chain a pilot actually flies. The LSA network
is worse: corridors and points carry weekday opening hours (06:00/12:00/14:00) and
weekend-only classes we ignored entirely.

## What the data holds

From the two secondary captures (Aug 2026), applied to the graph edges as HINTS:

- `closedHint` — 124 directed edges their live data had shut.
- `openFromHourHint` — 222 directed edges with a weekday opening hour (weekends open all
  day; Israel weekend = Fri/Sat).
- `weekdayClosedHint` — 6 directed edges removed on weekdays (explicit removals list).

The suffix is the point: these are operational hints from a secondary source, not chart
facts. The chart remains the authority for what exists; NOTAMs remain the authority for
what is closed today.

## Behaviour

`fplEdgeOpen(edge, when)` evaluates an edge for a local departure moment. Expansion runs
two passes per leg:

1. Over the corridors OPEN at the departure time (`when` from the filing modal's own
   date+time — the same values the EOBT is computed from).
2. If pass 1 leaves no chain: over the whole graph, and the plan carries
   `warnFplClosedCorridor` — a hint must never make a published route unfileable, and a
   silent fallback would defeat the warning's purpose.

No `when` (expansion outside the filing modal): closures apply, time gates do not — a
gate needs a clock to be meaningful.

## What this deliberately does not do

- No live NOTAM/getTrafficRules integration — the hints are a static capture and will
  drift; the warning text says "verify with the NOTAMs" for exactly that reason.
- No point-level availability (weekend-only points) yet: that changes which points can
  be FILED, not which corridor is chosen, and belongs with the LSA time-aware routing
  follow-up.
- No UI surface beyond the existing warnings list.
