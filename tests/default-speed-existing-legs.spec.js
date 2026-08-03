// "Default speed" reaches back into the route: legs nobody typed a speed on follow the
// default, legs with a typed speed keep it. A pilot who sets their aircraft's cruise
// after drawing the route should not have to re-type it leg by leg -- and must not lose
// the one leg they deliberately slowed for a low pass.
const { test, expect } = require('./_setup');

async function boot(page) {
  await page.addInitScript(() => {
    try {
      for (const sec of ['build', 'view', 'display', 'charts', 'export', 'print'])
        localStorage.setItem('navaid.sec.' + sec, '1');
    } catch (e) {}
  });
  await page.goto('?lang=en&nogist');
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

const speeds = page => page.evaluate(() =>
  state.legs.map(l => [l.flightSpeed, l.outboundSpeed, l._legSpeedAuto ? 'auto' : 'manual']));

async function setDefault(page, kt) {
  await page.fill('#default-speed', String(kt));
  await page.dispatchEvent('#default-speed', 'change');
}

test('raising the default carries every leg that was never edited', async ({ page }) => {
  await boot(page);
  await route(page);
  expect(await speeds(page)).toEqual([[90, 90, 'auto'], [90, 90, 'auto'], [90, 90, 'auto']]);
  await setDefault(page, 110);
  expect(await speeds(page)).toEqual([[110, 110, 'auto'], [110, 110, 'auto'], [110, 110, 'auto']]);
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
  expect(s[1]).toEqual([90, 90, 'manual']);
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
  // Inherited the typed forward speed and the pin. The return speed was never typed,
  // so it carries the source leg's 90 -- and stays there, because the leg is pinned.
  expect(s[2]).toEqual([70, 90, 'manual']);
  await setDefault(page, 110);
  expect((await speeds(page))[2][0]).toBe(70);
});

test('splitting an untouched leg leaves both halves following the default', async ({ page }) => {
  await boot(page);
  await route(page, 3);
  await page.evaluate(() => splitLegAt(0, { lat: 32.05, lng: 34.9 }));
  await setDefault(page, 110);
  expect((await speeds(page)).every(l => l[0] === 110 && l[2] === 'auto')).toBe(true);
});

test('reloading the tab does not freeze the route at the old default', async ({ page }) => {
  await boot(page);
  await route(page);
  await page.evaluate(() => flushPersist());
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof tune === 'function' && state.legs.length === 3);
  expect((await speeds(page)).every(l => l[2] === 'auto')).toBe(true);
  await setDefault(page, 110);
  expect((await speeds(page)).every(l => l[0] === 110)).toBe(true);
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
