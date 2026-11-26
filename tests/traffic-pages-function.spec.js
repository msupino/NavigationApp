// @ts-check
// The live-traffic relay as a Pages Function on the site's own host
// (functions/api/traffic/[[path]].js): some networks cannot reach *.workers.dev at all -- a pilot's
// Mac timed out on every request, so the web showed no ADS-B traffic while the app did. The same
// relay code (relay/traffic/worker.mjs) answers at navaid.supino.org/api/traffic/... .
const { test, expect } = require('@playwright/test');

async function load() {
  const fn = await import('../functions/api/traffic/[[path]].js');
  const relay = await import('../relay/traffic/worker.mjs');
  return { ...fn, handle: relay.handle };
}
const FEED = JSON.stringify({ ac: [{ hex: 'abc123', lat: 32.4, lon: 35.0 }], total: 1 });
const stub = () => {
  const asked = [];
  return { asked, deps: { cache: null, fetch: async (u) => { asked.push(u); return new Response(FEED, { status: 200 }); } } };
};
const URL_ = 'https://navaid.supino.org/api/traffic/v2/lat/32.38/lon/35.01/dist/40';

test("the site's own page is served: no Origin header, Sec-Fetch-Site same-origin", async () => {
  const { relayRequest, handle } = await load();
  const s = stub();
  const res = await handle(relayRequest(new Request(URL_, { headers: { 'Sec-Fetch-Site': 'same-origin' } })), s.deps);
  expect(res.status).toBe(200);
  expect(JSON.parse(await res.text()).total).toBe(1);
  // The prefix is stripped and the question snapped to the relay's grid, as on the Worker.
  expect(s.asked).toEqual(['https://api.adsb.lol/v2/lat/32.4/lon/35.0/dist/45']);
});

test('previews and staging on navaid-pr are served cross-origin, with the CORS header', async () => {
  const { relayRequest, handle } = await load();
  const res = await handle(relayRequest(new Request(URL_, { headers: { Origin: 'https://navaid-pr.supino.org', 'Sec-Fetch-Site': 'cross-site' } })), stub().deps);
  expect(res.status).toBe(200);
  expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://navaid-pr.supino.org');
});

test('another site, or a script with no Origin and no same-origin mark, is refused', async () => {
  const { relayRequest, handle } = await load();
  for (const headers of [{ Origin: 'https://evil.example', 'Sec-Fetch-Site': 'cross-site' }, {}, { 'Sec-Fetch-Site': 'cross-site' }]) {
    const s = stub();
    const res = await handle(relayRequest(new Request(URL_, { headers })), s.deps);
    expect(res.status).toBe(403);
    expect(s.asked).toEqual([]);
  }
});

test('only /api/* runs the function, so page and tile loads stay static', async () => {
  const fs = require('fs');
  const deploy = fs.readFileSync(require('path').join(__dirname, '..', '.github/workflows/deploy.yml'), 'utf8');
  expect(deploy).toContain('{"version":1,"include":["/api/*"],"exclude":[]}');
});
