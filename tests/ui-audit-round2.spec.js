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
      tocs: p.tocs.length,
      ramps: p.legs.map(l => +(l.climbDist + l.descDist).toFixed(2)) };
  });
  expect(r.profile).toBe(r.simple);            // one route, one ETE
  expect(r.ramps.every(x => x === 0)).toBe(true);
  expect(r.tocs).toBe(0);                      // nothing to mark without an altitude
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
  // Nothing to summarise yet: the ink is hidden but the row keeps its box, so the
  // hand-placed legend card does not resize the moment a route appears.
  const emptyState = await page.evaluate(() => {
    const p = document.getElementById('route-summary');
    return { vis: getComputedStyle(p).visibility, display: getComputedStyle(p).display };
  });
  expect(emptyState.vis).toBe('hidden');
  expect(emptyState.display).not.toBe('none');
  await withRoute(page);
  const r = await page.evaluate(() => {
    const pill = document.getElementById('route-summary');
    document.getElementById('plan').click();
    const fp = [...document.querySelectorAll('.modal *')]
      .map(e => e.childNodes.length === 1 ? e.textContent.trim() : '')
      .find(t => /leg[s]? ·/.test(t));
    return { pill: pill.textContent, visible: getComputedStyle(pill).visibility === 'visible', fp };
  });
  expect(r.visible).toBe(true);
  expect(r.pill).toBe(r.fp);                   // the pill and the plan cannot disagree
  expect(r.pill).toContain('37.8 NM');
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

test('Flight plan is a top-level toolbar action, listed exactly once', async ({ page }) => {
  await boot(page);
  await withRoute(page);
  // Promoting it while leaving the Charts item in place printed the same command
  // twice in one menu bar.
  const entries = await page.evaluate(() => {
    const label = (S.tbPlan || '').replace(/[^\p{L} ]/gu, '').trim();
    return [...document.querySelectorAll('#toolbar button')]
      .filter(b => b.textContent.replace(/[^\p{L} ]/gu, '').trim() === label)
      .map(b => b.id);
  });
  expect(entries).toEqual(['plan']);
  await page.evaluate(() => document.getElementById('plan').click());
  await expect(page.locator('.modal-back.flight-plan')).toHaveCount(1);
});

