// @ts-check
// The legend is a dock on every layout: a round Legend button at the bottom left with the route
// totals beside it, and the key opening ABOVE the button, so the button that opened it is where
// it closes. Reported on the desktop ("looks unrelated, takes space, closes in the wrong place")
// and then on the phone ("still using the old button and location"). The key starts closed and
// the choice is remembered on the device.
const { test, expect } = require('./_setup');

const PHONE = { width: 390, height: 780 };
const DESKTOP = { width: 1280, height: 900 };

async function boot(page, size, before, lang = 'en') {
  await page.setViewportSize(size);
  if (before) await page.addInitScript(before);
  await page.goto('?lang=' + lang + '&nogist');
  await page.waitForFunction(() => !!document.getElementById('legend-toggle'));
  await page.waitForSelector('#boot-loading', { state: 'detached', timeout: 15000 });
}

const state = (page) => page.evaluate(() => {
  const el = document.getElementById('map-legend');
  const row = el.querySelector('.map-legend-row');
  return {
    collapsed: el.classList.contains('map-legend-collapsed'),
    rowShown: !!(row && row.offsetParent !== null),
    expanded: document.getElementById('legend-toggle').getAttribute('aria-expanded'),
    stored: localStorage.getItem('navaid.legendCollapsed'),
  };
});

for (const [name, size, lang] of [['a phone', PHONE, 'en'], ['a phone in Hebrew', PHONE, 'he'], ['a desktop', DESKTOP, 'en']]) {
  test(`on ${name} it starts closed; the button opens the key above itself and closes it in place`, async ({ page }) => {
    await boot(page, size, null, lang);
    const s = await state(page);
    expect(s.collapsed).toBe(true);
    expect(s.rowShown).toBe(false);
    expect(s.expanded).toBe('false');
    const btn = page.locator('#legend-toggle');
    const shut = await btn.boundingBox();
    expect(shut.x).toBeLessThan(40);                                 // bottom-left, in Hebrew too
    await btn.click();
    const open = await state(page);
    expect(open.collapsed).toBe(false);
    expect(open.rowShown).toBe(true);
    expect(open.stored).toBe('0');
    const key = await page.locator('#map-legend').boundingBox();
    expect(key.y + key.height).toBeLessThanOrEqual(shut.y);           // above the button
    const still = await btn.boundingBox();
    expect(Math.round(still.x)).toBe(Math.round(shut.x));            // the button did not move
    expect(Math.round(still.y)).toBe(Math.round(shut.y));
    expect(await page.evaluate(() => getComputedStyle(document.getElementById('legend-toggle')).backgroundColor))
      .toBe('rgb(29, 111, 224)');                                    // toolbar blue while open
    await page.keyboard.press('Escape');
    expect((await state(page)).collapsed).toBe(true);
    await btn.click();
    await btn.click();                                               // same spot closes it
    const again = await state(page);
    expect(again.collapsed).toBe(true);
    expect(again.stored).toBe('1');
  });
}

// Android Back closes an open key before anything else, as it does any other panel.
test('on a phone, Back closes the open key', async ({ page }) => {
  await boot(page, PHONE);
  await page.locator('#legend-toggle').click();
  expect((await state(page)).collapsed).toBe(false);
  expect(await page.evaluate(() => backButtonStep())).toBe(true);
  expect((await state(page)).collapsed).toBe(true);
});

test('the choice is remembered on this device', async ({ page }) => {
  await boot(page, PHONE, () => localStorage.setItem('navaid.legendCollapsed', '0'));
  expect((await state(page)).collapsed).toBe(false);
});

// The phone dock sits one row up, clear of the coordinate readout across the bottom.
test('on a phone the dock is clear of the coordinate readout', async ({ page }) => {
  await boot(page, PHONE);
  const hit = await page.evaluate(() => {
    const a = document.querySelector('.legend-dock').getBoundingClientRect();
    const b = document.getElementById('coord-readout').getBoundingClientRect();
    return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
  });
  expect(hit).toBe(false);
});
