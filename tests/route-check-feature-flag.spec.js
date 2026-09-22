// @ts-check
// The route check is gated on `featureRouteCheck`, and that key has to exist in the tuning
// registry for the gate to mean anything. It was read from routecheck.js's first commit and
// never registered, so tune() answered undefined: the guard reads `!== false`, so the answer
// was always "on", the gist had no way to withdraw the feature, and it appeared nowhere in
// ?tune. Every other feature flag is registered, which is what makes the removal the gist's
// to make -- the house rule for taking a control away at all.
const { test, expect } = require('./_setup');

async function boot(page) {
  await page.addInitScript(() => {
    for (const s of ['build', 'view', 'display', 'charts', 'export', 'print'])
      try { localStorage.setItem('navaid.sec.' + s, '1'); } catch (e) {}
  });
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => window.NavAid && NavAid.tuningDefaults
    && !document.documentElement.classList.contains('app-booting'));
}

test('the flag is registered, so tune() has an answer to give', async ({ page }) => {
  await boot(page);
  const spec = await page.evaluate(() => {
    const d = NavAid.tuningDefaults.featureRouteCheck;
    return d ? { value: d.value, type: d.type, hasLabel: !!d.label } : null;
  });
  expect(spec, 'featureRouteCheck missing from the tuning registry').not.toBeNull();
  expect(spec.type).toBe('bool');
  expect(spec.value).toBe(true);          // shipped on
  expect(spec.hasLabel).toBe(true);       // ?tune renders the label
  // An unregistered key answers undefined, which is not false -- which is exactly why the
  // gate could never close.
  expect(await page.evaluate(() => tune('featureRouteCheck'))).toBe(true);
});

test('every key the tuning panel groups is a key that exists', async ({ page }) => {
  await boot(page);
  // A group naming a key that was never registered renders a row for nothing; the reverse --
  // a registered key in no group -- is invisible in ?tune. Both are silent, so both are
  // worth a test rather than a reading.
  const bad = await page.evaluate(() => {
    const groups = NavAid.tuningGroups || [];
    const reg = NavAid.tuningDefaults || {};
    const orphans = [];
    const grouped = new Set();
    for (const g of groups) for (const k of (g.keys || [])) {
      grouped.add(k);
      if (!(k in reg)) orphans.push(g.name + ' -> ' + k);
    }
    return { orphans, ungrouped: Object.keys(reg).filter(k => !grouped.has(k)) };
  });
  expect(bad.orphans, 'group keys with no registry entry').toEqual([]);
  expect(bad.ungrouped, 'registered tunables in no group').toEqual([]);
});

test('withdrawing it dims the button rather than leaving it dead', async ({ page }) => {
  await boot(page);
  const btn = page.locator('#route-check-btn');
  await expect(btn).toBeEnabled();

  // The point of registering the flag: switching it off has to REACH the control. It used
  // to reach only show(), which returned null -- so the button stayed lit and pressing it
  // did nothing at all, with nothing said. Dim, never hide.
  await page.evaluate(() => {
    NavAid.tuningDefaults.featureRouteCheck.value = false;
    redrawAfterTune();
  });
  expect(await page.evaluate(() => tune('featureRouteCheck'))).toBe(false);
  await expect(btn).toBeDisabled();
  await expect(btn, 'dimmed, not removed').toBeVisible();

  // ...and it comes back without a reload, as every other gist-controlled feature does.
  await page.evaluate(() => {
    NavAid.tuningDefaults.featureRouteCheck.value = true;
    redrawAfterTune();
  });
  await expect(btn).toBeEnabled();
});
