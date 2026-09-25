// @ts-check
// Default speed has a way back: ↻ returns to the gist's speed if it sets one, else the built-in,
// drops the pilot's stored number, and carries the legs that follow the default.
const { test, expect } = require('./_setup');

async function boot(page, lang = 'en') {
  await page.addInitScript(() => { try { localStorage.setItem('navaid.sec.view', '1'); } catch (e) {} });
  await page.goto('?lang=' + lang + '&nogist');
  await page.waitForFunction((l) => document.documentElement.lang === l && typeof syncDefaultSpeedInput === 'function', lang);
}
const setSpeed = (page, kt) => page.evaluate((v) => {
  const el = document.getElementById('default-speed');
  el.value = String(v); el.dispatchEvent(new Event('change'));
}, kt);

test('↻ is dimmed at the default, and brings a changed speed back to it', async ({ page }) => {
  await boot(page);
  const reset = page.locator('#default-speed-reset');
  await expect(reset).toBeDisabled();
  const base = await page.evaluate(() => tuneBaseline('defaultLegSpeedKt'));
  await page.evaluate(() => {
    state.waypoints = [{ lat: 32, lng: 34.9, name: 'A' }, { lat: 32.3, lng: 35, name: 'B' }];
    syncLegs(); draw();
  });
  await setSpeed(page, 120);
  expect(await page.evaluate(() => [tune('defaultLegSpeedKt'), state.legs[0].flightSpeed,
    localStorage.getItem('navaid.defaultSpeed')])).toEqual([120, 120, '120']);
  await expect(reset).toBeEnabled();
  expect(await reset.getAttribute('title')).toContain(String(base));
  await reset.click();
  const r = await page.evaluate(() => ({ kt: tune('defaultLegSpeedKt'), field: document.getElementById('default-speed').value,
    leg: state.legs[0].flightSpeed, stored: localStorage.getItem('navaid.defaultSpeed') }));
  expect(r).toEqual({ kt: base, field: String(base), leg: base, stored: null });
  await expect(reset).toBeDisabled();
});

test('the way back is to the gist\'s speed when the gist sets one', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(() => {
    // As if the last gist seen set 105 kt (gist on for this check).
    localStorage.setItem('navaid.gistCache', JSON.stringify({ defaultLegSpeedKt: 105 }));
    NavAid.gistDisabled = false;
    if (!NavAid.configUrl) NavAid.configUrl = 'x';
    return tuneBaseline('defaultLegSpeedKt');
  });
  expect(r).toBe(105);
});

test('Hebrew names the speed it returns to', async ({ page }) => {
  await boot(page, 'he');
  await setSpeed(page, 120);
  expect(await page.locator('#default-speed-reset').getAttribute('title')).toMatch(/חזרה לברירת המחדל \(\d+ קשר\)/);
});
