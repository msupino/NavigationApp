// @ts-check
// Round-2 UI audit fixes. Each test names the user-visible defect it pins down.
const { test, expect } = require('./_setup');

const ROUTE = [{ lat: 32.18, lng: 34.83, name: 'LLHZ' },
  { lat: 32.44, lng: 34.90, name: 'B' }, { lat: 32.70, lng: 35.20, name: 'C' }];

async function boot(page, q = '') {
  await page.goto('?lang=en&nogist' + q);
  await page.waitForFunction(() => typeof syncLegs === 'function' && typeof routeProfile === 'function');
}

async function withRoute(page) {
  await page.evaluate(r => {
    state.waypoints = r; state.legs = []; syncLegs(); draw();
  }, ROUTE);
}

test('landing view shows the chart at a readable zoom, not 0.13x', async ({ page }) => {
  await boot(page);
  const v = await page.evaluate(() => ({ z: map.getZoom(), c: map.getCenter(),
    tunable: [tune('defaultViewZoom'), tune('defaultViewLat'), tune('defaultViewLng')] }));
  expect(v.z).toBeGreaterThanOrEqual(11);      // z9 drew the CVFR raster unreadably small
  expect(v.tunable[0]).toBe(11);
  expect(v.c.lat).toBeCloseTo(32.1, 1);
});

test('an unset altitude does not invent climb/descent time', async ({ page }) => {
  // The plan assumed 2000 ft, modelled a descent onto the field, and came out ~50s
  // short of the map kites and the route summary for the same leg.
  await boot(page);
  await withRoute(page);
  const r = await page.evaluate(() => {
    const p = routeProfile();
    let simple = 0;
    for (let i = 0; i < state.legs.length; i++) {
      const g = geo(state.waypoints[i], state.waypoints[i + 1]);
      simple += g.dist / state.legs[i].flightSpeed;
    }
    return { profile: toHMS(p.totalTimeH), simple: toHMS(simple),
      tocs: p.tocs.length, tods: p.tods.length,
      ramps: p.legs.map(l => +(l.climbDist + l.descDist).toFixed(2)) };
  });
  expect(r.profile).toBe(r.simple);            // one route, one ETE
  expect(r.ramps.every(x => x === 0)).toBe(true);
  expect(r.tocs + r.tods).toBe(0);             // nothing to mark without an altitude
});

test('a real altitude still produces a climb profile with a TOC', async ({ page }) => {
  await boot(page);
  await withRoute(page);
  const r = await page.evaluate(() => {
    state.legs.forEach(l => { l.inboundAltitude = 3000; });
    const p = routeProfile();
    return { climb0: p.legs[0].climbDist > 0, tocs: p.tocs.length, alt: p.legs[0].cruiseAlt };
  });
  expect(r.climb0).toBe(true);
  expect(r.tocs).toBe(1);
  expect(r.alt).toBe(3000);
});

test('the profile drawing height for an unset altitude is gistable', async ({ page }) => {
  await boot(page);
  await withRoute(page);
  const r = await page.evaluate(() => {
    const shipped = routeProfile().legs[0].cruiseAlt;
    NavAid.tuningDefaults.unknownProfileAltFt.value = 4500;
    const overridden = routeProfile().legs[0].cruiseAlt;
    const time = toHMS(routeProfile().totalTimeH);
    NavAid.tuningDefaults.unknownProfileAltFt.value = 2000;
    return { shipped, overridden, time };
  });
  expect(r.shipped).toBe(2000);
  expect(r.overridden).toBe(4500);
  // ...and it still only affects the DRAWING, never the time
  const simple = await page.evaluate(() => {
    let s = 0;
    for (let i = 0; i < state.legs.length; i++) {
      const g = geo(state.waypoints[i], state.waypoints[i + 1]);
      s += g.dist / state.legs[i].flightSpeed;
    }
    return toHMS(s);
  });
  expect(r.time).toBe(simple);
});

