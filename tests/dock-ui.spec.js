// @ts-check
// The opt-in dock shell (?dock=1): the responsive dock-layout proposal shipped
// behind a URL flag so the proven shell stays the default. Covers all four
// phases: status strip (#1863), phone bottom bar + sheet (#1864), desktop rail
// (#1865), print-panel start-edge parking (#1866) — plus the mode chip's new
// locked / following states, which serve both shells.
const { test, expect } = require('./_setup');

test('without ?dock=1 nothing changes', async ({ page }) => {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof draw === 'function');
  const out = await page.evaluate(() => ({
    dock: document.documentElement.classList.contains('dock-ui'),
    strip: !!document.getElementById('status-strip'),
    readoutInToolbar: !!document.querySelector('#toolbar #gps-readout'),
    railBtn: !!document.getElementById('dock-rail-collapse'),
  }));
  expect(out.dock).toBe(false);
  expect(out.strip).toBe(false);
  expect(out.readoutInToolbar).toBe(true);
  expect(out.railBtn).toBe(false);
});

test('phone: bottom bar, sheet above it, GPS cluster in the status strip', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('?lang=en&nogist&dock=1');
  await page.waitForFunction(() => typeof draw === 'function' && !!document.getElementById('status-strip'));
  const shell = await page.evaluate(() => {
    const bar = document.getElementById('toolbar').getBoundingClientRect();
    const strip = document.getElementById('status-strip').getBoundingClientRect();
    return {
      barAtBottom: Math.abs(bar.bottom - window.innerHeight) < 2,
      barShort: bar.height < 90,
      stripOnTop: strip.top < bar.top,
      simInStrip: !!document.querySelector('#status-strip #sim-trigger'),
      recordInStrip: !!document.querySelector('#status-strip #gps-record'),
      readoutInStrip: !!document.querySelector('#status-strip #gps-readout'),
      handleGone: getComputedStyle(document.getElementById('toolbar-handle')).display === 'none',
    };
  });
  expect(shell.barAtBottom).toBe(true);
  expect(shell.barShort).toBe(true);
  expect(shell.stripOnTop).toBe(true);
  expect(shell.simInStrip).toBe(true);
  expect(shell.recordInStrip).toBe(true);
  expect(shell.readoutInStrip).toBe(true);
  expect(shell.handleGone).toBe(true);

  // Opening a section docks its body as a sheet above the bar; a map tap closes it.
  await page.click('.tb-section[data-sec="build"] .tb-section-head');
  const sheet = await page.evaluate(() => {
    const body = document.querySelector('.tb-section[data-sec="build"] .tb-section-body');
    const bar = document.getElementById('toolbar').getBoundingClientRect();
    const r = body.getBoundingClientRect();
    return { visible: r.height > 40, aboveBar: r.bottom <= bar.top + 2, fullBleed: Math.abs(r.left) < 2 };
  });
  expect(sheet.visible).toBe(true);
  expect(sheet.aboveBar).toBe(true);
  expect(sheet.fullBleed).toBe(true);
  await page.mouse.click(200, 200);
  const closed = await page.evaluate(() =>
    !document.querySelector('.tb-section[data-sec="build"]').classList.contains('open'));
  expect(closed).toBe(true);
});

