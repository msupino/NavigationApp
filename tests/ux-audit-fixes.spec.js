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

test('the first click starts the route AND arms add mode, so clicks keep adding', async ({ page }) => {
  await boot(page);
  await expect(page.locator('#empty-route-hint')).toBeVisible();
  const r = await page.evaluate(async () => {
    const before = state.waypoints.length;
    map.fire('click', { latlng: L.latLng(32.2, 34.9) });
    await new Promise(r2 => setTimeout(r2, 60));
    const first = { n: state.waypoints.length, mode: state.mode };
    // Arming the mode (rather than dropping one point) is the whole point: the next
    // click has to keep adding, or the user is stuck after the first.
    map.fire('click', { latlng: L.latLng(32.4, 35.0) });
    await new Promise(r2 => setTimeout(r2, 60));
    return { before, first, second: { n: state.waypoints.length, mode: state.mode } };
  });
  expect(r.before).toBe(0);
  expect(r.first.n).toBe(1);
  expect(r.first.mode).toBe('add');       // armed, not a one-shot
  expect(r.second.n).toBe(2);             // keeps adding
  await expect(page.locator('#mode-chip')).toBeVisible();
  await expect(page.locator('#empty-route-hint')).toHaveCount(0);
});

test('a chart waypoint offers an explicit way onto the route', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(async () => {
    await loadNavWaypoints();
    const i = navWP.findIndex(w => w.name === 'DEROR');
    const out = {};
    // Clicking a chart point used to open an info panel and stop there — the only
    // route-building path was the add tool, two levels into a menu.
    state.selected = { type: 'navwp', index: i }; draw(); showInspector();
    await new Promise(r2 => setTimeout(r2, 60));
    let btn = document.getElementById('insp-add-to-route');
    out.emptyLabel = btn && btn.textContent;
    btn.click();
    await new Promise(r2 => setTimeout(r2, 60));
    out.added = { n: state.waypoints.length, name: state.waypoints[0] && state.waypoints[0].name };
    // Revisiting the same point must not offer a duplicate.
    state.selected = { type: 'navwp', index: i }; showInspector();
    await new Promise(r2 => setTimeout(r2, 60));
    btn = document.getElementById('insp-add-to-route');
    out.second = { label: btn && btn.textContent, disabled: btn && btn.disabled };
    return out;
  });
  expect(r.emptyLabel).toMatch(/start route/i);     // wording adapts to an empty route
  expect(r.added.n).toBe(1);
  expect(r.added.name).toBe('DEROR');               // keeps the charted name
  expect(r.second.disabled).toBe(true);
  expect(r.second.label).toMatch(/already/i);
});

test('an airfield offers the same route action once a route exists', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(async () => {
    await loadAirfields();
    state.waypoints = [{ lat: 32.1, lng: 34.9, name: 'A' }]; syncLegs();
    state.selected = { type: 'airfield', index: 0 }; draw(); showInspector();
    await new Promise(r2 => setTimeout(r2, 60));
    const btn = document.getElementById('insp-add-to-route');
    const before = state.waypoints.length;
    btn.click();
    await new Promise(r2 => setTimeout(r2, 60));
    return { label: btn.textContent, before, after: state.waypoints.length };
  });
  expect(r.label).toMatch(/add to route/i);
  expect(r.after).toBe(r.before + 1);
});

test('selecting a chart point still opens its inspector (the chooser is untouched)', async ({ page }) => {
  await boot(page);
  // An earlier attempt made an empty route bypass overlay hit-testing so the first
  // click could land on a chart point. That also removed comm-change rings from the
  // point chooser (they report type 'navwp' too) and stopped VOR/NOTAM inspection.
  const r = await page.evaluate(async () => {
    await loadVors();
    state.waypoints = [];
    state.selected = { type: 'vor', index: vors.findIndex(v => v.ident === 'ZFR') };
    draw(); showInspector();
    await new Promise(r2 => setTimeout(r2, 60));
    return { hidden: document.getElementById('inspector').classList.contains('hidden'),
             title: document.getElementById('insp-title').value };
  });
  expect(r.hidden).toBe(false);
  expect(r.title).toMatch(/ZFR/);
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
  expect(r.summary).toMatch(/^1 leg · /);      // singular for one leg; Time/Fuel are otherwise scrolled off
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
    // The visible title now carries units (see fp-header-display-vs-csv.spec.js);
    // the CSV contract is asserted separately below.
    const time = ths.find(t => /^Time/.test(t.textContent.trim()));
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

async function clickChartPoint(page, name) {
  return page.evaluate(async (nm) => {
    await loadNavWaypoints();
    window.showNavWP = true; window.showCommChange = false;
    const wp = navWP.find(w => w.name === nm) || navWP[0];
    map.setView([wp.lat, wp.lng], 11, { animate: false });
    draw();
    const p = proj(wp);
    const box = map.getContainer().getBoundingClientRect();
    const at = (t, x, y) => map.getContainer().dispatchEvent(
      new MouseEvent(t, { clientX: box.left + x, clientY: box.top + y, bubbles: true, cancelable: true }));
    at('mousedown', p.x, p.y); at('mouseup', p.x, p.y); at('click', p.x, p.y);
    await new Promise(r => setTimeout(r, 120));
    return {
      target: wp.name,
      n: state.waypoints.length,
      names: state.waypoints.map(w => w.name),
      mode: state.mode,
      selType: state.selected && state.selected.type,
    };
  }, name);
}

test('with no route, clicking ON a chart waypoint starts the route there', async ({ page }) => {
  await boot(page);
  const r = await clickChartPoint(page, 'DEROR');
  // A press on a named point used to be consumed as a selection, so the first click
  // only worked on blank map — useless for routing between charted fixes.
  expect(r.n).toBe(1);
  expect(r.names[0]).toBe('DEROR');    // charted name, not a bare coordinate
  expect(r.mode).toBe('add');          // and it keeps adding from here
});

test('with a route present, clicking a chart waypoint inspects it instead', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => {
    state.waypoints = [{ lat: 31.0, lng: 34.0, name: 'FAR' }];
    syncLegs(); state.selected = null; state.mode = null; draw();
  });
  const r = await clickChartPoint(page, 'DEROR');
  // Priming is only for the empty-route case: once a route exists a click must not
  // silently append, or panning and inspecting become impossible.
  expect(r.n).toBe(1);
  expect(r.selType).toBe('navwp');     // its info panel, as before
  expect(r.mode).toBeNull();
});
