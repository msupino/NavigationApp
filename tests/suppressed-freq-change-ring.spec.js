// @ts-check
// A red circle on the map means a hotspot -- a point the pilot marked, or one the route
// graph calls a junction. It used to ALSO mean "change frequency here", drawn at every
// published comm-change point, and it stayed drawn even after the pilot suppressed that
// change. One symbol cannot mean two things, and a stale one is worse than none: the
// frequency change already announces itself in a callout, with the frequency in it.
const { test, expect } = require('./_setup');

async function boot(page) {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof syncLegs === 'function' && typeof loadCommChange === 'function');
  return page.evaluate(async () => {
    await Promise.all([loadNavWaypoints(), loadCommChange()]);
    const name = Object.keys(commChangeMap).find(k => commChangeMap[k] && commChangeMap[k].commChange
      && navWP.some(w => w.name === k));
    const pt = navWP.find(w => w.name === name);
    state.waypoints = [
      { lat: pt.lat - 0.15, lng: pt.lng - 0.1, name: 'A' },
      { lat: pt.lat, lng: pt.lng, name: pt.name },
      { lat: pt.lat + 0.15, lng: pt.lng + 0.1, name: 'B' },
    ];
    state.commChangeSuppressions = [];
    syncLegs();
    window.showCommChange = true;
    map.setView([pt.lat, pt.lng], 10);
    draw();
    return name;
  });
}

const rings = (page) => page.evaluate(() => {
  draw();
  return Array.from(window.__commChangeRingsDrawn || []);
});

test('no red circle is drawn at a frequency change', async ({ page }) => {
  await boot(page);
  expect(await rings(page)).toEqual([]);
});

// The reported bug, kept as a test against the tunable that still draws the ring: with it
// on, suppressing the change has to take its circle away too.
test('with the ring turned back on, suppressing the change removes it', async ({ page }) => {
  const name = await boot(page);
  await page.evaluate(() => { setTune('commChangeRings', true); draw(); });
  expect(await rings(page)).toContain(name);

  await page.evaluate((nm) => { suppressCommChange(nm); draw(); }, name);
  expect(await rings(page)).not.toContain(name);

  // ...and putting it back brings the circle back: suppression is a decision, not a delete.
  await page.evaluate((nm) => { unsuppressCommChange(nm); draw(); }, name);
  expect(await rings(page)).toContain(name);
});

// The legend has to agree with the map: its ringed circle is the hotspot symbol now.
test('the legend circle stands for a hotspot', async ({ page }) => {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => !!document.querySelector('.map-legend-row .legend-atc'));
  const legend = await page.evaluate(() => {
    const sym = document.querySelector('.legend-atc');
    const row = sym.closest('.map-legend-row');
    const cs = getComputedStyle(sym, '::before');
    return { label: row.textContent.trim(), fill: cs.backgroundColor, ring: cs.borderTopColor };
  });
  expect(legend.label).toBe('Hotspot');
  expect(legend.fill).toBe('rgb(255, 209, 102)');
  expect(legend.ring).toBe('rgb(215, 38, 61)');
});
