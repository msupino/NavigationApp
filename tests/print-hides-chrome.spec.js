// @ts-check
// Nothing but the chart goes on the paper.
//
// The print rule sweeps `.leaflet-control-container`, which covers everything Leaflet owns:
// the zoom keys, the legend card, the rotate dial, the Zulu clock, the attribution. The map
// clock and the docked search panel are not Leaflet controls -- they are children of the map
// container and the body -- so the sweep never reached them, and a slider, a Now button and
// a search box printed across the chart, over the waypoint labels underneath.
//
// The test asks the question the other way round from the rule: not "are these two hidden?"
// but "what is left standing that is not the chart?". A control added later is furniture the
// rule has not been told about, and this fails the moment one appears.
const { test, expect } = require('./_setup');

test('nothing but the chart survives print media', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.addInitScript(() => {
    for (const s of ['build', 'view', 'display', 'charts', 'export', 'print'])
      try { localStorage.setItem('navaid.sec.' + s, '1'); } catch (e) {}
  });
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof draw === 'function'
    && !document.documentElement.classList.contains('app-booting'));
  // As much chrome on screen as a pilot could plausibly have up when they hit print.
  await page.evaluate(() => {
    const b = document.getElementById('boot-loading'); if (b) b.remove();
    state.waypoints = [{ lat: 32.18, lng: 34.83, name: 'LLHZ' }, { lat: 32.78, lng: 35.04, name: 'LLHA' }];
    syncLegs(); draw();
    state.selected = { type: 'wp', index: 1 }; showInspector();
    const cb = document.getElementById('notam-cb');
    if (cb && !cb.checked) { cb.checked = true; cb.dispatchEvent(new Event('change', { bubbles: true })); }
  });
  // It has to be up on screen first, or the assertion below passes for the wrong reason.
  const onScreen = await page.evaluate(() => ['#toolbar', '#inspector', '#map-time']
    .filter(s => { const e = document.querySelector(s); return e && e.checkVisibility(); }));
  expect(onScreen, 'chrome was not up on screen to begin with').toContain('#map-time');

  await page.emulateMedia({ media: 'print' });
  const left = await page.evaluate(() => {
    const map = document.getElementById('map'), ov = document.getElementById('overlay');
    const out = [];
    for (const e of document.body.children) {
      if (e === map || e === ov) continue;
      if (!e.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) continue;
      const b = e.getBoundingClientRect();
      if (b.width < 2 || b.height < 2) continue;
      out.push(e.id || e.tagName + '.' + String(e.className).split(' ')[0]);
    }
    return out;
  });
  expect(left, 'chrome printed over the chart').toEqual([]);
});
