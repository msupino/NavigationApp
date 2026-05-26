# AGENTS.md

NavAid is a static web app deployed via GitHub Pages from a workflow.
This branch and the production branch hold only the web app — no
Unity.

## Layout

- `docs/` — the deployed app (HTML / CSS / JS, no build step).
- `docs/nav-waypoints.json` — 238 Israeli VFR reporting points
  (`{name, lat, lng}`); shipped, lazily fetched by the "Show Nav
  Waypoints" toggle.
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
- **Always run `node --check docs/app.js`** before committing.
- **Every enhancement, bug fix, or regression must include tests.** Add new
  test cases to the appropriate `tests/*.spec.js` file. If no file covers
  the area, create one.
- If a push to `dev` / `main` doesn't trigger `Deploy` / `CI` within
  ~30 s (admin bypass can swallow the event), dispatch manually:
  `gh workflow run Deploy --ref dev` or `gh workflow run CI --ref dev`.
  See `.claude/skills/navaid-dev/SKILL.md` "CI / Deploy gotchas" for
  details.
- Default deploy target during development is `dev` (staging). Only
  push to `main` when the change is reviewed and ready for
  production.
- **Never push directly to `main`.** Every change must go through a
  feature branch and pull request — even one-line fixes.
- Persist UI state to `localStorage` only via existing `navaid.*`
  keys (`navaid.route`, `navaid.layer`, `navaid.toolbarPos`,
  `navaid.yellowAlpha`, `navaid.wpSize`, `navaid.magVar`,
  `navaid.showNavWP`). Add new keys only with a clear reason.
- No external dependencies beyond Leaflet (CDN) and
  `images.weserv.nl` (used as a CORS proxy by `exportPNG`). No
  build step, no bundler, no transpiler — keep it plain HTML / CSS
  / JS.
- Don't reintroduce Unity files. They live on `original-plotter`.

## Live + repo

- App (production): https://msupino.github.io/NavigationApp/
- App (staging):    https://msupino.github.io/NavigationApp/staging/
- Repo: https://github.com/msupino/NavigationApp
