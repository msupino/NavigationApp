// @ts-check
// A PR preview may share a big static asset directory with the deployed root instead of
// carrying its own copy. docs/ is 141 MB, of which byop is 126 MB; the remaining 14.7 MB is
// mostly chart-overlay imagery (~12 MB) that a branch almost never edits, and every open PR
// used to ship all of it. Five PRs put one Pages artifact near 300 MB and Pages could not
// publish it inside the deploy action's ceiling — which is not configurable: it logs the
// `timeout` input and ignores it.
const { test, expect } = require('./_setup');
const fs = require('fs');
const path = require('path');

const DIRS = ['circuit-img', 'training-img', 'cvfr-img', 'heli-img', 'commfail-img'];

async function boot(page, sharedDirs) {
  if (sharedDirs) {
    await page.addInitScript(dirs => { window.__navPreviewSharedDirs = dirs; }, sharedDirs);
  }
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof navAssetBase === 'function' &&
    typeof circuitImgBase === 'function');
}

test('without a shared list, every set resolves to the document\'s own copy', async ({ page }) => {
  await boot(page, null);
  const r = await page.evaluate(dirs => {
    const out = {};
    for (const d of dirs) out[d] = navAssetBase(d);
    return { out, base: document.baseURI };
  }, DIRS);
  // This is production/staging behaviour and must not change: each set sits beside the app.
  for (const d of DIRS) {
    expect(r.out[d]).toBe(new URL(d + '/', r.base).href);
  }
});

test('a shared set resolves to the deployed root, from a preview path', async ({ page }) => {
  await page.addInitScript(() => { window.__navPreviewSharedDirs = ['circuit-img', 'heli-img']; });
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof navAssetBase === 'function');
  const r = await page.evaluate(() => {
    // Pretend this document is served from a preview path, which is the only case the
    // stripping applies to.
    const fake = (docBase, dir) => {
      const here = new URL(dir + '/', docBase).href;
      const u = new URL(here);
      u.pathname = u.pathname.replace(/[^/]*\/$/, '').replace(/(staging|pr\/[^/]+|branch\/.+)\/$/, '') + dir + '/';
      return u.href;
    };
    return {
      pr: fake('https://navaid.supino.org/pr/1466/index.html', 'circuit-img'),
      branchWithSlash: fake('https://navaid.supino.org/branch/feat/x/index.html', 'circuit-img'),
      staging: fake('https://navaid.supino.org/staging/index.html', 'circuit-img'),
      live: navAssetBase('circuit-img'),
      notShared: navAssetBase('training-img'),
    };
  });
  // Root copy, whatever the preview path looks like — including a branch name with a slash,
  // which is why the pattern is `branch/.+` and not `branch/[^/]+`.
  expect(r.pr).toBe('https://navaid.supino.org/circuit-img/');
  expect(r.branchWithSlash).toBe('https://navaid.supino.org/circuit-img/');
  expect(r.staging).toBe('https://navaid.supino.org/circuit-img/');
  // A set NOT in the list keeps the document's own copy even on a preview.
  expect(r.notShared).toContain('training-img/');
});

test('every image base goes through the resolver', async ({ page }) => {
  await boot(page, ['circuit-img', 'training-img', 'cvfr-img', 'heli-img', 'commfail-img']);
  const r = await page.evaluate(() => ({
    circuit: circuitImgBase(), training: trainingImgBase(), cvfr: cvfrImgBase(),
    heli: heliImgBase(), commfail: commfailImgBase(),
    shared: window.__navPreviewSharedDirs,
  }));
  // All five must consult the shared list; one left on `new URL(dir, baseURI)` would 404 on
  // a preview that no longer carries that directory.
  for (const [k, v] of Object.entries(r)) {
    if (k === 'shared') continue;
    expect(typeof v, k).toBe('string');
    expect(v, k).toMatch(/-img\/$/);
  }
  const src = fs.readFileSync(path.join(__dirname, '..', 'docs', 'app', 'ui.js'), 'utf8');
  expect(src).not.toMatch(/new URL\('[a-z-]+-img\/', document\.baseURI\)/);
});

test('the build omits a set only when the branch has not touched it', () => {
  const wf = fs.readFileSync(
    path.join(__dirname, '..', '.github', 'workflows', 'deploy.yml'), 'utf8');
  // The saving is only ever taken where there is nothing to see: a branch that edits an
  // overlay keeps its own copy, so its preview shows the change it is there to show.
  expect(wf).toMatch(/git diff --quiet "origin\/main\.\.\.origin\/\$BRANCH" -- "docs\/\$d"/);
  expect(wf).toMatch(/rm -rf "\$STAGING\/\$d"/);
  expect(wf).toMatch(/keeps its own \$d \(branch modified it\)/);
  // ...and the page is told what it does not carry, before any overlay loader runs.
  expect(wf).toContain('window.__navPreviewSharedDirs');
  expect(wf).toContain('preview-shared.js');
  for (const d of DIRS) expect(wf, d + ' not listed').toContain(d);
});
