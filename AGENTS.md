# AGENTS.md

NavAid is a static web app deployed via GitHub Pages from a workflow.
This branch and the production branch hold only the web app — no
Unity.

## Layout

- `docs/` — the deployed app (HTML / CSS / JS, no build step).
- `docs/nav-waypoints.json` — 173 Israeli VFR reporting points
 (`{name, he, lat, lng}`); shipped, lazily fetched by the "Show Nav
 Waypoints" toggle. Sourced from the published IAA CVFR chart waypoint
 reference table (page 113, 2025 edition) — see SKILL.md for refresh
 procedure.
- `.github/workflows/deploy.yml` — Pages build + deploy.
- `.claude/skills/navaid-dev/SKILL.md` — full developer guide.
  **Read this first** for any change to the app.

## Branches

- `main` — production (https://msupino.github.io/NavigationApp/).
- `dev` — staging (https://msupino.github.io/NavigationApp/staging/).
- Any open PR → auto-deployed to
  https://msupino.github.io/NavigationApp/pr/NNN/ and
  https://msupino.github.io/NavigationApp/branch/BRANCH_NAME/
- `original-plotter` — frozen Unity 2019 reference (renamed from
  `master`). Don't commit web changes here.
- `export-leg-attributes` — old draft PR branch.

Each push to `main` or `dev` re-runs the workflow, which checks out
both branches and assembles a single Pages site:
`main/docs/` → root, `dev/docs/` → `/staging/`.

## Working rules for AI agents

- Treat `.claude/skills/navaid-dev/SKILL.md` as the source of truth
  for architecture, state shape, persistence keys, and deploy
  mechanics.
- **Cache-bust is automatic at deploy time.** All `?v=N` values in
  `docs/index.html` must remain equal (CI lint enforces). The deploy
  workflow rewrites them to the short commit SHA at upload time, so
  the source value itself doesn't need to be bumped per commit — it's
  just a placeholder kept consistent across `app.js` / `style.css` /
  `strings.js` references.
- **Toolbar version SHA suffix is automatic at deploy time.** The
  same Deploy step rewrites `NavAid.version` in `docs/core.js` from
  `'1.0'` to `'1.0-<short-sha>'`, so the toolbar identifies the exact
  deployed commit without manually increasing the source version number.
- **Before `git commit`, verify the current branch** (`git branch
  --show-current`, and `git status` if needed). If it is not the branch
  the user intended for this work, or you are unsure, **ask the user**
  which branch to use before committing (other agents may be using a
  different branch). Do not commit on `main`, `dev`, or unrelated work
  by mistake.
- **Always run `node --check` on every changed `.js` file** before
  committing (the app code lives in `docs/core.js`, `docs/draw.js`,
  `docs/interact.js`, `docs/io.js`, `docs/ui.js`, `docs/sw.js`, and
  the locale bundles `docs/en/strings.js` / `docs/he/strings.js`).
- **Every enhancement, bug fix, or regression must include tests.** Add new
  test cases to the appropriate `tests/*.spec.js` file. If no file covers
  the area, create one.
- **Keep `tests/README.md` in sync** when adding tests that don't run in
  e2e-deployed, or when changing the exclusion pattern in `deploy.yml`.
- If a push to `dev` / `main` doesn't trigger `Deploy` / `CI` within
  ~30 s (admin bypass can swallow the event), dispatch manually:
  `gh workflow run Deploy --ref dev` or `gh workflow run CI --ref dev`.
  See `.claude/skills/navaid-dev/SKILL.md` "CI / Deploy gotchas" for
  details.
- Default deploy target during development is `dev` (staging). Only
  push to `main` when the change is reviewed and ready for
  production.
- **Never push directly to `main`.** Every change must go through a
  feature branch and pull request targeting `dev` — even one-line fixes.
- **Every PR must be preceded by a GitHub issue.** Open the issue first,
  then create the PR referencing it (`Fixes #N` or `Closes #N`).
- Persist UI state to `localStorage` only via existing `navaid.*`
  keys. The authoritative list lives in
  `.claude/skills/navaid-dev/SKILL.md` (see the **Persistence**
  section); grep `localStorage.setItem` / `sessionStorage.setItem`
  in `docs/` to verify. Add new keys only with a clear reason.
  Notable keys (see SKILL.md for the full list):
  - `navaid.route` — route geometry (waypoints / legs / notes).
  - `navaid.view` — map center / zoom / bearing, persisted across
    reloads. `F` (no modifier) re-runs fit-to-route; the `⌖ Fit to
    screen` toolbar button does the same. `+`/`=`/numpad `+` and
    `−`/numpad `−` zoom the map (or loupe zoom when the magnifier is on);
    `M` toggles the magnifying glass. All are listed in the `?` cheat-sheet
    (`SHORTCUTS_HELP_ROWS` in `docs/io.js`).
- **Keyboard shortcuts must be discoverable.** Every global keyboard
  shortcut in `docs/` is listed in the `?` cheat-sheet modal
  (`SHORTCUTS_HELP_ROWS` in `docs/io.js`). When you add a new global
  shortcut, append a row to that array and add the matching
  `S.shortcutXxx` strings in `docs/core.js` (English defaults) +
  `docs/he/strings.js` (Hebrew). See SKILL.md "Keyboard shortcuts
  cheat-sheet" for the rendering pipeline.
- No external dependencies beyond Leaflet + `leaflet-rotate@0.2.8`
  (both loaded from `unpkg.com`) and `images.weserv.nl` (used as a
  CORS proxy by `exportPNG`). No build step, no bundler, no
  transpiler — keep it plain HTML / CSS / JS.
- Don't reintroduce Unity files. They live on `original-plotter`.

## Live + repo

- App (production): https://msupino.github.io/NavigationApp/
- App (staging):    https://msupino.github.io/NavigationApp/staging/
- Repo: https://github.com/msupino/NavigationApp
