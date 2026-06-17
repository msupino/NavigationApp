# UI Patterns

NavAid is a dense operational tool. Prefer compact, predictable controls over
marketing-style layouts.

## Toolbar

- Toolbar sections are accordions.
- Only one chart/modal-style panel should be open when the UI already follows
  that pattern.
- Hebrew layout moves the menu to the right; verify both `?lang=en` and
  `?lang=he` after layout changes.
- Global shortcuts must be discoverable in the `?` cheat sheet.

## Inspector

Keep inspectors consistent across equivalent object types:

- Route waypoint on a known nav point and standalone nav waypoint should show
  the same code/localized-name identity.
- Airfield selected as an airfield and airfield selected as a route waypoint
  should show the same frequency/weather/satellite ordering.
- Satellite snippets belong below frequency/weather details for airfields.
- Standalone inspector VOR selector is local to the inspector and should reset
  to the global VOR reference when closed.

When adding a row, use the existing row builders (`textRow`, `numberRow`,
`inputRow`, `selectRow`) unless the layout truly needs custom markup.

## Charts

Charts are modal tools, not route inspectors.

Current chart-style tools include:

- BYOP airport charts
- frequency table
- altitude pairs table
- route templates

Patterns:

- Search inputs filter rows without resetting edits.
- Editable rows should show override/default state clearly.
- Undo/revert actions should exist per edited value when values are
  directional.
- Global reset is useful, but it should not replace per-direction reset.
- In Hebrew, direction labels must make `from -> to` and `to -> from` clear.

## Route And Leg UI

Route leg markers are called kites in code/comments. They store offsets in
leg-relative coordinates.

Rules:

- Keep dragged kites inside their leg when `limitLegKites` is enabled.
- Mouse drag must clamp the stored offset, not only the rendered position.
- If a leg is split, copy operational metadata to both halves and reset label
  offsets to defaults.
- Do not infer new CVFR waypoint names from split-leg clicks; blank/user route
  waypoints use sequence names like `WP #`.

## Satellite Preview

The inspector preview is a static tile snippet. Expanded satellite view is a
Leaflet modal map with zoom, layer picker, reset-to-center, and rotation sync.
All base layers remain selectable, but chart layers use a tighter readable
zoom range in this modal. Switching from high-zoom satellite imagery to CVFR /
Navigation / Low Alt / Helicopters snaps back near the chart's native tile
zoom instead of overscaling into blur.

Title rules:

- Put identity before coordinates.
- Keep code/name pieces isolated for bidi.
- Use the same title helper for route waypoint, standalone nav waypoint, and
  airfield flows where they represent the same point.

## VOR Readouts

The global VOR reference drives radial/DME readouts. The "Show VOR stations"
toggle controls map markers only.

Inspector-local VOR selection:

- Should display short three-letter identifiers.
- Should not overwrite the global VOR reference.
- Should reset to the global reference when the inspector closes.

## RTL / LTR Guardrails

Regression-prone text:

- inspector titles with code + Hebrew name + coordinates
- altitude-pair direction columns
- VOR radial/DME readouts
- flight-plan from/to names
- frequencies and MHz labels
- map coordinate readouts

Use `tests/bidi-regression.spec.js` for lasting coverage.
