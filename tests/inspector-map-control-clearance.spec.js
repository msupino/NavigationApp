const { test, expect } = require('./_setup');

async function bootFresh(page, lang = 'en') {
  await page.addInitScript(language => {
    try {
      localStorage.removeItem('navaid.inspPos.' + language);
      localStorage.removeItem('navaid.inspPos');
    } catch (e) {}
  }, lang);
  await page.goto('?lang=' + lang + '&nogist');
  await page.waitForFunction(() =>
    typeof showInspector === 'function' && typeof loadAirfields === 'function');
  await page.waitForFunction(() =>
    !document.documentElement.classList.contains('app-booting'));
}

function rectanglesOverlap(a, b) {
  return a.x < b.x + b.width && a.x + a.width > b.x
    && a.y < b.y + b.height && a.y + a.height > b.y;
}

test('fresh English inspector stays clear of the bottom-right map controls', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await bootFresh(page);

  await page.evaluate(async () => {
    await loadAirfields();
    state.selected = { type: 'airfield', index: airfields.findIndex(a => a.name === 'LLBG') };
    showInspector();
  });

  const inspector = page.locator('#inspector');
  const rotate = page.locator('#rotate-dial');
  const zoom = page.locator('.leaflet-control-zoom');
  const inspectorBox = await inspector.boundingBox();
  const rotateBox = await rotate.boundingBox();
  const zoomBox = await zoom.boundingBox();

  expect(inspectorBox).not.toBeNull();
  expect(rotateBox).not.toBeNull();
  expect(zoomBox).not.toBeNull();
  expect(rectanglesOverlap(inspectorBox, rotateBox)).toBe(false);
  expect(rectanglesOverlap(inspectorBox, zoomBox)).toBe(false);

  // A second selection replaces the shared inspector; it never creates a stacked copy.
  await page.evaluate(() => {
    state.waypoints = [
      { lat: 32.17944, lng: 34.83444, name: 'LLHZ' },
      { lat: 32.8, lng: 35.0, name: 'TEST' },
    ];
    syncLegs();
    state.selected = { type: 'leg', index: 0 };
    showInspector();
  });
  await expect(page.locator('#inspector')).toHaveCount(1);
  await expect(page.locator('#insp-title')).toHaveValue('LLHZ → TEST');
});
