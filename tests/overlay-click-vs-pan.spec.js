// @ts-check
// A pan gesture that STARTS on a selectable overlay marker (VOR / airfield /
// nav-WP) must not open the inspector — selection is deferred to Leaflet's
// 'click', which never fires after a drag. A clean click still selects.
const { test, expect } = require('./_setup');

async function boot(page) {
  // Keep every toolbar section closed so the floating toolbar doesn't cover
  // the map centre where the real mouse gestures land.
  await page.addInitScript(() => {
    try {
      for (const s of ['build', 'view', 'display', 'charts', 'export', 'print'])
        localStorage.setItem('navaid.sec.' + s, '0');
    } catch (e) {}
  });
  await page.goto('?lang=en');
  await page.waitForFunction(() => typeof state !== 'undefined' && typeof loadVors === 'function');
  // Show the NAT VOR and get its client (page) coordinates.
  return page.evaluate(async () => {
    await loadVors();
    window.showVorStations = true;
    map.setView([32.332, 34.968], 10);
    draw();
    const s = proj(vorByIdent('NAT'));
    const r = map.getContainer().getBoundingClientRect();
    return { x: r.left + s.x, y: r.top + s.y };
  });
}

test('dragging the map from a VOR marker does not open the inspector', async ({ page }) => {
  const pt = await boot(page);
  const centerBefore = await page.evaluate(() => map.getCenter().lng);
  await page.mouse.move(pt.x, pt.y);
  await page.mouse.down();
  await page.mouse.move(pt.x + 90, pt.y + 40, { steps: 8 });   // real pan
  await page.mouse.up();
  await page.waitForTimeout(300);
  // Map panned…
  expect(await page.evaluate(() => map.getCenter().lng)).not.toBeCloseTo(centerBefore, 5);
  // …and no selection / inspector.
  expect(await page.evaluate(() => state.selected)).toBeNull();
  await expect(page.locator('#inspector')).toBeHidden();
});

test('a clean click on a VOR marker still opens its inspector', async ({ page }) => {
  const pt = await boot(page);
  await page.mouse.click(pt.x, pt.y);
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => state.selected && state.selected.type)).toBe('vor');
  await expect(page.locator('#insp-title')).toHaveValue(/NAT/);
});
