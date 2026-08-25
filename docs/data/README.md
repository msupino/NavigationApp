# Datasets

Where each file came from and which edition it is, so "are we current?" is answerable
without archaeology. `scripts/aip-drift.py` answers the same question for the chart PDFs in
`docs/byop/` and `docs/byop-enr/`.

| File | Source | Edition |
|---|---|---|
| `airfields.json` | CAAI AIP AD 2 / per-airfield packs, plus hand-fitted overlay corners | AIP packs of May 2026 |
| `airspace.json` | AIP ENR 5.1 (prohibited / restricted), ENR 2.1 (FIR, TMA), AD 2.17 (CTRs) | ENR 5.1 22 FEB 2024 · ENR 2.1 06 AUG 2026 · AD 2.17 2025–2026 |
| `ats-chart.json` | AIP ENR 6.1 ATS routes chart, warped by `scripts/warp-ats-chart.py` | amendment 2/25, effective 02 OCT 2025 |
| `ats-route-graph.json` · `ats-waypoints.json` | Reporting points read off the same ENR 6.1 sheet | amendment 2/25 |
| `ctr-boundaries.json` | Maintainer's per-field reporting-point lists (**not** geometry — the CTR polygons live in `airspace.json`) | 2026-08 |
| `cvfr-route-graph.json` · `heli-route-graph.json` · `lsa-route-graph.json` | Leg altitudes extracted from the published raster charts | per graph |
| `ifr-overlays.json` | AIP instrument charts, georeferenced by `scripts/build-ifr-overlays.py` | AIP packs of May 2026 |
| `lsa-areas.json` | LSA bubble polygons + altitude bands from the Low Alt chart legend | chart legend |
| `notam-borders.json` | geoBoundaries gbOpen ADM0, Israel-side arcs per neighbour | gbOpen |
| `notam.json` · `wx.json` · `sigmet.json` | Live feeds (autorouter/EAD, NOAA AWC), refreshed by workflow into their own branches | continuous |
| `plate-titles.json` | Designations read from the CAA's AIP index by `scripts/aip-plate-titles.mjs` | refreshed daily |
| `route-templates.json` | In-repo, hand-maintained | — |
| `terrain.json` | SRTM elevation grid, downsampled for MSA / terrain tint | SRTM v3 |
| `ultralight-areas.json` | CAAI PAMAT internal chart, appendix A-17 | update 3/24, 31 OCT 2024 |
| `vor.json` | AIP ENR 4.1 antenna positions + GEN 2.5 names; see the file's own `_source` | AIRAC 2024-10-31 |

## Two files carry no header

`plate-titles.json` and `ifr-overlays.json` are keyed maps — every top-level key is a plate
or an ICAO, and readers iterate them. A `source` key there would read as another plate, so
their provenance lives in this table instead.

## Known gaps

- **Obstacles.** AIP ENR 5.4 does not publish the obstacle table as readable text: the page
  is a single embedded object whose words extract out of order (`TheAviv table Industry
  lists Area obstacles known Chimney Bldg 4 3`). The AIP itself says the Area 1 database is
  available only by contacting the CAA, and that it "does not meet the quality requirements
  in ICAO Annex 15" and is incomplete. Salvaging heights out of that page would produce
  confident, wrong terrain data, so there is none.
- **ENR 5.3** is a paragraph about radar-altimeter interference — no geometry.
- **ENR 5.5** (aerial sporting) and **ENR 2.2** (other regulated airspace) both read `NIL`.
- **Bird concentration routes** (ENR 6.11A/B, 6.13, 6.14) are published as index charts only;
  nothing machine-readable yet.
