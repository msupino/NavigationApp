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
    const aviation = read('.github/workflows/aviation-data.yml');
    expect(aviation).toContain('SIGMET publish skipped; preserving last-good branch.');
    expect(aviation).toContain('WX publish skipped; preserving last-good branch.');
    // A transport error is not the only way this feed can lie. A 200 carrying an empty array,
    // or a shape that no longer has icaoId, leaves the station map empty -- publishing that
    // blanks every field's weather while reporting success, so emptiness has to block too.
    expect(aviation).toContain("Object.keys(stations).length > 0");
    expect(aviation).toContain('if (wxOk)');
    // ...whereas no SIGMETs over Israel is the normal case and must still publish.
    expect(aviation).toContain('if (sigOk)');
    expect(read('.github/workflows/charts-monitor.yml')).toContain('wx-data/wx.json');

    const ims = read('.github/workflows/ims-charts.yml');
    expect(ims).toContain('sourceStem(f)');
    // Two source PDFs can sanitise to one filename, and then one overwrites the other -- a
    // chart labelled as one valid time showing another, which is what source-naming exists to
    // prevent. A collision has to stop the run so every category keeps its last-good.
    expect(ims).toContain('chart name collision');
    expect(ims).toContain('/tmp/pwx.candidate.json');
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
