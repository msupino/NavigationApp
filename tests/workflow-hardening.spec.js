const { test, expect } = require('./_setup');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');

test.describe('workflow trust and integrity gates', () => {
  test('CI and Deploy syntax-check every shipped app/i18n JavaScript file mechanically', () => {
    for (const rel of ['.github/workflows/ci.yml', '.github/workflows/deploy.yml']) {
      const workflow = read(rel);
      expect(workflow, rel).toContain("find docs/app docs/i18n -type f -name '*.js' -print0");
      expect(workflow, rel).toContain('node --check docs/sw.js');
    }
  });

  test('PR-controlled tests have read-only permissions and no persisted checkout token', () => {
    const workflow = read('.github/workflows/deploy.yml');
    const e2e = workflow.slice(workflow.indexOf('\n  e2e-deployed:'));
    expect(e2e).toContain('permissions:\n      contents: read');
    expect(e2e).toContain('persist-credentials: false');
    expect(e2e).not.toMatch(/\b(?:pages|deployments|pull-requests): write\b/);
    expect(e2e).not.toContain('id-token: write');
  });

  test('pull requests are verified as local artifacts and never deployed to Pages', () => {
    const workflow = read('.github/workflows/deploy.yml');
    expect(workflow).toContain("if: github.event_name != 'pull_request'");
    expect(workflow).toContain('artifact-only verification');
    expect(workflow).not.toContain('gh pr list --state open');
    expect(workflow).not.toContain('site/branch/');
    expect(workflow).not.toContain('Post preview link comment');
  });

  test('scheduled feed jobs preserve last-good outputs on partial failures', () => {
    const aviation = read('.github/workflows/aviation-data.yml');
    expect(aviation).toContain('SIGMET publish skipped; preserving last-good branch.');
    expect(aviation).toContain('WX publish skipped; preserving last-good branch.');
    expect(aviation).toContain('if (metarsOk && tafsOk)');
    expect(read('.github/workflows/charts-monitor.yml')).toContain('wx-data/wx.json');

    const ims = read('.github/workflows/ims-charts.yml');
    expect(ims).toContain('sourceStem(f)');
    expect(ims).toContain('/tmp/pwx.candidate.json');
    expect(ims).toContain('scripts/finalize-ims-manifests.mjs');
    expect(ims).toContain('persist-credentials: false');
  });
});
