// @ts-check
// On a phone the inspector is a bottom sheet pinned to both screen edges. The header is a
// drag handle on desktop, and it used to release the sheet's right edge on MOUSEDOWN --
// before knowing whether a drag had begun. A tap is a mousedown, so simply touching the
// header (or the title while reading it) collapsed the sheet from edge-to-edge to
// shrink-to-fit, and it stayed collapsed for every later open: the panel looked "wide"
// covering the zoom/north controls, then suddenly narrow, and no longer where the pilot
// expected to dismiss it.
const { test, expect } = require('./_setup');

const PHONE = { width: 412, height: 900 };
const DESKTOP = { width: 1280, height: 900 };

async function boot(page, size) {
  await page.setViewportSize(size);
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof showInspector === 'function' && !!window.navWP);
}
// PELEG is a plain nav waypoint — the repro's selection, and it needs no route.
async function openPeleg(page) {
  await page.evaluate(() => {
    const ix = (window.navWP || []).findIndex(w => (w.name || '').toUpperCase() === 'PELEG');
    state.selected = { type: 'navwp', index: ix };
    showInspector();
  });
  await expect(page.locator('#inspector')).toBeVisible();
}
const width = page => page.evaluate(() =>
  Math.round(document.getElementById('inspector').getBoundingClientRect().width));
const inlineStyle = page => page.evaluate(() =>
  document.getElementById('inspector').getAttribute('style') || '');

async function tapHeader(page) {
  const h = await page.locator('#insp-header').boundingBox();
  await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(30);
  await page.mouse.up();              // pressed and released without moving: a tap
  await page.waitForTimeout(80);
}

test('a tap on the header does not collapse the phone bottom sheet', async ({ page }) => {
  await boot(page, PHONE);
  await openPeleg(page);
  const full = await width(page);
  expect(full).toBeGreaterThan(380);            // edge-to-edge sheet on a 412px screen

  await tapHeader(page);
  expect(await width(page)).toBe(full);         // unchanged by the tap
  expect(await inlineStyle(page)).toBe('');     // and no inline geometry was written

  // ...and it is still the full-width sheet the next time it opens.
  await page.evaluate(() => document.getElementById('insp-close').click());
  await openPeleg(page);
  expect(await width(page)).toBe(full);
  expect(await inlineStyle(page)).toBe('');
});

test('repeated open/close on a phone keeps the same sheet geometry', async ({ page }) => {
  await boot(page, PHONE);
  await openPeleg(page);
  const first = await width(page);
  for (let i = 0; i < 5; i++) {
    await page.evaluate(() => document.getElementById('insp-close').click());
    await expect(page.locator('#inspector')).toBeHidden();   // one close is enough
    await openPeleg(page);
    expect(await width(page)).toBe(first);
  }
});

test('the desktop panel still drags and remembers where it was put', async ({ page }) => {
  await boot(page, DESKTOP);
  await openPeleg(page);
  const before = await page.evaluate(() =>
    Math.round(document.getElementById('inspector').getBoundingClientRect().left));

  const h = await page.locator('#insp-header').boundingBox();
  await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
  await page.mouse.down();
  await page.mouse.move(h.x + h.width / 2 - 300, h.y + h.height / 2 + 80, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(150);

  const after = await page.evaluate(() =>
    Math.round(document.getElementById('inspector').getBoundingClientRect().left));
  expect(after).toBeLessThan(before - 100);      // it actually moved
  const saved = await page.evaluate(() =>
    Object.keys(localStorage).filter(k => /inspPos/i.test(k)).map(k => localStorage.getItem(k)));
  expect(saved.length).toBe(1);                  // ...and the position was remembered
});

test('a desktop press that never moves is not treated as a drag', async ({ page }) => {
  await boot(page, DESKTOP);
  await openPeleg(page);
  const before = await inlineStyle(page);
  await tapHeader(page);
  expect(await inlineStyle(page)).toBe(before);  // nothing repositioned
  const saved = await page.evaluate(() =>
    Object.keys(localStorage).filter(k => /inspPos/i.test(k)));
  expect(saved).toEqual([]);                     // and no position stored
});
