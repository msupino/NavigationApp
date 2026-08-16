# Workflow For AI Agents

## Branching

Default base branch is `dev`.

Before creating a feature branch:

```bash
git fetch origin --prune
git checkout dev
git branch --set-upstream-to=origin/dev dev
git pull --ff-only origin dev
```

Before each production promotion, automation uses the open `dev` → `main`
PR's Update branch operation to bring the previous promotion merge commit
back into `dev`; no separate sync PR is needed. If `origin/main`
contains production-only file changes, stop and use a reviewed maintenance PR;
never push directly to `dev` or `main` as routine recovery.

Create feature branches with the `codex/` prefix unless the user requested a
specific branch:

```bash
git checkout -b codex/short-task-name
```

## Issues And PRs

Every PR must have a matching GitHub issue.

1. Create the issue first.
2. Implement and test.
3. Commit on the feature branch.
4. Push the feature branch.
5. Open a draft PR targeting `dev`.

PR body should include:

- `Fixes #N` or `Closes #N`.
- Summary bullets.
- Tests run.
- PR verification is attached to Actions as a built artifact and exercised by
  the artifact E2E job; it is not published as an executable web preview.

## Commit Safety

Before every commit:

```bash
git branch --show-current
git status --short --branch
```

Stop and ask if the branch is `main`, `dev`, or not clearly the intended
feature branch.

Stage only intended files. Untracked local helper directories may exist in this
workspace; do not stage them unless the task explicitly asks for them.

## GitHub User Safety

Before pushing:

```bash
gh api user --jq .login
```

The active user must be `msupino`. If not:

```bash
gh auth switch -h github.com -u msupino
```

After push/PR creation, restore the previously active local account:

```bash
gh auth switch -h github.com -u <previous-user>
```

## Local Verification

Docs-only changes usually need no app test run, but still inspect diffs.

For JavaScript changes:

```bash
node --check docs/app/<file>.js
node --check docs/i18n/he/strings.js
npm test
```

For targeted UI changes:

```bash
python3 -m http.server -d docs 8000 --bind 127.0.0.1
BASE_URL=http://127.0.0.1:8000 npx playwright test tests/<suite>.spec.js
```

Stop any local server you start before finishing.

## Deploy And Checks

CI runs on PR branches and on pushes to `dev` / `main`.

Deploy builds on trusted `main`/`dev` pushes:

- `main/docs/` to production root.
- `dev/docs/` to `/staging/`.
- Pull requests assemble `/pr/NNN/` only inside the CI artifact, serve it from
  localhost for E2E, and do not invoke the Pages deploy job.

If an explicitly authorized maintainer push or merged PR does not create
CI/Deploy runs within about 30 seconds, dispatch manually:

```bash
gh workflow run CI --ref dev
gh workflow run Deploy --ref dev
```

Ordinary changes always use an issue and feature-branch PR targeting `dev`.
Direct protected-branch pushes require explicit maintainer authorization.

After a change merges into `dev`, `Auto PR dev to main` opens or reuses the
direct promotion PR. It invokes that PR's Update branch operation when the
previous promotion left a merge commit only on `main`, then waits for `dev` to
advance. It explicitly dispatches CI, Deploy, Review, and the auto-merge
watcher against the aligned `dev` SHA. No preliminary `main` to `dev` sync PR
or first-time-contributor approval is needed.

## Squash Policy

Changes entering `dev` should still prefer squash merges for readable history.
The CI history job reports merge commits on `dev` as warnings instead of
failing, so production promotion is not blocked when GitHub lands a PR with a
merge commit.
