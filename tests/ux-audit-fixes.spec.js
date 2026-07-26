// @ts-check
// Fixes from the UI audit. Each test pins a specific thing a first-time or phone user
// could not do before, so a regression shows up as a failing behaviour, not a diff.
const { test, expect } = require('./_setup');

async function boot(page, w, h) {
  if (w) await page.setViewportSize({ width: w, height: h });
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof state !== 'undefined' && typeof draw === 'function');
  await page.evaluate(() => {
    state.waypoints = []; state.legs = []; state.notes = [];
    syncLegs(); state.selected = null; state.mode = null; draw();
  });
}

test('an empty route shows a hint, and a plain map click starts the route', async ({ page }) => {
  await boot(page);
  // The core action had no discoverable entry point: a click did nothing and the add
  // tool is two levels into a menu.
  await expect(page.locator('#empty-route-hint')).toBeVisible();
  const r = await page.evaluate(() => {
    const before = state.waypoints.length;
    map.fire('click', { latlng: L.latLng(32.2, 34.9) });
    return { before, after: state.waypoints.length, selected: state.selected && state.selected.type };
  });
  expect(r.before).toBe(0);
  expect(r.after).toBe(1);              // the click itself starts the route
  expect(r.selected).toBe('wp');        // and selects it, so the inspector explains it
  await expect(page.locator('#empty-route-hint')).toHaveCount(0);   // hint retires
});

test('the hint never swallows the click it asks for', async ({ page }) => {
  await boot(page);
  const pe = await page.evaluate(() =>
    getComputedStyle(document.getElementById('empty-route-hint')).pointerEvents);
  expect(pe).toBe('none');
});

test('a plain click does NOT add a waypoint once the route exists', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(() => {
    state.waypoints = [{ lat: 32.1, lng: 34.9, name: 'A' }];
    syncLegs(); state.selected = null; draw();
    const before = state.waypoints.length;
    map.fire('click', { latlng: L.latLng(32.5, 35.1) });
    return { before, after: state.waypoints.length };
  });
  // Only the FIRST point is click-to-start; after that a click must not fight
  // selection or panning.
  expect(r.after).toBe(r.before);
});

test('add-mode shows a persistent chip that can stop it', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => document.getElementById('tool-add').click());
  const chip = page.locator('#mode-chip');
  await expect(chip).toBeVisible();
  await expect(chip).toContainText(/adding waypoints/i);
  // The mode buttons live in a dropdown that closes on click, hiding their own
  // highlight — this chip is the only lasting cue, so it must also clear the mode.
  await chip.click();
  expect(await page.evaluate(() => state.mode)).toBeNull();
  await expect(chip).toHaveCount(0);
});

test('mobile: arming a map tool gets the menu off the map', async ({ page }) => {
  await boot(page, 375, 812);
  const r = await page.evaluate(async () => {
    const bar = document.getElementById('toolbar');
    if (typeof window.collapseToolbarForMapTool === 'function') { /* present */ }
    bar.classList.remove('collapsed');                    // menu open, as after tapping ☰
    const openPct = () => {
      const b = bar.getBoundingClientRect();
      return Math.round((Math.min(b.bottom, innerHeight) - Math.max(b.top, 0)) / innerHeight * 100);
    };
    const before = openPct();
    document.getElementById('tool-add').click();
    await new Promise(r2 => setTimeout(r2, 150));
    return { before, after: openPct(), mode: state.mode };
  });
  expect(r.mode).toBe('add');
  // It used to cover ~98% of the height, so points went in through a narrow strip.
  expect(r.before).toBeGreaterThan(50);
  expect(r.after).toBeLessThan(r.before);
});

test('mobile: inspector actions stay on screen, and only delete is red', async ({ page }) => {
  await boot(page, 375, 812);
  const r = await page.evaluate(async () => {
    state.waypoints = [{ lat: 32.18, lng: 34.83, name: 'LLHZ' }, { lat: 32.44, lng: 34.90, name: 'HADERA' }];
    state.legs = []; syncLegs();
    state.selected = { type: 'wp', index: 1 };
    draw(); showInspector();
    await new Promise(r2 => setTimeout(r2, 100));
    const acts = document.querySelector('#insp-body .insp-actions');
    const btns = [...(acts ? acts.querySelectorAll('button') : [])].map(b => ({
      label: b.textContent.trim(),
      offScreen: b.getBoundingClientRect().top > innerHeight,
      safe: b.classList.contains('insp-btn-safe'),
    }));
    return { grouped: !!acts, btns };
  });
  expect(r.grouped).toBe(true);
  expect(r.btns.length).toBeGreaterThanOrEqual(3);
  // Delete + Reset used to sit below the fold on a 812px-tall phone.
  expect(r.btns.filter(b => b.offScreen)).toEqual([]);
  const del = r.btns.find(b => /delete/i.test(b.label));
  expect(del.safe).toBe(false);                       // destructive keeps the alarm red
  for (const b of r.btns.filter(b => !/delete/i.test(b.label))) {
    expect(b.safe, b.label + ' should not look destructive').toBe(true);
  }
});

