const { test, expect } = require('./_setup');
const fs = require('fs');
const path = require('path');
const YAML = require('yaml');

const root = path.join(__dirname, '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
// Parsed, not string-matched: asserting on `permissions:\n      contents: read` pinned six
// spaces of indentation, and slicing "from the job name to end of file" assumed a particular
// job was last. Both would fail on a reindent that changed nothing.
const job = (rel, name) => {
  const doc = YAML.parse(read(rel));
  expect(doc.jobs, rel + ' has no jobs').toBeTruthy();
  expect(doc.jobs[name], rel + ' has no job ' + name).toBeTruthy();
  return doc.jobs[name];
};

test.describe('workflow trust and integrity gates', () => {
  test('CI and Deploy syntax-check every shipped app/i18n JavaScript file mechanically', () => {
    for (const rel of ['.github/workflows/ci.yml', '.github/workflows/deploy.yml']) {
      const workflow = read(rel);
      expect(workflow, rel).toContain("find docs/app docs/i18n -type f -name '*.js' -print0");
      expect(workflow, rel).toContain('node --check docs/sw.js');
    }
  });

  test('PR-controlled tests have read-only permissions and no persisted checkout token', () => {
    const e2e = job('.github/workflows/deploy.yml', 'e2e-deployed');
    // The job runs code from the pull request, so its token must be able to do nothing but
    // read: no Pages publish, no deployment records, no PR writes, no OIDC identity.
    expect(e2e.permissions).toEqual({ contents: 'read' });
    const checkouts = (e2e.steps || []).filter(s => String(s.uses || '').startsWith('actions/checkout'));
    expect(checkouts.length).toBeGreaterThan(0);
    for (const step of checkouts) {
      expect(step.with && step.with['persist-credentials'], 'checkout keeps its token').toBe(false);
    }
  });

  test('every job that can run pull-request code is read-only', () => {
    const doc = YAML.parse(read('.github/workflows/deploy.yml'));
    // Workflow-level permissions are the floor for any job that does not override them.
    expect(doc.permissions).toEqual({ contents: 'read' });
    for (const [name, spec] of Object.entries(doc.jobs)) {
      const perms = spec.permissions;
      if (!perms || perms === 'read-all') continue;
      const writes = Object.entries(perms).filter(([, v]) => v === 'write').map(([k]) => k);
      if (!writes.length) continue;
      // A job that may publish must be gated off pull requests entirely.
      expect(String(spec.if || ''), name + ' has write scopes ' + writes.join(',')).toContain(
        "github.event_name != 'pull_request'");
    }
  });

  test('pull requests are verified as local artifacts and never deployed to Pages', () => {
    const workflow = read('.github/workflows/deploy.yml');
    const doc = YAML.parse(read('.github/workflows/deploy.yml'));
    expect(String(doc.jobs.deploy.if || '')).toContain("github.event_name != 'pull_request'");
    // Nothing may fetch or publish other people's branches from this workflow.
    expect(workflow).not.toContain('gh pr list --state open');
    expect(workflow).not.toContain('site/branch/');
    expect(workflow).not.toContain('Post preview link comment');
  });

  test('scheduled feed jobs preserve last-good outputs on partial failures', () => {
    // The aviation build is a module now, so its publish rules are covered behaviourally in
    // tests/aviation-feeds.spec.js instead of by grepping this YAML -- a substring cannot tell
    // a working guard from a commented-out one. What is left to assert here is the wiring.
    const aviation = read('.github/workflows/aviation-data.yml');
    expect(aviation).toContain('node scripts/build-aviation-feeds.mjs');
    expect(aviation).not.toContain("node --input-type=module <<'NODE'");
    // The script lives in the repo, so the job needs a checkout the heredoc did not...
    expect(aviation).toMatch(/uses: actions\/checkout/);
    // ...and it must not carry a token: the data branches are pushed with an explicit
    // x-access-token URL, never with the checkout's credentials.
    expect(aviation).toContain('persist-credentials: false');
    expect(read('.github/workflows/charts-monitor.yml')).toContain('wx-data/wx.json');

    const ims = read('.github/workflows/ims-charts.yml');
    // Source-naming and the collision guard are a module now (behaviour lives in
    // tests/ims-chart-jobs.spec.js, including the rule that every manifest entry gets a
    // download job the shell actually runs -- a list piped on stdout was not
    // newline-terminated, so `while read` dropped the last chart and froze SIGWX, #1429).
    expect(ims).toContain('node scripts/build-ims-chart-jobs.mjs');
    expect(ims).not.toContain("node --input-type=module <<'NODE'");
    // A final line with no newline still fills read's variables, so the loop must consume it.
    expect(ims).toContain(`while IFS=$'\\t' read -r url out mode || [ -n "$url" ]; do`);
    // Candidates are built and finalized from one run-scoped scratch dir, so finalize sees
    // exactly what this run produced (and no fixed /tmp name is written).
    expect(ims).toContain('WORK="$(mktemp -d)"');
    expect(ims).toContain('"$WORK/pwx.candidate.json"');
    expect(ims).not.toMatch(/-o \/tmp\/|< \/tmp\/|\/tmp\/\w+\.candidate\.json/);
    expect(ims).toContain('scripts/finalize-ims-manifests.mjs');
    expect(ims).toContain('persist-credentials: false');
  });

  test('only a topic branch into dev is squashed; long-lived branches keep ancestry', () => {
    const arm = read('.github/workflows/draft-auto-merge.yml');
    // A squashed dev -> main promo gives main dev's content with none of its ancestry, so git
    // stops knowing main contains dev's commits and the NEXT promo reports every flattened
    // file as "changed in both" -- 37 files of phantom conflicts on #1425. The same applies to
    // a main -> dev backmerge, which exists precisely to restore that ancestry.
    expect(arm).toContain('METHOD=--squash');
    expect(arm).toMatch(/case "\$HEAD_REF" in main\|dev\) METHOD=--merge/);
    expect(arm).toMatch(/case "\$BASE" in main\) METHOD=--merge/);
    // ...and the flags must be variables, not a hard-coded --squash on the merge call.
    expect(arm).toContain('--auto $METHOD $DELETE');
    expect(arm).not.toMatch(/--auto --squash --delete-branch/);
  });

  test('auto-merge never asks to delete a long-lived branch', () => {
    const arm = read('.github/workflows/draft-auto-merge.yml');
    // A promo PR's HEAD is `dev`, so a blanket --delete-branch asks GitHub to delete the
    // integration branch on every promotion. Branch protection refused it; this stops asking.
    // Keyed on the head ref, so no long-lived branch can be deleted however a PR is pointed.
    expect(arm).toMatch(/case "\$HEAD_REF" in\s*\n\s*main\|dev\) DELETE= ;;/);
  });
});
