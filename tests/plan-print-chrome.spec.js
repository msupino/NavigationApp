// @ts-check
// Printing the flight plan on a phone printed the app around it too: the top strip with the
// route, the clocks and the Comm fail button, and the tab bar at the bottom. The print hid a
// list of named elements, and the phone's chrome was not on it. Now only the plan prints.
const { test, expect } = require('./_setup');

// Desktop too: the printed page is narrower than the screen, so the phone layout's media
// queries apply in print and its strip and tab bar came back on a desktop print.
for (const [name, vp] of [['phone', { width: 390, height: 844 }], ['desktop', { width: 1280, height: 800 }]])
test(name + ': a print of the plan is the plan alone', async ({ page }) => {
  await page.setViewportSize(vp);
  await page.goto('?lang=he&nogist');
  await page.waitForFunction(() => typeof showFlightPlan === 'function' && typeof syncLegs === 'function');
  await page.evaluate(() => {
    state.waypoints = [{ lat: 32.18, lng: 34.83, name: 'LLHZ' }, { lat: 32.81, lng: 35.04, name: 'LLHA' }];
    syncLegs(); draw(); showFlightPlan();
  });
  await expect(page.locator('.modal-back.flight-plan .flight-table').first()).toBeVisible();
  await page.emulateMedia({ media: 'print' });
  // An A4 page is about 700 CSS px wide: the width the phone media queries see in print.
  await page.setViewportSize({ width: 700, height: 1000 });
  const shown = await page.evaluate(() => {
    document.body.classList.add('printing-plan');
    // Every body child that still takes space, other than the plan.
    return Array.from(document.body.children)
      .filter(el => !el.matches('.modal-back.flight-plan'))
      .filter(el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; })
      .map(el => el.id || el.className || el.tagName);
  });
  expect(shown).toEqual([]);
  await expect(page.locator('.modal-back.flight-plan .flight-table').first()).toBeVisible();
  await expect(page.locator('.fp-route-file-row')).toBeHidden();
});
