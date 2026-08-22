# CVFR Altitude Extraction Notes

This is the breadcrumb trail for updating the altitude fields in
`docs/data/cvfr-route-graph.json` from the Israeli CVFR map PDFs. The graph is
the runtime source of truth; waypoint and altitude datasets are projections
created in memory by the app.

## Inputs

- North chart: `CVFR North 2025`
  `https://www.gov.il/BlobFolder/generalpage/idcunim-2025/he/%D7%91'-03%20CVFR%20%D7%A6%D7%A4%D7%95%D7%A0%D7%99-.pdf`
- South chart: `CVFR South 2023`
  `https://www.gov.il/BlobFolder/generalpage/updates-2023/he/aip_CVFR_South_2023.pdf`
- Point coordinates come from `docs/data/cvfr-route-graph.json` (`nodes`) and
  `docs/data/airfields.json`. Do not duplicate point coordinates in edge records.

## Direction Convention

For each segment, `inboundAltitude` means `from -> to` and
`outboundAltitude` means `to -> from`. If the app later looks up a route leg
in the reverse order, swap the stored values.

Each entry in `cvfr-route-graph.json` under `edges.<from>[]` is one adjacency.
The two altitude fields describe the directions relative to that stored edge:

Some CVFR paths are one-way. In `docs/data/cvfr-route-graph.json`, one-way rows
set `oneWay: true` and use `null` for the disallowed direction; the non-null
altitude is the allowed direction.

Candidate sign labels in the review artifacts used:

- `IN`: yellow altitude arrow points from `from` to `to`.
- `OUT`: yellow altitude arrow points from `to` to `from`.
- Bidirectional/same-altitude marker: a yellow altitude tag with pointed ends
  on both sides, like the 1200 marker in the maintainer screenshot, applies the
  same altitude in both directions when it is on the same green route.

## Working Artifacts

The extraction pass for PR #576 used these temporary paths:

- PDFs: `/tmp/navaid-cvfr-pdf/cvfr-north.pdf`,
  `/tmp/navaid-cvfr-pdf/cvfr-south.pdf`
- Extracted SVG/text: `/tmp/navaid-cvfr-pdf/north.svg`,
  `/tmp/navaid-cvfr-pdf/south.svg`,
  `/tmp/navaid-cvfr-pdf/north-bbox.html`,
  `/tmp/navaid-cvfr-pdf/south-bbox.html`
- Segment crops: `/tmp/navaid-altitude-extract/<FROM>_<TO>.png`
- Candidate metadata: `/tmp/navaid-altitude-extract/review-meta.json`
- Contact sheets: `/tmp/navaid-altitude-extract/review-sheet-01.jpg` ...
  `/tmp/navaid-altitude-extract/review-sheet-09.jpg`
- Yellow sign sheets: `/tmp/navaid-altitude-signs/sign-sheet-01.jpg` ...
  `/tmp/navaid-altitude-signs/sign-sheet-14.jpg`
- Yellow sign labels: `/tmp/navaid-altitude-signs/labels.txt`

These paths are not expected to exist forever; they document the reproducible
shape of the review output.

## Process

1. Download the current north/south PDFs and render them at high resolution.
2. Use `docs/data/cvfr-route-graph.json` nodes and `docs/data/airfields.json` as the only
   point source. Candidate edge endpoints are point ids, not copied coordinates.
3. Detect likely green CVFR route segments by sampling the chart between known
   endpoints. Store `detection.greenScore`, `detection.maxGap`, and
   `detection.samples` for triage only.
4. Crop each candidate segment with a blue `from -> to` line overlaid.
5. Detect yellow altitude signs near the crop and score them by arrow direction
   against the segment line.
6. Generate full segment review sheets and enlarged yellow-sign sheets.
7. Manually assign each altitude pair from same-route yellow arrows, using the
   rules below.
8. Keep `status: "candidate"` unless the value has maintainer-provided evidence
   or a second independent manual review. `DESHE-ZALMN` is currently the only
   `reviewed` row because it came from a maintainer screenshot.

## Review Rules

- In dense terminal areas, prefer the continuous green route and printed route
  number over nearest-pixel distance to a yellow sign.
- For very short connectors, use a sign just before or after the endpoint only
  when it is clearly on the same continuous green route.
- Do not reject equal inbound/outbound altitudes by default. Some CVFR route
  markers publish the same altitude both ways, especially the double-ended
  yellow tags; keep equal values when the same-route crop or an independent
  airway table supports them.
- Do not invent a reverse altitude for one-way paths. Encode the blocked
  direction as `null` and set `oneWay: true`.
- Ignore labels from crossing blue, magenta, airport, or nearby green branches
  even when they are closer to the review line.
- Treat OCR as a hint, not proof. Full-crop review corrected bad early OCR on
  `AFFEK-LLHA` from `3000/4500` to `2000/1500`.
- Keep route endpoints stable; if a point moves in `cvfr-route-graph.json` or
  `airfields.json`, rerun green-route detection rather than patching
  coordinates into the altitude file.

## Known Tricky Areas

- Haifa / LLHA: `AFFEK-LLHA`, `KRYON-LLHA`, and nearby labels overlap. Use
  route continuity.
- Herzliya coast: `ARENA-HTZUK`, `HTZUK-KNTRY`, `IKKEA-LLRS`, and
  `LLBG-PARDS` have short connectors where neighboring signs are easy to steal.
- Beer Sheba: `KUVSH-LLBS`, `KUVSH-NCITY`, `NCITY-OMMER`, and `NCITY-ZGOAL`
  have many overlapping arrows and waypoint labels.
- Coastal strip: `OLGAH`, `PELEG`, `SDTYM`, and `VINGT` use a mix of
  `500`, `800`, and `1500`; inspect the full continuous route before assigning.
- Arad / Metzada: `ARRAD-LLMZ` and `ARRAD-TARAD` share visual space with
  vertical branches near `MOR` / `LLMZ`.

See `scripts/cvfr-altitude-extraction-notes.json` for the per-segment review
ledger and evidence notes.
