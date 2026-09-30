# Change Checklists

Use these as quick pre-commit reminders.

## Any Change

- Read `AGENTS.md`.
- Confirm the branch is a feature branch based on current `dev`.
- Keep unrelated local/untracked files out of the commit.
- Run `git diff --check`.
- Update docs if behavior, storage, workflow, or test expectations change.

## JavaScript Change

- Run `node --check` on each changed `.js`.
- Add or update focused Playwright tests.
- If adding storage, document the `navaid.*` key.
- If adding a shortcut, update the cheat sheet and both locales.
- If touching strings, update English defaults and Hebrew overrides.

## UI / Layout Change

- Verify `?lang=en` and `?lang=he`.
- Check desktop and a narrow/mobile viewport.
- Look for clipped labels, overlapping controls, and bidi reorder.
- Add/update `tests/bidi-regression.spec.js` for mixed-direction text.
- Prefer existing row builders and modal patterns.
- Check light and dark theme too (`navaid.theme`), not only LTR/RTL.
- No `alert()` / `confirm()` / `prompt()`: they are silent in the APK WebView. Use
  `askYesNo` / `askRouteOverwrite` or a toast.
- Map symbols: change the shared painter (`drawAirfieldSymbol`, `drawReportingPointSymbol`,
  `drawVorSymbol`, `OWN_SHIP_PATH`); the legend swatches repaint from it.
- In-flight map buttons: icons come from `MAP_ICONS` via `setMapIcon`, never emoji.

## Mobile / APK Change

- `versionName` "1.N" must match `versionCode` N (`validate-capacitor.mjs`).
- Never change the Android `server.hostname` (`navaid.supino.org`): another origin hides every
  saved route.
- Web-only changes reach installed apps over the air on the next deploy; a new APK is needed
  only for native changes or the built-in chart.

## Docs

- Update the GitHub wiki (EN and HE pages) for user-visible changes.
- Screenshots: run the **Update wiki screenshots** workflow
  (`gh workflow run wiki-screenshots.yml --ref main`) after the change reaches main; it also
  runs nightly.

## Data Change

- Validate JSON.
- Run focused dataset tests.
- Update source-of-truth notes in `.ai/data.md` or `.ai/navaid-dev.md` if the source
  changed.
- Keep route templates free of leg altitude values that belong on the
  matching edge in the active `<prefix>-route-graph.json`.

## Branch / PR

- Create a GitHub issue first.
- Verify active GitHub user is `msupino` before push.
- Commit on the intended feature branch.
- Push the branch.
- Open a draft PR to `dev`.
- Restore the previously active local GitHub user after push/PR work.
