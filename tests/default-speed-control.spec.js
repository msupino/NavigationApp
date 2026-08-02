// "Default speed" under View/Set, below the layer picker: the seed speed for a
// leg with no earlier leg to copy from. Drives the defaultLegSpeedKt tune key and
// outranks the gist, like the other pilot-set controls.
const { test, expect } = require('./_setup');

// The View section is collapsed by default, so the input is not interactable
// until it is open — same init the other toolbar specs use.
async function boot(page, q = '?lang=en&nogist') {
  await page.addInitScript(() => {
    try {
      for (const sec of ['build', 'view', 'display', 'charts', 'export', 'print'])
        localStorage.setItem('navaid.sec.' + sec, '1');
    } catch (e) {}
  });
  await page.goto(q);
  await page.waitForFunction(() => typeof tune === 'function' && typeof syncLegs === 'function');
}

test('the control sits under the layer picker in View/Set and shows 90 by default', async ({ page }) => {
  await boot(page);
  const el = page.locator('#default-speed');
  await expect(el).toHaveValue('90');
  const order = await page.evaluate(() => {
    const body = document.querySelector('.tb-section[data-sec="view"] .tb-section-body');
    const rows = [...body.children];
    return {
      layerIdx: rows.findIndex(r => r.querySelector('#layer-select')),
      speedIdx: rows.findIndex(r => r.querySelector('#default-speed')),
      sameSection: !!body.querySelector('#default-speed'),
    };
  });
  expect(order.sameSection).toBe(true);
  expect(order.speedIdx).toBe(order.layerIdx + 1);   // directly below Layer
});

test('it is labelled in both languages', async ({ page }) => {
  await boot(page);
  const en = await page.evaluate(() =>
    document.querySelector('#default-speed').closest('.navtoggle').querySelector('span').textContent);
  expect(en).toMatch(/default speed/i);
  await boot(page, '?lang=he&nogist');
  const he = await page.evaluate(() =>
    document.querySelector('#default-speed').closest('.navtoggle').querySelector('span').textContent);
  expect(he).toMatch(/[֐-׿]/);
});

test('changing it drives defaultLegSpeedKt and persists across reload', async ({ page }) => {
  await boot(page);
  await page.fill('#default-speed', '110');
  await page.dispatchEvent('#default-speed', 'change');
  expect(await page.evaluate(() => tune('defaultLegSpeedKt'))).toBe(110);
  expect(await page.evaluate(() => localStorage.getItem('navaid.defaultSpeed'))).toBe('110');
  await page.reload();
  await page.waitForFunction(() => typeof tune === 'function');
  await expect(page.locator('#default-speed')).toHaveValue('110');
  expect(await page.evaluate(() => tune('defaultLegSpeedKt'))).toBe(110);
});

test('a new leg with nothing to inherit uses it', async ({ page }) => {
  await boot(page);
  await page.fill('#default-speed', '125');
  await page.dispatchEvent('#default-speed', 'change');
  const speed = await page.evaluate(() => {
    state.waypoints = [{ lat: 32.0, lng: 34.9, name: 'A' }, { lat: 32.3, lng: 35.0, name: 'B' }];
    state.legs = []; syncLegs(); draw();
    return state.legs[0].flightSpeed;
  });
  expect(speed).toBe(125);
});

test('out-of-range or junk input is rejected and the field shows what is in force', async ({ page }) => {
  await boot(page);
  for (const bad of ['0', '5', '900', '']) {
    await page.fill('#default-speed', bad);
    await page.dispatchEvent('#default-speed', 'change');
    expect(await page.evaluate(() => tune('defaultLegSpeedKt'))).toBe(90);
    await expect(page.locator('#default-speed')).toHaveValue('90');
  }
});

test('the saved value outranks the gist', async ({ page }) => {
  await page.addInitScript(() => {
    try { localStorage.setItem('navaid.defaultSpeed', '105'); } catch (e) {}
  });
  // Let the gist path run (no ?nogist) and pretend it ships a different speed.
  await page.route('**/gist*', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ defaultLegSpeedKt: 70 }),
  }));
  await boot(page, '?lang=en');
  await page.waitForFunction(() => document.getElementById('default-speed').value !== '');
  expect(await page.evaluate(() => tune('defaultLegSpeedKt'))).toBe(105);
  await expect(page.locator('#default-speed')).toHaveValue('105');
});