test('route totals are always on screen, and match the plan', async ({ page }) => {
  await boot(page);
  const emptyHidden = await page.evaluate(() =>
    document.getElementById('route-summary').style.display === 'none');
  expect(emptyHidden).toBe(true);              // nothing to summarise yet
  await withRoute(page);
  const r = await page.evaluate(() => {
    const pill = document.getElementById('route-summary');
    document.getElementById('plan-top').click();
    const fp = [...document.querySelectorAll('.modal *')]
      .map(e => e.childNodes.length === 1 ? e.textContent.trim() : '')
      .find(t => /leg[s]? ·/.test(t));
    return { pill: pill.textContent, visible: pill.style.display !== 'none', fp,
      stats: document.getElementById('info').textContent };
  });
  expect(r.visible).toBe(true);
  expect(r.pill).toBe(r.fp);                   // pill, plan and stats cannot disagree
  expect(r.stats).toContain('37.8 NM');
});

test('a one-leg route says "1 leg", not "1 legs"', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => {
    state.waypoints = [{ lat: 32.18, lng: 34.83, name: 'A' }, { lat: 32.44, lng: 34.90, name: 'B' }];
    state.legs = []; syncLegs(); draw();
  });
  const txt = await page.evaluate(() => document.getElementById('route-summary').textContent);
  expect(txt).toMatch(/^1 leg · /);
});

test('map kites show a dash for an unset altitude; tables still say Unknown', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(() => ({
    kite: kiteAltitudeLabel(NaN, {}, 'inboundAltitude'),
    table: formatAltitudeValue(NaN, {}, 'inboundAltitude'),
  }));
  expect(r.kite).toBe('—');
  expect(r.table).toBe('Unknown');
});

test('VOR legend row follows the VOR toggle', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(() => {
    const row = document.getElementById('legend-row-vor');
    showVorStations = true; draw();
    const on = row.style.display !== 'none';
    showVorStations = false; draw();
    const off = row.style.display === 'none';
    return { on, off, label: row.textContent.trim() };
  });
  expect(r.on).toBe(true);
  expect(r.off).toBe(true);
  expect(r.label).toContain('VOR');
});

test('Flight plan is a top-level toolbar action, and the Charts entry still works', async ({ page }) => {
  await boot(page);
  await withRoute(page);
  await page.evaluate(() => document.getElementById('plan-top').click());
  await expect(page.locator('.modal-back.flight-plan')).toHaveCount(1);
  await page.evaluate(() => document.querySelector('.modal-back.flight-plan .modal-close-x').click());
  await page.evaluate(() => document.getElementById('plan').click());
  await expect(page.locator('.modal-back.flight-plan')).toHaveCount(1);
});

test('the standalone Flight plan entry is not a dropdown', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(() => {
    const sec = document.querySelector('.tb-section[data-sec="plan"]');
    const btn = document.getElementById('plan-top');
    btn.click();
    return { open: sec.classList.contains('open'), hasBody: !!sec.querySelector('.tb-section-body'),
      persisted: localStorage.getItem('navaid.sec.plan') };
  });
  expect(r.open).toBe(false);                  // no body to open
  expect(r.hasBody).toBe(false);
  expect(r.persisted).toBeNull();              // and nothing to remember
});

test('desktop menu bar stays one row with Flight plan promoted', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await boot(page);
  const r = await page.evaluate(() => {
    const tb = document.getElementById('toolbar').getBoundingClientRect();
    return { h: tb.height, right: tb.right, vw: window.innerWidth };
  });
  expect(r.h).toBeLessThan(48);
  expect(r.right).toBeLessThanOrEqual(r.vw + 0.5);
});

test('reference links collapse behind one overflow toggle', async ({ page }) => {
  await boot(page);
  const menu = page.locator('#footer-more-menu');
  await expect(menu).toBeHidden();
  await page.locator('#footer-more-btn').click();
  await expect(menu).toBeVisible();
  await expect(menu.locator('a')).toHaveCount(6);
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
});

test('per-leg distance is visible by default on desktop', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await boot(page);
  await withRoute(page);
  await page.evaluate(() => document.getElementById('plan-top').click());
  const heads = await page.evaluate(() => [...document.querySelectorAll('.modal thead th')]
    .filter(t => !(t.hidden || getComputedStyle(t).display === 'none'))
    .map(t => t.textContent.trim()));
  expect(heads).toContain('Dist (NM)');
});

