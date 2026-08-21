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
    expect(yml).toMatch(/main\|dev\) METHOD=--merge/);
    expect(yml).toMatch(/case "\$BASE" in main\) METHOD=--merge/);
  });

  test('Auto PR aligns and promotes dev without a bot-authored back-merge PR', () => {
    const yml = workflow('auto-pr-dev-to-main.yml');
    expect(yml).not.toContain('pull_request:');
    expect(yml).toContain("github.actor != 'github-actions[bot]'");
    expect(yml).not.toContain('git merge --no-ff main');
    expect(yml).not.toContain('SYNC_BRANCH=');
    expect(yml).not.toContain('--base dev');
    expect(yml).toContain('--base main');
    expect(yml).toContain('--head dev');
    expect(yml).toContain('compare/main...dev');
    expect(yml).toContain("'.behind_by'");
    expect(yml).toContain('pulls/$PR/update-branch');
    expect(yml).toContain('-f expected_head_sha="$OLD_HEAD"');
    expect(yml).toContain('if [ "$NEW_HEAD" != "$OLD_HEAD" ]');
  });

  // The run failed at update-branch with HTTP 403 "user doesn't have permission to update
  // head repository": that call writes to dev, and the workflow only asked for read. It had
  // already created the PR by then, so the whole promotion looked broken over one step.
  test('Auto PR may write to the branch it updates, and survives being refused', () => {
    const yml = workflow('auto-pr-dev-to-main.yml');
    const perms = yml.slice(yml.indexOf('permissions:'), yml.indexOf('jobs:'))
      .split('\n').filter(l => !l.trim().startsWith('#'));      // the comment quotes the 403
    expect(perms).toContain('  contents: write');
    expect(perms).not.toContain('  contents: read');
    // Refused is not fatal: the PR exists and its checks still need dispatching.
    expect(yml).toContain('if ! gh api');
    expect(yml).toContain('BEHIND=0');
    expect(yml).toContain('[ "$BEHIND" -eq 0 ] && break');
  });

  test('Auto PR dispatches checks only for a new promotion and arms once', () => {
    const yml = workflow('auto-pr-dev-to-main.yml');
    expect(yml).not.toContain('git push origin dev');
    expect(yml).toContain('CREATED=false');
    expect(yml).toContain('CREATED=true');
    expect(yml).toContain('echo "dispatch_checks=$CREATED"');
    expect(yml).toContain("if: steps.promotion.outputs.dispatch_checks == 'true'");
    expect(yml).toContain("if: steps.promotion.outputs.dispatch_watcher == 'true'");
    expect(yml).toContain("'.autoMergeRequest != null'");
    expect(yml).toContain('gh workflow run CI --ref dev');
    expect(yml).toContain('gh workflow run Deploy --ref dev');
    expect(yml).toContain('gh workflow run Review --ref dev');
    expect(yml).toContain('gh workflow run "Draft + auto-merge"');
    expect(yml).toContain('--ref dev');
    expect(yml).toContain('-f pr="$PR"');
    expect(yml).toContain('actions: write');

    const deploy = workflow('deploy.yml');
    expect(deploy).toContain("github.ref_name == 'dev'");
    expect(deploy).not.toContain("startsWith(github.ref_name, 'automation/sync-main-into-dev-')");
    expect(deploy).toContain('for CORE in _site/pr/*/app/core.js');
    expect(deploy).toContain('HEAD_SHA: ${{ github.event.pull_request.head.sha || github.sha }}');
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
