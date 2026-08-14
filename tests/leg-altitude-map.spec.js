// @ts-check
// CVFR leg altitude table wiring: new map legs between known green-route
// endpoints should pick up the table altitudes automatically.
const { test, expect } = require('./_setup');
const { hideToolbarMenus } = require('./_toolbar');

async function boot(page) {
  await page.addInitScript(() => {
    try {
      for (const k of Object.keys(localStorage)) localStorage.removeItem(k);
      sessionStorage.clear();
      for (const s of ['build', 'view', 'display', 'charts', 'export', 'print']) {
        localStorage.setItem('navaid.sec.' + s, '1');
      }
    } catch (e) {}
  });
  await page.goto('?lang=en');
  await page.waitForFunction(() =>
    typeof state !== 'undefined' &&
    typeof loadNavWaypoints === 'function' &&
    typeof loadAirfields === 'function' &&
    typeof loadLegAltitudes === 'function');
  await page.evaluate(async () => {
    await Promise.all([loadNavWaypoints(), loadAirfields(), loadLegAltitudes()]);
  });
}

async function clickRoute(page, from, to) {
  return page.evaluate(({ from, to }) => {
    const findPoint = name =>
      (Array.isArray(navWP) && navWP.find(w => w.name === name)) ||
      (Array.isArray(airfields) && airfields.find(a => a.name === name));
    const a = findPoint(from);
    const b = findPoint(to);
    if (!a || !b) throw new Error('missing point fixture');
    state.waypoints = [];
    state.legs = [];
    state.notes = [];
    state.selected = null;
    state.mode = 'add';
    map.fire('click', { latlng: L.latLng(a.lat, a.lng) });
    map.fire('click', { latlng: L.latLng(b.lat, b.lng) });
    return {
      names: state.waypoints.map(w => w.name),
      leg: {
        inboundAltitude: state.legs[0].inboundAltitude,
        outboundAltitude: state.legs[0].outboundAltitude,
        inboundUnknown: Number.isNaN(state.legs[0].inboundAltitude),
        outboundUnknown: Number.isNaN(state.legs[0].outboundAltitude),
        inboundDisplay: formatAltitudeValue(
          state.legs[0].inboundAltitude, state.legs[0], 'inboundAltitude'),
        outboundDisplay: formatAltitudeValue(
          state.legs[0].outboundAltitude, state.legs[0], 'outboundAltitude'),
        inboundBlocked: state.legs[0]._legAltitudeInboundBlocked === 1,
        outboundBlocked: state.legs[0]._legAltitudeOutboundBlocked === 1,
        auto: state.legs[0]._legAltitudeAuto === 1,
      },
    };
  }, { from, to });
}

async function setNamedRoute(page, from, to) {
  return page.evaluate(({ from, to }) => {
    const findPoint = name =>
      (Array.isArray(navWP) && navWP.find(w => w.name === name)) ||
      (Array.isArray(airfields) && airfields.find(a => a.name === name));
    const a = findPoint(from);
    const b = findPoint(to);
    if (!a || !b) throw new Error('missing point fixture');
    state.waypoints = [a, b].map(p => ({ lat: p.lat, lng: p.lng, name: p.name }));
    state.legs = [];
    state.notes = [];
    state.selected = null;
    syncLegs();
    return {
      names: state.waypoints.map(w => w.name),
      leg: {
        inboundAltitude: state.legs[0].inboundAltitude,
        outboundAltitude: state.legs[0].outboundAltitude,
        inboundUnknown: Number.isNaN(state.legs[0].inboundAltitude),
        outboundUnknown: Number.isNaN(state.legs[0].outboundAltitude),
        inboundDisplay: formatAltitudeValue(
          state.legs[0].inboundAltitude, state.legs[0], 'inboundAltitude'),
        outboundDisplay: formatAltitudeValue(
          state.legs[0].outboundAltitude, state.legs[0], 'outboundAltitude'),
        inboundBlocked: state.legs[0]._legAltitudeInboundBlocked === 1,
        outboundBlocked: state.legs[0]._legAltitudeOutboundBlocked === 1,
        auto: state.legs[0]._legAltitudeAuto === 1,
      },
    };
  }, { from, to });
}

