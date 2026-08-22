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

test('global hotspot visibility persists without clearing inspector choices', async ({ page }) => {
  await boot(page);
  await setRoute(page);
  const globalToggle = page.locator('#hotspot-cb');
  await expect(globalToggle).toBeChecked();
  await expect(globalToggle.locator('xpath=..')).toContainText('Show hotspots');
  expect(await page.evaluate(() => ({
    defaultValue: NavAid.tuningDefaults.defaultShowHotspots.value,
    drawn: window.__hotspotWaypointIndexes,
  }))).toEqual({ defaultValue: true, drawn: [1] });

  await page.evaluate(() => {
    const cb = document.getElementById('hotspot-cb');
    cb.checked = false;
    cb.dispatchEvent(new Event('change'));
  });
  expect(await page.evaluate(() => ({
    shown: showHotspots,
    stored: localStorage.getItem('navaid.showHotspots'),
    effective: waypointHotspot(state.waypoints[1]),
    drawn: window.__hotspotWaypointIndexes,
  }))).toEqual({ shown: false, stored: '0', effective: true, drawn: [] });

  await page.evaluate(() => {
    state.selected = { type: 'wp', index: 0 };
    showInspector();
  });
  await page.locator('#insp-hotspot-btn').click();
  expect(await page.evaluate(() => ({
    override: state.waypoints[0].hotspot,
    shown: showHotspots,
    drawn: window.__hotspotWaypointIndexes,
  }))).toEqual({ override: true, shown: false, drawn: [] });

  await page.reload();
  await page.waitForFunction(() => typeof waypointHotspot === 'function' && state.waypoints.length === 3);
  await expect(globalToggle).not.toBeChecked();
  expect(await page.evaluate(() => ({
    override: state.waypoints[0].hotspot,
    effective: state.waypoints.map(waypointHotspot),
    drawn: window.__hotspotWaypointIndexes,
  }))).toEqual({ override: true, effective: [true, true, false], drawn: [] });

  await page.evaluate(() => {
    const cb = document.getElementById('hotspot-cb');
    cb.checked = true;
    cb.dispatchEvent(new Event('change'));
  });
  expect(await page.evaluate(() => window.__hotspotWaypointIndexes)).toEqual([0, 1]);
});

test('tunable hotspot default controls a device with no saved preference', async ({ page }) => {
  await boot(page);
  const result = await page.evaluate(() => {
    localStorage.removeItem('navaid.showHotspots');
    NavAid.tuning.defaultShowHotspots = false;
    NavAid.applyDefaultVisibility();
    return {
      checked: document.getElementById('hotspot-cb').checked,
      shown: showHotspots,
      stored: localStorage.getItem('navaid.showHotspots'),
    };
  });
  expect(result).toEqual({ checked: false, shown: false, stored: null });
});

test('default hotspots exactly match waypoint graph junctions with more than two bidirectional neighbours', async ({ page }) => {
  await boot(page);
  const result = await page.evaluate(async () => {
    const graph = await (await fetch('data/cvfr-route-graph.json?hotspot-parity=1')).json();
    const expected = Object.entries(graph.edges)
      .filter(([name, edges]) => graph.nodes[name] && graph.nodes[name].kind === 'waypoint' &&
        new Set(edges.filter(edge => !edge.oneWay && !edge.blocked).map(edge => edge.to)).size > 2)
      .map(([name]) => name).sort();
    const actual = Object.keys(graph.nodes)
      .filter(name => graph.nodes[name].kind === 'waypoint' && waypointHotspot({ name }))
      .sort();
    return {
      expected,
      actual,
      hadraDegree: new Set(graph.edges.HADRA
        .filter(edge => !edge.oneWay && !edge.blocked).map(edge => edge.to)).size,
      eironDegree: new Set(graph.edges.EIRON
        .filter(edge => !edge.oneWay && !edge.blocked).map(edge => edge.to)).size,
      eironHotspot: waypointHotspot({ name: 'EIRON' }),
      airfieldDefaults: Object.keys(graph.nodes)
        .filter(name => graph.nodes[name].kind === 'airfield' && waypointHotspot({ name })),
    };
  });
  expect(result.actual).toEqual(result.expected);
  expect(result.actual).toHaveLength(80);
  expect(result.actual).toContain('HADRA');
  expect(result.hadraDegree).toBe(5);
  expect(result.eironDegree).toBe(2);
  expect(result.eironHotspot).toBe(false);
  expect(result.airfieldDefaults).toEqual([]);
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
  await expect(page.locator('#hotspot-cb').locator('xpath=..')).toContainText('הצג נוקודות חמות');
});
