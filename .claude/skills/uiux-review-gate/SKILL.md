---
name: uiux-review-gate
description: Every NavAid change that alters what a pilot sees or touches passes a UI/UX review of the PR's CURRENT head before it is marked ready or merged -- and again after any later UI push. Use whenever a PR touches docs/index.html, docs/app/style.css, docs/i18n/, UI strings in docs/app/core.js, or JS that builds or changes DOM (buttons, rows, panels, toasts, captions), and before `gh pr ready` / merge on such a PR.
---

# UI/UX review gate (NavigationApp)

This sits beside `pr-review-gate` (the code review) and does not replace it. A PR that changes the UI
needs **both** markers on its current head before it goes ready:

```
Code review: clean at <sha>
UI review: passed at <sha>
```

A later push that touches the UI needs the UI review passed again. A push that touches no UI (a test,
a relay, a comment) only needs the code review again.

## When

Right after the PR is opened, and again after every push to it -- **not** when the user asks for
"to main". By then the markers should already name the current head, so "to main" is only the
`gh pr ready` and the watch. (The user, Nov 8: "run UI review and code review after opening pr, not
when asked to go to main".) Findings are fixed in the same PR before reporting it to the user.

## 1. Guidance first

Invoke the `ui-ux-pro-max` skill for the change, and query it for the concern at hand, e.g.
`"segmented control selected state" --domain ux` or `"icon button accessible label" --domain icons`.
If a query returns nothing, retry once narrower. If that also returns nothing, say so in the PR
and fall back to the checklist below. Don't present an empty search as guidance.

## 2. The checklist (NavAid's own rules first)

- **Dim, never hide.** A control the platform can't use is dimmed, with the reason on a tap or a
  title. Only the gist removes one (a `feature*` tunable).
- **Never remove the only way out** of a panel, sheet or dialog.
- **Touch:** 44 px targets in the deck (`body.deck-on`) and on touch screens. The desktop menubar
  can be compact.
- **Selected state:** the toolbar's selected blue `#1d6fe0` (as `#toolbar button[aria-pressed="true"]`),
  not a new colour. Watch specificity: `body.theme-light #toolbar button` outranks a bare class.
- **Icons:** drawn from `NAV_ICONS` (`navIconSvg`), never emoji.
- **Words:**
  - Every label exists in EN (`docs/app/core.js` `S`) and HE (`docs/i18n/he/strings.js`), using the
    app's own labels.
  - A control whose meaning isn't obvious says what it does (a caption or a title). Three bare
    words weren't enough for NavAid pilots.
  - No competitor names.
- **RTL:** Hebrew mirrors correctly. Latin runs (codes, units, host names) are isolated with
  `dir="ltr"` or `unicode-bidi: isolate`.
- **Both themes:** readable in light and dark, with no colour that exists in only one.
- **Every layout:**
  - phone (the deck and its Menu sheet);
  - desktop (the menubar);
  - tablet (the deck; with `featureTabletDesktop`, the menubar);
  - a docked or summoned panel, where that applies.
- **Accessibility:**
  - a role that matches the behaviour (no `role="radio"` without arrow keys; use `aria-pressed`);
  - `aria-label` on icon-only controls;
  - a visible `:focus-visible` ring;
  - `prefers-reduced-motion` respected.
- **Copy matches the code:** the PR description, captions and the wiki patch say exactly what the
  control does in every state. Check each claim against a spec.

## 3. Look once

Take screenshots of the changed element with Playwright in **every combination**: light and dark
x phone (390x844) and desktop (1280x800) x English and Hebrew -- eight shots, plus the tablet case
if it applies (the user, Nov 8: "every UI change should be checked in dark light mobile and desktop,
he and en"). One throwaway spec that loops over the eight and a contact sheet of them is enough.
Read them, fix what they show, then move on, and say in the report which combinations were seen. Don't build a loop of repeated screenshots. Delete the throwaway spec
(`tests/zz-*.spec.js`) afterwards.

## 4. Record it

```bash
H=$(gh pr view $N --json headRefOid -q .headRefOid)
gh pr comment $N --body "UI review: passed at $H

<what was checked: layouts, languages, themes; what was found and fixed>"
```

Before readying, check for it the same way the code-review marker is checked:

```bash
gh pr view $N --json comments -q '.comments[].body' | grep -Fxq "UI review: passed at $H" \
  || echo "UI not reviewed at $H"
```
