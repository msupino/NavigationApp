// @ts-check
// The legend card keeps clear of the map clock.
//
// The clock is a full-width strip along the bottom of the chart with its controls laid out
// inside it, and the legend sits bottom-left. On a wide screen they miss each other; below
// about 1150px the card reached across the clock's row and sat on top of the control at its
// left end. Which control that is depends on the language, because the strip is laid out
// with the text direction:
//
//     en   the Now button       covered 47x22 at 900px
//     he   the hour readout     covered 54x22 at 900px
//
// Covered to the point of being unusable: hit-testing the button's own centre returned the
// legend's version line, not the button. 1024px is an iPad in landscape and a half-screen
// laptop window, so this is not an unusual size.
//
// The legend already avoids chrome that is not transient -- it is why it steps around the
// docked search panel but deliberately NOT around the toolbar, which comes and goes. The
// clock belongs on that list: it has a fixed place and it DIMS rather than vanishing when
// nothing answers to it. The card moves, because the clock cannot.
const { test, expect } = require('./_setup');

async function boot(page, lang) {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('?lang=' + lang + '&nogist');
  await page.waitForFunction(() => typeof draw === 'function'
    && !document.documentElement.classList.contains('app-booting'));
  await page.evaluate(() => { const b = document.getElementById('boot-loading'); if (b) b.remove(); });
  // A route, so the legend carries its summary line and is at its widest.
  await page.evaluate(() => {
    state.waypoints = [{ lat: 32.18, lng: 34.83, name: 'LLHZ' }, { lat: 32.78, lng: 35.04, name: 'LLHA' }];
    syncLegs(); draw();
    const cb = document.getElementById('notam-cb');       // a timed layer, so the clock is live
    if (cb && !cb.checked) { cb.checked = true; cb.dispatchEvent(new Event('change', { bubbles: true })); }
  });
}

// Every control in the strip, measured against the legend, and hit-tested at its own edge
// and centre: a rect that merely misses is not proof that a thumb lands on the control.
const audit = page => page.evaluate(() => {
  const legend = document.querySelector('.map-legend').getBoundingClientRect();
  const out = { overlap: [], covered: [] };
  for (const id of ['map-time-now', 'map-time-read', 'map-time-slider']) {
    const el = document.getElementById(id);
    if (!el || el.hidden) continue;
    const b = el.getBoundingClientRect();
    const ox = Math.min(b.right, legend.right) - Math.max(b.left, legend.left);
    const oy = Math.min(b.bottom, legend.bottom) - Math.max(b.top, legend.top);
    if (ox > 2 && oy > 2) out.overlap.push(id + ' ' + Math.round(ox) + 'x' + Math.round(oy));
    for (const [x, y] of [[b.left + 4, (b.top + b.bottom) / 2],
      [(b.left + b.right) / 2, (b.top + b.bottom) / 2]]) {
      const hit = document.elementFromPoint(x, y);
      if (!el.contains(hit)) out.covered.push(id + ' -> ' + (hit ? (hit.id || hit.className) : 'null'));
    }
  }
  return out;
});

for (const lang of ['en', 'he']) {
  test('the legend never sits on the clock (' + lang + ')', async ({ page }) => {
    await boot(page, lang);
    for (const width of [820, 900, 1024, 1150, 1280]) {
      await page.setViewportSize({ width, height: 800 });
      // The card is re-seated on a viewport resize, on its own frame.
      await expect.poll(() => audit(page).then(a => a.overlap.concat(a.covered)),
        { message: 'at ' + width + 'px wide' }).toEqual([]);
    }
  });
}

test('the row is given back when the clock is withdrawn', async ({ page }) => {
  await boot(page, 'en');
  await page.setViewportSize({ width: 900, height: 800 });
  await expect.poll(() => audit(page).then(a => a.overlap)).toEqual([]);
  const withClock = await page.evaluate(() =>
    document.querySelector('.map-legend').getBoundingClientRect().bottom);

  // The gist can withdraw the clock. The card should be free to use the row again rather
  // than keeping a gap for something that is no longer there.
  await page.evaluate(() => {
    NavAid.tuningDefaults.featureMapClock.value = false;
    NavAid.refreshMapClock();
  });
  await expect(page.locator('#map-time')).toBeHidden();
  await expect.poll(() => page.evaluate(() =>
    document.querySelector('.map-legend').getBoundingClientRect().bottom))
    .toBeGreaterThan(withClock);
});
