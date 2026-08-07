# Filing a U-turn sortie as one ICAO plan

**Date:** 2026-08-07
**Status:** approved design, not yet implemented

## The problem

A local CVFR sortie flies out to a turn point and comes back. The outbound and the
return are **not** the same path. From a plan filed through flp.co.il for 4XDAZ:

```
out:  SFAIM APOLN ARENA HTZUK RIDNG CLORE TYONA SUPER NTAIM BOVED NAGID
back:                    HTZUK RIDNG CLORE TYONA SUPER NTAIM BOVED
then: KNTRY -> LLHZ
```

The return drops `APOLN` and `ARENA` and lands via `KNTRY` instead of `SFAIM`.
Field 15 lists the whole flown sequence, repeated points included, and the EET
(`0030`) covers the whole sortie.

NavAid cannot produce this today, for two reasons — neither of them the file format:

1. **The editor refuses the retrace.** `appendAddToRouteButton` (interact.js) disables
   "Add to route" whenever `routeOccupiesPoint(pt)` is true, i.e. when the point is
   anywhere on the route. Only re-adding the point the route *currently ends on* would
   create a zero-length leg; every other revisit is ordinary. `routeNeighbourAtPoint`
   (core.js) already states this distinction — the button is stricter than the model
   beneath it.
2. **The pilot builds two routes.** Outbound and return are separate NavAid routes so
   each gets its own nav log, plan card and exports. Nothing links them at filing time.

`showReturn` does not solve it: it mirrors the outbound, and the real return differs.
It is also currently **unsafe to file** — `routeProfile()` contains no reference to
`showReturn`, so with it on the nav log renders a return table while field 15 and the
EET describe one direction. A 26-minute out-and-back files as 13.

What already works, verified against the running app: `state.waypoints` carries repeats,
and `buildIcaoFpl` emits them. A hand-built out-and-back produced
`-N0100VFR SFAIM HTZUK NAGID HTZUK SFAIM` with zero errors and zero warnings.

## Scope

This design covers **only** the U-turn sortie: out and back with **no intermediate
landing**, filed as one plan.

An intermediate landing is explicitly out of scope, because the filing authority
requires a separate plan per leg. flp.co.il rejects it in as many words:

> שגיאה בתוכנית הטיסה — סימנת נחיתת ביניים במנחת תימן. יש להגיש תוכנית טיסה נפרדת לכל לג.

NavAid already enforces this via `errFplMidAirfield`, and that rule must run on the
**combined** sequence so composing `LLHZ→LLES` with `LLES→LLHZ` is refused rather than
filed.

## Decisions

| Question | Decision |
|---|---|
| Where do the two halves live? | Two independent routes, linked only at filing time |
| Where does the return come from? | The saved route library |
| How many parts? | Exactly two: outbound and return |
| Join where both coincide | Dedupe — the turn point appears once |
| Join where they do not coincide | **Refuse to file** (error, not warning) |
| Where in the UI? | Inside the existing FPL modal |

The gap case is an error because the feature exists only for turnarounds: two routes
that do not join are not a U-turn, and filing them as one plan would describe a path
never flown. This mirrors how the intermediate landing is already refused.

## Design

### Model

`state.waypoints` is unchanged. The outbound is the route on the map, as today. The
return is a saved library entry (`{ id, name, savedAt, data: serializeRoute() }`)
selected in the FPL modal.

Composition happens **only** while building the plan text. It never mutates the drawn
route, so the map, the nav log and the ETE keep one meaning, and both routes stay
independently exportable — the requirement that ruled out merging them into one route.

### Composing field 15

`buildIcaoFpl` takes one new optional input, `returnRouteData` (a `serializeRoute()`
blob). Points become `outbound.waypoints ++ return.waypoints`, then:

- if the return's first point coincides with the outbound's last (`sameMapPoint`, the
  existing epsilon), drop the duplicate → `... BOVED NAGID BOVED ...`
- otherwise push `errFplJoinGap`, naming both points, and do not produce a plan
- departure = outbound's first point; destination = return's last point
- `fplMidRouteAirfields()` runs over the combined sequence

### Time and speed

EET = `routeProfile(outbound).totalTimeH + routeProfile(return).totalTimeH`, rounded up
to the existing 5-minute grid **once**, after summing — not per part, which would
double-round.

Field 15 carries one cruising TAS. If the return's first-leg speed differs from the
outbound's, reuse the existing `mixedSpeed` warning rather than adding a second concept.

### UI

One row in the existing FPL form: **Return route**, a `<select>` of saved routes
defaulting to "— none —", so single-route filing is byte-identical to today. When a
return is selected the form shows the composed route line and the summed EET before
filing.

### `showReturn`

Stays a display aid, and becomes explicitly non-filable: if it is on and no return route
is selected, filing warns (`warnFplMirrorNotFiled`) that the drawn return is a mirror and
is not included in the plan. This closes the current silent half-EET defect without
pretending a mirror is a filed route.

## Filing-time route expansion

A filed plan names **every published reporting point on the way**, not only the points the
pilot clicked. flp.co.il does this because the CVFR low-level network is a published graph
of segments between reporting points.

