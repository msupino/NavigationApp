# AIP airspace sections

Four sections of the CAAI AIP, snapshotted from the AIP index's own bundle
(`apiaip.azurewebsites.net/getJson` → `url` → `filesPdf.zip`), kept here the way
`docs/byop/` keeps the airport plates: the index gives titles and hashes, not
download links, so the PDF is the record of what was read.

| File | Section | Edition |
|---|---|---|
| `ENR-2.1_FIR-TMA.pdf` | FIR, TMA | 06 AUG 2026 |
| `ENR-2.2_other-regulated.pdf` | Other regulated airspace | 11 AUG 2022 |
| `ENR-5.1_prohibited-restricted-danger.pdf` | Prohibited, restricted, danger areas | 22 FEB 2024 |
| `ENR-5.2_military-training.pdf` | Military exercise and training areas | 11 AUG 2022 |

| `AD-2.2_LLHA_Haifa.pdf` | Haifa aerodrome (AD 2.17 = its CTR) | 06 AUG 2026 |
| `AD-2.5_LLBG_Ben-Gurion.pdf` | Ben-Gurion aerodrome | 02 OCT 2025 |
| `AD-2.7_LLER_Eilat-Ramon.pdf` | Eilat / Ramon aerodrome | 06 AUG 2026 |

`scripts/extract-airspace.py` reads ENR 5.1, ENR 2.1 and each AD 2.17 block into
`docs/data/airspace.json`. The other two are here because they are the rest of the
airspace picture and the next thing anyone extending this will want.