test('the flight plan is not covered by the inspector, and shows a mobile summary', async ({ page }) => {
  await boot(page, 375, 812);
  const r = await page.evaluate(async () => {
    state.waypoints = [{ lat: 32.18, lng: 34.83, name: 'LLHZ' }, { lat: 32.44, lng: 34.90, name: 'HADERA' }];
    state.legs = []; syncLegs(); state.legs.forEach(l => l.flightSpeed = 110);
    state.selected = { type: 'wp', index: 1 };
    draw(); showInspector();
    const inspVisibleBefore = !document.getElementById('inspector').classList.contains('hidden');
    showFlightPlan();
    await new Promise(r2 => setTimeout(r2, 200));
    const summary = document.getElementById('fp-mobile-summary');
    return {
      inspVisibleBefore,
      inspHiddenDuringPlan: document.getElementById('inspector').classList.contains('hidden'),
      summary: summary ? summary.textContent : null,
    };
  });
  expect(r.inspVisibleBefore).toBe(true);
  expect(r.inspHiddenDuringPlan).toBe(true);   // it sat at z2320 over the z2000 modal
  expect(r.summary).toMatch(/legs/);           // Time/Fuel/Total are otherwise scrolled off
  expect(r.summary).toMatch(/NM/);
});

test('the storage wipe is not beside the everyday edit actions', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(() => ({
    inEdit: !!document.querySelector('[data-sec="build"] #clear-store'),
    inDataMenu: !!document.querySelector('[data-sec="export"] #clear-store'),
    stillExists: !!document.getElementById('clear-store'),
  }));
  expect(r.stillExists).toBe(true);
  expect(r.inEdit).toBe(false);       // it used to sit next to Undo / Clear / Fit
  expect(r.inDataMenu).toBe(true);
});

test('the Edit menu head has an accessible name', async ({ page }) => {
  await boot(page);
  const name = await page.evaluate(() =>
    document.querySelector('[data-sec="build"] .tb-section-head').getAttribute('aria-label'));
  expect(name).toBeTruthy();          // it read as a bare "button" to a screen reader
});

test('mobile zoom controls meet the 44px touch minimum', async ({ page }) => {
  await boot(page, 375, 812);
  const sizes = await page.evaluate(() =>
    [...document.querySelectorAll('.leaflet-control-zoom a')].map(a => {
      const r = a.getBoundingClientRect();
      return { w: Math.round(r.width), h: Math.round(r.height) };
    }));
  expect(sizes.length).toBeGreaterThan(0);
  for (const s of sizes) {
    expect(Math.min(s.w, s.h), JSON.stringify(s)).toBeGreaterThanOrEqual(44);
  }
});

test('the flight-plan time columns state their units, without changing the CSV', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(async () => {
    state.waypoints = [{ lat: 32.18, lng: 34.83, name: 'A' }, { lat: 32.44, lng: 34.90, name: 'B' }];
    state.legs = []; syncLegs(); state.legs.forEach(l => l.flightSpeed = 110);
    showFlightPlan();
    await new Promise(r2 => setTimeout(r2, 200));
    const ths = [...document.querySelectorAll('.flight-table thead th')];
    const time = ths.find(t => /^Time$/.test(t.textContent.trim()));
    return { title: time && time.title, headers: S.fpHeaders.join(',') };
  });
  // "13:15" beside a Zulu clock reads as a clock time; it is mm:ss.
  expect(r.title).toMatch(/mm:ss/);
  // The label is ALSO the CSV column name, so it must stay stable for anything
  // consuming the export.
  expect(r.headers).toContain('Time');
  expect(r.headers).toContain('Cum. time');
  expect(r.headers).not.toContain('mm:ss');
});

test('the frequency-change toggle sits with the VOR overlay, not under Route info', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(() => {
    const body = document.querySelector('[data-sec="view"] .tb-section-body');
    const kids = [...body.children];
    const idx = sel => kids.findIndex(k => k.querySelector && k.querySelector(sel));
    const vor = idx('#vor-cb');
    const vorRef = kids.findIndex(k => k.id === 'vor-ref-row');
    const comm = idx('#commchange-cb');
    const routeInfoGroup = kids.findIndex(k => k.classList && k.classList.contains('tb-group')
      && /route/i.test(k.textContent));
    return { vor, vorRef, comm, routeInfoGroup };
  });
  // A frequency change is a navigation-facility overlay like a VOR, so it belongs
  // beside them rather than among the route annotations.
  expect(r.comm).toBeGreaterThan(r.vor);
  expect(r.comm).toBeGreaterThan(r.vorRef);
  expect(r.comm).toBeLessThan(r.routeInfoGroup);
});
