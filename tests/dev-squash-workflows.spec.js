// @ts-check
// Workflow-level regression coverage: automated changes that land on `dev`
// must be single, non-merge commits so staging stays squash-only.
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

  test('CI fails dev pushes that are not one non-merge commit', () => {
    const yml = workflow('ci.yml');
    expect(yml).toContain('dev-history:');
    expect(yml).toContain("github.event_name == 'push' && github.ref == 'refs/heads/dev'");
    expect(yml).toContain('COUNT=$(git rev-list --count "$RANGE")');
    expect(yml).toContain('MERGES=$(git rev-list --merges --count "$RANGE")');
    expect(yml).toContain('dev must receive exactly one commit per integration');
    expect(yml).toContain('dev received a merge commit');
  });
});
