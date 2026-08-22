# Intent context

Source: approved bug-fix RCA for GitHub issue #1799 and draft PR #1800.

An effective turning waypoint must not carry an automatic or manual frequency-change callout. Reconciliation removes such callouts without creating a persistent suppression, preserves unrelated notes and selection integrity, and prevents the inspector or `Z` shortcut from recreating the callout. Inspector delete actions remain red; non-destructive set/unset actions retain their safe colors and use bold text to indicate the selected state.

Acceptance criteria and expected shape are authoritative in `.ai/plans/bugs-turn-freq-change/rca-report.md`.
