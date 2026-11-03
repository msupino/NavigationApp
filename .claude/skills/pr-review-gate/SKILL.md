---
name: pr-review-gate
description: Every NavAid PR passes a code review of its CURRENT head before it is marked ready, merged, promoted to main, or reported as done -- and again after every later push. Use whenever you open a PR, push to one, are about to run `gh pr ready` / `gh pr merge` / the merge-chain script, or the user asks to merge, "get it to dev/main", or "is it done".
---

# PR review gate (NavigationApp)

The rule: **no PR moves toward merge without a clean code review of the exact commit that would
merge.** A review of an earlier head does not count: any push after it (a fix, a CodeQL fix, a
test tweak, a wiki patch) needs the review to be passed again.

New PRs open as drafts, and `.github/workflows/draft-auto-merge.yml` arms auto-merge the moment
one is marked ready. So **"ready" is the gate**: never run `gh pr ready` (or the merge script,
which readies PRs itself) until the review below is clean for the current head.

## 1. Review the whole PR, at its head

```bash
cd ~/NavigationApp
N=<pr>; HEAD=$(gh pr view $N --json headRefOid -q .headRefOid)
BASE=$(gh pr view $N --json baseRefName -q .baseRefName)
git fetch -q origin "$BASE" && git diff "origin/$BASE...$HEAD" > /tmp/pr-$N.diff
```

Read the full diff, not only the last commit. For each change, check:

- **Correctness:** state that can go stale (counts and toggles refreshed on every path that
  changes their data: boot, re-poll, slider, gist), async ordering, cancel/abort paths that leave
  something switched on, an id or class another file selects.
- **Project rules** (see the memory index): dim, never hide; EN + HE strings in parity
  (`docs/app/core.js` `S` and `docs/i18n/he/strings.js`, using the app's own labels); no
  hard-coded draw values (tunables); `navaid.*` keys synced or declared device-local; tests
  never load third parties; selected state in the toolbar's blue; no competitor names in any repo
  artifact.
- **Security:** HTML built from data (use `textContent`), URLs built from gist or feed text,
  unanchored URL regexes (CodeQL flags them).
- **Tests:** each behaviour has a spec, and the spec fails on the old code (check by copying the
  old file with `git show origin/<base>:<path>`, never by stashing).
- **Wiki:** a behaviour the wiki describes has a patch under `wiki-patches/` (wiki-update skill).

Use the `code-review-skill` (user skill) checklists for the language at hand.

## 2. Fix, then review again

Fix every finding **in the same PR**. Each fix is a new head, so go back to step 1 for the new
diff. Repeat until a pass finds nothing.

## 3. Record it on the PR

When a pass is clean, leave the marker as a PR comment, with the full head SHA:

```bash
gh pr comment $N --body "Code review: clean at $HEAD"
```

Only then mark the PR ready or start the merge chain. Before readying, verify that the marker
names the current head:

```bash
H=$(gh pr view $N --json headRefOid -q .headRefOid)
gh pr view $N --json comments -q '.comments[].body' | grep -Fxq "Code review: clean at $H" \
  || echo "not reviewed at $H -- review again"
```

## UI changes

A PR that changes what a pilot sees or touches also needs the `uiux-review-gate` skill's marker,
`UI review: passed at <sha>`, on the same head. Both markers must be there before it is readied.

## Notes

- A DONT MERGE title still gets reviewed after pushes, so the PR is mergeable when the user lifts it.
- dev → main promotion PRs ("Dev to main") carry only already-reviewed PRs; no extra review
  is needed unless something was committed straight to dev.
- In the report to the user, say the PR passed review at which commit, or what the review found and
  fixed.
