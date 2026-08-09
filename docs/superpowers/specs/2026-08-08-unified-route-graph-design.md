# One route graph for CVFR, heli and LSA

**Date:** 2026-08-08
**Status:** approved design

## The problem

The same reporting point is described in up to four places today, each keyed by a name
string:

| file | keyed by | holds |
|---|---|---|
| `{cvfr,heli,lsa}-nav-waypoints.json` | `name` | position, report type |
| `{cvfr,heli,lsa}-leg-altitude.json` | segment `from`/`to` | altitudes, one-way, distance |
| `{cvfr,heli,lsa}-comm-change.json` | `name` | comm change + call signs |
| `airfields.json` | `name` | fields, which are points on the same corridors |

And the key is not the same kind of thing across layers. CVFR names points by their
five-letter code (`ZMGID`); LSA and heli name many by their Hebrew name (`ערה`), because
those were mapped by hand from the charts and no code list was available.

Three consequences, all observed:

1. **The same point looks like several.** 575 waypoint rows describe **414 distinct
   positions**; 127 points appear in more than one layer.
2. **Cross-layer lookups fail silently.** Searching for the AIP annex א' sample's points by
   code found 4 of 17 and I reported the rest as missing coverage. Searching by *position*
   found 12 of the 13 "missing" ones — in the LSA and heli files, under Hebrew names. The
   sample is an ultralight plan (`-ULAC/L-S/C`), so its points are LSA points; nothing was
   missing.
3. **An LSA route cannot be filed.** `fplRoutePoint()` accepts `/^[A-Z0-9]{2,7}$/`, so a
   Hebrew-named point returns null and the plan fails with `errFplBadPoints`. Verified
   end to end.

