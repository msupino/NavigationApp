// @ts-check
// The charts window is read on a kneeboard: the way back and the category chips must stay
// under the thumb however far the plate list scrolls, and the box must not change width
// between its two screens (all fields → one field's plates).
const { test, expect } = require('./_setup');

async function openCharts(page) {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof showChartsModal === 'function');
  await page.evaluate(() => showChartsModal());
  await page.waitForSelector('.charts-modal-body');
}

// Ben Gurion: the most plates and the most categories, so the only field where the
// scrolling actually buries anything.
async function openField(page, icao = 'LLBG') {
  await page.evaluate((code) => {
    const btn = [...document.querySelectorAll('.charts-field')]
      .find(b => b.textContent.includes(code));
    btn.click();
  }, icao);
  await page.waitForSelector('.charts-field-head');
}

test('the way back and the categories are one block that stays put', async ({ page }) => {
  await openCharts(page);
  await openField(page);
  const head = await page.evaluate(() => {
    const h = document.querySelector('.charts-field-head');
    return {
      sticky: getComputedStyle(h).position,
      holdsBack: !!h.querySelector('.charts-back'),
      holdsChips: !!h.querySelector('.charts-cat-chips'),
      // Nothing else may be sticky inside it: two stacked sticky elements need the first
      // one's height as the second one's offset, which changes as the name wraps.
      innerSticky: [...h.querySelectorAll('*')]
        .filter(el => getComputedStyle(el).position === 'sticky').length,
    };
  });
  expect(head).toEqual({ sticky: 'sticky', holdsBack: true, holdsChips: true, innerSticky: 0 });
});

test('scrolling the plate list leaves them on screen', async ({ page }) => {
  await openCharts(page);
  await openField(page);
  const scroller = page.locator('.fp-scroll');
  const before = await page.locator('.charts-back').boundingBox();
  await scroller.evaluate(el => { el.scrollTop = el.scrollHeight; });
  await page.waitForTimeout(150);
  const after = await page.locator('.charts-back').boundingBox();
  const chips = await page.locator('.charts-cat-chips').boundingBox();
  // Sticky, not merely slow: a list this long would have carried it hundreds of pixels up.
  expect(Math.abs(after.y - before.y)).toBeLessThan(6);
  expect(await page.locator('.charts-back').isVisible()).toBe(true);
  expect(chips.height).toBeGreaterThan(0);                     // and neither did the chips
});

test('the window keeps one width across both screens', async ({ page }) => {
  await openCharts(page);
  const modal = page.locator('.modal.charts-modal');
  const fields = await modal.boundingBox();
  await openField(page);
  const plates = await modal.boundingBox();
  expect(Math.round(plates.width)).toBe(Math.round(fields.width));
  // ...and back again.
  await page.click('.charts-back');
  await page.waitForSelector('.charts-field');
  expect(Math.round((await modal.boundingBox()).width)).toBe(Math.round(fields.width));
});

// One wait, one notice: turning on an Extra-layers plate raised a toast of its own AND the
// counted marker the plates themselves raise, in two different wordings.
test('turning on a plate layer announces the wait once', async ({ page }) => {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof chartsLoading === 'function');
  const notices = await page.evaluate(() => {
    chartsLoading(true);
    const seen = document.querySelectorAll('.overlay-loading.show, .toast.show').length;
    chartsLoading(false);
    return { seen, count: overlayLoadingCount() };
  });
  expect(notices.seen).toBe(1);
  expect(notices.count).toBe(0);          // and it is cleared again
});
