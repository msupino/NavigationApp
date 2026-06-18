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
  test('Draft auto-merge enables squash merges for PRs', () => {
    const yml = workflow('draft-auto-merge.yml');
    expect(yml).toContain('gh pr merge "$PR"');
    expect(yml).toContain('--auto --squash --delete-branch');
  });

  test('Auto PR dev to main squash-syncs main into dev', () => {
    const yml = workflow('auto-pr-dev-to-main.yml');
    expect(yml).toContain('git merge --squash main');
    expect(yml).toContain('Squash merge main into dev (auto-sync before promotion PR)');
    expect(yml).not.toContain('git merge --no-ff');
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