Meanwhile `core.js:3300-3316` already builds an adjacency structure at runtime from the
altitude data, and `docs/data/cvfr-route-graph.json` (PR #1478) builds another for CVFR.
Three representations of one thing.

## Design

**One self-contained file per layer**: `docs/data/{cvfr,heli,lsa}-route-graph.json`. Sharing
a node between layers is a modelling fact, but shipping one merged file would make every
consumer load all three networks and allow routing across them by accident. A per-layer file
cannot: the other layers' edges are not in it. A node used by two layers appears in both
files, identically — 573 node entries for 339 distinct points, which is the price of that
guarantee. Sizes: cvfr 135 KB, heli 77 KB, lsa 66 KB.

Each file:

```
layer: "cvfr" | "heli" | "lsa"
nodes: {
  <id>: { code, he, en, lat, lng, kind, report, commChange, callSigns[], layers[],
          codeSource }
}
edges: { <id>: [{ to, inboundAltitude, outboundAltitude, distanceNm,
                  chartDistanceNm?, oneWay?, blocked?, status }] }
```

### Nodes are deduplicated by position

Points within **0.25 nm** are one node **when their identity agrees** — same code, same
Hebrew name, or one side lacking what the other has. Distance alone is not enough: it would
eventually fuse two genuinely different published points. 0.1 nm was tried first and was too
tight, leaving 74 same-named pairs split between 0.10 and 0.20 nm — the same junction
digitised twice from different charts.

A second pass merges on a **shared code**, which is stronger evidence than a spelling:
`צ. ברכיה` and `צומת ברכיה` are one junction 0.10 nm apart that the name check refused, and
both cross-referenced to `ZBRCH`.

Result: **339 nodes from 575 rows**, 157 shared by more than one layer. Four id collisions
remain — genuinely distinct points wanting the same id — and are suffixed and recorded
rather than dropped. An earlier build dropped them silently: 414 merged points came out as
335 nodes because `out[id]` overwrote.

`id` is the code where one exists, else a stable slug of the Hebrew name. `layers` records
which networks the point belongs to, so a point can be shared without being duplicated.

### Edges stay per layer, and routing must never cross them

This is the one hard rule. A CVFR flight expanded through a heli corridor would file a
route it is not cleared for, and it would look plausible. Edges are grouped by layer and
every consumer names the layer it wants. There is no merged edge list.

Both directions are stored, with inbound/outbound altitudes swapped on the reverse, as
`legAltitudeForLeg()` already resolves them.

### Distance is computed, not stored

Our stored `distanceNm` matches great-circle from our own coordinates to a mean of
**0.025 nm** — it is the derived value, rounded to 0.1. Routing weights are therefore
computed from coordinates at build time.

The published figure is kept as `chartDistanceNm` **only where a chart value is displayed**
(the altitude-pairs table, `io.js:6071` and `6384`), because a pilot comparing that table
with the chart should see the chart's number. It is an annotation, never a routing input.

### Comm change moves onto the node

`commChange` and `callSigns` are properties of a point (`{"name":"BASAN","commChange":true,
"callSigns":["KIRYAT_SHMONA","PLUTO_EAST"]}`). They belong on the node, not in a fourth
file keyed by a name that does not match across layers.

## Codes for the un-coded points

79 LSA and 105 heli points have no code. Field 15 needs one, so today those routes cannot
be filed.

Codes are cross-referenced from flight-maps by **position**, taking only the code — not
their geometry, not their segments. Matching is accepted only when the nearest candidate is
within 0.35 nm and the runner-up is beyond 0.6 nm, so an ambiguous match is left un-coded
rather than guessed. Observed: **58 of 79** LSA and **38 of 105** heli resolve
unambiguously, with the Hebrew names matching exactly on both sides, which independently
corroborates the position match.

### Their adjacency asymmetry is NOT direction data

Worth recording, because it looks like a signal and is not one. Of 895 directed pairs in the
secondary source, 850 are symmetric and **45 list only one direction**. Thirteen of those 45
are segments we carry, and we independently mark 8 of them one-way — which reads like
corroboration.

It is not. The five remaining cases (`KUVSH→LLBS`, `LLBG→PARDS`, `SMRAT→SZION`,
`OVDAT→RUHOT`, `AFFEK→LLHA`) were checked against the live site by the maintainer and are
**all bidirectional**. The asymmetry is an incomplete reverse entry in their extraction, not
a one-way corridor.

So one-way flags must come from the charts, never from an absent reverse edge. A direction
flag is the one field that *forbids* flying something: a wrong one either refuses a legal
route or, worse, stays silent about a corridor that may not be entered.

Each such node carries `codeSource: "cross-referenced"`. The authoritative source is the
back of the published route charts, as AIP א'-11 annex א' states; these codes are a
convenience pending a chart audit, and the field makes that auditable rather than
forgotten.

Our own CVFR codes were checked the same way: **130 agree**, 40 are points the other source
does not carry, and **2 conflict** — `HATRU`/`TZHTR` (צומת חתרורים) and `YOTVT`/`LLYO`
(יטבתה, where `LLYO` is an ICAO airfield code, so both may be correct for co-located
things). Conflicts are recorded, not silently overwritten: ours wins, theirs is kept in
`codeAlt` for the audit.

## Retiring the source files

Done, in this change. The nine per-layer files are deleted and the graph is now the source
rather than a derived artifact.

What made that safe was not confidence, it was a proof. `scripts/legacy-from-graph.mjs`
rebuilds each legacy shape from the graph and compares it field for field with the real
file; while any field failed to reproduce, the file could not be deleted. It went
654 → 400 → 163 → 2 → 0 problems as the graph grew the fields it had been dropping
(`nameByLayer`, `reportByLayer`, `posByLayer`, `commByLayer`, `callSignsByLayer`, per-layer
provenance, and the 44-entry `callSigns` dictionary). The baseline is now read from git at
the last commit that had the files, so the proof still runs after the deletion — otherwise
the evidence would have disappeared together with the thing it was about.

The 68 call sites were not migrated one by one. `_fetchLayerDataRaw()` in `draw.js` is the
single funnel every loader already went through, so the projection sits there: the loaders,
their validators and all 68 call sites still receive exactly the shapes they validate. The
projection is `docs/app/route-graph-shapes.js` — one implementation, shared by the app, the
proof and the tests, so the app cannot drift from what the proof checked.

### Altitudes cross-referenced for seven of the thirteen unknowns

A secondary source's route network (extracted Aug 2026) was cross-checked against ours:
**136 of its 139 CVFR points match ours by code AND position with zero disagreements**, and
281 directed edges agree exactly on altitude. That mutual agreement is what qualifies it as
an altitude source for links we could not read off a chart.

Seven `status:"unknown"` pairs took its per-direction altitudes and moved to
`status:"candidate"`, with the provenance in `source` (KRYON↔GALIM, GALIM↔GILAM,
AMNON↔HULAT, DUMIM↔MIHMS, HAZVA↔ZOFAR, TIRAT↔EITAN, MMORR↔ENGDI). Six pairs remain
unknown: five airfield joins the source carries as `alt 0` (its circuit-join convention,
not a published altitude) and ZOHAR↔LLMZ, which no source speaks to.

The equivalence proof now carries an explicit `INTENTIONAL_EDITS` list: each post-migration
edit is named with its reason, reported in the output, and anything NOT on the list still
fails the proof. Recorded for the audit, not folded in: the source disputes two of our
one-way flags (OLGAH→HADRA, AHIUD→AAKKO — it flies both), two altitudes
(ALUMT→DESHE 3000 vs 3500, YOTVT→SHRUT 2500 vs 3000), carries three points we do not
(MNSZN, RSNIM, SOREK), and marks 57 corridors inactive — a corridor-availability dimension
we do not model. Direction flags come from charts only, as ever.

### The equivalence proof is retired

`scripts/legacy-from-graph.mjs` and its baseline are gone. The proof guarded the
MIGRATION — while any field of the retired files failed to reproduce from the graph, they
could not be deleted — and it did that job (654 → 0 problems). But its baseline was frozen
at the deletion commit, so once the data started growing (cross-referenced altitudes, new
points, airstrips), every legitimate edit joined an ever-longer exception ledger, and the
check decayed into ceremony. Worse, the baseline first lived in a squash-orphaned commit
that CI could not even reach.

What replaces it is self-referential: a **census pin** (nodes / segments / comm points /
unknowns per layer, one line to update in the same diff a reviewer reads), **spot pins**
on the safety-critical rows (the one-way corridors, a charted altitude, a comm node's call
signs), the **cross-file identity guard** for shared nodes, and the structural invariants
(reverse symmetry, endpoint existence, dedup-with-identity). An accidental deletion fails
the census; a surgical edit fails a spot pin or the identity guard; a deliberate change
updates one visible line.

### The LSA table, cross-checked the same way

The same secondary source carries the LSA network with per-direction altitudes and a time
dimension (weekday / weekend-only / time-restricted point sets) that we do not model.
Cross-check: 166 of its 221 points match ours with zero position conflicts (the 55
unmatched are mostly its "bubble" anchors, a concept we carry as area polygons).

What it showed about our own data: the LSA OCR pass read **one altitude per segment and
applied it to both directions**, but the routes use per-direction altitudes (a ±300 ft
direction split). In 11 of 13 comparable pairs, our single value matched exactly one of
their two directions -- the other direction of ours was a copy, not a reading.

Taken: **34 unknown pairs filled** (4 of them the source marks inactive, noted in
`source`), and **9 symmetric OCR rows split into per-direction values**, keeping our OCR
value on the direction it matched. AAKKO↔SMRAT — flagged as a conflict (our OCR 700 both
ways, the source 400 both ways) — was resolved by the maintainer as a direction split:
700 toward SMRAT, 400 toward AAKKO; both sources had captured one direction each. AYLON↔NSHRM — the mirror-image direction dispute —
was likewise resolved by the maintainer: 1200 toward NSHRM, 800 toward AYLON; our OCR had
it flipped, the source had it right. Left alone, for the chart audit: the 15 pairs the
source does not carry. The heli table's 38 unknowns remain: the source has no
heli network.

### The segment key is canonical now

The graph stores a segment in whichever direction it walks first, so ~30% of leg-altitude
rows project out reversed (altitudes swapped with them — same fact from the other end).
Every consumer used to handle that by probing `legAltitudeKey` in both orientations, which
worked but left a trap: a future single-orientation lookup would silently miss those rows.
`legAltitudeKey` now sorts its endpoints — one canonical key, one lookup — and orientation
is decided where it matters, by comparing the leg's `from` with the row's own `from`.
Old saved routes carrying a directional `_legAltitudeKey` heal on first repaint: the key
mismatch marks the auto leg changed once and the canonical key is stored.

### What the strengthened proof caught

The first version of the proof compared comm-change by **count only**. The count was right
and the data was gone: `routeHints` on 20 CVFR points — which tell the app which station to
call in the direction actually being flown — were never carried into the graph, and nothing
noticed. Comparing every key of every row, for all three kinds, found three real losses:

1. **`routeHints`, and the comm-change file's own provenance keys.** Now on the node and in
   `commMeta`.
2. **Per-layer spellings.** `צ. ברכיה` and `צומת ברכיה` are one junction 0.10 nm apart,
   merged on their shared code `ZBRCH` — but each layer's file spells it its own way, and
   the merge had picked one spelling for everybody.
3. **The published point order**, which `known-freq-points.md` mirrors row for row. Node
   order in the graph is by id and says nothing about it.

Separately, the per-layer distance check found that **298 heli and LSA edges stored the
chart figure as the routing weight** instead of the computed one — up to 0.33 nm off. The
weight is now computed from that layer's own coordinates, as the design says, with the
chart figure kept only as the displayed annotation.

The lesson is the one worth keeping: a check that compares a hand-picked list of fields, or
a count, reports success for exactly the data it does not look at.

Consequences worth stating plainly:

- **`scripts/build-route-graph.mjs` and `scripts/sync-leg-altitude-directions.js` are
  deleted.** Their inputs no longer exist. A chart update is now an edit to the graph, not
  an edit to a source file plus a rebuild.
- **One fetch per layer instead of three.** `S.navWpUrl`, `S.commChangeUrl` and
  `S.legAltitudeUrl` collapse into `S.routeGraphUrl`.
- **`airfields.json` stays.** It carries `runways`, `plates`, `atis`, `clearance`,
  `elev_ft` and the four overlay bindings, none of which the graph holds, plus four
  airfields (`KKDEM`, `LLES`, `LLEV`, `LLAR`) that appear in no graph file.
- **`directionPool` is no longer stored.** It was always derivable from the segments, and
  the loader already fell back to deriving it.

## What this does not change

- No behaviour change to filing, drawing or the nav log in this change.
- **`cvfr-route-graph.json` is replaced, not added to.** PR #1478 introduced a file of that
  name with a different schema (`{ nodes, edges }`, one layer, stored distance). This change
  rewrites it to the per-layer schema above. Whichever lands second has to be rebased onto
  the first, and #1478's `fplExpandRoute()` must be pointed at the new shape — it reads
  `graph.edges[from]` and `e.distanceNm`, both of which still exist, plus `e.blocked`, which
  also still exists. The migration is small but it is not automatic.
- The per-layer source files remain the inputs; this is a derived, regenerable artifact
  with a `--check` mode, like `build-cvfr-route-graph.mjs`.

## Testing

1. Node count and dedup: 339 nodes from 575 rows; no two nodes on the same spot unless they
   genuinely disagree on identity; every shared point carries all its layers.
2. No edge crosses layers; every edge's endpoints exist as nodes.
3. Reverse-edge symmetry with inbound/outbound swapped.
4. Comm-change points land on nodes with their call signs.
5. Cross-referenced codes are flagged `codeSource`, and an ambiguous match stays un-coded.
6. The CVFR sub-graph is equivalent to today's `cvfr-route-graph.json` — same segments,
   same altitudes — so the migration in the follow-up cannot change behaviour silently.
7. `--check` fails when the artifact is stale.

## Follow-ups, not in this change

- Migrate `fplExpandRoute()` and `core.js`'s runtime builder to read this file.
- Let `fplRoutePoint()` resolve a Hebrew-named point to its node code, so LSA routes can
  be filed at all.
- Audit the 2 code conflicts and the 21 unmatched LSA / 67 unmatched heli points against
  the charts.
- `ZMGID ↔ LLMG` (2.7 nm) is missing from CVFR, and `LLPL` has no inbound edge.
