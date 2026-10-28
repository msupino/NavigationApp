// @ts-check
// relay/edge/feeds.mjs: SIGMET and AIRMET rebuilt on a Cron Trigger into KV, served with CORS.
// The build itself is scripts/build-aviation-feeds.mjs (tests/aviation-feeds.spec.js); this is
// the Worker's use of it. Stubbed fetch and KV -- nothing goes to the network.
const { test, expect } = require('./_setup');
const path = require('path');

const load = () => import(path.join(__dirname, '..', 'relay', 'edge', 'feeds.mjs'));
const kv = () => { const m = new Map(); return { m, get: async (k) => (m.has(k) ? m.get(k) : null), put: async (k, v) => { m.set(k, v); } }; };
const MT_OBSC = 'LLLL TEL AVIV FIR MT OBSC OBS WI N3255 E03535 - N3315 E03535 - N3018 E03435 - N3042 E03426 - N3255 E03535 STNR WKN=';
const IMS = { data: { area_warnings: { 42559: { wid: '42559', issue_date: '2026-08-31 03:00',
  lines: [{ content: 'LLLL AIRMET 1 VALID 310300/310700 LLBD-' }, { content: MT_OBSC }] } } } };

function upstream(over) {
  const asked = [];
  const answer = Object.assign({
    isigmet: () => [{ firId: 'LLLL', hazard: 'TS', coords: [{ lat: 32, lon: 34.9 }] }],
    ims: () => IMS,
  }, over || {});
  const fetch = async (url) => {
    asked.push(String(url));
    const kind = String(url).includes('isigmet') ? 'isigmet' : String(url).includes('ims.gov.il') ? 'ims' : 'other';
    const f = answer[kind];
    if (!f) return new Response('nope', { status: 500 });
    const body = f();
    return body instanceof Response ? body : new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
  };
  return { fetch, asked };
}

test('a run stores SIGMET and AIRMET, and does not spend AWC on METAR/TAF', async () => {
  const { refreshFeeds } = await load();
  const env = { FEEDS: kv() };
  const up = upstream();
  const { stored } = await refreshFeeds(env, { fetch: up.fetch, warn: () => {} });
  expect(stored.sort()).toEqual(['airmet.json', 'sigmet.json']);
  expect(JSON.parse(env.FEEDS.m.get('sigmet.json')).sigmets).toHaveLength(1);
  expect(JSON.parse(env.FEEDS.m.get('airmet.json')).airmets[0].hazard).toBe('MT OBSC');
  expect(up.asked.some(u => /\/api\/data\/(metar|taf)/.test(u))).toBe(false);
  // No wx.json: the weather stays with the GitHub Action (IAA answers curl only).
  expect(env.FEEDS.m.has('wx.json')).toBe(false);
});

test('a failed source keeps the last good copy', async () => {
  const { refreshFeeds } = await load();
  const env = { FEEDS: kv() };
  env.FEEDS.m.set('sigmet.json', '{"sigmets":["last good"]}');
  const up = upstream({ isigmet: () => new Response('down', { status: 503 }) });
  const { stored } = await refreshFeeds(env, { fetch: up.fetch, warn: () => {} });
  expect(stored).toEqual(['airmet.json']);
  expect(env.FEEDS.m.get('sigmet.json')).toBe('{"sigmets":["last good"]}');
});

test('served with CORS and a short cache; only the two feeds; 404 before the first build', async () => {
  const { serveFeed } = await load();
  const env = { FEEDS: kv() };
  expect((await serveFeed('sigmet.json', env)).status).toBe(404);
  env.FEEDS.m.set('sigmet.json', '{"sigmets":[]}');
  const res = await serveFeed('sigmet.json', env);
  expect(res.status).toBe(200);
  expect(res.headers.get('access-control-allow-origin')).toBe('*');
  expect(res.headers.get('cache-control')).toBe('public, max-age=60');
  expect(await serveFeed('wx.json', env)).toBeNull();
  expect(await serveFeed('notam.json', env)).toBeNull();
});
