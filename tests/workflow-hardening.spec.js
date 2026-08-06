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

  // PR previews are published again, deliberately replacing the rule that no pull request
  // is ever deployed. That rule was one way to keep a fork's code off the production
  // origin; the narrower way keeps the feature and still closes the hole, so what is
  // pinned here is the same-repo condition rather than the absence of previews.
  test('pull requests publish previews, but only from this repository', () => {
    const workflow = read('.github/workflows/deploy.yml');
    const doc = YAML.parse(read('.github/workflows/deploy.yml'));
    const deploy = doc.jobs.deploy;
    // A preview is same-origin with the live app: it shares localStorage, the
    // service-worker scope and any stored Drive/BYOK token, whatever path it sits under.
    // So a fork's branch must never reach it -- gated in the job AND in the branch list.
    expect(String(deploy.if || '')).toMatch(/head\.repo\.full_name == github\.repository/);
    expect(workflow).toContain('isCrossRepository == false');
    // The two things that make a preview findable from the PR.
    expect(workflow).toContain('Create PR deployment');
    expect(workflow).toContain('Post preview link comment');
    expect(deploy.permissions).toMatchObject({ deployments: 'write', 'pull-requests': 'write' });
    // One URL for the comment and the deployment record: they used to differ
    // (/branch/<name>/ versus /pr/<n>/), so the two links on a PR could show
    // different builds after a rebase.
    expect(workflow).not.toMatch(/\/branch\/\$\{BRANCH\}\//);
    // Previews stay out of search results, and the deployment is marked transient so the
    // Deployments tab does not accumulate live-looking entries.
    expect(workflow).toContain('name="robots" content="noindex"');
    expect(workflow).toContain('"transient_environment": true');
    // Every preview gets its OWN storage namespace, injected as the first script in its
    // <head>. Same origin as the live app means same localStorage without it.
    expect(workflow).toContain('pr-store.js');
    expect(workflow).toContain('s/__PR_PREFIX__/pr-${NUM}./');
    // ...and a preview that could not be isolated is not published at all.
    expect(workflow).toMatch(/skipping its preview/);
    // The shim must never reach production or staging: only the preview branch injects it.
    const assemble = workflow.slice(workflow.indexOf('- name: Assemble site'),
      workflow.indexOf('- name: Build previews'));
    expect(assemble).not.toContain('pr-store.js');
  });

  test('the deployed-site suite runs against a preview with the shim stripped', () => {
    const workflow = read('.github/workflows/deploy.yml');
    // The suite seeds localStorage from page.addInitScript, which runs BEFORE any page
    // script -- so with the shim active every seeded key is namespaced away, the app boots
    // without the controls the tests click, and the whole run times out (observed: 171
    // passed, 1533 did not run). The shim is a property of the PUBLISHED preview and is
    // covered on its own by tests/preview-store-isolation.spec.js.
    const serve = workflow.slice(workflow.indexOf('Serve published site locally'));
    expect(serve).toMatch(/sed -i '\/<script src="pr-store\.js">/);
    // Same reasoning for sw.js: the published preview has none on purpose, but this job
    // verifies the PR's build and the suite reads the worker's source.
    expect(serve).toMatch(/cp docs\/sw\.js "\$PREVIEW\/sw\.js"/);
  });

  test('Pages deploys queue per PR instead of piling up on one group', () => {
    const doc = YAML.parse(read('.github/workflows/deploy.yml'));
    const c = doc.jobs.deploy.concurrency;
    // One shared 'pages' group meant every open PR's whole-site publish queued behind every
    // other, until actions/deploy-pages hit its 10-minute wait and failed -- blocking
    // unrelated PRs and the promo. A PR's deploys now supersede only THAT PR's.
    expect(String(c.group)).toMatch(/pages-pr-\{0\}/);
    expect(String(c.group)).toMatch(/pages-prod/);
    expect(String(c['cancel-in-progress'])).toMatch(/github\.event_name == 'pull_request'/);
    // Production publishes must never be cancelled by a preview: they are in their own
    // group, and cancel-in-progress is false for anything that is not a pull request.
    expect(String(c.group)).not.toBe('pages');
    // ...and the wait has to survive sitting behind another deployment.
    const step = doc.jobs.deploy.steps.find(x => String(x.uses || '').includes('deploy-pages'));
    expect(Number(step.with.timeout)).toBeGreaterThan(600000);
  });

  test('no PR metadata is ever interpolated into shell source', () => {
    const workflow = read('.github/workflows/deploy.yml');
    // A branch name is attacker-controlled and git accepts $( ) inside a ref, so
    // 'feat/x$(printf${IFS}PWNED)' executed in the job that assembles the PRODUCTION tree
    // and hands it to a `pages: write` deploy. Verified by running the old xargs -I{}
    // pattern with that value.
    expect(workflow).not.toMatch(/xargs[^\n]*bash -c/);
    expect(workflow).not.toMatch(/read -r n b <<< "\{\}"/);
    // Read as NUL-delimited data, checked, and passed as positional parameters.
    expect(workflow).toContain("tr '\\n' '\\0'");
    expect(workflow).toMatch(/while IFS= read -r -d ''/);
    expect(workflow).toContain('git check-ref-format');
    expect(workflow).toMatch(/build_preview "\$NUM" "\$BRANCH"/);
    // The branch list must not be expanded as fetch options either.
    expect(workflow).not.toMatch(/git fetch origin --depth 1 -q \$BRANCHES/);
    expect(workflow).toMatch(/git fetch origin --depth 1 -q -- "\$BRANCH"/);
  });

  test('a preview takes its shim from the base branch and ships no service worker', () => {
    const workflow = read('.github/workflows/deploy.yml');
    // The branch being previewed used to be allowed to supply its own "isolation" file --
    // any non-empty no-op passed the presence check.
    expect(workflow).not.toMatch(/git show "origin\/\$BRANCH:\.github\/preview\/pr-store\.js"/);
    expect(workflow).toMatch(/cp \.github\/preview\/pr-store\.js/);
    // Cache Storage is per ORIGIN: a preview worker's cleanup deleted the live app's
    // offline shell just by being visited.
    expect(workflow).toMatch(/rm -f "\$STAGING\/sw\.js"/);
  });

  test('the service worker only deletes caches its own scope owns', () => {
    const sw = read('docs/sw.js');
    // The old cleanup deleted every navaid-* cache that was not its own, across scopes.
    expect(sw).not.toMatch(/ks\.filter\(k => k !== CACHE && k !== TILE_CACHE\)/);
    expect(sw).toContain('__navaid_owner__');
    expect(sw).toContain('ownedByThisScope');
  });

  test('the handbook states the real preview trust model', () => {
    const doc = read('.ai/navaid-dev.md');
    // It claimed PR code is never deployed under the live origin, which stopped being
    // true the moment previews came back.
    expect(doc).not.toMatch(/unreviewed code is not deployed under the live origin/);
    expect(doc).toMatch(/not\*\* a security boundary|not a security boundary/);
    expect(doc).toContain('/pr/<n>/');
  });

  test('the storage shim exists and is inert until a prefix is substituted', () => {
    const shim = read('.github/preview/pr-store.js');
    expect(shim).toContain('__PR_PREFIX__');
    // Guard for a half-applied build: an unsubstituted placeholder must leave the real
    // store alone rather than isolating under a literal placeholder name.
    expect(shim).toMatch(/indexOf\('__PR_'\) === 0\) return/);
    for (const fn of ['getItem', 'setItem', 'removeItem', 'clear', 'key']) {
      expect(shim, fn + ' not wrapped').toContain(fn + ':');
    }
    expect(shim).toContain('sessionStorage');
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
