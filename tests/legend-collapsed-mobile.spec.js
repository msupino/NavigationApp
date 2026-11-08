// @ts-check
// On a phone the legend card covered most of the bottom-left quarter of the chart to say the
// same six things it says on every flight. It starts collapsed to its title there, opens on a
// tap, and remembers the choice per device. Desktop has the room and is unchanged.
const { test, expect } = require('./_setup');

const PHONE = { width: 390, height: 780 };
const DESKTOP = { width: 1280, height: 900 };

async function boot(page, size, before) {
  await page.setViewportSize(size);
  if (before) await page.addInitScript(before);
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => !!document.getElementById('map-legend'));
  await page.waitForSelector('#boot-loading', { state: 'detached', timeout: 15000 });
}

const state = (page) => page.evaluate(() => {
  const el = document.getElementById('map-legend');
  const title = el.querySelector('.map-legend-title');
  const row = el.querySelector('.map-legend-row');
  return {
    collapsed: el.classList.contains('map-legend-collapsed'),
    rowShown: !!(row && row.offsetParent !== null),
    expanded: title.getAttribute('aria-expanded'),
    height: Math.round(el.getBoundingClientRect().height),
    stored: localStorage.getItem('navaid.legendCollapsed'),
  };
});

test('on a phone it starts collapsed, showing only its title', async ({ page }) => {
  await boot(page, PHONE);
  const s = await state(page);
  expect(s.collapsed).toBe(true);
  expect(s.rowShown).toBe(false);
  expect(s.expanded).toBe('false');
});

// Desktop: a round Legend button opens the key ABOVE itself and closes it from the same spot --
// reported: the old card closed from a title under the route totals and then landed 170px lower.
test('on a desktop it starts closed; the button opens the key above itself and closes it in place', async ({ page }) => {
  await boot(page, DESKTOP);
  expect((await state(page)).collapsed).toBe(true);
  const btn = page.locator('#legend-toggle');
  await expect(btn).toHaveAttribute('aria-expanded', 'false');
  const shut = await btn.boundingBox();
  await btn.click();
  await expect(btn).toHaveAttribute('aria-expanded', 'true');
  const key = await page.locator('#map-legend').boundingBox();
  expect(key.y + key.height).toBeLessThanOrEqual(shut.y);           // above the button
  const open = await btn.boundingBox();
  expect(Math.round(open.x)).toBe(Math.round(shut.x));             // the button did not move
  expect(Math.round(open.y)).toBe(Math.round(shut.y));
  expect(await page.evaluate(() => getComputedStyle(document.getElementById('legend-toggle')).backgroundColor))
    .toBe('rgb(29, 111, 224)');                                    // toolbar blue while open
  await page.keyboard.press('Escape');
  await expect(btn).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('#map-legend')).toBeHidden();
  await btn.click();
  await btn.click();                                               // same spot closes it
  await expect(page.locator('#map-legend')).toBeHidden();
});

test('tapping the title opens it, and tapping again closes it', async ({ page }) => {
  await boot(page, PHONE);
  const title = page.locator('#map-legend .map-legend-title');
  const shut = await state(page);
  await title.click();
  const open = await state(page);
  expect(open.collapsed).toBe(false);
  expect(open.rowShown).toBe(true);
  expect(open.height).toBeGreaterThan(shut.height);
  expect(open.stored).toBe('0');
  await title.click();
  const shutAgain = await state(page);
  expect(shutAgain.collapsed).toBe(true);
  expect(shutAgain.stored).toBe('1');
});

test('the choice is remembered on this device', async ({ page }) => {
  await boot(page, PHONE, () => localStorage.setItem('navaid.legendCollapsed', '0'));
  expect((await state(page)).collapsed).toBe(false);
});

// The card is draggable, and the title is inside it: a drag must not be read as a tap.
test('dragging the card by its title does not toggle it', async ({ page }) => {
  await boot(page, PHONE, () => localStorage.setItem('navaid.legendCollapsed', '0'));
  const title = page.locator('#map-legend .map-legend-title');
  const box = await title.boundingBox();
  await page.mouse.move(box.x + 10, box.y + 5);
  await page.mouse.down();
  await page.mouse.move(box.x + 10, box.y - 100, { steps: 8 });
  await page.mouse.up();
  // It must STAY open: poll for a while so a late toggle would be caught rather than missed.
  await expect.poll(async () => (await state(page)).collapsed, { timeout: 1500 }).toBe(false);
});

// The chevron is the affordance: it points the way the card will open.
test('the chevron says which way it opens', async ({ page }) => {
  await boot(page, PHONE);
  const mark = () => page.evaluate(() => getComputedStyle(
    document.querySelector('#map-legend .map-legend-title'), '::after').content);
  expect(await mark()).toContain('\u25b8');            // collapsed: pointing right
  await page.locator('#map-legend .map-legend-title').click();
  expect(await mark()).toContain('\u25be');            // open: pointing down
});
