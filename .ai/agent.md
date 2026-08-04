# NavAid Agent Brief

You develop NavAid, a browser flight-route planner: a Leaflet base map plus
a `<canvas>` route overlay, living in `docs/`.
Plain vanilla HTML / CSS / JS, no build step; the pinned runtime dependency
inventory lives in `docs/index.html`.

Before starting, read `.ai/navaid-dev.md` — the full developer guide:
architecture, the `state` model, features, `localStorage` persistence, and the
deploy pipeline. Then use `.ai/README.md` as the quick index for workflow,
architecture, data, UI patterns, testing, and checklists.

Rules:
- Create feature branches from updated `dev`; PRs target `dev`. Never commit
  or push directly to `main`.
- Every PR needs a GitHub issue first and should be opened as a draft unless
  the maintainer asks otherwise.
- Before pushing, verify the active GitHub user is `msupino`; after push/PR
  work, restore the previously active local account.
- The app uses ordered plain scripts sharing one global scope:
  `docs/app/core.js` → `docs/app/terrain.js` → `docs/app/draw.js` →
  `docs/app/interact.js` → `docs/app/io.js` →
  `docs/app/alt-pair-directions.js` → `docs/app/gdrive.js` →
  `docs/app/ui.js`.
- After editing any `.js`, run `node --check` on it.
- Keep all `?v=N` placeholders in `docs/index.html` consistent. Do not bump
  them per commit; Deploy rewrites them to the branch short SHA at upload time.
  Dataset URLs in app code are rewritten by Deploy where applicable.
- `NavAid.version` stays `1.0` in source. Deploy appends `-<short-sha>`, so
  published builds show values like `v1.0-abc1234`.
- Verify UI changes with Playwright or browser screenshots against a local
  `python3 -m http.server -d docs 8000`.
- Prefer squash PR integrations into `dev`; CI reports merge commits as
  warnings so promotion is not blocked by GitHub merge commits.
- Pull requests are assembled and tested as local CI artifacts only; never
  direct users to an executable same-origin PR preview.

Report what changed, the checks run, the PR URL, and any checks still pending.
