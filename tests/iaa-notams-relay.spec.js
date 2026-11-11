// The IAA NOTAM relay (relay/notams/worker.mjs): exercise request mapping and reject
// redirects/challenge bodies using a stubbed fetch. No request goes to IAA from this suite.
const { test, expect } = require('./_setup');
const path = require('path');

const load = () => import(path.join(__dirname, '..', 'relay', 'notams', 'worker.mjs'));
const URL = 'https://aeroinfo.iaa.gov.il/api/api/AeroInfo/GetNotams';
const fromDate = '2026-11-11T08:00:00.000Z';
const request = (query = '', method = 'GET') =>
  new Request('https://relay.test/' + query, { method });

function harness(answer) {
  const calls = [];
  const store = new Map();
  const pending = [];
  return {
    calls,
    pending,
    deps: {
      fetch: async (url, init) => {
        calls.push({ url, init });
        return typeof answer === 'function' ? answer(url, init) : new Response(answer);
      },
      cache: {
        match: async req => store.get(req.url)?.clone() || null,
        put: async (req, res) => { store.set(req.url, res); },
      },
      waitUntil: promise => pending.push(promise),
    },
  };
}

test('maps a GET to the IAA NOTAM request and returns its JSON', async () => {
  const { handle } = await load();
  const h = harness('[{"notamID":"C1234/26"}]');
  const res = await handle(request(`?fromDate=${encodeURIComponent(fromDate)}&hoursAhead=12`), h.deps);

  expect(res.status).toBe(200);
  expect(res.headers.get('access-control-allow-origin')).toBe('*');
  expect(await res.json()).toEqual([{ notamID: 'C1234/26' }]);
  expect(h.calls).toHaveLength(1);
  expect(h.calls[0].url).toBe(URL);
  expect(h.calls[0].init.method).toBe('POST');
  expect(h.calls[0].init.headers.referer).toBe('https://aeroinfo.iaa.gov.il/Notams');
  expect(h.calls[0].init.headers['user-agent']).toContain('Chrome/156');
  expect(h.calls[0].init.headers.cookie).toBeUndefined();
  expect(h.calls[0].init.headers.uzlc).toBeUndefined();
  expect(JSON.parse(h.calls[0].init.body)).toEqual({
    fromDate,
    hoursAhead: '12',
    regions: 'North,Center,South',
    locations: '',
    series: '3',
    nonActive: false,
  });
  await Promise.all(h.pending);
});

test('caches successful responses for an identical query', async () => {
  const { handle } = await load();
  const h = harness('[{"notamID":"C1234/26"}]');
  const pathAndQuery = `?fromDate=${encodeURIComponent(fromDate)}`;
  await handle(request(pathAndQuery), h.deps);
  await Promise.all(h.pending);
  const cached = await handle(request(pathAndQuery), h.deps);

  expect(cached.status).toBe(200);
  expect(h.calls).toHaveLength(1);
});

test('rejects invalid input and handles preflight without an upstream call', async () => {
  const { handle } = await load();
  const h = harness('[]');
  expect((await handle(request('', 'POST'), h.deps)).status).toBe(405);
  expect((await handle(request('?hoursAhead=nope'), h.deps)).status).toBe(400);
  expect((await handle(request('?fromDate=not-a-date'), h.deps)).status).toBe(400);
  const preflight = await handle(request('', 'OPTIONS'), h.deps);
  expect(preflight.status).toBe(200);
  expect(preflight.headers.get('access-control-allow-methods')).toContain('GET');
  expect(h.calls).toHaveLength(0);
});

test('does not turn redirects, block pages, or unexpected JSON into a feed', async () => {
  const { handle } = await load();
  const redirect = harness(() => new Response('', { status: 302 }));
  expect((await handle(request(), redirect.deps)).status).toBe(502);

  const challenge = harness(() => new Response('<title>Radware Captcha</title>'));
  expect((await handle(request(), challenge.deps)).status).toBe(502);

  const wrongShape = harness('{"status":"success","data":[]}');
  expect((await handle(request(), wrongShape.deps)).status).toBe(502);
});

test('returns 502 when the upstream request throws', async () => {
  const { handle } = await load();
  const h = harness(() => { throw new Error('unreachable'); });
  expect((await handle(request(), h.deps)).status).toBe(502);
});
