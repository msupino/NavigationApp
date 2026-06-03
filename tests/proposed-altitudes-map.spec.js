// @ts-check
// Proposed CVFR altitude table wiring: new map legs between known green-route
// endpoints should pick up the table altitudes automatically.
const { test, expect } = require('./_setup');

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
    typeof loadProposedAltitudes === 'function');
  await page.evaluate(async () => {
    await Promise.all([loadNavWaypoints(), loadAirfields(), loadProposedAltitudes()]);
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
        auto: state.legs[0]._proposedAltitudeAuto === 1,
      },
    };
  }, { from, to });
}

test.describe('proposed-altitudes map wiring', () => {
  test('map-added known green-route leg uses proposed altitudes', async ({ page }) => {
    await boot(page);

    const result = await clickRoute(page, 'DESHE', 'ZALMN');

    expect(result.names).toEqual(['DESHE', 'ZALMN']);
    expect(result.leg).toMatchObject({
      inboundAltitude: 3000,
      outboundAltitude: 2500,
      auto: true,
    });
  });

  test('reverse map-added leg swaps proposed inbound/outbound altitudes', async ({ page }) => {
    await boot(page);

    const result = await clickRoute(page, 'ZALMN', 'DESHE');

    expect(result.names).toEqual(['ZALMN', 'DESHE']);
    expect(result.leg).toMatchObject({
      inboundAltitude: 2500,
      outboundAltitude: 3000,
      auto: true,
    });
  });

  test('manual altitude edits are not overwritten by the proposed table', async ({ page }) => {
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
      applyProposedAltitudesToRoute();
      return {
        inboundAltitude: l.inboundAltitude,
        outboundAltitude: l.outboundAltitude,
        auto: l._proposedAltitudeAuto === 1,
      };
    });

    expect(leg).toEqual({
      inboundAltitude: 1234,
      outboundAltitude: 2345,
      auto: false,
    });
  });

  test('one-way proposed leg fills only the allowed direction', async ({ page }) => {
    await boot(page);

    const result = await clickRoute(page, 'EIRON', 'SDTYM');

    expect(result.names).toEqual(['EIRON', 'SDTYM']);
    expect(result.leg).toMatchObject({
      inboundAltitude: 3000,
      outboundUnknown: true,
      auto: true,
    });
    const oneWay = await page.evaluate(() =>
      state.legs[0]._proposedOneWay === 1 && legAllowsReturn(0) === false);
    expect(oneWay).toBe(true);
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
      !state.legs[0]._proposedOneWay && legAllowsReturn(0) === true);
    expect(allowsReturn).toBe(true);
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
      !state.legs[0]._proposedOneWay && legAllowsReturn(0) === true);
    expect(allowsReturn).toBe(true);
  });

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

  test('blocked reverse of one-way proposed leg is not auto-filled', async ({ page }) => {
    await boot(page);

    const result = await clickRoute(page, 'SDTYM', 'EIRON');

    expect(result.names).toEqual(['SDTYM', 'EIRON']);
    expect(result.leg).toMatchObject({
      inboundUnknown: true,
      outboundUnknown: true,
      auto: true,
    });
    const key = await page.evaluate(() => state.legs[0]._proposedAltitudeKey || '');
    expect(key).toBe('');
  });

  test('reversing a one-way proposed leg clears the blocked auto altitude', async ({ page }) => {
    await boot(page);
    await clickRoute(page, 'EIRON', 'SDTYM');

    const reversed = await page.evaluate(() => {
      document.getElementById('reverse').click();
      return {
        names: state.waypoints.map(w => w.name),
        inboundUnknown: Number.isNaN(state.legs[0].inboundAltitude),
        outboundUnknown: Number.isNaN(state.legs[0].outboundAltitude),
        key: state.legs[0]._proposedAltitudeKey || '',
        oneWay: state.legs[0]._proposedOneWay === 1,
      };
    });

    expect(reversed).toEqual({
      names: ['SDTYM', 'EIRON'],
      inboundUnknown: true,
      outboundUnknown: true,
      key: '',
      oneWay: false,
    });
  });

  test('non-CVFR path with no proposed altitude is marked unknown', async ({ page }) => {
    await boot(page);

    const result = await clickRoute(page, 'LLHZ', 'LLHA');

    expect(result.names).toEqual(['LLHZ', 'LLHA']);
    expect(result.leg).toMatchObject({
      inboundUnknown: true,
      outboundUnknown: true,
      auto: true,
    });
  });
});
