// NavAid live-traffic relay: a Cloudflare Worker that lets the web app read ADS-B traffic.
//
// The public ADS-B feeds answer anyone but send no CORS header, so a browser may not read them.
// The Android and iOS apps fetch the feed natively; the web app fetches this relay instead, which
// asks adsb.lol (open data, ODbL) and answers in the same form with the CORS header added -- for
// NavAid's own origins only.
//
// Kind to the feed: each request is snapped to a 0.1-degree grid (about 6 nm) with the radius
// widened to cover the snap, and the answer is cached for CACHE_SECONDS, so every pilot near one
// spot shares a single upstream call per poll.
//
// Route (the template the app's `trafficWebApiUrl` gist setting names):
//   GET /v2/lat/{lat}/lon/{lon}/dist/{dist}

export const UPSTREAM = 'https://api.adsb.lol/v2/lat/{lat}/lon/{lon}/dist/{dist}';
export const ALLOWED_ORIGINS = [
  'https://navaid.supino.org',
  'https://msupino.github.io',
  'http://localhost:8080',
];
export const CACHE_SECONDS = 8;
export const MAX_DIST_NM = 100;
const GRID = 0.1;            // degrees
const GRID_SLACK_NM = 5;     // half a grid cell's diagonal, rounded up

const ROUTE = /^\/v2\/lat\/(-?\d+(?:\.\d+)?)\/lon\/(-?\d+(?:\.\d+)?)\/dist\/(\d+(?:\.\d+)?)\/?$/;

// The request a browser makes, mapped to the one this relay makes: null when it is not a
// well-formed traffic question.
export function upstreamFor(pathname) {
  const m = ROUTE.exec(pathname);
  if (!m) return null;
  const lat = Number(m[1]), lon = Number(m[2]), dist = Number(m[3]);
  if (!(Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && dist > 0)) return null;
  const snap = (v) => (Math.round(v / GRID) * GRID).toFixed(1);
  const nm = Math.min(MAX_DIST_NM, Math.ceil(dist) + GRID_SLACK_NM);
  return UPSTREAM.replace('{lat}', snap(lat)).replace('{lon}', snap(lon)).replace('{dist}', String(nm));
}

function corsHeaders(origin) {
  const h = { Vary: 'Origin' };
  if (ALLOWED_ORIGINS.includes(origin)) {
    h['Access-Control-Allow-Origin'] = origin;
    h['Access-Control-Allow-Methods'] = 'GET, OPTIONS';
    h['Access-Control-Allow-Headers'] = 'Accept';
    h['Access-Control-Max-Age'] = '86400';
  }
  return h;
}

function reply(status, body, origin, extra) {
  return new Response(body, {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(origin), ...(extra || {}) },
  });
}

// `deps` lets the tests hand in fetch and the cache; Cloudflare provides both for real.
export async function handle(request, deps) {
  const d = deps || {};
  const doFetch = d.fetch || fetch;
  const cache = d.cache !== undefined ? d.cache : (typeof caches !== 'undefined' ? caches.default : null);
  const origin = request.headers.get('Origin') || '';
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(origin) });
  if (request.method !== 'GET') return reply(405, '{"error":"GET only"}', origin, { Allow: 'GET, OPTIONS' });
  // Only NavAid's pages: anyone else -- another site, or a script with no Origin at all (a
  // browser always sends one on a cross-site fetch) -- would be using the relay as a free mirror.
  if (!ALLOWED_ORIGINS.includes(origin)) return reply(403, '{"error":"origin not allowed"}', origin);
  const target = upstreamFor(new URL(request.url).pathname);
  if (!target) return reply(400, '{"error":"use /v2/lat/{lat}/lon/{lon}/dist/{dist}"}', origin);

  const key = new Request(target);
  let upstream = cache ? await cache.match(key) : null;
  if (!upstream) {
    let res;
    try {
      res = await doFetch(target, { headers: { Accept: 'application/json', 'User-Agent': 'NavAid traffic relay (navaid.supino.org)' } });
    } catch (e) {
      return reply(502, '{"error":"feed unreachable"}', origin);
    }
    if (!res.ok) return reply(502, JSON.stringify({ error: 'feed answered ' + res.status }), origin);
    const body = await res.text();
    upstream = new Response(body, { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=' + CACHE_SECONDS } });
    if (cache) await cache.put(key, upstream.clone());
  }
  return reply(200, await upstream.text(), origin, { 'Cache-Control': 'public, max-age=' + CACHE_SECONDS });
}

export default { fetch: (request) => handle(request) };
