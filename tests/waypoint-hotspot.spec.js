// @ts-check
// Route-waypoint hotspot defaults, inspector override, drawing and persistence.
const { test, expect } = require('./_setup');

async function boot(page, lang = 'en') {
  await page.goto(`?lang=${lang}&nogist`);
  await page.waitForFunction(() => typeof waypointHotspot === 'function' &&
    typeof showInspector === 'function' && typeof buildShareUrl === 'function');
}

async function setRoute(page) {
  await page.evaluate(() => {
    state.waypoints = [
      { lat: 32.40, lng: 34.80, name: 'ALPHA' },
      { lat: 32.46, lng: 34.91, name: 'HADRA' },
      { lat: 32.52, lng: 34.95, name: 'BRAVO' },
    ];
    state.legs = [];
    state.notes = [];
    syncLegs();
    draw();
  });
}

test('HADRA defaults on and route waypoint inspector exposes the pressed toggle', async ({ page }) => {
  await boot(page);
  await setRoute(page);
  const result = await page.evaluate(() => {
    state.selected = { type: 'wp', index: 1 };
    showInspector();
    const btn = document.getElementById('insp-hotspot-btn');
    return {
      effective: state.waypoints.map(waypointHotspot),
      drawn: window.__hotspotWaypointIndexes,
      pressed: btn && btn.getAttribute('aria-pressed'),
      text: btn && btn.textContent,
    };
  });
  expect(result.effective).toEqual([false, true, false]);
  expect(result.drawn).toEqual([1]);
  expect(result.pressed).toBe('true');
  expect(result.text).toContain('Clear hotspot');
});

test('inspector can explicitly disable the default and the override survives reload', async ({ page }) => {
  await boot(page);
  await setRoute(page);
  await page.evaluate(() => {
    state.selected = { type: 'wp', index: 1 };
    showInspector();
  });
  await page.locator('#insp-hotspot-btn').click();
  await page.waitForFunction(() => {
    const raw = localStorage.getItem('navaid.route');
    return raw && JSON.parse(raw).waypoints[1].hotspot === false;
  });
  const disabled = await page.evaluate(() => ({
    own: Object.prototype.hasOwnProperty.call(state.waypoints[1], 'hotspot'),
    value: state.waypoints[1].hotspot,
    effective: waypointHotspot(state.waypoints[1]),
    drawn: window.__hotspotWaypointIndexes,
    stored: JSON.parse(localStorage.getItem('navaid.route')).waypoints[1].hotspot,
  }));
  expect(disabled).toEqual({ own: true, value: false, effective: false, drawn: [], stored: false });

  await page.reload();
  await page.waitForFunction(() => typeof waypointHotspot === 'function' && state.waypoints.length === 3);
  expect(await page.evaluate(() => ({
    value: state.waypoints[1].hotspot,
    effective: waypointHotspot(state.waypoints[1]),
  }))).toEqual({ value: false, effective: false });
});

test('inspector can enable a non-default waypoint and standalone references have no toggle', async ({ page }) => {
  await boot(page);
  await setRoute(page);
  await page.evaluate(() => {
    state.selected = { type: 'wp', index: 0 };
    showInspector();
  });
  await page.locator('#insp-hotspot-btn').click();
  expect(await page.evaluate(() => ({
    value: state.waypoints[0].hotspot,
    drawn: window.__hotspotWaypointIndexes,
  }))).toEqual({ value: true, drawn: [0, 1] });

  const standaloneHasToggle = await page.evaluate(() => {
    navWP = [{ name: 'HADRA', en: 'Hadera', he: 'חדרה', lat: 32.46, lng: 34.91 }];
    state.selected = { type: 'navwp', index: 0 };
    showInspector();
    return !!document.getElementById('insp-hotspot-btn');
  });
  expect(standaloneHasToggle).toBe(false);
});

test('route files and share links retain true and false hotspot overrides', async ({ page }) => {
  await boot(page);
  await setRoute(page);
  const result = await page.evaluate(() => {
    state.waypoints[0].hotspot = true;
    state.waypoints[1].hotspot = false;
    const serialized = serializeRoute();
    const built = buildShareUrl();
    const decoded = decodeShareUrl(new URL(built.url).search);
    return {
      serialized: serialized.waypoints.map(w => w.hotspot),
      decoded: decoded.waypoints.map(w => ({ own: Object.prototype.hasOwnProperty.call(w, 'hotspot'), value: w.hotspot })),
      h: new URL(built.url).searchParams.get('h'),
      badSchema: validateRoute({
        waypoints: [{ lat: 1, lng: 2, name: 'X', hotspot: 'yes' }],
        legs: [], notes: [],
      }),
    };
  });
  expect(result.serialized).toEqual([true, false, undefined]);
  expect(result.decoded).toEqual([
    { own: true, value: true },
    { own: true, value: false },
    { own: false, value: undefined },
  ]);
  expect(result.h).toBe('10_');
  expect(result.badSchema).toContain('waypoints[0].hotspot: expected boolean');
});

test('Hebrew inspector localizes the hotspot toggle', async ({ page }) => {
  await boot(page, 'he');
  await setRoute(page);
  await page.evaluate(() => {
    state.selected = { type: 'wp', index: 1 };
    showInspector();
  });
  await expect(page.locator('#insp-hotspot-btn')).toContainText('בטל נקודה חמה');
});
