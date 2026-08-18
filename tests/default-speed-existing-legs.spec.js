// "Default speed" reaches back into the route: legs nobody typed a speed on follow the
// default, legs with a typed speed keep it. A pilot who sets their aircraft's cruise
// after drawing the route should not have to re-type it leg by leg -- and must not lose
// the one leg they deliberately slowed for a low pass.
const { test, expect } = require('./_setup');
const { enableAssistant } = require('./_assistant-on');

async function boot(page) {
  await page.addInitScript(() => {
    try {
      for (const sec of ['build', 'view', 'display', 'charts', 'export', 'print'])
        localStorage.setItem('navaid.sec.' + sec, '1');
    } catch (e) {}
  });  await page.goto('?lang=en&nogist');
  await enableAssistant(page);
  await page.waitForFunction(() => typeof tune === 'function' && typeof syncLegs === 'function');
}

// Three legs at the shipped 90 kt default, none of them hand-edited.
async function route(page, n = 4) {
  await page.evaluate(count => {
    state.waypoints = [];
    for (let i = 0; i < count; i++) state.waypoints.push({ lat: 32 + i * 0.1, lng: 34.9, name: 'W' + i });
    syncLegs();
    draw();
  }, n);
}

// [forward, return, forward-pin, return-pin] -- the two speeds are tracked separately.
const speeds = page => page.evaluate(() => state.legs.map(l =>
  [l.flightSpeed, l.outboundSpeed, l._legSpeedAuto ? 'auto' : 'manual',
    l._legSpeedAutoRet ? 'auto' : 'manual']));

async function setDefault(page, kt) {
  await page.fill('#default-speed', String(kt));
  await page.dispatchEvent('#default-speed', 'change');
}

test('raising the default carries every leg that was never edited', async ({ page }) => {
  await boot(page);
  await route(page);
  expect(await speeds(page)).toEqual(Array(3).fill([90, 90, 'auto', 'auto']));
  await setDefault(page, 110);
  expect(await speeds(page)).toEqual(Array(3).fill([110, 110, 'auto', 'auto']));
});

test('a hand-typed leg speed survives a later default change', async ({ page }) => {
  await boot(page);
  await route(page);
  // Type 70 on the middle leg the way the inspector does.
  await page.evaluate(() => {
    const old = state.legs[1].flightSpeed;
    state.legs[1].flightSpeed = 70;
    propagateAlt(1, 'flightSpeed', 70, old);
  });
  await setDefault(page, 110);
  const s = await speeds(page);
  expect(s[1][0]).toBe(70);
  expect(s[1][2]).toBe('manual');
  expect(s[0][0]).toBe(110);       // untouched legs still follow
});

test('propagation downstream pins the legs it walked, so they keep the typed speed', async ({ page }) => {
  await boot(page);
  await route(page);
  // Editing leg 0 propagates forward across legs still at the old 90.
  await page.evaluate(() => {
    const old = state.legs[0].flightSpeed;
    state.legs[0].flightSpeed = 70;
    propagateAlt(0, 'flightSpeed', 70, old);
  });
  expect((await speeds(page)).every(l => l[0] === 70 && l[2] === 'manual')).toBe(true);
  await setDefault(page, 110);
  expect((await speeds(page)).every(l => l[0] === 70)).toBe(true);
});

test('typing the speed already in force still pins the leg', async ({ page }) => {
  await boot(page);
  await route(page);
  await page.evaluate(() => propagateAlt(1, 'flightSpeed', 90, 90));   // no-op value
  await setDefault(page, 110);
  const s = await speeds(page);
  expect(s[1]).toEqual([90, 110, 'manual', 'auto']);   // forward pinned, return still following
  expect(s[0][0]).toBe(110);
});

test('a leg appended after a hand-typed one is pinned too', async ({ page }) => {
  await boot(page);
  await route(page, 3);
  await page.evaluate(() => {
    const old = state.legs[1].flightSpeed;
    state.legs[1].flightSpeed = 70;
    propagateAlt(1, 'flightSpeed', 70, old);
    state.waypoints.push({ lat: 32.4, lng: 34.9, name: 'W3' });
    syncLegs();
  });
  const s = await speeds(page);
  // Inherited the typed forward speed and its pin. The return speed was never typed,
  // so it still follows the default.
  expect(s[2]).toEqual([70, 90, 'manual', 'auto']);
  await setDefault(page, 110);
  const after = (await speeds(page))[2];
  expect(after[0]).toBe(70);         // typed forward speed held
  expect(after[1]).toBe(110);        // untyped return speed followed
});

test('splitting an untouched leg leaves both halves following the default', async ({ page }) => {
  await boot(page);
  await route(page, 3);
  await page.evaluate(() => splitLegAt(0, { lat: 32.05, lng: 34.9 }));
  await setDefault(page, 110);
  expect((await speeds(page)).every(l => l[0] === 110 && l[2] === 'auto')).toBe(true);
});

