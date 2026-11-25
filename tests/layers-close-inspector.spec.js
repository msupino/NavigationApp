// @ts-check
// Asked: "extra layers button should hide inspector". On a tablet the LLHZ inspector stood over the
// column's layers popover and over the chart being changed. Opening the layers popover, or the
// menubar's Extra layers menu, now dismisses the inspector -- as opening the legend already did.
const { test, expect } = require('./_setup');

async function openLlhz(page, size) {
  await page.setViewportSize(size);
  await page.goto('?lang=he&nogist');
  await page.waitForFunction(() => typeof showInspector === 'function' && typeof clearBootLoading === 'function'
    && Array.isArray(window.airfields) && !!document.getElementById('edit-col-layers'));
  await page.evaluate(() => {
    state.selected = { type: 'airfield', index: airfields.findIndex(a => a.name === 'LLHZ') };
    showInspector();
  });
  await expect(page.locator('#inspector')).not.toHaveClass(/hidden/);
}

for (const [name, size] of [['tablet', { width: 820, height: 1180 }], ['phone', { width: 390, height: 844 }]]) {
  test(`opening the layers popover closes the inspector (${name})`, async ({ page }) => {
    await openLlhz(page, size);
    await page.click('#edit-col-layers');
    await expect(page.locator('#quick-layers')).toBeVisible();
    await expect(page.locator('#inspector')).toHaveClass(/hidden/);
    expect(await page.evaluate(() => state.selected)).toBeNull();
  });
}

test('opening the Extra layers menu closes the inspector (desktop menubar)', async ({ page }) => {
  await openLlhz(page, { width: 1280, height: 800 });
  await page.click('.tb-section[data-sec="weather"] .tb-section-head');
  await expect(page.locator('.tb-section[data-sec="weather"]')).toHaveClass(/open/);
  await expect(page.locator('#inspector')).toHaveClass(/hidden/);
});
