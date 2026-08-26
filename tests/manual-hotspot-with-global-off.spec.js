// @ts-check
// The global switch and a per-waypoint mark answer different questions. "Show hotspots"
// governs the junctions the route graph DERIVES -- points that measure as busy. Marking one
// yourself is a statement about this route: that point is where you expect to be looking
// out. Now that the overlay ships off, that distinction is the whole feature, so it is
// pinned here.
const { test, expect } = require('./_setup');

async function boot(page) {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof syncLegs === 'function' && typeof draw === 'function');
  await page.evaluate(() => {
    state.waypoints = [{ lat: 32.10, lng: 34.90, name: 'A' },
                       { lat: 32.40, lng: 35.00, name: 'B' }];
    syncLegs();
    const cb = document.getElementById('hotspot-cb');
    cb.checked = false;
    cb.dispatchEvent(new Event('change', { bubbles: true }));   // global: off
    draw();
  });
}

const mark = (page, i) => page.evaluate((idx) => {
  state.selected = { type: 'wp', index: idx };
  showInspector();
  document.getElementById('insp-hotspot-btn').click();
  draw();
}, i);

test('the mark button is there with the global switch off', async ({ page }) => {
  await boot(page);
  const label = await page.evaluate(() => {
    state.selected = { type: 'wp', index: 0 };
    showInspector();
    const b = document.getElementById('insp-hotspot-btn');
    return b ? b.textContent.trim() : null;
  });
  expect(label).toMatch(/Mark as hotspot/);
});

test('a waypoint marked by hand is drawn even though the overlay is off', async ({ page }) => {
  await boot(page);
  expect(await page.evaluate(() => window.__hotspotWaypointIndexes)).toEqual([]);
  await mark(page, 0);
  const after = await page.evaluate(() => ({
    stored: state.waypoints[0].hotspot,
    drawn: window.__hotspotWaypointIndexes,
    button: document.getElementById('insp-hotspot-btn').textContent.trim(),
  }));
  expect(after.stored).toBe(true);
  expect(after.drawn).toEqual([0]);           // the ring is painted
  expect(after.button).toMatch(/Clear hotspot/);
});

test('and clearing it puts the point back to what the graph says', async ({ page }) => {
  await boot(page);
  await mark(page, 0);
  await mark(page, 0);                        // press again: clear
  const after = await page.evaluate(() => ({
    stored: state.waypoints[0].hotspot,
    drawn: window.__hotspotWaypointIndexes,
  }));
  expect(after.stored).toBe(false);
  expect(after.drawn).toEqual([]);
});

// The two controls must not fight: turning the overlay on and off again leaves a hand-made
// mark exactly where the pilot put it.
test('the global switch does not touch a hand-made mark', async ({ page }) => {
  await boot(page);
  await mark(page, 1);
  const seen = await page.evaluate(() => {
    const cb = document.getElementById('hotspot-cb');
    const out = [];
    for (const on of [true, false]) {
      cb.checked = on;
      cb.dispatchEvent(new Event('change', { bubbles: true }));
      draw();
      out.push(window.__hotspotWaypointIndexes.includes(1));
    }
    return { on: out[0], off: out[1], stored: state.waypoints[1].hotspot };
  });
  expect(seen.on).toBe(true);
  expect(seen.off).toBe(true);
  expect(seen.stored).toBe(true);
});

// A mark is part of the route, so it has to survive the route being put away and taken out
// again -- that is what "this point is where I look out" is worth.
test('the mark is saved with the route', async ({ page }) => {
  await boot(page);
  await mark(page, 0);
  const json = await page.evaluate(() => JSON.stringify(state.waypoints));
  await page.reload();
  await page.waitForFunction(() => typeof syncLegs === 'function');
  const restored = await page.evaluate((raw) => {
    state.waypoints = JSON.parse(raw);
    syncLegs();
    const cb = document.getElementById('hotspot-cb');
    cb.checked = false;
    cb.dispatchEvent(new Event('change', { bubbles: true }));
    draw();
    return { stored: state.waypoints[0].hotspot, drawn: window.__hotspotWaypointIndexes };
  }, json);
  expect(restored.stored).toBe(true);
  expect(restored.drawn).toEqual([0]);
});

