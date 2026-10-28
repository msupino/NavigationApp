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
  const problems = [];
  const warn = (...a) => {
    // The build's own words for what failed ("isigmet: 403", "ims airmet: ..."), kept for the
    // status report; the ::error:: lines are its GitHub annotations of the same thing.
    const line = a.map(String).join(' ');
    if (!/^::error::/.test(line)) problems.push(line.slice(0, 300));
    (d.warn || ((...x) => console.warn(...x)))(...a);
  };
  const result = await buildAviationFeeds({
    firs: FIRS, ids: [], bbox: BBOX,
    fetchImpl: skipWx(d.fetch || fetch),
    write: (path, text) => { written[path] = text; },
    log: () => {}, warn,
  });
  const stored = [];
  // Only what the build published: a failed fetch keeps the last good copy, as on GitHub.
  for (const [name, path] of Object.entries(FEEDS)) {
    if (written[path] != null) { await env.FEEDS.put(name, written[path]); stored.push(name); }
  }
  const report = { sigmet: result.sigmet, airmet: result.airmet, sigmets: result.sigmets,
    airmets: result.airmets, problems };
  console.log('feeds run', JSON.stringify(report));
  // Readable at /feeds/status.json, so a source that fails from Cloudflare shows without the
  // dashboard. Written only when it changes: KV's free plan allows 1,000 writes a day.
  const prev = await env.FEEDS.get('status.json');
  const prevReport = prev ? JSON.parse(prev) : null;
  const same = prevReport && JSON.stringify({ ...prevReport, at: undefined, since: undefined }) === JSON.stringify(report);
  if (!same) await env.FEEDS.put('status.json', JSON.stringify({ ...report, since: new Date().toISOString() }));
  return { result, stored, report };
}

export async function serveFeed(name, env) {
  if (name !== 'status.json' && !Object.prototype.hasOwnProperty.call(FEEDS, name)) return null;
  const body = await env.FEEDS.get(name);
  const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=60' };
  return body == null
    ? new Response(name === 'status.json' ? '{"error":"no run yet"}' : '{"error":"not built yet"}', { status: 404, headers })
    : new Response(body, { headers });
}
