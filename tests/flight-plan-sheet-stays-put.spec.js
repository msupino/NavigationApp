// @ts-check
// Reported with two screenshots seconds apart: the flight-plan sheet jumps on pressing.
//
// A modal is centred in the space it has, so anything that changes its height -- a field
// gaining focus, the vertical profile finishing its first paint, a row appearing -- moves the
// whole sheet. On a desktop that is a shrug; on a phone it is the panel sliding under the
// finger that pressed it.
const { test, expect } = require('./_setup');

const planTop = (page) => page.evaluate(() =>
  Math.round(document.querySelector('.modal-back.flight-plan .modal').getBoundingClientRect().top));

async function openPlan(page, width, height) {
  await page.setViewportSize({ width, height });
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof showFlightPlan === 'function' && typeof draw === 'function');
  await page.evaluate(() => {
    state.waypoints = [{ lat: 32.18, lng: 34.83, name: 'LLHZ' },
                       { lat: 32.78, lng: 35.02, name: 'LLHA' }];
    syncLegs();
    draw();
    showFlightPlan();
  });
}

test('the sheet is anchored to the top on a phone, so it grows rather than jumps', async ({ page }) => {
  await openPlan(page, 390, 844);
  const before = await planTop(page);
  await page.evaluate(() => {
    // Something inside gets taller, the way it does when the profile paints.
    const filler = document.createElement('div');
    filler.style.height = '120px';
    document.querySelector('.modal-back.flight-plan .modal').appendChild(filler);
  });
  expect(await planTop(page), 'the sheet moved when its content grew').toBe(before);
});

test('on a desktop it is still centred', async ({ page }) => {
  await openPlan(page, 1280, 900);
  const align = await page.evaluate(() =>
    getComputedStyle(document.querySelector('.modal-back.flight-plan')).alignItems);
  expect(align).toBe('center');
});
