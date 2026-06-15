# Workflow For AI Agents

## Branching

Default base branch is `dev`.

Before creating a feature branch:

```bash
git fetch origin --prune
git checkout dev
git branch --set-upstream-to=origin/dev dev
git pull --ff-only origin dev
git merge-base --is-ancestor origin/main HEAD || git merge --ff-only origin/main
```

If `origin/main` cannot fast-forward into `dev`, stop and resolve the branch
relationship deliberately; do not create a merge commit and do not force-push
`dev` without explicit maintainer approval. If `dev` did fast-forward, push the
linear update to `origin/dev` before branching.

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
- Preview URL after PR number is known when useful:
  `https://msupino.github.io/NavigationApp/pr/NNN/`.

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

Deploy builds:

- `main/docs/` to production root.
- `dev/docs/` to `/staging/`.
- open PR branches to `/pr/NNN/` and `/branch/BRANCH_NAME/`.

If a direct `dev` or `main` push does not create CI/Deploy runs within about
30 seconds, dispatch manually:

```bash
gh workflow run CI --ref dev
gh workflow run Deploy --ref dev
```

Prefer PRs over direct `dev` pushes; PR events are more reliable and keep the
history reviewable.

## Squash Policy

Changes entering `dev` should be squash-merged or otherwise arrive as one
linear integration commit. CI rejects non-trivial merge commits on `dev`.