test('the standalone Flight plan entry is not a dropdown', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(() => {
    const sec = document.querySelector('.tb-section[data-sec="plan"]');
    const btn = document.getElementById('plan');
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
  await page.evaluate(() => document.getElementById('plan').click());
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
      document.getElementById('plan').click();
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
    document.getElementById('plan').click();
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
    document.getElementById('plan').click();
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
    document.getElementById('plan').click();
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

// --- follow-ups reported against the merged round-2 work -------------------

test('a loaded template shows the same per-leg time on the chart and in the plan', async ({ page }) => {
  // Template legs carry altitudes, so each one costs climb/descent time. The kites
  // used still-air dist/speed, so leg 1 of "Beer Sheva to Herzliya" read 1:55 on the
  // chart and 2:20 in the plan — the climb out of the field.
  await boot(page);
  const r = await page.evaluate(async () => {
    const tpls = await loadRouteTemplates();
    const t = tpls[0];
    await applyRouteTemplate(t, t.defaultSpeed || 90, () => {});
    draw();
    const p = routeProfile();
    const stillAir = state.legs.map((l, i) => {
      const g = geo(state.waypoints[i], state.waypoints[i + 1]);
      return l.flightSpeed > 0 ? g.dist / l.flightSpeed : 0;
    });
    return {
      alts: state.legs.map(l => l.inboundAltitude),
      plan: p.legs.map(l => toHMS(l.timeH)),
      kite: p.legs.map((l, i) => toHMS(legKiteTimeH(i))),
      stillAir: stillAir.map(toHMS),
      cumMatchesPlan: toHMS(p.totalTimeH) ===
        toHMS(p.legs.reduce((a, l) => a + l.timeH, 0)),
    };
  });
  expect(r.alts.every(a => Number.isFinite(a))).toBe(true);   // template really set them
  expect(r.kite).toEqual(r.plan);                             // chart == plan, leg by leg
  expect(r.kite).toEqual(r.stillAir);        // and both are simply distance / speed
  expect(r.cumMatchesPlan).toBe(true);
});

test('the Hebrew summary keeps its numbers in order (bidi isolation)', async ({ page }) => {
  await page.goto('?lang=he&nogist');
  await page.waitForFunction(() => typeof syncLegs === 'function');
  const r = await page.evaluate(r2 => {
    state.waypoints = r2; state.legs = []; syncLegs(); draw();
    const txt = document.getElementById('route-summary').textContent;
    // Strip the isolates to read the logical order the user should see.
    const logical = txt.replace(/[⁦⁩]/g, '');
    return { txt, logical,
      isolates: (txt.match(/⁦/g) || []).length,
      pops: (txt.match(/⁩/g) || []).length };
  }, ROUTE);
  expect(r.isolates).toBe(4);          // legs, NM, time, gal — each pinned LTR
  expect(r.pops).toBe(r.isolates);
  // Values appear in the intended order, with no two numbers merged into one run
  // (the bug rendered "... · 5.2 46.0 NM · גלון").
  expect(r.logical).toMatch(/^2 קטעים · 37\.8 NM · \d+:\d\d · [\d.]+ גלון$/);
});

test('dragging the legend takes the route totals with it', async ({ page }) => {
  // The totals started life as a sibling Leaflet control: dragging the legend left
  // them behind at the corner, which read as the route info vanishing.
  await boot(page);
  await withRoute(page);
  const legend = page.locator('#map-legend');
  const pill = page.locator('#route-summary');
  await expect(pill).toBeVisible();
  const before = await legend.boundingBox();
  await page.mouse.move(before.x + 20, before.y + 6);
  await page.mouse.down();
  await page.mouse.move(520, 220, { steps: 8 });
  await page.mouse.up();
  const after = await legend.boundingBox();
  const box = await pill.boundingBox();
  expect(Math.abs(after.x - before.x)).toBeGreaterThan(50);   // it really moved
  await expect(pill).toBeVisible();
  expect(box.y).toBeGreaterThanOrEqual(after.y - 1);          // still inside the card
  expect(box.y).toBeLessThan(after.y + after.height);
  // ...and the position persists for both together
  await page.reload();
  await page.waitForFunction(() => typeof syncLegs === 'function');
  await withRoute(page);
  const restored = await legend.boundingBox();
  expect(Math.abs(restored.x - after.x)).toBeLessThan(4);
  await expect(pill).toBeVisible();
});

test('route totals are shown in exactly one place', async ({ page }) => {
  // The mobile menu carried its own stats block (Waypoints / Legs / Distance / Total
  // time) while the legend card shows the same totals, so a phone printed the route
  // info twice. The legend is now the only readout.
  await page.setViewportSize({ width: 375, height: 812 });
  await boot(page);
  await withRoute(page);
  const r = await page.evaluate(() => {
    const texts = [...document.querySelectorAll('body *')]
      .filter(el => el.children.length === 0 && /\d+\.\d NM/.test(el.textContent))
      .map(el => el.id || el.className.toString().slice(0, 24));
    return { withNm: texts, statsBlock: !!document.getElementById('info'),
      pill: document.getElementById('route-summary').textContent };
  });
  expect(r.statsBlock).toBe(false);
  expect(r.withNm).toEqual(['route-summary']);
  expect(r.pill).toContain('NM');
});

test('the collapsed phone card has no empty band', async ({ page }) => {
  // The ⋯ overflow was an 11px-wide trigger for six links that phones hide by
  // design, and it still claimed a whole flex row above the GPS buttons.
  await page.setViewportSize({ width: 375, height: 812 });
  await boot(page);
  const r = await page.evaluate(() => {
    const fl = document.getElementById('footer-links').getBoundingClientRect();
    const gps = document.querySelector('#footer-links .footer-gps-group').getBoundingClientRect();
    return { footerH: fl.height, gpsH: gps.height,
      moreBtn: getComputedStyle(document.getElementById('footer-more-btn')).display };
  });
  expect(r.moreBtn).toBe('none');                    // follows the links it holds
  expect(r.footerH).toBeLessThan(r.gpsH + 20);       // one row, not two
});

test('the overflow toggle is still there on desktop', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await boot(page);
  await expect(page.locator('#footer-more-btn')).toBeVisible();
  await page.locator('#footer-more-btn').click();
  await expect(page.locator('#footer-more-menu')).toBeVisible();
  await expect(page.locator('#footer-more-menu a')).toHaveCount(6);
});

// --- V/S shapes the profile, never the clock -------------------------------

test('V/S changes the drawn climb but not time or fuel', async ({ page }) => {
  await boot(page);
  await withRoute(page);
  const r = await page.evaluate(() => {
    state.legs.forEach(l => { l.inboundAltitude = 3000; l.flightSpeed = 100; });
    routeEndpointElev = i => (i === 0 ? 200 : null);      // depart from a field
    const at = vs => { window.profileVS = vs; const p = routeProfile({ gph: 8 });
      return { time: p.totalTimeH, fuel: p.totalFuel, climb: p.legs[0].climbDist,
        tocs: p.tocs.length }; };
    const slow = at(200), fast = at(1500);
    window.profileVS = 500;
    const stillAir = state.legs.reduce((a, l, i) => {
      const g = geo(state.waypoints[i], state.waypoints[i + 1]);
      return a + g.dist / l.flightSpeed; }, 0);
    return { slow, fast, stillAir };
  });
  expect(r.slow.climb).toBeGreaterThan(r.fast.climb);   // the picture responds
  expect(r.slow.time).toBeCloseTo(r.fast.time, 10);     // the clock does not
  expect(r.slow.fuel).toBeCloseTo(r.fast.fuel, 10);
  expect(r.slow.time).toBeCloseTo(r.stillAir, 10);      // == distance / speed
  expect(r.slow.tocs).toBe(1);                          // TOC still marked
});

test('only a leg starting on an airfield gets a ramp', async ({ page }) => {
  await boot(page);
  await withRoute(page);
  const r = await page.evaluate(() => {
    state.legs.forEach(l => { l.inboundAltitude = 4000; });
    routeEndpointElev = () => null;                     // nothing is a field
    const none = routeProfile({ gph: 8 });
    routeEndpointElev = i => (i === 0 ? 300 : null);
    const dep = routeProfile({ gph: 8 });
    return { noneRamps: none.legs.map(l => l.climbDist), noneTocs: none.tocs.length,
      depRamp0: dep.legs[0].climbDist, depRamp1: dep.legs[1].climbDist,
      depStart: dep.legs[0].startAlt, endAlt: dep.legs[dep.legs.length - 1].endAlt };
  });
  expect(r.noneRamps.every(d => d === 0)).toBe(true);
  expect(r.noneTocs).toBe(0);
  expect(r.depRamp0).toBeGreaterThan(0);
  expect(r.depRamp1).toBe(0);                 // mid-route legs stay level
  expect(r.depStart).toBe(300);               // ramp begins at field elevation
  expect(r.endAlt).toBe(4000);                // and nothing descends into the end
});

// --- round-3 fixes ---------------------------------------------------------

test('leg labels stop growing past the cap', async ({ page }) => {
  // 2^(zoom-12) with no ceiling meant 8x at the z15 maximum: one kite covered a third
  // of the screen and buried the chart detail you had zoomed in to read.
  await boot(page);
  const r = await page.evaluate(() => {
    const at = z => { map.setView([32.1, 34.9], z, { animate: false }); return +legZoomScale().toFixed(2); };
    const scales = { z10: at(10), z12: at(12), z13: at(13), z14: at(14), z15: at(15) };
    NavAid.tuningDefaults.legLabelMaxScale.value = 4;
    const raised = at(15);
    NavAid.tuningDefaults.legLabelMaxScale.value = 2;
    return { scales, raised, cap: tune('legLabelMaxScale') };
  });
  expect(r.scales.z10).toBeCloseTo(0.35, 2);   // floor still there
  expect(r.scales.z12).toBeCloseTo(1, 2);
  expect(r.scales.z13).toBeCloseTo(2, 2);
  expect(r.scales.z14).toBeCloseTo(2, 2);      // capped
  expect(r.scales.z15).toBeCloseTo(2, 2);
  expect(r.raised).toBeCloseTo(4, 2);          // and the cap is gistable
});

test('the legend cannot come to rest under the toolbar', async ({ page }) => {
  await boot(page);
  await withRoute(page);
  const legend = page.locator('#map-legend');
  const b = await legend.boundingBox();
  await page.mouse.move(b.x + 20, b.y + 6);
  await page.mouse.down();
  await page.mouse.move(60, 8, { steps: 6 });   // aim into the menu bar
  await page.mouse.up();
  const overlaps = () => page.evaluate(() => {
    const l = document.getElementById('map-legend').getBoundingClientRect();
    const t = document.getElementById('toolbar').getBoundingClientRect();
    return !(l.right < t.left || t.right < l.left || l.bottom < t.top || t.bottom < l.top);
  });
  expect(await overlaps()).toBe(false);        // pushed clear on drop
  await page.reload();
  await page.waitForFunction(() => typeof syncLegs === 'function');
  await withRoute(page);
  expect(await overlaps()).toBe(false);        // and on restore, where it used to hide the totals
});

test('the legend can still be dragged freely after being pushed clear', async ({ page }) => {
  // The first version of the clamp tested only "fully above the bar", so a card whose
  // x-range overlapped the toolbar was pinned to bottom+6: draggable up, never back down.
  await boot(page);
  await withRoute(page);
  const legend = page.locator('#map-legend');
  const drag = async (toX, toY) => {
    const b = await legend.boundingBox();
    await page.mouse.move(b.x + 20, b.y + 6);
    await page.mouse.down();
    await page.mouse.move(toX, toY, { steps: 6 });
    await page.mouse.up();
    return (await legend.boundingBox()).y;
  };
  await drag(60, 8);                          // into the bar -> pushed clear below it
  const parked = (await legend.boundingBox()).y;
  const moved = await drag(60, 420);          // now drag it far down the same column
  expect(moved).toBeGreaterThan(parked + 100);
  // ...and still further down, then back up to just below the bar
  const lower = await drag(60, 650);
  expect(lower).toBeGreaterThan(moved);
});

test('printing warns when the route runs off the page, and can fit it', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => {
    state.waypoints = [{ lat: 32.18, lng: 34.83, name: 'LLHZ' }, { lat: 32.44, lng: 34.90, name: 'HADERA' }];
    state.legs = []; syncLegs(); map.setView([32.31, 34.87], 11, { animate: false });
    setPage('A4'); pageOrient = 'portrait'; pageOffset = { x: 400, y: 260 }; draw();
  });
  const before = await page.evaluate(() => ({ fit: routePageFit().fits,
    warn: !document.getElementById('print-clip-warn').hidden,
    text: document.getElementById('print-clip-warn').textContent,
    fitBtn: !document.getElementById('print-fit').hidden }));
  expect(before.fit).toBe(false);
  expect(before.warn).toBe(true);              // silently clipped before
  expect(before.text).toMatch(/past the page/);
  expect(before.fitBtn).toBe(true);
  const after = await page.evaluate(() => {
    document.getElementById('print-fit').click();
    return { fit: routePageFit().fits, warn: !document.getElementById('print-clip-warn').hidden,
      fitBtn: !document.getElementById('print-fit').hidden, orient: pageOrient };
  });
  expect(after.fit).toBe(true);                // one click puts the whole route on the page
  expect(after.warn).toBe(false);
  expect(after.fitBtn).toBe(false);
});

