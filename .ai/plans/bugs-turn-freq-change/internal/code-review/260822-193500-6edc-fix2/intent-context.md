# Intent context

Source: issue #1799, merged PR #1800 review finding, and follow-up PR #1804.

The merged turning-point callout fix must also apply immediately when saved route data is restored or imported. The common route synchronization boundary should remove automatic and manual callouts at the effective turn, preserve unrelated notes, repair selected-note indexes, avoid persistent suppressions, and allow normal automatic reseeding when the turn moves or clears.
