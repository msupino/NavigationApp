# Israel BYOP Airport Plates

This directory holds 142 published airport plates ("dapeyot") for 16 Israeli airfields, snapshotted from the official **Israel CAAI AIP**. Ben Gurion (LLBG), Eilat / Ramon (LLER) and Arad (LLAR) retain the prior edition; the remaining airfields were rebuilt from the latest per-airfield AIP packs (May 2026). Sde Dov (LLEV) was dropped as a closed aerodrome.

## Contents

| ICAO | Airport |
|---|---|
| LLAR | Arad |
| LLBG | Tel Aviv / Ben Gurion |
| LLBO | Habonim |
| LLBS | Be'er Sheva |
| LLER | Eilat / Ilan & Asaf Ramon |
| LLES | Ein Shemer |
| LLEY | Ein Yahav |
| LLFK | Fik (Golan) |
| LLHA | Haifa |
| LLHZ | Herzliya |
| LLIB | Rosh Pina (Mahanayim) |
| LLKS | Kiryat Shmona |
| LLKZ | Ktziot |
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

PDFs are stored as regular git blobs under `docs/byop/` and served directly by **GitHub Pages** CDN. Total ~133 MB.

The PDFs are accessible at:

```
https://navaid.supino.org/byop/<file>.pdf
```

## License & attribution

- Charts © **Israel Civil Aviation Authority (CAAI)** / Ministry of Transport.
- The AIP is publicly available at <https://www.gov.il/en/Departments/Guides/aip-israel> and is published free for personal pilot use.

NavAid bundles this snapshot for reference and offline use only. For current operational use, **always cross-check against the official AIP** which updates every AIRAC cycle (~28 days).

## Updating

When CAAI publishes a new AIP edition:

1. Download the new plates from the official AIP <https://www.gov.il/en/Departments/Guides/aip-israel>.
2. Replace files under `docs/byop/` with the new edition's PDFs.
3. Run `qpdf --flatten-rotation` on any PDFs that have `Rotate:` metadata (check with `pdfinfo`).
4. Commit. Update this README's edition / effective date.

## Status

Integrated into NavAid's UI. Use the **🗺️ Charts** toolbar button to browse all airfields, or select a waypoint whose name matches an airfield ICAO (e.g. `LLBG`) to see its charts in the inspector. Click a chip to open the PDF in a full-screen viewer. See [Airfields dataset](https://github.com/msupino/NavigationApp/wiki/Airfields-Dataset) for details.
