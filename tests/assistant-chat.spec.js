// @ts-check
// AI assistant chat (assistant.js): a BYOK LLM panel with a tiered tool layer
// over the app's existing functions. Tests stub the provider (no real API) and
// exercise the agent loop + each tool tier: read (safe), route (auto + undo),
// outbound (confirm).
const { test, expect } = require('./_setup');

// Anchored to the raw.githubusercontent origin so it can't match a look-alike
// host embedded elsewhere in a URL (CodeQL js/regex/missing-anchor).
const NOTAM_RE = /^https:\/\/raw\.githubusercontent\.com\/.*\/notam-data\/notam\.json/;
const NOTAM_DATA = {
  generatedAt: '2026-06-23T09:00:00Z',
  notams: [
    { id: 'B0007/26', icao: 'LLBG', type: 'MRLC', end: '2035-12-31T00:00:00Z', geom: null,
      text: 'RWY 12/30 CLSD.' },
    { id: 'A0483/26', icao: 'LLLL', type: 'ARLC', end: '2035-12-31T23:59:00Z',
      geom: { type: 'polygon', coords: [[32.0, 34.8], [32.2, 34.9], [31.9, 35.1]] },
      text: 'ATS RTE CLSD.' },
  ],
};

async function boot(page) {
  await page.route(NOTAM_RE, r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(NOTAM_DATA) }));
  await page.goto('?lang=en');
  await page.waitForFunction(() => typeof state !== 'undefined' && window.NavAid &&
    NavAid.assistant && document.querySelector('.assistant-fab'));
}

// Call a tool handler directly (unit-level).
const runTool = (page, name, args) => page.evaluate(([n, a]) =>
  NavAid.assistant._tools.find(t => t.name === n).run(a), [name, args]);

test('the FAB is present and opening the panel shows settings when no key is set', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => { try { localStorage.removeItem('navaid.ai.key'); } catch (e) {} });
  await page.locator('.assistant-fab').click();
  await expect(page.locator('.assistant-panel')).toBeVisible();
  // No key → settings pane is revealed with the get-a-key link.
  await expect(page.locator('.assistant-settings')).toBeVisible();
  await expect(page.locator('.assistant-settings a')).toHaveAttribute('href', /aistudio\.google\.com/);
});

test('agent loop: model tool-call runs the tool and the result is fed back', async ({ page }) => {
  await boot(page);
  const out = await page.evaluate(async () => {
    let turn = 0, fedBack = null;
    NavAid.assistant._setProvider(async (msgs) => {
      turn++;
      if (turn === 1) return [{ functionCall: { name: 'set_route', args: { points: ['LLHZ', 'HADERA', 'LLIB'] } } }];
      const last = msgs[msgs.length - 1];
      fedBack = last.parts[0].functionResponse;   // the tool result the loop sent back
      return [{ text: 'Route planned.' }];
    });
    await NavAid.assistant.send('plan a route');
    return { fedBackName: fedBack && fedBack.name, ok: fedBack && fedBack.response && fedBack.response.ok,
      wps: (state.waypoints || []).map(w => w.name), legs: (state.legs || []).length };
  });
  expect(out.fedBackName).toBe('set_route');
  expect(out.ok).toBe(true);
  expect(out.wps.length).toBe(3);            // LLHZ / HADRA / LLIB resolved
  expect(out.legs).toBe(2);
  await expect(page.locator('.assistant-assistant')).toContainText('Route planned.');
});

test('set_route builds the route and is Undo-able', async ({ page }) => {
  await boot(page);
  const r = await runTool(page, 'set_route', { points: ['LLHZ', 'LLIB'] });
  expect(r.ok).toBe(true);
  const built = await page.evaluate(() => (state.waypoints || []).map(w => w.name));
  expect(built.length).toBe(2);
  const afterUndo = await page.evaluate(() => { undo(); return (state.waypoints || []).length; });
  expect(afterUndo).toBe(0);                  // undo restored the empty route
});

test('set_route reports unresolved waypoints instead of mutating', async ({ page }) => {
  await boot(page);
  const r = await runTool(page, 'set_route', { points: ['LLHZ', 'ZZZZZ'] });
  expect(r.error).toMatch(/could not resolve/i);
  expect(r.error).toContain('ZZZZZ');
  const wps = await page.evaluate(() => (state.waypoints || []).length);
  expect(wps).toBe(0);                        // nothing applied
});

test('reverse_route swaps start/destination and is Undo-able', async ({ page }) => {
  await boot(page);
  await runTool(page, 'set_route', { points: ['LLHZ', 'HADERA', 'LLIB'] });
  const before = await page.evaluate(() => state.waypoints.map(w => w.name).join('>'));
  await runTool(page, 'reverse_route', {});
  const rev = await page.evaluate(() => state.waypoints.map(w => w.name).join('>'));
  expect(rev).toBe(before.split('>').reverse().join('>'));
  const back = await page.evaluate(() => { undo(); return state.waypoints.map(w => w.name).join('>'); });
  expect(back).toBe(before);
});

