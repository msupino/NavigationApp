// ATC-IL owns station selection in the embedded radio page; inspector rows no longer add NavAid
// relay buttons beside frequencies or callsigns.
const { test, expect } = require('./_setup');

async function boot(page) {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof state !== 'undefined' && !!window.atcRadio
    && Array.isArray(window.airfields) && typeof showInspector === 'function');
  await page.evaluate(async () => { await loadNavWaypoints(); await loadCommChange(); });
  await page.waitForFunction(() => window.commChangeMap && Object.keys(window.commChangeMap).length > 0);
}

async function openField(page, code) {
  await page.evaluate((name) => {
    state.selected = { type: 'airfield', index: airfields.findIndex(a => a.name === name) };
    showInspector();
  }, code);
}

async function openWaypoint(page, name) {
  await page.evaluate((n) => {
    window.showCommChange = true;
    state.selected = { type: 'navwp', index: navWP.findIndex(w => w.name === n) };
    showInspector();
  }, name);
}

test('airfield frequency rows no longer contain NavAid ATC play buttons', async ({ page }) => {
  await boot(page);
  await openField(page, 'LLHZ');
  await expect(page.locator('#inspector .primary-row [data-atc]')).toHaveCount(0);
  await expect(page.locator('#inspector .clearance-row [data-atc]')).toHaveCount(0);
  await openField(page, 'LLHA');
  await expect(page.locator('#inspector .atis-row [data-atc]')).toHaveCount(0);
});

test('waypoint callsign rows no longer contain NavAid ATC play buttons', async ({ page }) => {
  await boot(page);
  await openWaypoint(page, 'ZMGID');
  await expect(page.locator('#inspector .commchange-option')).toHaveCount(3);
  await expect(page.locator('#inspector .commchange-option [data-atc]')).toHaveCount(0);
  await expect(page.locator('#tool-atc-radio')).toBeHidden();
});
