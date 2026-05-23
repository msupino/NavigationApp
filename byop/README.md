# Israel BYOP Airport Plates

This directory holds 141 published airport plates ("dapeyot") for 16 Israeli airfields, sourced verbatim from the **ForeFlight Israel Base Pack** (`02-25` edition, effective Oct 2025), itself derived from the official **Israel CAAI AIP**.

## Contents

| ICAO | Airport |
|---|---|
| LLAR | Arad |
| LLBG | Tel Aviv / Ben Gurion |
| LLBS | Be'er Sheva |
| LLER | Eilat / Ilan & Asaf Ramon |
| LLES | Ein Shemer |
| LLEV | Tel Aviv / Sde Dov |
| LLEY | Ein Yahav |
| LLFK | Fik (Golan) |
| LLHA | Haifa |
| LLHZ | Herzliya |
| LLIB | Rosh Pina (Mahanayim) |
| LLKS | Kiryat Shmona |
| LLKZ | Kibbutz Kfar Yeshoshua |
| LLMG | Megiddo |
| LLMZ | Bar Yehuda (Masada) |
| LLRS | Rishon LeZion |

Each airfield has up to ~10 PDFs:

- `*_airport_CVFR.pdf` — VFR aerodrome chart
- `*_airport_Chart.pdf` — general aerodrome chart
- `*_airport_Circuit.pdf` — circuit pattern
- `*_airport_Text.pdf` — text information
- `*_APPROACH_*.pdf` — instrument approach plates (per runway / procedure)
- `*_SID_*.pdf` — Standard Instrument Departures
- `*_STAR_*.pdf` — Standard Terminal Arrivals
- `*_Ground_*.pdf` — ground movement / parking diagrams
- `*_ATC_*.pdf` — ATC / SMAC documents

## Storage

PDFs are stored via **Git LFS** (`.gitattributes` traps `byop/*.pdf`). Total ~133 MB.

The `byop/` directory is **NOT served by GitHub Pages** — it lives at the repo root, not under `docs/`. Pages does not serve LFS files anyway. The PDFs are accessible at:

```
https://media.githubusercontent.com/media/msupino/NavigationApp/main/byop/<file>.pdf
```

…or the `raw.githubusercontent.com/...` equivalent.

## License & attribution

- Charts © **Israel Civil Aviation Authority (CAAI)** / Ministry of Transport.
- The pack was assembled by **ForeFlight Israel** ([foreflightisrael.xyz](https://www.foreflightisrael.xyz/)) and is published free for personal pilot use.
- The underlying AIP is publicly available at <https://www.gov.il/en/Departments/Guides/aip-israel>.

NavAid bundles this snapshot for reference and offline use only. For current operational use, **always cross-check against the official AIP** which updates every AIRAC cycle (~28 days).

## Updating

When CAAI / ForeFlight Israel publish a new edition:

1. Download the new pack from <https://www.foreflightisrael.xyz/>.
2. Replace files under `byop/` with the new pack's `byop/` directory.
3. Commit (LFS handles the upload). Bump cache-bust on any UI that references the plates.
4. Update this README's edition / effective date.

## Status

Currently bundled but **not yet integrated** into NavAid's UI. Future work will surface relevant plates per airport waypoint via the inspector. Tracked separately.
