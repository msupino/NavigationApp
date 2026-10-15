# Vendored: ui-ux-pro-max

- Source: https://github.com/nextlevelbuilder/ui-ux-pro-max-skill, path
  `.claude/skills/ui-ux-pro-max/`, commit `56ea9cf174ed86786187daa9de0e6247cb0747e4`
  (2026-10-15).
- License: MIT, copied alongside as `LICENSE`.
- Copied: `SKILL.md`, `data/`, `references/`, `scripts/*.py`. Left out: the upstream
  `scripts/tests/` and any `__pycache__`.
- One local edit: `SKILL.md` ran the search script from `${CLAUDE_PLUGIN_ROOT}`, which is set
  for plugins but not for a skill checked into a repository. Those paths now start at
  `$(git rev-parse --show-toplevel)`.

The scripts are Python 3 standard library only and read the local CSV/JSON files. They make no
network calls. Refresh by re-copying the same paths from a newer upstream commit and re-applying
the path edit.

## Using it on NavAid

- The stack is plain HTML/CSS/JS on Leaflet, which none of the skill's `--stack` options
  describe. Use `--domain ux` (and `color`, `typography`, `icons` as needed) for findings, and
  implement them the way `.ai/ui-patterns.md` describes.
- NavAid has an established look. Review against the guidelines rather than generating a new
  `--design-system`, and do not `--persist` a design system into the repository.
- Phone fields in the inspector are 30px high on purpose (see the field family in
  `docs/app/style.css`): the web target size (WCAG 2.2) is 24px. The skill's 44pt/48dp
  figures are for native app controls.
