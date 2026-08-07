// Builds the two NOAA-derived feeds the app reads: sigmet/sigmet.json and wx/wx.json.
//
// Extracted verbatim from aviation-data.yml's inline `node --input-type=module` heredoc.
// The logic was already fail-closed, but it lived in a YAML string, so the only thing any
// test could do was grep the workflow for source text — including the rule that decides
// whether a feed is published at all. That is the rule most worth testing and the one least
// suited to a substring match, so it lives here now, with the fetching injectable.
//
// Scheduled workflows run only from the default branch, so this code cannot be exercised
// before it reaches main. Unit coverage is the only pre-merge signal there is.
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const UA = { 'User-Agent': 'NavAid-aviation-bot' };
const AWC = 'https://aviationweather.gov/api/data/';

// --- SIGMET (Israel region) ---------------------------------------------------------
export function selectSigmets(sig, { firs, bbox }) {
  const FIRS = new Set(firs);
  const inBox = c => Array.isArray(c) && c.some(p =>
    p && p.lat >= bbox.s && p.lat <= bbox.n && p.lon >= bbox.w && p.lon <= bbox.e);
  return (Array.isArray(sig) ? sig : [])
    .filter(s => FIRS.has(s.firId) || inBox(s.coords))
    .map(s => ({
      id: s.isigmetId || s.airSigmetId || s.seriesId || null,
      firId: s.firId, firName: s.firName,
      hazard: s.hazard, qualifier: s.qualifier,
      base: s.base, top: s.top, dir: s.dir, spd: s.spd,
      validFrom: s.validTimeFrom, validTo: s.validTimeTo,
      coords: Array.isArray(s.coords)
        ? s.coords.filter(p => p && Number.isFinite(p.lat) && Number.isFinite(p.lon))
          .map(p => [p.lat, p.lon])
        : [],
      raw: s.rawSigmet,
    }));
}

// --- METAR / TAF (Israeli fields) ---------------------------------------------------
export function collectStations(metars, tafs) {
  const stations = {};
  // Defensive against a non-array reaching here at all: the caller validates, but this is
  // exported and the crash it prevents took out the whole scheduled job.
  if (!Array.isArray(metars)) metars = [];
  if (!Array.isArray(tafs)) tafs = [];
  for (const m of (metars || [])) if (m && m.icaoId) (stations[m.icaoId] ||= {}).metar = m;
  for (const t of (tafs || [])) if (t && t.icaoId) (stations[t.icaoId] ||= {}).taf = t;
  return stations;
}

// Whether each feed may be published. Both rules are "fail closed", but they are NOT the
// same rule, and the difference is the whole point:
//
//   SIGMET  — an empty list is real information. Most days there are none over Israel, so
//             emptiness publishes; only a failed or malformed fetch withholds.
//   WX      — an empty station map is never real. A 200 carrying an empty array, or a shape
//             that no longer has icaoId, would blank every field's METAR and TAF while
//             reporting success. Emptiness withholds.
//
// Withholding leaves the previous publish in place: the data branches are force-pushed only
// when a file is produced, so last-good survives untouched.
export function sigmetPublishable({ sigOk }) {
  return !!sigOk;
}
// Coverage, not merely non-emptiness. The workflow asks for a FIXED list of Israeli fields,
// so a 200 carrying one station is a truncated response, not the weather: publishing it blanked
// METAR and TAF for the other twelve under a fresh generatedAt, which the staleness monitor
// reads as healthy. A field can legitimately go quiet, so the bar is a share rather than all of
// them -- below it, last-good survives untouched.
export const WX_MIN_COVERAGE = 0.6;
export function wxPublishable({ metarsOk, tafsOk, stations, requested }) {
  if (!metarsOk || !tafsOk) return false;
  const have = Object.keys(stations || {}).length;
  const want = Array.isArray(requested) ? requested.length : 0;
  if (!want) return have > 0;
  return have >= Math.max(1, Math.ceil(want * WX_MIN_COVERAGE));
}

async function fetchJson(url, fetchImpl) {
  const r = await fetchImpl(url, { headers: UA });
  if (!r.ok) throw new Error(url.replace(AWC, '') + ' ' + r.status);
  return r.json();
}

export async function buildAviationFeeds({ firs, ids, bbox, fetchImpl = fetch,
  write = writeFileSync, log = console.log, warn = console.error } = {}) {
  // Assign only what has been validated. The inline original did `x = await api(...)` and
  // THEN checked Array.isArray, so a 200 carrying a JSON object (an error envelope, a quota
  // notice) left a non-array in the variable: the catch set ok=false as intended, but the
  // later `for (const m of metars)` threw an uncaught TypeError and killed the step instead
  // of reporting "publish skipped; preserving last-good branch."
  let sig = [], sigOk = false;
  try {
    const body = await fetchJson(AWC + 'isigmet?format=json', fetchImpl);
    if (!Array.isArray(body)) throw new Error('isigmet response is not an array');
    sig = body;
    sigOk = true;
  } catch (e) { warn('isigmet:', e.message); }
  const sigmets = selectSigmets(sig, { firs, bbox });

  let metars = [], tafs = [], metarsOk = false, tafsOk = false;
  const idList = (ids || []).join(',');
  try {
    const body = await fetchJson(AWC + 'metar?ids=' + idList + '&format=json', fetchImpl);
    if (!Array.isArray(body)) throw new Error('metar response is not an array');
    metars = body;
    metarsOk = true;
  } catch (e) { warn(e.message); }
  try {
    const body = await fetchJson(AWC + 'taf?ids=' + idList + '&format=json', fetchImpl);
    if (!Array.isArray(body)) throw new Error('taf response is not an array');
    tafs = body;
    tafsOk = true;
  } catch (e) { warn(e.message); }
  const stations = collectStations(metars, tafs);

  const result = { sigmet: 'skipped', wx: 'skipped', sigmets: sigmets.length,
    stations: Object.keys(stations).length };
  if (sigmetPublishable({ sigOk })) {
    write('sigmet/sigmet.json', JSON.stringify({
      generatedAt: new Date().toISOString(), source: 'NOAA AWC isigmet', sigmets,
    }, null, 1));
    log('SIGMETs:', sigmets.length);
    result.sigmet = 'published';
  } else {
    warn('::error::SIGMET publish skipped; preserving last-good branch.');
  }
  if (wxPublishable({ metarsOk, tafsOk, stations, requested: ids })) {
    write('wx/wx.json', JSON.stringify({
      generatedAt: new Date().toISOString(), source: 'NOAA AWC', stations,
    }));
    log('WX stations:', Object.keys(stations).length);
    result.wx = 'published';
  } else {
    // ::error:: and a non-zero exit, not a bare log line. A run that published nothing used to
    // be a green check with an empty annotations panel -- indistinguishable in the Actions list
    // from a successful one -- so a frozen feed was only ever caught by the staleness monitor
    // hours later (#1429).
    warn('::error::WX publish skipped (' + Object.keys(stations).length + '/' +
      (ids || []).length + ' stations); preserving last-good branch.');
  }
  if (result.sigmet === 'skipped' && result.wx === 'skipped') {
    process.exitCode = 1;
  }
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const split = v => (v || '').split(',').map(s => s.trim()).filter(Boolean);
  await buildAviationFeeds({
    firs: split(process.env.FIRS),
    ids: split(process.env.IDS),
    bbox: { s: 28, n: 35, w: 32, e: 38 },
  });
}