test.describe('leg-altitude map wiring', () => {
  test('the segment key is orientation-free', async ({ page }) => {
  // The graph stores a segment in whichever direction it walks first, so ~30% of rows come
  // out reversed from one build to the next. The key being canonical is what lets every
  // consumer do ONE lookup: a directional key here once meant a single-orientation lookup
  // silently missed those rows -- no error, just legs with no charted altitude.
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof legAltitudeKey === 'function');
  const r = await page.evaluate(() => ({
    same: legAltitudeKey('KNTRY', 'HTZUK') === legAltitudeKey('HTZUK', 'KNTRY'),
    trimmed: legAltitudeKey(' HTZUK ', 'KNTRY') === legAltitudeKey('KNTRY', 'HTZUK'),
  }));
  expect(r.same).toBe(true);
  expect(r.trimmed).toBe(true);
});

test('map-added known green-route leg uses leg altitudes', async ({ page }) => {
    await boot(page);

    const result = await clickRoute(page, 'DESHE', 'ZALMN');

    expect(result.names).toEqual(['DESHE', 'ZALMN']);
    expect(result.leg).toMatchObject({
      inboundAltitude: 3000,
      outboundAltitude: 2500,
      auto: true,
    });
  });

  test('reverse map-added leg swaps leg-altitude inbound/outbound values', async ({ page }) => {
    await boot(page);

    const result = await clickRoute(page, 'ZALMN', 'DESHE');

    expect(result.names).toEqual(['ZALMN', 'DESHE']);
    expect(result.leg).toMatchObject({
      inboundAltitude: 2500,
      outboundAltitude: 3000,
      auto: true,
    });
  });

  test('manual altitude edits are not overwritten by the leg-altitude table', async ({ page }) => {
    await boot(page);
    await clickRoute(page, 'DESHE', 'ZALMN');

    const leg = await page.evaluate(() => {
      const l = state.legs[0];
      const oldIn = l.inboundAltitude;
      l.inboundAltitude = 1234;
      propagateAlt(0, 'inboundAltitude', l.inboundAltitude, oldIn);
      const oldOut = l.outboundAltitude;
      l.outboundAltitude = 2345;
      propagateAlt(0, 'outboundAltitude', l.outboundAltitude, oldOut);
      applyLegAltitudesToRoute();
      return {
        inboundAltitude: l.inboundAltitude,
        outboundAltitude: l.outboundAltitude,
        auto: l._legAltitudeAuto === 1,
      };
    });

    expect(leg).toEqual({
      inboundAltitude: 1234,
      outboundAltitude: 2345,
      auto: false,
    });
  });

  test('one-way leg-altitude entry fills only the allowed direction', async ({ page }) => {
    await boot(page);

    const result = await clickRoute(page, 'EIRON', 'SDTYM');

    expect(result.names).toEqual(['EIRON', 'SDTYM']);
    expect(result.leg).toMatchObject({
      inboundAltitude: 3000,
      outboundUnknown: true,
      outboundDisplay: 'Blocked',
      outboundBlocked: true,
      auto: true,
    });
    const oneWay = await page.evaluate(() =>
      state.legs[0]._legAltitudeOutboundBlocked === 1 && legAllowsReturn(0) === false);
    expect(oneWay).toBe(true);
    await page.evaluate(() => {
      state.selected = { type: 'leg', index: 0 };
      showInspector();
    });
    const inspectorAltitudeInputs = page.locator('#insp-body input[type="number"]');
    await expect(inspectorAltitudeInputs.nth(1)).toHaveValue('3000');
    await expect(inspectorAltitudeInputs.nth(2)).toHaveValue('');
    await expect(inspectorAltitudeInputs.nth(2)).toHaveAttribute('placeholder', 'Blocked');
  });

  test('ANATA to HNINA uses the charted 5000 / 4500 altitude pair', async ({ page }) => {
    await boot(page);

    const result = await clickRoute(page, 'ANATA', 'HNINA');

    expect(result.names).toEqual(['ANATA', 'HNINA']);
    expect(result.leg).toMatchObject({
      inboundAltitude: 5000,
      outboundAltitude: 4500,
      auto: true,
    });
    const allowsReturn = await page.evaluate(() =>
      !state.legs[0]._legAltitudeOneWay && legAllowsReturn(0) === true);
    expect(allowsReturn).toBe(true);
  });

  test('inspector dims default alts; typing un-dims; emptying restores default', async ({ page }) => {
    await boot(page);
    await clickRoute(page, 'ANATA', 'HNINA');
    await page.evaluate(() => { state.selected = { type: 'leg', index: 0 }; showInspector(); });
    const alts = page.locator('#insp-body input[type="number"]');
    const inAlt = alts.nth(1);            // speed(0), in-alt(1), out-alt(2)
    // Charted default → muted (is-default) and showing the charted value.
    await expect(inAlt).toHaveValue('5000');
    await expect(inAlt).toHaveClass(/is-default/);
    // Typing an override drops the muted style.
    await inAlt.fill('4000');
    await expect(inAlt).not.toHaveClass(/is-default/);
    expect(await page.evaluate(() => state.legs[0].inboundAltitude)).toBe(4000);
    // Emptying restores the charted default (and re-dims) on blur.
    await inAlt.fill('');
    await inAlt.blur();
    await expect(inAlt).toHaveValue('5000');
    await expect(inAlt).toHaveClass(/is-default/);
    expect(await page.evaluate(() => state.legs[0].inboundAltitude)).toBe(5000);
    // The ↻ reset also re-dims (restores the charted default).
    await inAlt.fill('4000');
    await expect(inAlt).not.toHaveClass(/is-default/);
    const reset = page.locator('#insp-body .row').filter({ hasText: 'Inbound alt' })
      .locator('button.row-reset');
    await hideToolbarMenus(page);
    await reset.click();
    await expect(inAlt).toHaveValue('5000');
    await expect(inAlt).toHaveClass(/is-default/);
  });

  test('inspector default/reset stay charted after an override edits the live map', async ({ page }) => {
    await boot(page);
    await clickRoute(page, 'ANATA', 'HNINA');
    // Override the inbound altitude — this also writes 4000 into the live
    // leg-altitude lookup map (the edit becomes the live "source of truth").
    await page.evaluate(() => { state.selected = { type: 'leg', index: 0 }; showInspector(); });
    await page.locator('#insp-body input[type="number"]').nth(1).fill('4000');
    expect(await page.evaluate(() => state.legs[0].inboundAltitude)).toBe(4000);
    // Rebuild the inspector. The charted DEFAULT must still be the JSON-origin
    // 5000 — not the edited 4000 — so the override doesn't redefine "charted".
    await page.evaluate(() => { state.selected = { type: 'leg', index: 0 }; showInspector(); });
    const inAlt = page.locator('#insp-body input[type="number"]').nth(1);
    await expect(inAlt).toHaveValue('4000');
    await expect(inAlt).not.toHaveClass(/is-default/);
    const reset = page.locator('#insp-body .row').filter({ hasText: 'Inbound alt' })
      .locator('button.row-reset');
    await hideToolbarMenus(page);
    await reset.click();
    await expect(inAlt).toHaveValue('5000');
    await expect(inAlt).toHaveClass(/is-default/);
  });

  test('HNINA to ANATA uses the charted 4500 reverse altitude', async ({ page }) => {
    await boot(page);

    const result = await clickRoute(page, 'HNINA', 'ANATA');

    expect(result.names).toEqual(['HNINA', 'ANATA']);
    expect(result.leg).toMatchObject({
      inboundAltitude: 4500,
      outboundAltitude: 5000,
      auto: true,
    });
    const allowsReturn = await page.evaluate(() =>
      !state.legs[0]._legAltitudeOneWay && legAllowsReturn(0) === true);
    expect(allowsReturn).toBe(true);
  });

  test('ANATA to DUMIM uses the charted 4500 / 5000 altitude pair', async ({ page }) => {
    await boot(page);

    const result = await clickRoute(page, 'ANATA', 'DUMIM');

    expect(result.names).toEqual(['ANATA', 'DUMIM']);
    expect(result.leg).toMatchObject({
      inboundAltitude: 4500,
      outboundAltitude: 5000,
      auto: true,
    });
    const allowsReturn = await page.evaluate(() =>
      !state.legs[0]._legAltitudeOneWay && legAllowsReturn(0) === true);
    expect(allowsReturn).toBe(true);
  });

  test('DUMIM to ANATA uses the charted 5000 reverse altitude', async ({ page }) => {
    await boot(page);

    const result = await clickRoute(page, 'DUMIM', 'ANATA');

    expect(result.names).toEqual(['DUMIM', 'ANATA']);
    expect(result.leg).toMatchObject({
      inboundAltitude: 5000,
      outboundAltitude: 4500,
      auto: true,
    });
    const allowsReturn = await page.evaluate(() =>
      !state.legs[0]._legAltitudeOneWay && legAllowsReturn(0) === true);
    expect(allowsReturn).toBe(true);
  });

  for (const [from, to, inboundAltitude, outboundAltitude] of [
    ['DUMIM', 'YRIHO', 3500, 4000],
    ['YRIHO', 'DUMIM', 4000, 3500],
    ['YRIHO', 'ALMOG', 3500, 4000],
    ['ALMOG', 'YRIHO', 4000, 3500],
    ['ENGDI', 'LLMZ', 3500, 4000],
    ['LLMZ', 'ENGDI', 4000, 3500],
  ]) {
    test(`${from} to ${to} uses the charted altitude pair`, async ({ page }) => {
      await boot(page);

      const result = await clickRoute(page, from, to);

      expect(result.names).toEqual([from, to]);
      expect(result.leg).toMatchObject({
        inboundAltitude,
        outboundAltitude,
        auto: true,
      });
      const allowsReturn = await page.evaluate(() =>
        !state.legs[0]._legAltitudeOneWay && legAllowsReturn(0) === true);
      expect(allowsReturn).toBe(true);
    });
  }

  test('BAZRA to DEROR uses the charted 800 / 2000 altitude pair', async ({ page }) => {
    await boot(page);

    const result = await clickRoute(page, 'BAZRA', 'DEROR');

    expect(result.names).toEqual(['BAZRA', 'DEROR']);
    expect(result.leg).toMatchObject({
      inboundAltitude: 800,
      outboundAltitude: 2000,
      auto: true,
    });
  });

  test('DEROR to BAZRA uses the charted 2000 reverse altitude', async ({ page }) => {
    await boot(page);

    const result = await clickRoute(page, 'DEROR', 'BAZRA');

    expect(result.names).toEqual(['DEROR', 'BAZRA']);
    expect(result.leg).toMatchObject({
      inboundAltitude: 2000,
      outboundAltitude: 800,
      auto: true,
    });
  });

  test('BAZRA to LLHZ uses the upstream Herzliya airway altitude pair', async ({ page }) => {
    await boot(page);

    const result = await clickRoute(page, 'BAZRA', 'LLHZ');

    expect(result.names).toEqual(['BAZRA', 'LLHZ']);
    expect(result.leg).toMatchObject({
      inboundAltitude: 1200,
      outboundAltitude: 800,
      auto: true,
    });
  });

  test('ZGOAL to ZLHAV uses the upstream GORAL airway altitude pair', async ({ page }) => {
    await boot(page);

    const result = await clickRoute(page, 'ZGOAL', 'ZLHAV');

    expect(result.names).toEqual(['ZGOAL', 'ZLHAV']);
    expect(result.leg).toMatchObject({
      inboundAltitude: 3500,
      outboundAltitude: 3000,
      auto: true,
    });
  });

  test('DEROR to SHARO uses the seeded sibling altitude pair', async ({ page }) => {
    await boot(page);

    const result = await clickRoute(page, 'DEROR', 'SHARO');

    expect(result.names).toEqual(['DEROR', 'SHARO']);
    expect(result.leg).toMatchObject({
      inboundAltitude: 1500,
      outboundAltitude: 2000,
      auto: true,
    });
  });

  test('SHARO to ZYAAR uses the maintainer altitude pair', async ({ page }) => {
    await boot(page);

    const result = await clickRoute(page, 'SHARO', 'ZYAAR');

    expect(result.names).toEqual(['SHARO', 'ZYAAR']);
    expect(result.leg).toMatchObject({
      inboundAltitude: 1500,
      outboundAltitude: 2000,
      auto: true,
    });
  });

  test('ZYAAR to SHARO uses the maintainer reverse altitude', async ({ page }) => {
    await boot(page);

    const result = await clickRoute(page, 'ZYAAR', 'SHARO');

    expect(result.names).toEqual(['ZYAAR', 'SHARO']);
    expect(result.leg).toMatchObject({
      inboundAltitude: 2000,
      outboundAltitude: 1500,
      auto: true,
    });
  });

  test('ZYAAR to HADRA uses the maintainer altitude pair', async ({ page }) => {
    await boot(page);

    const result = await clickRoute(page, 'ZYAAR', 'HADRA');

    expect(result.names).toEqual(['ZYAAR', 'HADRA']);
    expect(result.leg).toMatchObject({
      inboundAltitude: 1500,
      outboundAltitude: 2000,
      auto: true,
    });
  });

  test('HADRA to ZYAAR uses the maintainer reverse altitude', async ({ page }) => {
    await boot(page);

    const result = await clickRoute(page, 'HADRA', 'ZYAAR');

    expect(result.names).toEqual(['HADRA', 'ZYAAR']);
    expect(result.leg).toMatchObject({
      inboundAltitude: 2000,
      outboundAltitude: 1500,
      auto: true,
    });
  });

  test('ZMGEN to TZHOT uses the upstream Urim airway altitude pair', async ({ page }) => {
    await boot(page);

    const result = await clickRoute(page, 'ZMGEN', 'TZHOT');

    expect(result.names).toEqual(['ZMGEN', 'TZHOT']);
    expect(result.leg).toMatchObject({
      inboundAltitude: 2000,
      outboundAltitude: 2000,
      auto: true,
    });
  });

  test('TZHOT to LLHB uses the upstream Urim to Hatzerim altitude pair', async ({ page }) => {
    await boot(page);

    const result = await clickRoute(page, 'TZHOT', 'LLHB');

    expect(result.names).toEqual(['TZHOT', 'LLHB']);
    expect(result.leg).toMatchObject({
      inboundAltitude: 2000,
      outboundAltitude: 2000,
      auto: true,
    });
  });

  test('NMASD to NITZA uses the maintainer altitude pair', async ({ page }) => {
    await boot(page);

    const result = await clickRoute(page, 'NMASD', 'NITZA');

    expect(result.names).toEqual(['NMASD', 'NITZA']);
    expect(result.leg).toMatchObject({
      inboundAltitude: 800,
      outboundAltitude: 1200,
      auto: true,
    });
  });

  test('NITZA to NMASD uses the maintainer reverse altitude', async ({ page }) => {
    await boot(page);

    const result = await clickRoute(page, 'NITZA', 'NMASD');

    expect(result.names).toEqual(['NITZA', 'NMASD']);
    expect(result.leg).toMatchObject({
      inboundAltitude: 1200,
      outboundAltitude: 800,
      auto: true,
    });
  });

  test('route-template promoted legs fill from the shared altitude table', async ({ page }) => {
    await boot(page);

    for (const [from, to, inboundAltitude, outboundAltitude] of [
      ['SFAIM', 'HTZUK', 800, 1600],
      ['HTZUK', 'SFAIM', 1600, 800],
      ['SFAIM', 'RIDNG', 800, 1600],
      ['RIDNG', 'SFAIM', 1600, 800],
      ['TYONA', 'NTAIM', 800, 1200],
      ['NTAIM', 'TYONA', 1200, 800],
      ['NTAIM', 'BOVED', 800, 1200],
      ['BOVED', 'NTAIM', 1200, 800],
      ['NITZA', 'HODYA', 1500, 2000],
      ['HODYA', 'NITZA', 2000, 1500],
      ['HODYA', 'REVAH', 1500, 2000],
      ['REVAH', 'HODYA', 2000, 1500],
      ['SOVAL', 'MINGV', 2500, 3000],
      ['MINGV', 'SOVAL', 3000, 2500],
      ['RIDNG', 'HTZUK', 1200, 800],
    ]) {
      const result = await setNamedRoute(page, from, to);

      expect(result.names).toEqual([from, to]);
      expect(result.leg).toMatchObject({
        inboundAltitude,
        outboundAltitude,
        auto: true,
      });
    }
  });

  test('blocked reverse of one-way leg-altitude entry shows blocked current direction', async ({ page }) => {
    await boot(page);

    const result = await clickRoute(page, 'SDTYM', 'EIRON');

    expect(result.names).toEqual(['SDTYM', 'EIRON']);
    expect(result.leg).toMatchObject({
      inboundUnknown: true,
      inboundDisplay: 'Blocked',
      inboundBlocked: true,
      outboundAltitude: 3000,
      outboundDisplay: '3000',
      auto: true,
    });
    const returnAllowed = await page.evaluate(() => legAllowsReturn(0) === true);
    expect(returnAllowed).toBe(true);
    await page.evaluate(() => {
      state.selected = { type: 'leg', index: 0 };
      showInspector();
    });
    const inspectorAltitudeInputs = page.locator('#insp-body input[type="number"]');
    await expect(inspectorAltitudeInputs.nth(1)).toHaveValue('');
    await expect(inspectorAltitudeInputs.nth(1)).toHaveAttribute('placeholder', 'Blocked');
    await expect(inspectorAltitudeInputs.nth(2)).toHaveValue('3000');
  });

  test('reversing a one-way leg-altitude entry marks the new current direction blocked', async ({ page }) => {
    await boot(page);
    await clickRoute(page, 'EIRON', 'SDTYM');

    const reversed = await page.evaluate(() => {
      document.getElementById('reverse').click();
      return {
        names: state.waypoints.map(w => w.name),
        inboundUnknown: Number.isNaN(state.legs[0].inboundAltitude),
        outboundUnknown: Number.isNaN(state.legs[0].outboundAltitude),
        inboundDisplay: formatAltitudeValue(
          state.legs[0].inboundAltitude, state.legs[0], 'inboundAltitude'),
        outboundDisplay: formatAltitudeValue(
          state.legs[0].outboundAltitude, state.legs[0], 'outboundAltitude'),
        key: state.legs[0]._legAltitudeKey || '',
        inboundBlocked: state.legs[0]._legAltitudeInboundBlocked === 1,
        outboundBlocked: state.legs[0]._legAltitudeOutboundBlocked === 1,
        returnAllowed: legAllowsReturn(0) === true,
      };
    });

    expect(reversed).toEqual({
      names: ['SDTYM', 'EIRON'],
      inboundUnknown: true,
      outboundUnknown: false,
      inboundDisplay: 'Blocked',
      outboundDisplay: '3000',
      key: 'EIRON-SDTYM',
      inboundBlocked: true,
      outboundBlocked: false,
      returnAllowed: true,
    });
  });

  test('non-CVFR path with no leg altitude is marked unknown', async ({ page }) => {
    await boot(page);
    // Auto-route would splice the published corridor between these two fields (that is its
    // job); this test is about the UNKNOWN-altitude display on a direct leg, so draw one.
    await page.evaluate(() => { window.autoRouteCorridors = false; });

    const result = await clickRoute(page, 'LLHZ', 'LLHA');

    expect(result.names).toEqual(['LLHZ', 'LLHA']);
    expect(result.leg).toMatchObject({
      inboundUnknown: true,
      outboundUnknown: true,
      inboundDisplay: 'Unknown',
      outboundDisplay: 'Unknown',
      auto: true,
    });

    await page.evaluate(() => {
      state.selected = { type: 'leg', index: 0 };
      showInspector();
    });
    const inspectorAltitudeInputs = page.locator('#insp-body input[type="number"]');
    await expect(inspectorAltitudeInputs.nth(1)).toHaveValue('');
    await expect(inspectorAltitudeInputs.nth(1)).toHaveAttribute('placeholder', 'Unknown');
    await expect(inspectorAltitudeInputs.nth(2)).toHaveValue('');
    await expect(inspectorAltitudeInputs.nth(2)).toHaveAttribute('placeholder', 'Unknown');

    await page.locator('#plan').click();
    const modal = page.locator('.modal-back.flight-plan');
    await expect(modal).toBeVisible();
    const firstForwardAlt = modal.locator('.fp-scroll > .flight-table')
      .first()
      .locator('tbody tr')
      .first()
      .locator('td')
      .nth(6)
      .locator('input');
    await expect(firstForwardAlt).toHaveValue('');
    await expect(firstForwardAlt).toHaveAttribute('placeholder', 'Unknown');
  });

  test('promoted SFAIM to RIDNG shortcut uses the shared altitude row', async ({ page }) => {
    await boot(page);

    const result = await setNamedRoute(page, 'SFAIM', 'RIDNG');

    expect(result.names).toEqual(['SFAIM', 'RIDNG']);
    expect(result.leg).toMatchObject({
      inboundAltitude: 800,
      outboundAltitude: 1600,
      auto: true,
    });
    expect(await page.evaluate(() =>
      Boolean(legAltitudeMap['SFAIM-RIDNG'] || legAltitudeMap['RIDNG-SFAIM'])
    )).toBe(true);
  });

  test('reverse promoted SFAIM to RIDNG shortcut swaps the shared altitude row', async ({ page }) => {
    await boot(page);

    const result = await setNamedRoute(page, 'RIDNG', 'SFAIM');

    expect(result.names).toEqual(['RIDNG', 'SFAIM']);
    expect(result.leg).toMatchObject({
      inboundAltitude: 1600,
      outboundAltitude: 800,
      auto: true,
    });
  });
});
