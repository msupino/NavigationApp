---
name: wiki-update
description: Update the NavAid GitHub wiki (English + Hebrew pages) for a change -- as a reviewed patch under wiki-patches/ that goes live when the code reaches main. Use whenever a feature, fix or setting changes what the wiki says, or the user asks to sweep / update / fix the wiki.
---

# Updating the NavAid wiki

The wiki (`msupino/NavigationApp.wiki.git`) is its own git repo with no pull requests. Edits are
reviewed like code: they travel as a `git format-patch` file under `wiki-patches/` in the PR of
the change they document, and `.github/workflows/wiki-patches.yml` ("Apply wiki patches")
applies them **when the code reaches main** -- the wiki describes the live app.

**Never push to the wiki repo directly.** A patch is reviewed, ordered and idempotent; a push is
none of those.

## 1. Find what changed and which pages say it

- The PRs since the last wiki edit: `gh pr list --base dev --state merged --search "merged:>=<date>"`;
  the last hand-written wiki commit: `git log` in the wiki clone, skipping the bots' changelog and
  screenshot commits.
- Read each PR's description (`gh pr view <n> --json body`) for what actually shipped, not the title.
- `grep -il` the wiki for the feature's words to find the pages that already cover it. Prefer a
  section in the page that owns the subject over a new page.

## 2. Clone and edit

```bash
S=<scratchpad>
git clone -q https://github.com/msupino/NavigationApp.wiki.git $S/wiki
```

Every page exists twice: `Page.md` (English) and `Page-he.md` (Hebrew). **Edit both, always.**

Hebrew pages:
- The whole page sits inside `<div dir="rtl">` ... `</div>` (blank lines after the opening tag and
  before the closing one). A page without it is laid out left to right and Latin runs scramble the
  sentence -- check new pages for it.
- Code, keys and file names: `<span dir="ltr"><code>navaid.aircraft</code></span>`, not bare
  backticks.
- Use the app's **own Hebrew labels** -- read them from `docs/i18n/he/strings.js` (and the English
  ones from `docs/app/core.js` `S`), never a fresh translation, so the page names what the pilot sees.
- Anchors to Hebrew headings are the heading with spaces as hyphens: `[...](Flight-Plan-he#קלטי-כלי-טיס)`.
- Link text should match the title of the page it opens.
- Don't "fix" a spelling (e.g. תכנית / תוכנית) the app's labels use; unify the app first.

`_Sidebar.md` has an English list and a Hebrew list: a new page goes in **both**, each linking its
own language (no Hebrew link inside the English list).

Edit with a script that pins each change to existing text and fails if it is not found exactly
once -- never a blind regex over the page.

## 3. Make the patch

Patches apply in file-name order, each on top of the wiki as the earlier ones leave it. Before
committing, apply any patches in `wiki-patches/` that the wiki does not carry yet, so yours stacks
on them:

```bash
cd $S/wiki
for p in <repo>/wiki-patches/*.patch; do
  subj=$(git mailinfo /dev/null /dev/null < "$p" | sed -n 's/^Subject: //p')
  git log --format=%s | grep -Fxq -- "$subj" && continue        # already on the wiki
  git -c user.name=Marco -c user.email=marco@supino.org am -q --3way "$p"
done
# your edits, then:
git -c user.name=Marco -c user.email=marco@supino.org commit -qam "<what the pages now say>"
git format-patch -1 HEAD --stdout > <repo>/wiki-patches/YYYY-MM-DD-<topic>.patch
```

- The commit **subject is the patch's identity**: the workflow treats a patch as applied once a
  wiki commit carries that subject. Make it specific, and don't reuse one.
- To revise a patch still in an open PR: edit in the same clone, `git commit --amend`, regenerate
  the file over the old one.
- Commit the patch file in the **same PR as the code** it documents.

## 4. When it goes live

- The PR merges into dev: nothing happens on the wiki (by design).
- dev reaches main: Draft + auto-merge dispatches "Apply wiki patches" on main after the merge (a
  bot merge starts no workflow by itself), and a human push to main triggers it directly.
- By hand, when needed: `gh workflow run wiki-patches.yml --ref main`.

The run logs one line per patch: `applied`, `already on the wiki`, or an `::error::` for a patch
that neither applies nor is applied (the wiki moved under it -- regenerate it from a fresh clone).
One bad patch does not stop the others being pushed.

## 5. Verify

Clone the wiki fresh and check the change is there (`grep` for a phrase from the patch), and that
the run said `applied` for it. Report what went live, in which pages, both languages.
