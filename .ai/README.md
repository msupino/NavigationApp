# NavAid AI Handbook

This directory is the repo-tracked handbook for AI agents working on NavAid. It
gives every agent the same map of where to look, how to branch, what to test,
and which local conventions matter.

## Start Here

1. Read `AGENTS.md` at the repository root.
2. Read `.ai/navaid-dev.md` when touching app behavior.
3. Use this `.ai/` handbook for fast task orientation:
   - `.ai/agent.md` - compact agent brief.
   - `.ai/navaid-dev.md` - full developer guide.
   - `.ai/workflow.md` - branches, issues, commits, pushes, PRs, deploys.
   - `.ai/architecture.md` - app layout, globals, state, render pipeline.
   - `.ai/data.md` - shipped JSON datasets, sources of truth, update rules.
   - `.ai/ui-patterns.md` - inspector, charts, RTL/LTR, modals, map gestures.
   - `.ai/testing.md` - local checks, Playwright suites, CI/e2e behavior.
   - `.ai/checklists.md` - change-specific checklists before commit/PR.

## Project Snapshot

NavAid is a static browser app for Israeli CVFR route planning. It is plain
HTML, CSS, and JavaScript on Leaflet. There is no bundler, no transpiler, and no
runtime server beyond static file hosting.

Important paths:

- `docs/index.html` - web root HTML and ordered script tags.
- `docs/app/` - app JavaScript and CSS.
- `docs/data/` - shipped JSON aviation datasets.
- `docs/i18n/` - locale string bundles.
- `docs/byop/` - stable public chart/plate PDF URL space.
- `tests/` - Playwright and dataset regression coverage.
- `.github/workflows/` - CI, deploy, review, data refresh, and PR automation.

## Non-Negotiables

- Create feature branches from updated `dev`; PRs target `dev`.
- Never push directly to `main`.
- Every PR needs a GitHub issue first and should reference it with
  `Fixes #N` or `Closes #N`.
- Keep `dev` linear. Do not push non-trivial merge commits to `dev`.
- Before committing, verify the current branch with `git branch --show-current`
  and `git status --short --branch`.
- Run `node --check` on every changed JavaScript file.
- User-visible behavior changes need tests in `tests/*.spec.js`.
- Keep all `?v=` placeholders in `docs/index.html` identical; deploy rewrites
  them to the short SHA.
- Source `NavAid.version` remains `1.0`; deploy appends the short SHA.
- Use existing `navaid.*` storage keys unless a new key is explicitly needed and
  documented.

## Local Maintainer Preferences

These preferences come from the active maintainer workflow for this repository:

- Before pushing, verify the active GitHub user is `msupino`.
- After pushing/PR work, restore the local active GitHub user to `msupinodn`.
- Open PRs as drafts by default.
- Push completed changes; do not leave finished work only local.

## Editing Style

- Keep app code plain JavaScript in the existing global-script style.
- Prefer small helpers that match nearby code over broad refactors.
- Keep UI text localized in `window.S` defaults plus `docs/i18n/he/strings.js`.
- Be careful with Hebrew/English mixed text. Use the existing bidi isolation
  helpers and regression tests when touching labels, inspector titles, charts,
  flight-plan rows, VOR readouts, or coordinates.
- Avoid changing data and UI behavior in the same commit unless the feature
  requires both.
