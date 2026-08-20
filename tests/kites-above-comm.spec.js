// @ts-check
// Reported: a frequency-change callout covered the kites. All three sit on the leg, and the
// callout is a filled box on a tail — where they overlap, the numbers a pilot is still
// scanning for (what to fly, and when they reach the point) were hidden behind a label they
// had already read. Both kites are painted last now.
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
    return { painted, queued: _kiteQueue.length };
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
      if (typeof flushKites === 'function') flushKites();
    } finally {
      window.drawCumTimeArrow = origKite;
      window.drawNotes = origNotes;
    }
    return seen;
  });
  expect(order.lastIndexOf('notes')).toBeLessThan(order.indexOf('kite'));
});

// The nav kite is the one carrying the heading and altitude to fly; it had the same problem.
test('the nav kite is painted after the notes too', async ({ page }) => {
  await boot(page);
  const order = await page.evaluate(() => {
    const seen = [];
    const origArrow = window.drawLegArrow;
    const origNotes = window.drawNotes;
    window.drawLegArrow = function (...a) { seen.push('nav'); return origArrow.apply(null, a); };
    window.drawNotes = function (...a) { seen.push('notes'); return origNotes.apply(null, a); };
    try { draw(); } finally {
      window.drawLegArrow = origArrow;
      window.drawNotes = origNotes;
    }
    return seen;
  });
  expect(order).toContain('nav');
  expect(order.lastIndexOf('notes')).toBeLessThan(order.indexOf('nav'));
});

test('both kinds of kite flush, and the queue is left empty', async ({ page }) => {
  await boot(page);
  const out = await page.evaluate(() => {
    let nav = 0; let cum = 0;
    const oa = window.drawLegArrow; const oc = window.drawCumTimeArrow;
    window.drawLegArrow = function (...a) { nav++; return oa.apply(null, a); };
    window.drawCumTimeArrow = function (...a) { cum++; return oc.apply(null, a); };
    try { draw(); } finally { window.drawLegArrow = oa; window.drawCumTimeArrow = oc; }
    return { nav, cum, queued: _kiteQueue.length };
  });
  expect(out.nav).toBeGreaterThan(0);
  expect(out.cum).toBeGreaterThan(0);
  expect(out.queued).toBe(0);
});
