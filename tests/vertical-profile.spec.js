// #672 — top-of-climb / top-of-descent + vertical profile.
const { test, expect } = require('@playwright/test');

async function boot(page) {
  await page.goto('?lang=en');
  await page.waitForFunction(() => typeof state !== 'undefined' &&
    typeof routeProfile === 'function' && typeof showFlightPlan === 'function');
}

// 3 legs at 3000 / 8000 / 3000 ft → leg 1 climbs then descends (TOC + TOD).
async function seed(page) {
  await page.evaluate(() => {
    state.waypoints = [
      { lat: 32.0, lng: 34.8, name: 'A' }, { lat: 32.2, lng: 34.9, name: 'B' },
      { lat: 32.6, lng: 35.1, name: 'C' }, { lat: 32.8, lng: 35.2, name: 'D' },
    ];
    state.legs = []; syncLegs();
    const a = [3000, 8000, 3000];
    state.legs.forEach((l, i) => { l.flightSpeed = 110; l.inboundAltitude = a[i]; });
  });
}

test('routeProfile marks TOC + TOD and segments climb/descent time', async ({ page }) => {
  await boot(page);
  await seed(page);
  const p = await page.evaluate(() => routeProfile({ gph: 8, climbFpm: 700, descentFpm: 500, climbKt: 75, descentKt: 110 }));
  // Leg 1 (index 1) climbs 3000→8000 at start and descends 8000→3000 at end.
  expect(p.tocs.some(t => t.leg === 1)).toBe(true);
  expect(p.tods.some(t => t.leg === 1)).toBe(true);
  const toc = p.tocs.find(t => t.leg === 1);
  expect(toc.frac).toBeGreaterThan(0);
  expect(toc.frac).toBeLessThan(1);
  expect(p.totalDist).toBeGreaterThan(0);
  expect(p.legs[1].climbDist).toBeGreaterThan(0);
  expect(p.legs[1].descDist).toBeGreaterThan(0);
  // Climb/descent flown at their own speeds → leg time differs from flat cruise.
  const flat = p.legs[1].dist / 110;
  expect(Math.abs(p.legs[1].timeH - flat)).toBeGreaterThan(0.001);
});

test('flat route (constant altitude) has no TOC/TOD', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => {
    state.waypoints = [{ lat: 32, lng: 34.8, name: 'A' }, { lat: 32.4, lng: 35, name: 'B' }];
    state.legs = []; syncLegs();
    state.legs[0].flightSpeed = 100; state.legs[0].inboundAltitude = 3000;
  });
  const p = await page.evaluate(() => routeProfile({ gph: 8 }));
  expect(p.tocs.length).toBe(0);
  expect(p.tods.length).toBe(0);
});

test('flight plan modal renders the vertical-profile strip', async ({ page }) => {
  await boot(page);
  await seed(page);
  await page.evaluate(() => showFlightPlan());
  await expect(page.locator('.fp-profile-canvas')).toBeVisible();
  await expect(page.locator('.fp-profile-label')).toContainText(/profile/i);
  // TOC/TOD map markers turn on while the plan is open.
  expect(await page.evaluate(() => window.showProfile)).toBe(true);
  // The strip must paint on first open — not only after an edit. refresh()
  // runs before the modal is in the DOM, so the canvas was disconnected and
  // the draw bailed; a post-mount rAF redraw fixes it (#672 regression).
  const painted = await page.evaluate(async () => {
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    const c = document.querySelector('.fp-profile-canvas');
    const cx = c.getContext('2d');
    const px = cx.getImageData(0, 0, c.width, c.height).data;
    for (let i = 3; i < px.length; i += 4) if (px[i] !== 0) return true;
    return false;
  });
  expect(painted).toBe(true);
});
