// @ts-check
// On a phone, panels open and stay in the space between the top strip and the bottom bar --
// never under the strip (their title and close button hidden) or over it. Reported with the
// route templates, the planning form and the SIGMET list in the app, where the status bar
// pushes the strip down: the backdrop now hangs from the strip's bottom EDGE, not its height,
// and a dragged panel is kept inside that space, not inside the whole window.
const { test, expect } = require('./_setup');
test.use({ viewport: { width: 390, height: 780 }, hasTouch: true, isMobile: true });

async function boot(page) {
  await page.goto('?lang=he&nogist');
  await page.waitForFunction(() => NavAid.disclaimerDone && typeof showRouteTemplatesModal === 'function' && document.body.classList.contains('deck-on'));
}
const titleShows = (page) => page.evaluate(() => {
  const m = document.querySelector('.modal-back .modal'); const s = document.getElementById('deck-strip').getBoundingClientRect();
  const t = m.querySelector('.modal-title').getBoundingClientRect();
  return { below: Math.round(t.top) >= Math.round(s.bottom), boxTop: Math.round(m.getBoundingClientRect().top), stripBottom: Math.round(s.bottom) };
});

test('a strip pushed down by the status bar: the panel opens below it', async ({ page }) => {
  await boot(page);
  // As in the app: something above the strip (the status bar) moves it 40 px down.
  await page.addStyleTag({ content: 'body.deck-on .deck-strip { top: 40px !important; }' });
  await page.evaluate(() => window.dispatchEvent(new Event('resize')));   // as the app does when its insets arrive
  await page.waitForTimeout(200);
  await page.evaluate(() => showRouteTemplatesModal());
  const r = await titleShows(page);
  expect(r.below).toBe(true);
  expect(r.boxTop).toBeGreaterThanOrEqual(r.stripBottom);
});

test('a panel dragged up stops under the strip, not under or over it', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => showRouteTemplatesModal());
  const t = await page.locator('.route-template-modal .modal-title').boundingBox();
  await page.mouse.move(t.x + 20, t.y + 10);
  await page.mouse.down();
  await page.mouse.move(t.x + 20, 0, { steps: 5 });
  await page.mouse.up();
  const r = await titleShows(page);
  expect(r.below).toBe(true);
});
