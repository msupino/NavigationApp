# Cone-based leg tracking, and an unknown-position alert

**Date:** 2026-08-13
**Status:** designed

## The problem

The app decides which leg the aircraft is on with a forward-only pointer
(`gpsAlertLegIndex`): it advances on capture radius or on passing abeam, and it never
goes back. Seeding it (`gpsSnapLegAlertsToPosition`) picks the leg whose perpendicular
corridor contains the position, else the nearest endpoint.

That corridor is unbounded sideways, so every position belongs to some leg. The app is
therefore never able to say "I do not know where you are relative to this route" — it
always answers, even when the answer is meaningless, and the altitude and off-course
alerts are then measured against a leg the aircraft is nowhere near.

Forward-only also mismodels real flying: rejoining a route mid-way, flying it in reverse,
or skipping a leg all leave the pointer stuck behind.

## The cone

For each leg A→B, a 90° cone from each end, and the leg is their OVERLAP: ±45° from A
toward B, AND ±45° from B back toward A. The region is a diamond — a point at each
waypoint, widest (± half the leg length) at the midpoint.

Using the existing `_gpsTrackProjection(a, b, pos)` (along-track and cross-track in NM),
the aircraft is inside leg `i` when:

```
0 ≤ along ≤ legLen   and   |cross| ≤ min(along, legLen − along)
```

`tan 45° = 1`, so the cone test reduces to that comparison — no trigonometry.

A single cone anchored at A was rejected: it widens without bound, so near B a position a
whole leg-length off to the side still reads as "on the leg", and the unknown state would
almost never trigger on a long leg — defeating the point of the feature.

## Selecting the current leg, every fix

1. If the CURRENT leg is still inside its own cone, keep it. This hysteresis is what
   stops flapping where adjacent diamonds overlap around a shared waypoint.
2. Otherwise, among the legs whose cones contain the position, take the smallest
   `|cross|`; ties break to the lowest index.
3. If no cone contains the position, the state is UNKNOWN. The pointer keeps its last
   value rather than jumping, so nothing dependent on it lurches.

When the selected leg CHANGES, that leg's one-shot latches are re-armed
(`_gpsAlertLegFired`, `_gpsAlertAltDeviated`, `_gpsAlertMinDistNm`). Rejoining a leg you
had left therefore gives you its approach alert again — which is the desired behaviour on
a rejoin, and is kept from nagging by the hysteresis in step 1.

## While unknown

Leg-approach, TOP, altitude and off-course alerts are all suppressed. There is no
trustworthy leg to measure against, and an altitude "deviation" from a leg the aircraft is
not flying is noise. The unknown alert supersedes them. Normal alerting resumes on
re-entry into any cone.

## The unknown alert

Fires once the position has been CONTINUOUSLY outside every cone for 15 s — timed from
the first outside fix, and reset the instant any fix falls inside a cone again. Time, not
a fix count: fix rate varies with the GPS source, and a count would mean a different
grace period on a 1 Hz phone fix than on a simulator poll.

Not on the first stray fix: a wide turn at a waypoint and ordinary GPS scatter both put a
fix briefly outside, and an alert that cries wolf there would be turned off.

Fires ONCE per episode. It clears on re-entry into a cone; a later exit is a new episode
and fires again. New EN/HE strings, sent through `gpsSendWatchAlert` like every other
alert — so it inherits the watch mirroring now and the spoken form once
`2026-08-13-voice-alerts-design.md` ships.

## TOP

Unchanged in character: proximity to the shared waypoint (capture radius), one-shot per
leg. Being overhead a point is a question about distance to that point, not about leg
membership, so it does not move into the cone logic.

## Confirmation gate

`_gpsAlertConfirmed` exists because the old nearest-leg snap was a guess, and alerts
built on a guessed leg are worse than no alerts — so nothing fires until a fix genuinely
lands within capture radius of a real waypoint.

Cone membership is stronger evidence than that snap ever was: it is a positional fact
about a bounded region, not a nearest-neighbour guess. Being inside a cone therefore
counts as confirmation. Alerts start working as soon as the aircraft is demonstrably on a
leg, instead of waiting for the first waypoint capture — which is the improvement the
feature is for.

## Testing

Pure-geometry tests first, since the rest rests on them:

- inside / outside / exactly on the cone edge; the midpoint maximum width; a very short
  leg; a position beyond either end
- selection with overlapping cones near a shared waypoint, and the hysteresis that keeps
  the current leg
- re-arming on leg change, and no re-fire while the leg is held
- the debounce: brief excursions stay silent, a sustained one fires once
- suppression of the other four alerts while unknown, and their resumption after

## What this deliberately does not do

- No map or toolbar display of the current leg or the unknown state. Alerts only.
- No re-nagging while lost. One alert per episode.
- No change to how TOP is detected.

## Risk

This replaces leg tracking that is already shipped and has been live-tested across
several sessions. The cone handles rejoining and out-of-order flying far better, but it
is a genuine behavioural change to alerts the pilot relies on. Fly it against the
simulator before trusting it in the air.
