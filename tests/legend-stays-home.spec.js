// @ts-check
// Reported: "legend keeps jumping in mobile when changing layers". Reaching the layer picker
// on a phone means opening the toolbar, which covers the legend; the card was shoved clear
// AND the shove was written to storage, so it never came back — and every trip to the menu
// moved it again, a step at a time down the screen.
const { test, expect } = require('./_setup');

const KEY = 'navaid.legendPos.en';

async function boot(page, home) {
  await page.setViewportSize({ width: 390, height: 780 });
  // Open: a collapsed card is a chip that the toolbar rarely reaches, and this file is about
  // what happens when chrome DOES cover it. See legend-collapsed-mobile.spec.js for the size.
  await page.addInitScript(() => localStorage.setItem('navaid.legendCollapsed', '0'));
  if (home) await page.addInitScript(([k, v]) => localStorage.setItem(k, v), [KEY, JSON.stringify(home)]);
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof map !== 'undefined' && !!document.getElementById('map-legend'));
  await page.waitForSelector('#boot-loading', { state: 'detached', timeout: 15000 });
}

const at = (page) => page.evaluate((k) => {
  const r = document.getElementById('map-legend').getBoundingClientRect();
  return { x: Math.round(r.x), y: Math.round(r.y),
           stored: JSON.parse(localStorage.getItem(k) || 'null') };
}, KEY);

test('dragging it still decides where it lives', async ({ page }) => {
  await boot(page);
  const box = page.locator('#map-legend');
  const before = await box.boundingBox();
  await page.mouse.move(before.x + 20, before.y + 10);
  await page.mouse.down();
  await page.mouse.move(before.x + 20, before.y - 120, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(200);
  const after = await at(page);
  expect(after.stored).not.toBeNull();
  expect(Math.abs(after.stored.y - after.y)).toBeLessThan(2);   // stored = where it now is
});

// Reported separately: on a phone, expanding the legend and closing it again leaves it
// somewhere new. A card low on the screen is too tall to fit once it opens, so it is clamped
// upwards -- correct, and temporary. Collapsing it used to re-apply THAT position rather than
// the one the pilot chose, so every open/close walked the card up the screen.
test('expanding a low legend and closing it puts it back', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 560 });
  await page.addInitScript(() => localStorage.setItem('navaid.legendCollapsed', '1'));
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => !!document.querySelector('.map-legend'));
  await page.waitForFunction(() => !document.documentElement.classList.contains('app-booting'));

  const top = () => page.evaluate(() =>
    Math.round(document.querySelector('.map-legend').getBoundingClientRect().top));
  const tap = async () => {
    const t = await page.locator('.map-legend-title').boundingBox();
    await page.mouse.move(t.x + t.width / 2, t.y + t.height / 2);
    await page.mouse.down();
    await page.mouse.up();
    await page.waitForTimeout(120);
  };

  // Put it low by hand: a drag is what decides where the legend lives.
  const t0 = await page.locator('.map-legend-title').boundingBox();
  await page.mouse.move(t0.x + 20, t0.y + 10);
  await page.mouse.down();
  await page.mouse.move(t0.x + 30, 300, { steps: 6 });
  await page.mouse.move(t0.x + 30, 520, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(150);
  const home = await top();

  await tap();                                   // open: too tall down there, so it rides up
  const opened = await top();
  expect(opened).toBeLessThan(home);

  await tap();                                   // close: back to where it was put
  expect(await top()).toBe(home);

  // ...and again, because the bug was cumulative: each round used to move it further.
  await tap(); await tap();
  expect(await top()).toBe(home);
});