test('route templates: list finds the corridor and apply builds it with its reporting points', async ({ page }) => {
  await boot(page);
  const list = await runTool(page, 'list_route_templates', {});
  const m = list.templates.find(x => x.from === 'LLHZ' && x.to === 'LLHA');
  expect(m).toBeTruthy();
  expect(m.waypoints.length).toBeGreaterThan(2);      // a corridor, not a direct line
  const ap = await runTool(page, 'apply_route_template', { template: m.name });
  expect(ap.ok).toBe(true);
  const wps = await page.evaluate(() => state.waypoints.map(w => w.name));
  expect(wps[0]).toBe('LLHZ');
  expect(wps[wps.length - 1]).toBe('LLHA');
  expect(wps.length).toBe(m.waypoints.length);        // reporting points included
  const afterUndo = await page.evaluate(() => { undo(); return state.waypoints.length; });
  expect(afterUndo).toBe(0);                           // undo-able
});

test('apply_route_template reports available names for an unknown template', async ({ page }) => {
  await boot(page);
  const r = await runTool(page, 'apply_route_template', { template: 'no-such-route' });
  expect(r.error).toMatch(/no template matching/i);
  expect(Array.isArray(r.available)).toBe(true);
});

test('plan_corridor graph-routes an airfield pair over the CVFR leg network', async ({ page }) => {
  await boot(page);
  const c = await runTool(page, 'plan_corridor', { from: 'LLHZ', to: 'LLIB' });
  expect(c.ok).toBe(true);
  expect(c.corridor[0]).toBe('LLHZ');
  expect(c.corridor[c.corridor.length - 1]).toBe('LLIB');
  expect(c.corridor.length).toBeGreaterThan(2);       // via reporting points, not a direct line
  const wps = await page.evaluate(() => state.waypoints.map(w => w.name));
  expect(wps.length).toBe(c.corridor.length);
  const afterUndo = await page.evaluate(() => { undo(); return state.waypoints.length; });
  expect(afterUndo).toBe(0);                           // undo-able
});

test('plan_corridor rejects a point not on the leg network', async ({ page }) => {
  await boot(page);
  const r = await runTool(page, 'plan_corridor', { from: 'LLHZ', to: 'ZZZZ' });
  expect(r.error).toMatch(/not on the CVFR leg network/i);
});

test('describe_route exposes per-leg detail (heading, distance, altitude, speed, freq)', async ({ page }) => {
  await boot(page);
  await runTool(page, 'set_route', { points: ['LLHZ', 'HADERA', 'LLIB'] });
  await runTool(page, 'set_leg', { leg: 2, altitudeFt: 3500, speedKt: 110 });
  const d = await runTool(page, 'describe_route', {});
  expect(d.legCount).toBe(2);
  expect(d.legs).toHaveLength(2);
  const l2 = d.legs[1];
  expect(l2.from).toBe('HADRA');
  expect(l2.to).toBe('LLIB');
  expect(l2.altitudeFt).toBe(3500);          // set_leg flowed through
  expect(l2.speedKt).toBe(110);
  expect(typeof l2.headingMag).toBe('number');
  expect(l2.distNm).toBeGreaterThan(0);
  expect(l2.timeMin).toBeGreaterThan(0);
  expect(d.totalNm).toBeGreaterThan(0);
});

test('read tools: find_point and get_airfield_info resolve real data', async ({ page }) => {
  await boot(page);
  const fp = await runTool(page, 'find_point', { query: 'LLHZ' });
  expect(fp.found).toBe(true);
  expect(typeof fp.lat).toBe('number');
  const af = await runTool(page, 'get_airfield_info', { icao: 'LLHZ' });
  expect(af.found).toBe(true);
  expect(af.icao).toBe('LLHZ');
});

test('get_notams filters by airfield ICAO from the live feed', async ({ page }) => {
  await boot(page);
  const res = await runTool(page, 'get_notams', { icao: 'LLBG' });
  expect(res.count).toBe(1);
  expect(res.notams[0].id).toBe('B0007/26');
  expect(res.notams[0].text).toMatch(/closed/i);   // MRLC decoded + RWY..CLSD expanded
});

test('save_route (outbound tier) is gated by a confirm', async ({ page }) => {
  await boot(page);
  await runTool(page, 'set_route', { points: ['LLHZ', 'LLIB'] });
  // Decline → nothing saved.
  await page.evaluate(() => NavAid.assistant._setConfirm(() => false));
  const declined = await runTool(page, 'save_route', { name: 'Test' });
  expect(declined.cancelled).toBe(true);
  let n = await page.evaluate(() => JSON.parse(localStorage.getItem('navaid.routes') || '[]').filter(e => e && !e.deleted).length);
  expect(n).toBe(0);
  // Accept → saved.
  await page.evaluate(() => NavAid.assistant._setConfirm(() => true));
  const ok = await runTool(page, 'save_route', { name: 'Test' });
  expect(ok.ok).toBe(true);
  n = await page.evaluate(() => JSON.parse(localStorage.getItem('navaid.routes') || '[]').filter(e => e && !e.deleted).length);
  expect(n).toBe(1);
});

test('sending with no API key surfaces an error and opens settings', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => { try { localStorage.removeItem('navaid.ai.key'); } catch (e) {} });
  // Do NOT stub the provider → the real Gemini path throws no-key before any fetch.
  await page.evaluate(() => NavAid.assistant.send('hello'));
  await expect(page.locator('.assistant-error')).toContainText(/API key/i);
  await expect(page.locator('.assistant-settings')).toBeVisible();
});