// --- mobile ---------------------------------------------------------------
test.describe('phone layout', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test('the flight-plan table fits without sideways scrolling', async ({ page }) => {
    await boot(page);
    await withRoute(page);
    const r = await page.evaluate(() => {
      document.getElementById('plan-top').click();
      const tbl = document.querySelector('.modal table');
      const scroll = document.querySelector('.fp-scroll');
      return { tableW: tbl.scrollWidth, paneW: scroll.clientWidth,
        heads: [...document.querySelectorAll('.modal thead th')]
          .filter(t => !(t.hidden || getComputedStyle(t).display === 'none'))
          .map(t => t.textContent.trim()).filter(Boolean),
        csv: [...document.querySelectorAll('.modal thead th')].map(t => t.dataset.csv).filter(Boolean) };
    });
    expect(r.tableW).toBeLessThanOrEqual(r.paneW + 1);
    expect(r.heads).toEqual(['#', 'To', 'Hdg', 'Alt', 'Time']);
    // Short titles are display-only: the CSV export contract keeps its full names.
    expect(r.csv).toContain('Dist (NM)');      // display says "NM"
    expect(r.csv).toContain('Alt (ft)');       // display says "Alt"
    expect(r.csv).toContain('Fuel (gal)');     // display says "Fuel"
  });

  test('the inspector gets room for its content and a one-line action row', async ({ page }) => {
    await boot(page);
    await withRoute(page);
    const r = await page.evaluate(() => {
      state.selected = { type: 'wp', index: 1 };
      showInspector();
      const insp = document.getElementById('inspector').getBoundingClientRect();
      const acts = document.querySelector('#insp-body .insp-actions').getBoundingClientRect();
      const widths = [...document.querySelectorAll('#insp-body .insp-actions button')]
        .map(b => b.getBoundingClientRect().width);
      return { share: insp.height / window.innerHeight, content: insp.height - acts.height,
        sideBySide: widths.filter(w => w < 200).length };
    });
    expect(r.share).toBeGreaterThan(0.5);        // was 45dvh, clipping mid-row
    expect(r.content).toBeGreaterThan(300);
    expect(r.sideBySide).toBeGreaterThanOrEqual(2);   // actions share a row now
  });

  test('a pinch neither rotates the map nor opens the inspector', async ({ page }) => {
    await boot(page);
    await withRoute(page);
    const r = await page.evaluate(() => {
      const insp = document.getElementById('inspector');
      state.selected = null; showInspector();
      const el = document.getElementById('map');
      const p = map.latLngToContainerPoint(state.waypoints[0]);
      const ev = (type, pts) => {
        const t = pts.map((c, i) => new Touch({ identifier: i, target: el,
          clientX: c[0], clientY: c[1], pageX: c[0], pageY: c[1] }));
        return new TouchEvent(type, { touches: t, targetTouches: t, changedTouches: t,
          bubbles: true, cancelable: true });
      };
      el.dispatchEvent(ev('touchstart', [[p.x, p.y], [p.x + 60, p.y + 60]]));
      el.dispatchEvent(ev('touchend', [[p.x, p.y]]));
      map.fire('click', { latlng: state.waypoints[0], containerPoint: p,
        originalEvent: new MouseEvent('click') });
      return { touchRotate: !!map.options.touchRotate,
        inspOpened: !insp.classList.contains('hidden'),
        wps: state.waypoints.length, bearing: map.getBearing ? map.getBearing() : 0 };
    });
    expect(r.touchRotate).toBe(false);           // pinch used to twist the chart
    expect(r.inspOpened).toBe(false);            // ...and select whatever was under it
    expect(r.wps).toBe(3);                       // ...or drop a waypoint
  });

  test('the pinch guard expires, so a later tap still adds a waypoint', async ({ page }) => {
    await boot(page);
    await withRoute(page);
    await page.evaluate(() => {
      const el = document.getElementById('map');
      const p = map.latLngToContainerPoint(state.waypoints[0]);
      const t = [new Touch({ identifier: 0, target: el, clientX: p.x, clientY: p.y,
        pageX: p.x, pageY: p.y }), new Touch({ identifier: 1, target: el, clientX: p.x + 40,
        clientY: p.y + 40, pageX: p.x + 40, pageY: p.y + 40 })];
      el.dispatchEvent(new TouchEvent('touchstart', { touches: t, targetTouches: t,
        changedTouches: t, bubbles: true, cancelable: true }));
    });
    // During the grace window an add-mode click is swallowed...
    const during = await page.evaluate(() => {
      setMode('add');
      const before = state.waypoints.length;
      map.fire('click', { latlng: { lat: 32.9, lng: 35.4 },
        containerPoint: map.latLngToContainerPoint({ lat: 32.9, lng: 35.4 }),
        originalEvent: new MouseEvent('click') });
      return state.waypoints.length - before;
    });
    expect(during).toBe(0);
    await page.waitForTimeout(800);              // grace window is 700ms
    // ...and afterwards the very same click lands.
    const after = await page.evaluate(() => {
      const before = state.waypoints.length;
      map.fire('click', { latlng: { lat: 32.9, lng: 35.4 },
        containerPoint: map.latLngToContainerPoint({ lat: 32.9, lng: 35.4 }),
        originalEvent: new MouseEvent('click') });
      return state.waypoints.length - before;
    });
    expect(after).toBe(1);
  });
});

