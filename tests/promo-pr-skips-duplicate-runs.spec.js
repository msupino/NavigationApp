// @ts-check
// The dev -> main promotion PR is opened by GITHUB_TOKEN, so GitHub parks its
// pull_request workflow runs in `action_required` — they never start, and the PR reads as
// blocked on an approval nobody should give (approving also starts the rebase check, which
// fails by design on a promotion). Meanwhile auto-pr-dev-to-main.yml has already dispatched
// CI / Deploy / Review on `dev`, and those report every required context against the SAME
// commit. So the PR-triggered copies are pure duplication: skipped instead.
const { test, expect } = require('./_setup');
const fs = require('fs');
const path = require('path');
const YAML = require('yaml');

const read = (rel) => YAML.parse(fs.readFileSync(path.join(__dirname, '..', rel), 'utf8'));

// Every job that produces a required status check must refuse to run for a dev -> main PR.
const GUARDED = {
  '.github/workflows/ci.yml': ['native-android', 'native-ios', 'lint', 'e2e-shard', 'e2e'],
  '.github/workflows/deploy.yml': ['lint', 'build', 'deploy', 'e2e-deployed-shard', 'e2e-deployed'],
  '.github/workflows/review.yml': ['eslint', 'semgrep', 'codeql', 'lighthouse'],
};

// The three terms that together mean "not the promotion PR".
const guardsPromo = (cond) => {
  const s = String(cond || '').replace(/\s+/g, ' ');
  return s.includes("github.event_name != 'pull_request'") &&
         s.includes("github.head_ref != 'dev'") &&
         s.includes("github.base_ref != 'main'");
};

test('every check-producing job skips the promotion PR', () => {
  for (const [rel, jobs] of Object.entries(GUARDED)) {
    const doc = read(rel);
    for (const job of jobs) {
      expect(doc.jobs[job], rel + ' has no job ' + job).toBeTruthy();
      expect(guardsPromo(doc.jobs[job].if), rel + ' job ' + job + ' does not skip the promotion PR')
        .toBe(true);
    }
  }
});

test('the guard is a skip, not a silent pass on ordinary PRs', () => {
  // A feature branch into dev, and a push: both must still run. Evaluated the way the
  // expression reads rather than by trusting its shape.
  const evaluate = (cond, ctx) => {
    const s = String(cond).replace(/\s+/g, ' ')
      .replace(/github\.event_name/g, JSON.stringify(ctx.event_name))
      .replace(/github\.head_ref/g, JSON.stringify(ctx.head_ref))
      .replace(/github\.base_ref/g, JSON.stringify(ctx.base_ref))
      .replace(/github\.ref/g, JSON.stringify(ctx.ref || ''))
      .replace(/always\(\)/g, 'true')
      .replace(/!=/g, '!==').replace(/([^!<>=])==/g, '$1===');
    // eslint-disable-next-line no-new-func -- evaluating a boolean expression built here
    return Function('"use strict";return (' + s + ')')();
  };
  const lint = read('.github/workflows/ci.yml').jobs.lint.if;
  expect(evaluate(lint, { event_name: 'pull_request', head_ref: 'feat/x', base_ref: 'dev' })).toBe(true);
  expect(evaluate(lint, { event_name: 'push', head_ref: '', base_ref: '', ref: 'refs/heads/dev' })).toBe(true);
  // ...and the promotion PR is the one case that does not run.
  expect(evaluate(lint, { event_name: 'pull_request', head_ref: 'dev', base_ref: 'main' })).toBe(false);
});

// The guard was first written by a script that mistook an existing folded `if: >-` for the
// condition itself and emitted `(>-)` into the expression. GitHub rejected the whole file
// -- "Invalid workflow" -- so production deploys stopped, silently, on main. Parse the
// workflows and look at what each condition actually says.
test('every guarded condition is a real expression, not a mangled block marker', () => {
  for (const [rel, jobs] of Object.entries(GUARDED)) {
    const doc = read(rel);
    for (const job of jobs) {
      const cond = String(doc.jobs[job].if || '');
      expect(cond, rel + ' ' + job + ' carries a YAML block marker').not.toMatch(/>-|\|-/);
      // Balanced brackets: the mangling also left an orphan '(' pair behind.
      const opens = (cond.match(/\(/g) || []).length;
      const closes = (cond.match(/\)/g) || []).length;
      expect(opens, rel + ' ' + job + ' has unbalanced brackets').toBe(closes);
    }
  }
});

// The one that would have caught it: the fork check, the workflow_dispatch conditions and
// always() must survive the guard being ANDed in front of them.
test('the conditions the guard was added to are still intact', () => {
  const deploy = read('.github/workflows/deploy.yml').jobs;
  const flat = (c) => String(c).replace(/\s+/g, ' ');
  expect(flat(deploy.deploy.if)).toContain('github.event.pull_request.head.repo.full_name == github.repository');
  expect(flat(deploy['e2e-deployed-shard'].if)).toContain("github.ref_name == 'dev'");
  expect(flat(deploy['e2e-deployed'].if)).toContain('always()');
});

test('the promotion workflow still dispatches the runs that report those contexts', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '.github/workflows/auto-pr-dev-to-main.yml'), 'utf8');
  // Without these the guard above would leave the promotion with no checks at all.
  expect(src).toContain('gh workflow run CI --ref dev');
  expect(src).toContain('gh workflow run Deploy --ref dev');
  expect(src).toContain('gh workflow run Review --ref dev');
});
