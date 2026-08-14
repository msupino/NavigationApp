# AGENTS.md

NavAid is a static web app deployed via GitHub Pages from a workflow.

## Layout

- `docs/` — the deployed app, with browser-root files at the top level
 and source/data grouped below (`app/`, `data/`, `i18n/`, `assets/`,
 `legacy/`; `byop/` remains a stable public chart-PDF URL).
- `mobile/` — Capacitor workspace for native iOS / Android packaging.
  Its tiny `shell/` web payload opens `https://navaid.supino.org` through
  Capacitor (`webDir: "shell"`); native tooling stays out of the static app.
- `the nav-waypoints projection of docs/data/cvfr-route-graph.json` — 172 Israeli CVFR reporting points
 (`{name, en, he, lat, lng, report}`); shipped, lazily fetched by the "Show/pin
 navigation waypoints" toggle. Sourced from the published IAA CVFR chart waypoint
 reference table (page 113, 2025 edition) — see `.ai/navaid-dev.md` for refresh
 procedure.
- `.github/workflows/deploy.yml` — Pages build + deploy.
- `.ai/` — repo-tracked AI handbook: workflow, architecture, data,
  UI patterns, testing, and checklists.
- `.ai/navaid-dev.md` — full developer guide.
  **Read this first** for any change to the app.

## Branches

- `main` — production (https://navaid.supino.org/).
- `dev` — staging (https://navaid.supino.org/staging/).
- Pull requests are assembled and tested as local CI artifacts only. Unreviewed
  PR JavaScript is never published under the production origin.
- `export-leg-attributes` — old draft PR branch.

Each push to `main` or `dev` re-runs the workflow, which checks out
both branches and assembles a single Pages site:
`main/docs/` → root, `dev/docs/` → `/staging/`.

## Working rules for AI agents

- Treat `.ai/navaid-dev.md` as the source of truth
  for architecture, state shape, persistence keys, and deploy
  mechanics.
- Use `.ai/README.md` as the quick index for AI-specific workflow,
  architecture, data, UI, testing, and checklist docs. Keep `.ai/`
  updated when behavior, storage, workflow, or test expectations change.
- **Cache-bust is automatic at deploy time. Do NOT bump it.** Every `?v=` in
  `docs/index.html` is the literal placeholder `?v=src` and must stay that way
  (CI lint enforces that they all agree; `tests/workflow-hardening.spec.js`
  enforces the placeholder itself). The deploy workflow rewrites them to the
  short commit SHA at upload time, along with `NavAid.version` and the
  service-worker cache name, so the real cache-bust is per commit and automatic.
  Bumping a number here buys nothing and makes every pull request conflict with
  every other one on this single line — each merge then invalidating the rest.
- **Toolbar version SHA suffix is automatic at deploy time.** The
  same Deploy step rewrites `NavAid.version` in `docs/app/core.js` from
  `'1.0'` to `'1.0-<short-sha>'`, so the toolbar identifies the exact
  deployed commit without manually increasing the source version number.
- **Before creating a feature branch from `dev`, bring production back
  into `dev` first when possible.** Fetch `origin`, check out `dev`,
  fast-forward it to `origin/dev`, integrate `origin/main` when it can
  be done cleanly, then branch from the updated `dev` tip. If histories
  diverge but the trees are identical after promotion, branch from `dev`;
  otherwise use a reviewed maintenance PR. Never directly push protected
  branches as routine recovery.
- **Before `git commit`, verify the current branch** (`git branch
  --show-current`, and `git status` if needed). If it is not the branch
  the user intended for this work, or you are unsure, **ask the user**
  which branch to use before committing (other agents may be using a
  different branch). Do not commit on `main`, `dev`, or unrelated work
  by mistake.
- **Always run `node --check` on every changed `.js` file** before
  committing. App code is every `docs/app/*.js`, plus `docs/sw.js` and
  `docs/i18n/**/*.js`; CI enumerates these paths mechanically.
- **Every enhancement, bug fix, or regression must include tests.** Add new
  test cases to the appropriate `tests/*.spec.js` file. If no file covers
  the area, create one.
- **Keep `tests/README.md` in sync** when adding tests that don't run in
  e2e-deployed, or when changing the exclusion pattern in `deploy.yml`.
- If a push to `dev` / `main` doesn't trigger `Deploy` / `CI` within
  ~30 s (admin bypass can swallow the event), dispatch manually:
  `gh workflow run Deploy --ref dev` or `gh workflow run CI --ref dev`.
  See `.ai/navaid-dev.md` "CI / Deploy gotchas" for
  details.
- Default deploy target during development is `dev` (staging). Only
  push to `main` when the change is reviewed and ready for
  production.
- **Never push directly to `main`.** Every change must go through a
  feature branch and pull request targeting `dev` — even one-line fixes.
- **Every PR must be preceded by a GitHub issue.** Open the issue first,
  then create the PR referencing it (`Fixes #N` or `Closes #N`).
- Persist UI state to `localStorage` only via existing `navaid.*`
  keys. The mechanically enforced registry/policy lives in
  `tests/settings-sync-allowlist.spec.js`; `.ai/navaid-dev.md` summarizes
  the key families. Grep storage calls in `docs/` and update both the sync
  allowlist or device-local reason and the docs when adding a key.
  Notable keys:
  - `navaid.route` — route geometry (waypoints / legs / notes).
  - `navaid.view` — map center / zoom / bearing, persisted across
    reloads. `F` (no modifier) and the `⌖ Fit to screen` toolbar button fit
    the selected A3/A4 page frame, or fit the route when no page is selected.
    `+`/`=`/numpad `+` and
    `−`/numpad `−` zoom the map (or loupe zoom when the magnifier is on);
    `M` toggles the magnifying glass. All are listed in the `?` cheat-sheet
    (`SHORTCUTS_HELP_ROWS` in `docs/app/io.js`).
- **Keyboard shortcuts must be discoverable.** Every global keyboard
  shortcut in `docs/` is listed in the `?` cheat-sheet modal
  (`SHORTCUTS_HELP_ROWS` in `docs/app/io.js`). When you add a new global
  shortcut, append a row to that array and add the matching
  `S.shortcutXxx` strings in `docs/app/core.js` (English defaults) +
  `docs/i18n/he/strings.js` (Hebrew). See `.ai/navaid-dev.md` "Keyboard shortcuts
  cheat-sheet" for the rendering pipeline.
- No new web-app JavaScript dependencies without explicit review. The live
  inventory in `docs/index.html` is Leaflet, `leaflet-rotate@0.2.8`,
  `leaflet-imageoverlay-rotated@0.2.1`, and `leaflet-velocity@1.7.0`.
  Chart tiles are served from
  `https://navaid-tiles.supino.org`. No build step, no bundler, no
  transpiler — keep `docs/` plain HTML / CSS / JS. Capacitor dependencies
  live only under `mobile/`.

## Live + repo

- App (production): https://navaid.supino.org/
- App (staging):    https://navaid.supino.org/staging/
- Repo: https://github.com/msupino/NavigationApp