// --- the inspector must not climb back over the flight plan ---------------
test('editing a speed in the plan does not raise the hidden inspector', async ({ page }) => {
  await boot(page);
  await withRoute(page);
  const r = await page.evaluate(() => {
    const insp = document.getElementById('inspector');
    state.selected = { type: 'leg', index: 0 };
    showInspector();
    const before = !insp.classList.contains('hidden');
    document.getElementById('plan-top').click();
    const hiddenWithPlan = insp.classList.contains('hidden');
    const spd = [...document.querySelectorAll('.modal input.plan-num')][0];
    spd.value = '115';
    spd.dispatchEvent(new Event('input', { bubbles: true }));
    spd.dispatchEvent(new Event('change', { bubbles: true }));
    return { before, hiddenWithPlan, stillHidden: insp.classList.contains('hidden'),
      speeds: state.legs.map(l => l.flightSpeed) };
  });
  expect(r.before).toBe(true);
  expect(r.hiddenWithPlan).toBe(true);
  expect(r.stillHidden).toBe(true);              // the edit used to pop it back on top
  expect(r.speeds).toEqual([115, 115]);          // and the edit still lands
});

test('closing the plan hands the inspector back', async ({ page }) => {
  await boot(page);
  await withRoute(page);
  const r = await page.evaluate(() => {
    const insp = document.getElementById('inspector');
    state.selected = { type: 'wp', index: 1 };
    showInspector();
    document.getElementById('plan-top').click();
    const hidden = insp.classList.contains('hidden');
    document.querySelector('.modal-back.flight-plan .modal-close-x').click();
    return { hidden, restored: !insp.classList.contains('hidden'), sel: state.selected };
  });
  expect(r.hidden).toBe(true);
  expect(r.restored).toBe(true);
  expect(r.sel).toEqual({ type: 'wp', index: 1 });
});

test('a selection restored while the plan is open waits for the plan to close', async ({ page }) => {
  // Reload with both the plan and a selection persisted: the restore path used to call
  // showInspector() unconditionally and land the panel straight on top of the plan.
  await boot(page);
  await withRoute(page);
  await page.evaluate(() => {
    state.selected = { type: 'wp', index: 1 };
    persistInspectorSelection();
    document.getElementById('plan-top').click();
    try { sessionStorage.setItem('navaid.fpOpen', '1'); } catch (e) { /* */ }
  });
  await page.reload();
  await page.waitForFunction(() => !!document.querySelector('.modal-back.flight-plan'));
  const during = await page.evaluate(() => ({
    planOpen: !!document.querySelector('.modal-back.flight-plan'),
    inspHidden: document.getElementById('inspector').classList.contains('hidden'),
    deferred: !!window.__inspectorDeferredByPlan,
  }));
  expect(during.planOpen).toBe(true);
  expect(during.inspHidden).toBe(true);
  const after = await page.evaluate(() => {
    document.querySelector('.modal-back.flight-plan .modal-close-x').click();
    return !document.getElementById('inspector').classList.contains('hidden');
  });
  expect(after).toBe(true);
});
