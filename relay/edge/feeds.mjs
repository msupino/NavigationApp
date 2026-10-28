// Fresher SIGMET and AIRMET: the same build the GitHub Action runs (scripts/build-aviation-feeds.mjs)
// on a Cloudflare Cron Trigger every 5 minutes, stored in KV and served with a short cache. The
// Action runs every 20 minutes and its output then sits behind raw.githubusercontent.com's own
// cache, so a new SIGMET could take half an hour to reach a pilot.
//
// Only these two. The weather (wx.json) stays with the Action: its primary source, IAA's
// MobileAeroinfo, answers curl and refuses other clients, and a Worker falling back to AWC would
// publish fewer fields (no Herzliya). NOTAMs (also IAA) stay there too.
import { buildAviationFeeds } from '../../scripts/build-aviation-feeds.mjs';

export const FIRS = ['LLLL', 'LCCC', 'LCNC', 'HECC', 'OLBB', 'OJAC', 'OSTT', 'LTAA'];
export const BBOX = { s: 28, n: 35, w: 32, e: 38 };
export const FEEDS = { 'sigmet.json': 'sigmet/sigmet.json', 'airmet.json': 'airmet/airmet.json' };

// The build also asks AWC for METAR/TAF, which this job does not publish: answer those locally
// rather than spend AWC's requests on them.
const skipWx = (realFetch) => (url, init) => (/\/api\/data\/(metar|taf)\?/.test(String(url))
  ? Promise.resolve(new Response('[]', { headers: { 'Content-Type': 'application/json' } }))
  : realFetch(url, init));

export async function refreshFeeds(env, deps) {
  const d = deps || {};
  const written = {};
  const result = await buildAviationFeeds({
    firs: FIRS, ids: [], bbox: BBOX,
    fetchImpl: skipWx(d.fetch || fetch),
    write: (path, text) => { written[path] = text; },
    log: () => {}, warn: d.warn || ((...a) => console.warn(...a)),
  });
  const stored = [];
  // Only what the build published: a failed fetch keeps the last good copy, as on GitHub.
  for (const [name, path] of Object.entries(FEEDS)) {
    if (written[path] != null) { await env.FEEDS.put(name, written[path]); stored.push(name); }
  }
  return { result, stored };
}

export async function serveFeed(name, env) {
  if (!Object.prototype.hasOwnProperty.call(FEEDS, name)) return null;
  const body = await env.FEEDS.get(name);
  const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=60' };
  return body == null
    ? new Response('{"error":"not built yet"}', { status: 404, headers })
    : new Response(body, { headers });
}
