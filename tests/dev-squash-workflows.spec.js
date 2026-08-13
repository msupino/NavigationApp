// @ts-check
// Workflow-level regression coverage for automated promotion and PR helpers.
const { test, expect } = require('./_setup');
const fs = require('fs');
const path = require('path');

function workflow(name) {
  return fs.readFileSync(
    path.join(__dirname, '..', '.github', 'workflows', name),
    'utf8');
}

test.describe('dev workflow guards', () => {
  test('Draft auto-merge squashes topic branches and merges long-lived ones', () => {
    const yml = workflow('draft-auto-merge.yml');
    expect(yml).toContain('gh pr merge "$PR"');
    // Was `--auto --squash --delete-branch`, hard-coded for every PR. A squashed dev -> main
    // promo hands main dev's content with none of its ancestry, so the NEXT promo reports
    // every flattened file as "changed in both" -- #1425 opened with 37 files of conflicts
    // nobody had written. The flags are chosen per PR now; see the two guards below.
    expect(yml).toContain('--auto $METHOD $DELETE');
    expect(yml).toContain('METHOD=--squash');
    expect(yml).toMatch(/case "\$HEAD_REF" in main\|dev\) METHOD=--merge/);
    expect(yml).toMatch(/case "\$BASE" in main\) METHOD=--merge/);
  });

  // This guard used to assert the opposite -- that the sync was a SQUASH -- because the
  // aim was one tidy commit per integration on dev. That cost more than it bought: a
  // squash copies main's tree into dev but not its ancestry, so `main` never became an
  // ancestor of `dev`, and CI's own "Check PR is rebased" step (a literal
  // `git merge-base --is-ancestor`) fails on every dev->main promotion PR. It stayed
  // invisible only because a promotion PR's workflow runs sit in `action_required` and
  // never execute; the green lint on past promos came from the push-triggered run, which
  // has no rebase check. See #1560.
  test('Auto PR dev to main MERGES main into dev, preserving ancestry', () => {
    const yml = workflow('auto-pr-dev-to-main.yml');
    expect(yml).toContain('git merge --no-ff main');
    expect(yml).toContain('Merge main into dev (auto-sync before promotion PR)');
    // A squash here is the bug this guard now exists to prevent.
    expect(yml).not.toContain('git merge --squash main');
    // No "skip when the tree is unchanged" shortcut: after a promotion, main's merge
    // commit usually brings dev no new files -- dev is where the content came from -- and
    // that is exactly the case that must still be recorded, or the ancestry is lost again.
    expect(yml).not.toContain('main introduced no tree changes for dev');
  });

  test('CI reports merge commits on dev pushes without blocking promotion', () => {
    const yml = workflow('ci.yml');
    expect(yml).toContain('dev-history:');
    expect(yml).toContain("github.event_name == 'push' && github.ref == 'refs/heads/dev'");
    expect(yml).toContain('COUNT=$(git rev-list --count "$RANGE")');
    expect(yml).toContain('MERGES=$(git rev-list --merges "$RANGE" || true)');
    expect(yml).toContain('for m in $MERGES; do git show -s --oneline "$m"; done');
    expect(yml).not.toContain('dev must receive exactly one commit per integration');
    expect(yml).toContain('dev received merge commit(s); continuing.');
    expect(yml).toContain('dev received $COUNT commit(s) with no merge commits.');
  });
});
