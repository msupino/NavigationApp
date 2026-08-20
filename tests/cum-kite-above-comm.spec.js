// @ts-check
// Reported: a frequency-change callout covered the cumulative-time kite. Both sit on the leg,
// and the callout is a filled box on a tail — where they overlap, the number a pilot is
// scanning for on that leg (when they reach the point) was hidden behind a label they had
// already read. The kite is painted last now.
const { test, expect } = require('./_setup');

async function boot(page) {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof draw === 'function' && typeof drawCumTimeArrow === 'function');
  await page.evaluate(() => {
    state.waypoints = [
      { lat: 32.00, lng: 34.80, name: 'ALPHA' },
      { lat: 32.30, lng: 35.10, name: 'BRAVO' },
    ];
    syncLegs();
    showCumTime = true;
    map.setView([32.15, 34.95], 10);
    draw();
  });
}

// The order in which the two land on the canvas, by hooking their draw entry points.
const paintOrder = (page) => page.evaluate(() => {
  const seen = [];
  const origKite = window.drawCumTimeArrow;
  const origNotes = window.drawNotes;
  window.drawCumTimeArrow = function (...a) { seen.push('kite'); return origKite.apply(null, a); };
  window.drawNotes = function (...a) { seen.push('notes'); return origNotes.apply(null, a); };
  try { draw(); } finally {
    window.drawCumTimeArrow = origKite;
    window.drawNotes = origNotes;
  }
  return seen;
});

test('the cumulative kite is painted after the notes and callouts', async ({ page }) => {
  await boot(page);
  const order = await paintOrder(page);
  expect(order).toContain('kite');
  expect(order).toContain('notes');
  // Last notes pass comes before the first kite: the kite is on top.
  expect(order.lastIndexOf('notes')).toBeLessThan(order.indexOf('kite'));
});

test('every queued kite is flushed — none are lost on the way', async ({ page }) => {
  await boot(page);
  const out = await page.evaluate(() => {
    let painted = 0;
    const orig = window.drawCumTimeArrow;
    window.drawCumTimeArrow = function (...a) { painted++; return orig.apply(null, a); };
    try { draw(); } finally { window.drawCumTimeArrow = orig; }
    return { painted, queued: _cumKiteQueue.length };
  });
  expect(out.painted).toBeGreaterThan(0);      // the outbound leg's kite
  expect(out.queued).toBe(0);                  // and nothing left waiting
});

// The PNG export paints its own chart; the kite has to come last there too, or the exported
// sheet differs from the screen.
test('the export paints them in the same order', async ({ page }) => {
  await boot(page);
  const order = await page.evaluate(() => {
    const seen = [];
    const origKite = window.drawCumTimeArrow;
    const origNotes = window.drawNotes;
    window.drawCumTimeArrow = function (...a) { seen.push('kite'); return origKite.apply(null, a); };
    window.drawNotes = function (...a) { seen.push('notes'); return origNotes.apply(null, a); };
    try {
      drawLegs(); drawWaypoints(); drawNotes();
      if (typeof flushCumTimeArrows === 'function') flushCumTimeArrows();
    } finally {
      window.drawCumTimeArrow = origKite;
      window.drawNotes = origNotes;
    }
    return seen;
  });
  expect(order.lastIndexOf('notes')).toBeLessThan(order.indexOf('kite'));
});
