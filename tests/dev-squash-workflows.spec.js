// @ts-check
// Workflow-level regression coverage: automated changes that land on `dev`
// must avoid merge commits so staging stays squash-style.
const { test, expect } = require('./_setup');
const fs = require('fs');
const path = require('path');

function workflow(name) {
  return fs.readFileSync(
    path.join(__dirname, '..', '.github', 'workflows', name),
    'utf8');
}

test.describe('dev squash workflow guards', () => {
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

  test('CI rejects merge commits on dev pushes', () => {
    const yml = workflow('ci.yml');
    expect(yml).toContain('dev-history:');
    expect(yml).toContain("github.event_name == 'push' && github.ref == 'refs/heads/dev'");
    expect(yml).toContain('COUNT=$(git rev-list --count "$RANGE")');
    expect(yml).toContain('for m in $(git rev-list --merges "$RANGE"); do');
    expect(yml).toContain('git diff --quiet "$m^1" "$m"');
    expect(yml).not.toContain('dev must receive exactly one commit per integration');
    expect(yml).toContain('dev received a non-trivial merge commit');
    expect(yml).toContain('dev received $COUNT commit(s); any merges were no-ops.');
  });
});
