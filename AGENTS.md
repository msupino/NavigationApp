# AGENTS.md

This branch (`html5-app`) is a static web app deployed via GitHub Pages.
There is no Unity here — that lives on `master` and `clean`.

## Layout

- `docs/` — the deployed app (HTML / CSS / JS, no build step).
- `.claude/skills/plotter-dev/SKILL.md` — full developer guide for the
  plotter. **Read this first** for any change to the app.

## Working rules for AI agents

- Treat `.claude/skills/plotter-dev/SKILL.md` as the source of truth for
  architecture, state shape, persistence keys, and deploy mechanics.
- **Always bump `?v=N` in `docs/index.html`** (both the `app.js` and
  `style.css` query strings) on any change to those files. Stale-cache
  bugs are the most common Pages footgun.
- This branch must stay free of Unity files. They were intentionally
  stripped (commit `53188cc`); the Unity tree lives on `master` and
  `clean`. Don't reintroduce it here.
- Persist UI state to `localStorage` only via existing `plotter.*` keys
  (`plotter.route`, `plotter.layer`, `plotter.toolbarPos`,
  `plotter.yellowAlpha`); add new keys only with a clear reason.
- No external dependencies beyond Leaflet (CDN). No build step, no
  bundler, no transpiler — keep it plain HTML / CSS / JS.
- Deploy = `git push origin html5-app`. Pages serves from `/docs`.

## Live + repo

- App: https://msupino.github.io/NavigationApp/
- Repo: https://github.com/msupino/NavigationApp
