// @ts-check
// One chart on screen at a time.
//
// closeOpenChartModals() has always been the rule: it sweeps every
// .modal-back[data-chart-modal], the flight plan, and the planning form, so that opening a
// chart clears whatever was up. But the rule only reaches a window whose OPENER calls it,
// and two never did -- the planning form and the route check. Both are swept BY the sweep;
// neither ran it. So they opened on top of whatever was already there: two full-width
// windows about the same route, one over the other.
//
// The test is a full pairwise matrix rather than a case per pair, because the failure was
// not one bad pair -- it was a whole column of them, and a column is what a matrix shows.
const { test, expect } = require('./_setup');

// Everything on the toolbar that opens a chart-class window.
const OPENERS = ['route-templates', 'freq-table', 'alt-pairs', 'nav-log', 'charts',
  'route-check-btn', 'plan', 'route-library'];

async function boot(page) {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.addInitScript(() => {
    for (const s of ['build', 'view', 'display', 'charts', 'export', 'print'])
      try { localStorage.setItem('navaid.sec.' + s, '1'); } catch (e) {}
  });
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof draw === 'function'
    && !document.documentElement.classList.contains('app-booting'));
  await page.evaluate(() => {
    const b = document.getElementById('boot-loading'); if (b) b.remove();
    state.waypoints = [{ lat: 32.18, lng: 34.83, name: 'LLHZ' }, { lat: 32.78, lng: 35.04, name: 'LLHA' }];
    syncLegs(); draw();
  });
}

const shut = page => page.evaluate(() => {
  for (const b of document.querySelectorAll('.modal-back')) {
    if (b._navaidClose) b._navaidClose(); else b.remove();
  }
});
// Which windows are up, named so a failure says WHICH two were stacked.
const openWindows = page => page.evaluate(() => [...document.querySelectorAll('.modal-back')]
  .filter(b => { const c = getComputedStyle(b); return c.display !== 'none' && !b.hidden; })
  .map(b => b.dataset.chartModal
    || (b.querySelector('.navlog-modal') ? 'planning-form'
      : ((b.querySelector('.modal-title') || {}).textContent || '?').trim().slice(0, 24))));
const press = async (page, id) => {
  await page.evaluate(i => { const e = document.getElementById(i); if (e) e.click(); }, id);
  await page.waitForTimeout(320);
};

test('opening any chart closes whatever chart was already open', async ({ page }) => {
  test.setTimeout(300000);
  await boot(page);
  const stacked = [];
  for (const first of OPENERS) {
    for (const second of OPENERS) {
      if (first === second) continue;
      await shut(page);
      await press(page, first);
      if (!(await openWindows(page)).length) continue;   // this one opens nothing here
      await press(page, second);
      const up = await openWindows(page);
      if (up.length > 1) stacked.push(first + ' then ' + second + ' => [' + up.join(' | ') + ']');
    }
  }
  expect(stacked, 'charts stacked instead of replacing each other').toEqual([]);
});

test('the flight plan and the planning form replace each other, both ways', async ({ page }) => {
  await boot(page);
  // The two windows most likely to be confused for one another: both are full-width tables
  // of the same route, so one over the other is the worst version of this bug.
  for (const [a, b] of [['plan', 'nav-log'], ['nav-log', 'plan']]) {
    await shut(page);
    await press(page, a);
    expect(await openWindows(page), a + ' did not open').toHaveLength(1);
    await press(page, b);
    expect(await openWindows(page), a + ' then ' + b).toHaveLength(1);
  }
});