// A pressed toggle has to look pressed. The "on" state was font-weight alone, which on a
// small grey button is invisible: a marked point looked exactly like an unmarked one, and
// the whole control read as inert.
test('the button shows whether the point is marked', async ({ page }) => {
  await boot(page);
  const look = await page.evaluate(() => {
    const read = () => {
      const b = document.getElementById('insp-hotspot-btn');
      const cs = getComputedStyle(b);
      return { cls: b.className, bg: cs.backgroundColor, border: cs.borderTopColor,
               weight: cs.fontWeight, disabled: b.disabled, opacity: cs.opacity };
    };
    state.selected = { type: 'wp', index: 0 };
    showInspector();
    const off = read();
    document.getElementById('insp-hotspot-btn').click();
    const on = read();
    return { off, on };
  });
  // Not disabled and not faded in either state: it is a toggle, not a locked control.
  expect(look.off.disabled).toBe(false);
  expect(look.off.opacity).toBe('1');
  // ...and the two states are told apart by more than the weight of the type. The button
  // stays red either way -- it is a mark on the chart, not a preference -- and takes the
  // hotspot ring as its border once the point is marked.
  expect(look.on.cls).toMatch(/insp-btn-on/);
  expect(look.on.border).not.toBe(look.off.border);
  expect(look.on.border).toBe('rgb(255, 209, 102)');  // waypointHotspotFillColor, as the ring
});

// The action row reads in a fixed order — delete, reset, frequency change, hotspot, turn —
// rather than in whatever order the panel happened to build things.
test('the actions are in the order a pilot reads them', async ({ page }) => {
  await boot(page);
  const order = await page.evaluate(() => {
    state.selected = { type: 'wp', index: 0 };
    showInspector();
    return [...document.querySelectorAll('.insp-actions .insp-btn')]
      .map(b => b.id || b.className.split(' ').find(c => c.endsWith('-btn')) || b.className);
  });
  const rank = (id) => order.indexOf(id);
  expect(rank('insp-del-wp-btn')).toBe(0);
  expect(rank('insp-reset-name-btn')).toBe(1);
  expect(rank('add-freq-change-btn')).toBeLessThan(rank('insp-hotspot-btn'));
  expect(rank('insp-hotspot-btn')).toBeGreaterThan(-1);
});

// It is a mark on the chart, not a preference: it wears the same red as the delete actions,
// and keeps it when pressed, with the hotspot ring as its border so set still reads as set.
test('the hotspot toggle is red in both states', async ({ page }) => {
  await boot(page);
  const look = await page.evaluate(() => {
    const read = () => {
      const b = document.getElementById('insp-hotspot-btn');
      const cs = getComputedStyle(b);
      return { bg: cs.backgroundColor, border: cs.borderTopColor, safe: b.classList.contains('insp-btn-safe') };
    };
    state.selected = { type: 'wp', index: 0 };
    showInspector();
    const off = read();
    document.getElementById('insp-hotspot-btn').click();
    state.selected = { type: 'wp', index: 0 };
    showInspector();
    return { off, on: read() };
  });
  expect(look.off.safe).toBe(false);                  // never demoted to the quiet grey
  expect(look.off.bg).toBe('rgb(176, 54, 54)');       // the same red as delete
  expect(look.on.bg).toBe('rgb(176, 54, 54)');        // ...pressed too
  expect(look.on.border).toBe('rgb(255, 209, 102)');  // ringed with the hotspot colour
  expect(look.on.border).not.toBe(look.off.border);   // so the two states still differ
});
