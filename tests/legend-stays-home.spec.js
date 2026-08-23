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

test('an opened toolbar moves the legend but does not adopt the move', async ({ page }) => {
  await boot(page, { x: 12, y: 150 });
  const placed = await at(page);
  await page.locator('#toolbar-toggle').click();
  await page.waitForTimeout(400);
  const shoved = await at(page);
  expect(shoved.y).not.toBe(placed.y);                 // it got out of the way...
  expect(shoved.stored).toEqual(placed.stored);        // ...without rewriting where it lives
});

test('it comes home when the toolbar closes', async ({ page }) => {
  await boot(page, { x: 12, y: 150 });
  const placed = await at(page);
  await page.locator('#toolbar-toggle').click();
  await page.waitForTimeout(400);
  await page.locator('#toolbar-toggle').click();
  await page.waitForTimeout(500);
  const back = await at(page);
  expect(back.y).toBe(placed.y);
  expect(back.x).toBe(placed.x);
});

// The walk: open the menu, change a layer, close, repeat. The card used to be a little
// further down every round.
test('repeated trips to the layer picker leave it where it started', async ({ page }) => {
  await boot(page, { x: 12, y: 150 });
  const placed = await at(page);
  for (const layer of ['Low Alt', 'Satellite', 'CVFR']) {
    await page.locator('#toolbar-toggle').click();
    await page.waitForTimeout(350);
    await page.evaluate((v) => { const s = document.getElementById('layer-select'); s.value = v; s.onchange(); }, layer);
    await page.waitForTimeout(350);
    await page.locator('#toolbar-toggle').click();
    await page.waitForTimeout(450);
  }
  const end = await at(page);
  expect(end).toEqual(placed);
});

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