test('a route too long for any page says so instead of offering a fit', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(() => {
    // ~106 NM: past A3's 56.7 x 40.09 NM at 1:250,000, so no page can hold it.
    state.waypoints = [{ lat: 31.23, lng: 34.79, name: 'LLBS' }, { lat: 32.99, lng: 35.57, name: 'LLIB' }];
    state.legs = []; syncLegs(); fitView(); setPage('A4'); draw();
    return { text: document.getElementById('print-clip-warn').textContent,
      warn: !document.getElementById('print-clip-warn').hidden,
      fitBtn: !document.getElementById('print-fit').hidden };
  });
  expect(r.warn).toBe(true);
  expect(r.text).toMatch(/No page size/);
  expect(r.fitBtn).toBe(false);                // nothing to offer, so no dead button
});

test('the legend keeps its size with no route, across reloads', async ({ page }) => {
  await boot(page);
  const size = () => page.evaluate(() => {
    const b = document.getElementById('map-legend').getBoundingClientRect();
    return { w: Math.round(b.width), h: Math.round(b.height),
      vis: getComputedStyle(document.getElementById('route-summary')).visibility };
  });
  await withRoute(page);
  const withR = await size();
  expect(withR.vis).toBe('visible');
  await page.evaluate(() => { state.waypoints = []; state.legs = []; syncLegs(); draw(); });
  const cleared = await size();
  expect(cleared.vis).toBe('hidden');          // ink gone, box kept
  expect(cleared.w).toBe(withR.w);
  expect(cleared.h).toBe(withR.h);
  // ...and the reserved width survives a reload, when there is no route to measure
  await page.reload();
  await page.waitForFunction(() => typeof syncLegs === 'function');
  await page.evaluate(() => { state.waypoints = []; state.legs = []; syncLegs(); draw(); });
  const afterReload = await size();
  expect(afterReload.w).toBe(withR.w);
  expect(afterReload.h).toBe(withR.h);
});
