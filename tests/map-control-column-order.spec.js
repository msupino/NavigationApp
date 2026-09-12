// @ts-check
// Reported from the cockpit, with a screenshot: starting a follow-me share pushed the
// rotation dial up a row.
//
// The bottom-right column sorts itself by a list of class names, and anything not on that
// list ranks last -- which is right for Leaflet's own zoom and scale, and wrong for ours.
// follow-me was never added, so its icon landed BELOW the dial the moment sharing began, and
// every control above it moved. It belongs in the in-flight group it was built for, beside
// the follow lock.
const { test, expect } = require('./_setup');

async function boot(page) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => window.NavAid && typeof orderMapControls === 'function'
    && document.querySelector('.rotate-ctrl'));
}

// The column, top to bottom, by the class that names each control. Hidden rows are left out:
// what matters is the order of what is actually on screen.
const column = (page) => page.evaluate(() => {
  const corner = document.querySelector('.rotate-ctrl').parentNode;
  return Array.prototype.slice.call(corner.children)
    .filter(el => el.getClientRects().length)
    .map(el => (el.className || '').toString().split(/\s+/).find(c => c.endsWith('-ctrl')
      || c === 'leaflet-control-zoom' || c === 'assistant-fab-control') || el.className);
});

// Everything in that column appears on a rule of its own; force the in-flight ones on.
const goLive = (page) => page.evaluate(() => {
  NavAid.tuningDefaults.featureFollowMe.value = true;
  window.gpsLiveOn = true;
  if (typeof refreshVoiceControl === 'function') refreshVoiceControl();
  if (typeof refreshGpsFollowControl === 'function') refreshGpsFollowControl();
  if (typeof refreshFollowMeMapControl === 'function') refreshFollowMeMapControl();
  if (typeof refreshOrientControl === 'function') refreshOrientControl();
});

test('follow-me joins the in-flight icons instead of landing under the dial', async ({ page }) => {
  await boot(page);
  await goLive(page);
  const seen = await column(page);
  expect(seen, 'follow-me is not in the column').toContain('follow-me-ctrl');
  // Beside the follow lock, which is the control it was built next to...
  expect(seen.indexOf('follow-me-ctrl')).toBe(seen.indexOf('follow-ctrl') + 1);
  // ...and above the dial, which is what moved.
  expect(seen.indexOf('follow-me-ctrl')).toBeLessThan(seen.indexOf('rotate-ctrl'));
});

test('the dial keeps its place when sharing starts', async ({ page }) => {
  await boot(page);
  await goLive(page);
  const before = await page.evaluate(() =>
    Math.round(document.querySelector('.rotate-ctrl').getBoundingClientRect().bottom));
  await page.evaluate(() => {
    // What starting a share does to this column: the icon stops being display:none.
    const wrap = document.querySelector('.follow-me-ctrl');
    wrap.style.display = '';
    orderMapControls(wrap.parentNode);
  });
  const after = await page.evaluate(() =>
    Math.round(document.querySelector('.rotate-ctrl').getBoundingClientRect().bottom));
  // The column is anchored at the bottom corner, so a row added ABOVE the dial leaves the
  // dial exactly where the pilot last saw it. A row added below it moves everything.
  expect(after).toBe(before);
});

test('Leaflet’s own controls still rank below ours', async ({ page }) => {
  await boot(page);
  await goLive(page);
  const seen = await column(page);
  const zoom = seen.indexOf('leaflet-control-zoom');
  if (zoom < 0) return;                        // not in this corner on every layout
  // Unranked is still last among the controls this app places: the zoom keys and the credits
  // sit under the whole in-flight group, which is what the fallback rank is for.
  expect(zoom).toBeGreaterThan(seen.indexOf('rotate-ctrl'));
});