NavAid already ships that graph: `docs/data/cvfr-leg-altitude.json`, 256 segments over 187
points, each `{ from, to, distanceNm, inboundAltitude, outboundAltitude, oneWay }`, used
today only for leg altitudes. Verified against the 4XDAZ plan: **every consecutive pair in
both directions is a real segment in our data.**

Expansion runs **at filing time only**. The drawn route, the nav log, the kites and every
export stay exactly as built; only field 15 is expanded, and the expanded chain is shown in
the FPL modal before filing so the pilot can check it.

### It expands between picks, never end to end

Global shortest-path routing does **not** reproduce a real plan. Measured on our own graph:

| | shortest path | filed |
|---|---|---|
| LLHZ→NAGID | `SFAIM RIDNG CLORE TYONA NTAIM BOVED` (23.4 nm) | `SFAIM APOLN ARENA HTZUK RIDNG CLORE TYONA SUPER NTAIM BOVED` |
| NAGID→LLHZ | `BOVED NTAIM TYONA CLORE RIDNG HTZUK KNTRY` (21.1 nm) | adds `SUPER` |

The pilot flew the coastal corridor; the cheapest path goes inland. Auto-routing the whole
flight would file a route that was not flown — the same defect class as the mirrored return.

So expansion fills in only what lies **between two consecutive drawn waypoints**, along the
published segments. The pilot's picks (`ARENA`, `APOLN`, `SUPER`) are what select the
corridor.

### What the AIP requires

AIP א'-11 §3.ב splits filing in the same way this app already does:

- §3.ב.1 `תוכנית טיסה בנתיבים` — by **phone** or email to `ais@iaa.gov.il`, following the
  annex א' sample
- §3.ב.2 `תוכנית לטיסת מרחב` — email only to `fpl@iaa.gov.il`, following annex ב'

The "list every point overflown" clause (§3.ב.2(ב): `פירוט כל הנקודות ... כגון ישובים,
צמתים ו נ.צ. ברשת WGS-84`) belongs to the **cross-country** branch, where there are no named
reporting points to refer to.

For a routes plan the governing text is the annex א' sample, and it enumerates the whole
chain — 17 reporting points for a Rosh Pina → Megiddo flight — with the legend:

> נתיב טיסה — יוזן לפי קודים נקודות הדיווח באנגלית כפי שמופיעות בגב מפות הנתיבים

*Entered as the reporting-point codes in English as they appear on the back of the route
charts.* So expansion is not merely a convenience: it is what the AIP's own example does,
and the authoritative list of codes is the back of the published route charts.

That the plan can also be filed by phone (§3.ב.1), where a pilot plainly does not recite
seventeen codes, is why expansion must remain **offered and reviewable** rather than forced.

### Our data does not yet cover the published network

Measured against the annex א' sample route: **13 of its 17 reporting points exist in none of
our datasets** (`cvfr` 172 points, `heli` 209, `lsa` 167). Missing: `SHLVM REUTE LAPID MCZVA
SSOMR YARHV ZNYMN ELYAU MEYAL BSARS GSHML PRHNA ARRAA`. None of the sample's consecutive
pairs is adjacent in our graph.

Coverage is good where it has been worked — the graph reproduces a real filed sortie in the
centre exactly — and thin elsewhere (the north, and `LLER→SAMAR` in the south).

**Completing the dataset from the back of the published route charts is a separate task**,
and this feature is of limited use without it.

### Degrading honestly

Our graph has gaps: `LLER→SAMAR` exists in the published network but not in our dataset.
Where a consecutive pair cannot be resolved to a chain of published segments, expansion
inserts **nothing** for that pair and the modal says which pair could not be expanded. It
must never invent a point, and must never drop a point the pilot drew.

Third-party route data is not to be copied. Where our graph is incomplete the fix is to
derive the missing segments from the AIP, as the existing dataset was.

## Testing

Behavioural, against the real builder:

1. The 4XDAZ sortie end to end — outbound `LLHZ…NAGID`, saved return `NAGID…KNTRY…LLHZ`:
   composed field 15, deduped turn point, summed EET, zero errors.
2. Asymmetric halves: the return omits points the outbound has and adds one it does not.
3. Gap: return starts elsewhere → `errFplJoinGap`, no plan produced.
4. Airfield join: `LLHZ→LLES` + `LLES→LLHZ` → `errFplMidAirfield`, matching the
   authority's own rule.
5. `showReturn` on with no return route → `warnFplMirrorNotFiled`.
6. No return selected → output identical to today (regression guard).
7. Editor: re-adding a point already on the route is allowed; re-adding the point the
   route currently ends on is still refused (zero-length leg).

## Alternatives considered, deliberately deferred

Recorded because they may be revisited, not because they are rejected on merit:

- **A separate "submit plan" view** — a filing layer built from saved routes, independent
  of the map. Keeps the map uncluttered; duplicates the profile-field wiring.
- **One route with a marked turn point** — exports split at the marker. Single source of
  truth, but forces one combined nav log unless splitting is also built.
- **One route with named segments** — arbitrary segmentation, each exported separately.
  The most general, and the most code.
- **N-part sorties** — more than two saved routes composed in order.

## Open items

None. Every question above was decided.