test('desktop ≥1024px: left rail with in-flow accordion and persisted collapse', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('?lang=en&nogist&dock=1');
  await page.waitForFunction(() => typeof draw === 'function' && !!document.getElementById('dock-rail-collapse'));
  const rail = await page.evaluate(() => {
    const t = document.getElementById('toolbar').getBoundingClientRect();
    return { atStartEdge: t.left < 4, fullHeight: Math.abs(t.height - window.innerHeight) < 4, narrow: t.width < 260 };
  });
  expect(rail.atStartEdge).toBe(true);
  expect(rail.fullHeight).toBe(true);
  expect(rail.narrow).toBe(true);

  // In-flow expansion: the open body sits inside the rail column, not over the map.
  await page.click('.tb-section[data-sec="display"] .tb-section-head');
  const inFlow = await page.evaluate(() => {
    const t = document.getElementById('toolbar').getBoundingClientRect();
    const b = document.querySelector('.tb-section[data-sec="display"] .tb-section-body').getBoundingClientRect();
    return b.left >= t.left - 1 && b.right <= t.right + 1 && b.height > 60;
  });
  expect(inFlow).toBe(true);

  // Collapse persists across reload (device-local key).
  await page.click('#dock-rail-collapse');
  const collapsed = await page.evaluate(() => ({
    cls: document.documentElement.classList.contains('dock-rail-collapsed'),
    stored: localStorage.getItem('navaid.dockRailCollapsed'),
  }));
  expect(collapsed.cls).toBe(true);
  expect(collapsed.stored).toBe('1');
  await page.reload();
  await page.waitForFunction(() => typeof draw === 'function');
  expect(await page.evaluate(() =>
    document.documentElement.classList.contains('dock-rail-collapsed'))).toBe(true);
});

test('mode chip surfaces the edit lock, and unlocks through the real control', async ({ page }) => {
  await page.addInitScript(() => {
    try { localStorage.setItem('navaid.editLocked', '1'); } catch (e) { /* */ }
  });
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof draw === 'function' && !!document.getElementById('edit-lock'));
  const chip = await page.evaluate(() => {
    const c = document.getElementById('mode-chip');
    return c ? { text: c.textContent, kind: c.dataset.kind, live: c.getAttribute('aria-live') } : null;
  });
  expect(chip.kind).toBe('locked');
  expect(chip.text).toContain('Route locked');
  expect(chip.live).toBe('polite');
  await page.click('#mode-chip');
  const after = await page.evaluate(() => ({
    locked: window.routeEditLocked(),
    chipGone: !document.getElementById('mode-chip'),
  }));
  expect(after.locked).toBe(false);
  expect(after.chipGone).toBe(true);
});

test('mode chip surfaces aircraft following while tracking, and stops through the control', async ({ page }) => {
  await page.addInitScript(() => {
    navigator.geolocation.watchPosition = () => 7;
    navigator.geolocation.clearWatch = () => {};
  });
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof draw === 'function' && typeof gpsSetFollow === 'function');
  await page.evaluate(() => {
    window.gpsRecording = true;          // tracking source active…
    window.editUnlockOverride = true;    // …which auto-locks the route; pilot lifts it for the session
    gpsSetFollow(true);                  // …and holds the map onto it
    refreshEditLockControl();            // the hook that keeps the chip in step
  });
  const chip = await page.evaluate(() => {
    const c = document.getElementById('mode-chip');
    return c ? { kind: c.dataset.kind, text: c.textContent } : null;
  });
  expect(chip.kind).toBe('follow');
  expect(chip.text).toContain('Following the aircraft');
  await page.click('#mode-chip');
  const after = await page.evaluate(() => ({
    follow: window.gpsFollow,
    chipGone: !document.getElementById('mode-chip'),
  }));
  expect(after.follow).toBe(false);
  expect(after.chipGone).toBe(true);
});

test('print panel parks at the inline-start edge in the dock shell (#1866)', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('?lang=en&nogist&dock=1');
  await page.waitForFunction(() => typeof showExportModal === 'function');
  // A route so the panel has plan content; then open Print.
  await page.evaluate(() => {
    state.waypoints = [{ lat: 32.00, lng: 34.80 }, { lat: 32.30, lng: 35.10 }];
    syncLegs();
    showExportModal();
  });
  const parked = await page.evaluate(() => {
    const box = document.querySelector('.modal.export-floating') ||
                document.querySelector('.export-options .modal');
    if (!box) return null;
    const r = box.getBoundingClientRect();
    return { leftParked: r.left < 240, onScreen: r.left >= 0 && r.right <= window.innerWidth };
  });
  expect(parked).not.toBeNull();
  expect(parked.leftParked).toBe(true);
  expect(parked.onScreen).toBe(true);
});
