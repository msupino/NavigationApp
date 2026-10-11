// @ts-check
// Asked: sweep for buttons that move when pressed. In the waypoint panel, Mark as turning
// point and Start the clock here each add a status line when pressed. On a phone the action
// block is pinned to the panel's foot, so the line grew it upwards and lifted every button --
// the pressed one 47 px from under the finger; on a desktop it pushed the buttons below down
// ~44 px. Status lines now sit where appearing moves nothing. This presses each toggle and
// checks that no action button moved, on both layouts.
const { test, expect } = require('./_setup');

for (const [name, size] of [['phone', { width: 390, height: 844 }], ['desktop', { width: 1280, height: 900 }]]) {
  test(`waypoint toggles move no button when pressed (${name})`, async ({ page }) => {
    await page.setViewportSize(size);
    await page.goto('?lang=en&nogist');
    await page.waitForFunction(() => typeof showInspector === 'function' && typeof findNavWpToken === 'function');
    await page.evaluate(async () => {
      if (navWP === null) await loadNavWaypoints();
      // A loop, so the turning point is a choice (a retraced route fixes it, with no button).
      state.waypoints = ['LLHZ', 'DEROR', 'HADRA', 'SHARO', 'LLHZ'].map(c => {
        const p = findNavWpToken(c); return { lat: p.lat, lng: p.lng, name: p.name };
      });
      state.legs = []; state.notes = []; syncLegs(); draw();
    });
    const positions = () => page.evaluate(() => Object.fromEntries(
      [...document.querySelectorAll('#insp-body .insp-actions button')]
        .map(b => [b.id || b.className, Math.round(b.getBoundingClientRect().top)])));
    const open = () => page.evaluate(() => { state.selected = { type: 'wp', index: 2 }; showInspector(); });
    for (const id of ['insp-turn-btn', 'insp-timer-btn', 'insp-hotspot-btn']) {
      await open();
      const before = await positions();
      await page.evaluate((i) => document.getElementById(i).click(), id);
      await open();
      const after = await positions();
      const moved = Object.keys(before).filter(k => k in after && Math.abs(after[k] - before[k]) > 3);
      expect(moved, `pressing #${id} moved`).toEqual([]);
      await page.evaluate((i) => document.getElementById(i).click(), id);   // back
    }
  });
}
