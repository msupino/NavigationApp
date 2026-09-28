// @ts-check
// The live gist, bundled (data/gist-snapshot.js, scripts/write-gist-snapshot.mjs): an app that
// has never downloaded the gist -- a fresh APK opened offline -- starts with its settings rather
// than the built-in defaults alone. Layers: built-in < snapshot < this device's cached gist <
// the live gist.
const { test, expect } = require('./_setup');

// The rest of the suite runs with the snapshot off (tests/_setup.js); this spec is about it.
test.use({ useGistSnapshot: true });

test('with no gist ever downloaded, the bundled snapshot is in force', async ({ page }) => {
  // _setup aborts the live gist, and a fresh page has no cached copy.
  await page.goto('?lang=en');
  await page.waitForFunction(() => typeof tune === 'function' && window.__navaidGistSnapshot);
  const out = await page.evaluate(() => {
    const snap = window.__navaidGistSnapshot;
    // Every key the snapshot sets, and this build knows, is what tune() reads.
    const differ = Object.keys(snap).filter(k => NavAid.tuningDefaults[k] &&
      JSON.stringify(tune(k)).toLowerCase() !== JSON.stringify(snap[k]).toLowerCase() &&
      !(typeof snap[k] === 'number' && Math.abs(tune(k) - snap[k]) < 1e-9));
    return { applied: NavAid.gistSnapshotApplied, keys: Object.keys(snap).length, differ };
  });
  expect(out.keys).toBeGreaterThan(100);
  expect(out.applied).toBeGreaterThan(100);
  expect(out.differ).toEqual([]);
});

test('a cached gist from this device outranks the snapshot', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('navaid.gistCache', JSON.stringify({ featureRouteIntro: true }));
  });
  await page.goto('?lang=en');
  await page.waitForFunction(() => typeof tune === 'function');
  expect(await page.evaluate(() => [window.__navaidGistSnapshot.featureRouteIntro, tune('featureRouteIntro')]))
    .toEqual([false, true]);
});

test('?nogist runs on the built-in defaults alone, snapshot included', async ({ page }) => {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof tune === 'function');
  const out = await page.evaluate(() => ({ applied: NavAid.gistSnapshotApplied, intro: tune('featureRouteIntro'),
    shipped: NavAid.tuningDefaults.featureRouteIntro.value }));
  expect(out.applied).toBe(0);
  expect(out.intro).toBe(out.shipped);
});

test('the snapshot is a script loaded before core.js, and the deploy refreshes it before the update bundle', async ({ page }) => {
  const fs = require('fs'), path = require('path');
  const root = path.join(__dirname, '..');
  const index = fs.readFileSync(path.join(root, 'docs/index.html'), 'utf8');
  expect(index.indexOf("'data/gist-snapshot.js' + v")).toBeGreaterThan(-1);
  expect(index.indexOf("'data/gist-snapshot.js' + v")).toBeLessThan(index.indexOf("'app/core.js' + v"));
  const deploy = fs.readFileSync(path.join(root, '.github/workflows/deploy.yml'), 'utf8');
  expect(deploy.indexOf('Refresh the bundled gist snapshot')).toBeGreaterThan(-1);
  expect(deploy.indexOf('Refresh the bundled gist snapshot')).toBeLessThan(deploy.indexOf('Publish the update bundle'));
  const { snapshotSource } = await import('../scripts/write-gist-snapshot.mjs');
  const src = snapshotSource({ a: 1 }, 'T');
  const w = {};
  new Function('window', src)(w);
  expect(w.__navaidGistSnapshot).toEqual({ a: 1 });
});
