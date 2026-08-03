// Tools carry a `tier`, and it was never consulted: a state-changing call ran
// immediately. That matters because get_notams feeds NOTAM free text from a public
// feed into the model's context, so instruction-shaped text in a NOTAM body could
// rewrite a route the pilot only asked about.
const { test, expect } = require('./_setup');

async function boot(page) {
  await page.goto('?lang=en&nogist');
  // The assistant exposes its gated runner once it has wired up.
  await page.waitForFunction(() => typeof NavAid === 'object' && NavAid &&
    NavAid.assistant && typeof NavAid.assistant._runTool === 'function');
}

test('every tool still declares a tier, and only read is ungated', async ({ page }) => {
  await boot(page);
  const text = require('fs').readFileSync(
    require('path').join(__dirname, '..', 'docs', 'app', 'assistant.js'), 'utf8');
  const tiers = [...text.matchAll(/tier: '(\w+)'/g)].map(m => m[1]);
  expect(tiers.length).toBeGreaterThan(10);
  expect(new Set(tiers)).toEqual(new Set(['read', 'route', 'out']));
  // The gate reads the field — this is the line whose absence was the bug.
  expect(text).toMatch(/tool\.tier\s*!==\s*'read'/);
  expect(text).toMatch(/allowStateTools\(\)/);
  expect(text).not.toMatch(/window\.confirm/);   // uses the module's confirmAction hook
});

test('a declined prompt leaves the route untouched and tells the model why', async ({ page }) => {
  await boot(page);
  const out = await page.evaluate(async () => {
    state.waypoints = [{ lat: 32.0, lng: 34.9, name: 'A' }, { lat: 32.4, lng: 35.1, name: 'B' }];
    state.legs = []; syncLegs();
    state.legs.forEach(l => { l.flightSpeed = 100; l.inboundAltitude = 3000; });
    draw();
    const before = JSON.stringify(state.waypoints);
    let asked = 0;
    NavAid.assistant._resetConsent();
    NavAid.assistant._setConfirm(() => { asked++; return false; });   // pilot says no
    const res = await NavAid.assistant._runTool('set_route', { points: ['LLHZ', 'LLIB'] });
    return { asked, res, unchanged: JSON.stringify(state.waypoints) === before };
  });
  expect(out.asked).toBe(1);
  expect(out.unchanged).toBe(true);                              // route survived
  expect(String(out.res && out.res.error)).toMatch(/declined/);  // model is told
});

test('consent is asked once per session, then route tools run', async ({ page }) => {
  await boot(page);
  const out = await page.evaluate(async () => {
    state.waypoints = [{ lat: 32.0, lng: 34.9, name: 'A' }, { lat: 32.4, lng: 35.1, name: 'B' }];
    state.legs = []; syncLegs(); draw();
    let asked = 0;
    NavAid.assistant._resetConsent();
    NavAid.assistant._setConfirm(() => { asked++; return true; });     // agrees once
    const first = await NavAid.assistant._runTool('reverse_route', {});
    const second = await NavAid.assistant._runTool('reverse_route', {});
    return { asked, first, second };
  });
  expect(out.asked).toBe(1);            // not once per call
  expect(out.first && out.first.error).toBeFalsy();
  expect(out.second && out.second.error).toBeFalsy();
});

test('read-only tools never prompt', async ({ page }) => {
  await boot(page);
  const out = await page.evaluate(async () => {
    state.waypoints = [{ lat: 32.0, lng: 34.9, name: 'A' }, { lat: 32.4, lng: 35.1, name: 'B' }];
    state.legs = []; syncLegs(); draw();
    let asked = 0;
    NavAid.assistant._resetConsent();
    NavAid.assistant._setConfirm(() => { asked++; return false; });
    const res = await NavAid.assistant._runTool('describe_route', {});
    return { asked, gotData: !!(res && !res.error) };
  });
  expect(out.asked).toBe(0);
  expect(out.gotData).toBe(true);
});
