// Cloudflare Worker proxy for the public IAA AeroInfo NOTAM endpoint.
//
// Endpoint queried by this worker:
//   POST https://aeroinfo.iaa.gov.il/api/api/AeroInfo/GetNotams
//
// These browser request headers returned JSON during manual verification. No browser cookies
// or Radware telemetry token are embedded. IAA may still block Cloudflare egress; on a block,
// return 502 rather than serving a challenge page as if it were NOTAM data.

const UPSTREAM = 'https://aeroinfo.iaa.gov.il/api/api/AeroInfo/GetNotams';
const CACHE_SECONDS = 300;

export const UPSTREAM_HEADERS = {
  accept: '*/*',
  'accept-language': 'en-US,en;q=0.9,he-IL;q=0.8,he;q=0.7',
  'content-type': 'application/json',
  origin: 'https://aeroinfo.iaa.gov.il',
  referer: 'https://aeroinfo.iaa.gov.il/Notams',
  'sec-ch-ua': '"Not:A-Brand";v="8", "Chromium";v="156", "Google Chrome";v="156"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"macOS"',
  'sec-fetch-dest': 'empty',
  'sec-fetch-mode': 'cors',
  'sec-fetch-site': 'same-origin',
  'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36',
};

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

function jsonResponse(body, status = 200, extraHeaders = {}) {
  return new Response(body, {
    status,
    headers: {
      ...corsHeaders(),
      'Content-Type': 'application/json; charset=utf-8',
      ...extraHeaders,
    },
  });
}

// deps lets the focused tests supply a stub fetch and cache; Cloudflare supplies them in production.
export async function handle(request, deps = {}) {
  const doFetch = deps.fetch || fetch;
  const cache = deps.cache === undefined
    ? (typeof caches !== 'undefined' ? caches.default : null)
    : deps.cache;
  const waitUntil = deps.waitUntil || (promise => promise);

  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders() });
  }
  if (request.method !== 'GET') {
    return jsonResponse('{"error":"GET only"}', 405, { Allow: 'GET, OPTIONS' });
  }

  const url = new URL(request.url);
  const hoursAhead = url.searchParams.get('hoursAhead') ?? '0';
  if (!/^\d{1,3}$/.test(hoursAhead)) {
    return jsonResponse('{"error":"Invalid hoursAhead"}', 400);
  }

  // Round the default start time to a five-minute bucket so requests share cache entries.
  const bucket = Math.floor(Date.now() / CACHE_SECONDS / 1000) * CACHE_SECONDS * 1000;
  const fromDate = url.searchParams.get('fromDate') ?? new Date(bucket).toISOString();
  if (!Number.isFinite(Date.parse(fromDate))) {
    return jsonResponse('{"error":"Invalid fromDate"}', 400);
  }

  const payload = {
    fromDate,
    hoursAhead,
    regions: 'North,Center,South',
    locations: '',
    series: '3',
    nonActive: false,
  };

  const cacheUrl = new URL('https://notams-cache.invalid/');
  cacheUrl.searchParams.set('fromDate', fromDate);
  cacheUrl.searchParams.set('hoursAhead', hoursAhead);
  const cacheKey = new Request(cacheUrl.toString());

  const cached = cache ? await cache.match(cacheKey) : null;
  if (cached) return cached;

  let upstream;
  try {
    upstream = await doFetch(UPSTREAM, {
      method: 'POST',
      redirect: 'manual',
      headers: UPSTREAM_HEADERS,
      body: JSON.stringify(payload),
    });
  } catch {
    return jsonResponse('{"error":"IAA request failed"}', 502);
  }

  if (!upstream.ok || upstream.status >= 300) {
    return jsonResponse(JSON.stringify({ error: `IAA returned HTTP ${upstream.status}` }), 502);
  }

  const body = await upstream.text();
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    return jsonResponse('{"error":"IAA returned non-JSON; request may be blocked"}', 502);
  }
  if (!Array.isArray(parsed)) {
    return jsonResponse('{"error":"Unexpected IAA response shape"}', 502);
  }

  const response = jsonResponse(body, 200, {
    'Cache-Control': `public, max-age=${CACHE_SECONDS}`,
  });
  if (cache) waitUntil(cache.put(cacheKey, response.clone()));
  return response;
}

export default {
  fetch(request, env, ctx) {
    return handle(request, {
      cache: caches.default,
      waitUntil: promise => ctx.waitUntil(promise),
    });
  },
};
