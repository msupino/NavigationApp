# Nav log — design

**Goal:** produce the navigation log an Israeli CVFR written exercise asks for — the full
wind-triangle document, from CAS and a met table down to a compass heading and cumulative fuel —
without touching the flight plan pilots already fly with.

**Status:** scoped, not started. Reference sheet: Herzliya → Rosh Pina, six legs, in
`docs/superpowers/specs/assets/` if the scan is added.

## Why this is a feature and not a column toggle

Today's flight plan is deliberately **zero-wind** (`legWindFor`/`windTriangle` exist, but their
output is an inspector readout, never a plan column: a printed plan must not change because a
weather fetch landed). The exercise is the opposite document — it exists *because* of the wind,
and grades the arithmetic between CAS and the compass. Six of its columns have no data model in
the app at all: CAS, pressure altitude, per-leg temperature, TAS, compass deviation, compass
heading.

## Decisions taken

| | |
| --- | --- |
| Placement | A separate **Nav log** view. The flight plan is untouched and stays zero-wind |
| Met data | A **typed met table** (altitude → wind, temp). Where a row is missing, fall back to the app's route/per-leg wind and the weather feed — typed always wins, and every cell says which source it used |
| Variation | A **per-route field**, prefilled from `magneticVariationDeg`. Matching an exam sheet must not change what the map and the GPS readout show in flight |

## The arithmetic, pinned

Verified against the reference sheet — all three TAS values and both sampled wind triangles
reproduce to the digit.

**ISA and density altitude**

```
isaTempC(pa)      = 15 - 1.98 * pa / 1000
densityAlt(pa, t) = pa + 120 * (t - isaTempC(pa))
sigma(da)         = (1 - 6.8756e-6 * da) ^ 4.2561
tas(cas, pa, t)   = cas / sqrt(sigma(densityAlt(pa, t)))
```

Reference: 70 KCAS @ 4033'/+6 → 74.2 · 90 @ 6000'/+2 → 98.2 · 100 @ 3450'/+8 → 105.2.

**The altitude each segment is computed at** — this is the rule the exercise states, and it is
what makes the climb and descent rows possible at all:

```
climb   PA = departure elevation + 2/3 * (cruise - departure elevation)
cruise  PA = cruise altitude
descent PA = destination elevation + 1/2 * (cruise - destination elevation)
```

Reference: 100 + 2/3·5900 = 4033 · 900 + 1/2·5100 = 3450.

**Met row selection:** the table row **nearest** the segment's PA (4033 → the 4,000 row;
3450 → the 3,000 row). No interpolation — the exercise does not interpolate, and a grader's sheet
must be reproducible.

**Wind triangle:** `windTriangle()` as it stands, with one presentation rule. It returns the
*correction* (WCA, toward the wind); the log prints the **drift**, which is the opposite side:

```
drift magnitude = |wca|,  side = R when wca < 0 (wind from the left pushes you right)
true heading    = true track + wca        (i.e. track - drift)
```

Reference leg 1: TT 024, 300/20, TAS 74.2 → WCA −15.5 → prints `15R`, TH 009, GS 69.4.

**Variation and deviation**

```
magnetic heading = true heading - variation      (4E on the reference sheet)
compass heading  = magnetic heading + deviation of the NEAREST card entry
```

The nearest-entry rule is not an approximation I chose — it is what reproduces all six reference
rows, where interpolation does not (MH 050 → CH 049 via the 060 entry, not 048 via interpolation).

**Legs, times and fuel**

- Climb leg: distance = GS × (cruise − departure elev) / climb rate. Fuel is a **flat allowance**
  (the sheet's 7 USG), not rate × time.
- Descent leg: distance = GS × (cruise − destination elev) / descent rate, fuel at cruise flow.
- Cruise legs: the remainder of each route leg, at cruise flow.
- Times to the second, cumulative down the sheet; fuel to 0.1 USG.

## Data model

New key `navaid.navlog`, device-local, **not** synced (it is exercise scratch, and a met table
from another day is worse than none):

```js
{
  variationDeg: 4,                 // E positive, prefilled from magneticVariationDeg
  cas: { climb: 70, cruise: 90, descent: 100 },
  rates: { climbFpm: 800, descentFpm: 1000 },
  fuel: { climbGal: 7, cruiseGph: 8 },
  met: [ { alt: 2000, dir: 315, kt: 17, tempC: 10 }, ... ],
  deviation: [ { mh: 0, ch: 358 }, { mh: 30, ch: 27 }, ... ]
}
```

Climb/descent rates and cruise flow read from the aircraft profile (`navaid.aircraft`,
`profileClimbFpm`, `defaultGph`) where the pilot has set them; the nav log's copy is an override
so an exercise can differ from the aeroplane.

## Files

| File | Role |
| --- | --- |
| `docs/app/navlog.js` *(new)* | the view, the table, print and CSV. Added to the `srcs` array in `docs/index.html` |
| `docs/app/core.js` | `isaTempC`, `densityAlt`, `tasFromCas`, `metRowFor`, `deviationFor`, `navLogRows` — pure functions, no DOM |
| `docs/app/ui.js` | menu entry, and the met/deviation editors |
| `docs/i18n/he/strings.js` + `core.js` strings | every column title and editor label, EN/HE (parity enforced) |
| `tests/settings-sync-allowlist.spec.js` | `navaid.navlog` declared device-local |

## Phases

1. **The arithmetic, headless.** The pure functions above plus a golden test that reproduces the
   reference sheet's six rows end to end. No UI. This is the phase that decides whether the
   feature is right; everything after it is presentation.
2. **The data model and its editors.** Met table and deviation card as editable grids, variation
   and CAS fields, fallback to the app's own wind where a row is missing (each cell carries its
   source).
3. **The table.** The nav-log window: 23 columns, RTL-aware, with the same drag/resize furniture
   the flight plan has.
4. **Print and CSV.** A kneeboard-width print sheet; CSV with a fixed header contract like
   `fpHeaders`.
5. **Phone.** The table cannot fit a phone — it scrolls horizontally in its own container, and
   the editors stack.

## Tests

- **The golden test**: the reference route, met table, deviation card and 4E variation in, all six
  rows out, compared cell by cell. Rounding included — a sheet that agrees to the digit everywhere
  but one cell is a sheet a grader marks wrong.
- Unit tests per rule: ISA/density/TAS at a few altitudes; the 2/3 and 1/2 altitudes; nearest met
  row at a boundary (3,500 ft); nearest deviation entry either side of a card gap; drift side R/L
  for wind from the left and from the right; GS when the crosswind exceeds TAS (no solution —
  the row must say so rather than print a number).
- Fallback: a met table with a hole falls through to the route wind, and the cell says so.
- Bilingual: the Hebrew log is RTL with the numbers LTR, like the follow-me banner.

## Open questions

- **Rounding.** The sheet rounds TAS to 0.1, headings to whole degrees, times to the second. Do we
  match exactly, or carry full precision and round only at display? (Recommend: compute full,
  round at display, and make the golden test the arbiter.)
- **Does it own TOC/TOD?** `routeProfile()` already computes them for the map. The nav log needs
  them as *rows*. Recommend: nav log calls `routeProfile()` rather than deriving its own, so the
  markers on the chart and the rows in the log cannot disagree.
- **Wind aloft fetch** for the fallback: which feed, and at what altitudes.
