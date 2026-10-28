// @ts-check
// The live-traffic relay (relay/traffic/worker.mjs, a Cloudflare Worker): the web app's way to the
// ADS-B feed, which sends no CORS header. Run here with a stubbed fetch and cache -- nothing goes
// to the network.
const { test, expect } = require('./_setup');
const path = require('path');

const load = () => import(path.join(__dirname, '..', 'relay', 'traffic', 'worker.mjs'));
const NAVAID = 'https://navaid.supino.org';

function harness(answer) {
  const calls = [];
  const store = new Map();
  return {
    calls, store,
    deps: {
      fetch: async (url) => { calls.push(url); return typeof answer === 'function' ? answer(url) : new Response(answer || '{"ac":[]}'); },
      cache: {
        match: async (req) => store.get(req.url) ? store.get(req.url).clone() : undefined,
        put: async (req, res) => { store.set(req.url, res); },
      },
    },
  };
}
const req = (p, origin = NAVAID, method = 'GET') =>
  new Request('https://relay.test' + p, { method, headers: origin ? { Origin: origin } : {} });

test('answers NavAid with the feed and the CORS header', async () => {
  const { handle } = await load();
  const h = harness('{"ac":[{"hex":"abc"}]}');
  const res = await handle(req('/v2/lat/32.0512/lon/34.9234/dist/40'), h.deps);
  expect(res.status).toBe(200);
  expect(res.headers.get('access-control-allow-origin')).toBe(NAVAID);
  expect(await res.json()).toEqual({ ac: [{ hex: 'abc' }] });
  // Snapped to the 0.1-degree grid, the radius widened to cover the snap.
  expect(h.calls).toEqual(['https://api.adsb.lol/v2/lat/32.1/lon/34.9/dist/45']);
});

test('pilots near one spot share one upstream call', async () => {
  const { handle } = await load();
  const h = harness();
  await handle(req('/v2/lat/32.06/lon/34.92/dist/40'), h.deps);
  await handle(req('/v2/lat/32.08/lon/34.88/dist/40'), h.deps);
  expect(h.calls.length).toBe(1);
});

test('only NavAid origins; a malformed question; the preflight', async () => {
  const { handle } = await load();
  const h = harness();
  const other = await handle(req('/v2/lat/32/lon/34/dist/40', 'https://elsewhere.example'), h.deps);
  expect(other.status).toBe(403);
  expect(other.headers.get('access-control-allow-origin')).toBeNull();
  // No Origin at all is a script, not a NavAid page.
  expect((await handle(req('/v2/lat/32/lon/34/dist/40', ''), h.deps)).status).toBe(403);
  expect((await handle(req('/anything'), h.deps)).status).toBe(400);
  expect((await handle(req('/v2/lat/95/lon/34/dist/40'), h.deps)).status).toBe(400);
  const pre = await handle(req('/v2/lat/32/lon/34/dist/40', NAVAID, 'OPTIONS'), h.deps);
  expect(pre.status).toBe(204);
  expect(pre.headers.get('access-control-allow-methods')).toContain('GET');
  expect(h.calls).toEqual([]);
});

test('the radius is capped, and a feed failure is a 502, not cached', async () => {
  const { handle, upstreamFor } = await load();
  expect(upstreamFor('/v2/lat/32/lon/34/dist/400')).toMatch(/\/dist\/100$/);
  const h = harness(() => new Response('busy', { status: 503 }));
  const res = await handle(req('/v2/lat/32/lon/34/dist/40'), h.deps);
  expect(res.status).toBe(502);
  expect(res.headers.get('access-control-allow-origin')).toBe(NAVAID);
  await handle(req('/v2/lat/32/lon/34/dist/40'), h.deps);
  expect(h.calls.length).toBe(4);                              // both feeds, both times: nothing cached
});

test('adsb.lol rate-limiting (429) falls through to adsb.fi', async () => {
  const { handle } = await load();
  const h = harness((url) => url.includes('adsb.lol')
    ? new Response('slow down', { status: 429 })
    : new Response('{"aircraft":[{"hex":"fi1"}]}'));
  const res = await handle(req('/v2/lat/32.06/lon/34.92/dist/40'), h.deps);
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ aircraft: [{ hex: 'fi1' }] });
  expect(h.calls).toEqual(['https://api.adsb.lol/v2/lat/32.1/lon/34.9/dist/45',
    'https://opendata.adsb.fi/api/v2/lat/32.1/lon/34.9/dist/45']);
});

test('both feeds refusing serves the last good answer for the spot, marked stale', async () => {
  const { handle } = await load();
  let down = false;
  const h = harness(() => (down ? new Response('no', { status: 429 }) : new Response('{"ac":[{"hex":"old"}]}')));
  await handle(req('/v2/lat/32/lon/34/dist/40'), h.deps);
  // The fresh copy has expired (simulated: dropped), the stale one is still there.
  for (const k of [...h.store.keys()]) if (!k.endsWith('#stale')) h.store.delete(k);
  down = true;
  const res = await handle(req('/v2/lat/32/lon/34/dist/40'), h.deps);
  expect(res.status).toBe(200);
  expect(res.headers.get('x-navaid-stale')).toBe('1');
  expect(await res.json()).toEqual({ ac: [{ hex: 'old' }] });
});
