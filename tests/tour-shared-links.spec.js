// @ts-check
// Asked: "dont show tutorial if link came from follow.. or similar shared links". A Follow me
// view, a shared route or the pilots link opens on what was shared: no first-launch tour, and the
// tour stays unseen for the pilot's own first visit.
const { test, expect } = require('./_setup');

async function optIn(page) {
  await page.addInitScript(() => {
    window.__navaidNoTour = false;                         // the suite turns tours off (tests/_setup.js)
    // A Follow me view connects to its relay: keep it on this machine.
    window.WebSocket = class { constructor() { this.readyState = 0; } send() {} close() {} addEventListener() {} };
  });
}

for (const [name, query] of [
  ['a Follow me link', '?follow=TESTID&nogist#k=AAAAAAAAAAAAAAAAAAAAAA'],
  ['a shared route', '?r=_p~iF~ps|U_ulLnnqC&n=A,B&l=1500,1500&nogist'],
  ['the pilots link', '?pilots=secret&nogist'],
]) {
  test(`${name} opens without the tour, and leaves it unseen`, async ({ page }) => {
    await optIn(page);
    await page.goto(query);
    await page.waitForFunction(() => window.NavAid && NavAid.tour && !document.getElementById('boot-loading'));
    expect(await page.evaluate(() => window.__navaidFromSharedLink)).toBe(true);
    await page.waitForTimeout(3500);                       // the tour would have started by now
    await expect(page.locator('#map-tour')).toHaveCount(0);
    expect(await page.evaluate(() => localStorage.getItem('navaid.tourSeen'))).toBeNull();
  });
}

test('an ordinary first visit still gets the tour', async ({ page }) => {
  await optIn(page);
  await page.goto('?lang=en&nogist');
  await expect(page.locator('#map-tour')).toBeVisible({ timeout: 10000 });
});
