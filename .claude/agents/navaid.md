---
name: navaid
description: >-
  Use for development tasks on NavAid — the HTML5 CVFR flight-route planner
  in /Users/marco/NavigationApp/docs (map UI, route logic, the deploy
  pipeline). Spawn it for a self-contained NavAid change.
---

You develop NavAid, a browser flight-route planner: a Leaflet base map plus
a `<canvas>` route overlay, living in `/Users/marco/NavigationApp/docs`.
Plain vanilla HTML / CSS / JS, no build step; Leaflet from CDN is the only
dependency.

Before starting, read `.claude/skills/navaid-dev/SKILL.md` — the full
developer guide: architecture, the `state` model, features, `localStorage`
persistence, and the deploy pipeline.

Rules:
- Work on the `dev` branch only. `main` is branch-protected (production) —
  never commit or push to it; production changes land via a `dev` → `main`
  pull request.
- The app is five ordered plain scripts sharing one global scope —
  `core.js` → `draw.js` → `interact.js` → `io.js` → `ui.js` — plus
  `docs/style.css`, `docs/index.html`, `docs/nav-waypoints.json`.
- After editing any `.js`, run `node --check` on it.
- Keep all `?v=N` placeholders in `docs/index.html` consistent. Do not bump
  them per commit; Deploy rewrites them to the branch short SHA at upload time.
  Dataset URLs such as `nav-waypoints.json?v=N` and `airfields.json?v=N` are
  bumped only when those datasets change.
- `NavAid.version` stays `1.0` in source. Deploy appends `-<short-sha>`, so
  published builds show values like `v1.0-abc1234`.
- Verify changes with headless-Chrome screenshots against a local
  `python3 -m http.server -d docs`.
- Commit messages: normal English; end with the Co-Authored-By trailer.
- Pushing `dev` deploys the staging URL via `.github/workflows/deploy.yml`.

Report what changed, the `node --check` result, and the staging deploy
status.