// Regression: one shared flag meant a return-speed edit pinned the forward speed too,
// and because propagateAlt walks BACKWARD for outboundSpeed it pinned every leg --
// leaving the Default speed control doing nothing at all for that route.
test('a return-speed edit pins only the return direction', async ({ page }) => {
  await boot(page);
  await route(page);
  await page.evaluate(() => {
    const i = state.legs.length - 1;             // the return table edits the last leg first
    const old = state.legs[i].outboundSpeed;
    state.legs[i].outboundSpeed = 100;
    propagateAlt(i, 'outboundSpeed', 100, old);
  });
  const pinned = await speeds(page);
  expect(pinned.every(l => l[2] === 'auto')).toBe(true);     // no forward speed pinned
  expect(pinned.every(l => l[3] === 'manual')).toBe(true);   // the backward walk took the returns
  await setDefault(page, 110);
  const s = await speeds(page);
  expect(s.every(l => l[0] === 110)).toBe(true);   // forward speeds still follow the default
  expect(s.every(l => l[1] === 100)).toBe(true);   // typed return speeds held
});

test('reloading the tab does not freeze the route at the old default', async ({ page }) => {
  await boot(page);
  await route(page);
  await page.evaluate(() => flushPersist());  await page.goto('?lang=en&nogist');
  await enableAssistant(page);
  await page.waitForFunction(() => typeof tune === 'function' && state.legs.length === 3);
  expect((await speeds(page)).every(l => l[2] === 'auto' && l[3] === 'auto')).toBe(true);
  await setDefault(page, 110);
  expect((await speeds(page)).every(l => l[0] === 110 && l[1] === 110)).toBe(true);
});

// Regression: serializeRoute dropped the pins, so a round trip through the pilot's own
// route library froze the route at the old default -- what restoreRoute already guarded.
test('a save/load round trip through the route library keeps the legs following', async ({ page }) => {
  await boot(page);
  await route(page);
  const blob = await page.evaluate(() => JSON.stringify(serializeRoute()));
  expect(JSON.parse(blob).legs.every(l => l.speedAuto === 1 && l.retSpeedAuto === 1)).toBe(true);
  await page.evaluate(b => { state.waypoints = []; state.legs = []; applyRouteData(JSON.parse(b)); }, blob);
  await setDefault(page, 110);
  expect((await speeds(page)).every(l => l[0] === 110 && l[1] === 110)).toBe(true);
});

test('a route file without the pins keeps the explicit speeds it names', async ({ page }) => {
  await boot(page);
  await route(page);
  // A route saved before the pins existed, or written by hand.
  const blob = await page.evaluate(() => {
    const d = serializeRoute();
    for (const l of d.legs) { delete l.speedAuto; delete l.retSpeedAuto; l.flightSpeed = 85; l.outboundSpeed = 85; }
    return JSON.stringify(d);
  });
  await page.evaluate(b => { state.waypoints = []; state.legs = []; applyRouteData(JSON.parse(b)); }, blob);
  await setDefault(page, 110);
  expect((await speeds(page)).every(l => l[0] === 85 && l[1] === 85)).toBe(true);
});

// Regression: only the toolbar input carried the change, so a gist-shipped default left
// the control reading one number and the route flying another, with nothing to reconcile.
test('a gist-shipped default carries the route too', async ({ page }) => {
  await page.addInitScript(() => {
    try {
      for (const sec of ['build', 'view', 'display', 'charts', 'export', 'print'])
        localStorage.setItem('navaid.sec.' + sec, '1');
    } catch (e) {}
  });
  // The default block in _setup aborts this host; a later registration wins.
  await page.route('https://gist.githubusercontent.com/**', r => r.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ defaultLegSpeedKt: 100 }),
  }));  await page.goto('?lang=en');                 // gist path live (no ?nogist)
  await enableAssistant(page);
  await page.waitForFunction(() => typeof syncLegs === 'function');
  await route(page);
  await page.waitForFunction(() => tune('defaultLegSpeedKt') === 100);
  expect(await page.locator('#default-speed').inputValue()).toBe('100');
  expect((await speeds(page)).every(l => l[0] === 100 && l[1] === 100)).toBe(true);
});

test('the assistant setting a speed pins that leg', async ({ page }) => {
  await boot(page);
  await route(page);
  // Drive the tool itself rather than the agent loop, so this stays independent of
  // the consent gate around state-changing tools.
  await page.evaluate(async () => {
    const tool = NavAid.assistant._tools.find(x => x.name === 'set_leg');
    await tool.run({ leg: 2, speedKt: 75 });
  });
  await setDefault(page, 110);
  const s = await speeds(page);
  expect(s[1][0]).toBe(75);        // leg 2 is 1-based in the tool
  expect(s[1][2]).toBe('manual');
});
