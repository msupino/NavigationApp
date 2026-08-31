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
// Israeli AIRMETs live only here -- NOAA's isigmet feed carries international SIGMETs, not
// the domestic AIRMETs (mountain obscuration, IFR, surface wind) the IMS issues for the
// Tel Aviv FIR. A browser cannot read this cross-origin, so CI copies it to a data branch,
// exactly as the IMS charts already are.
const IMS_AVIATION = 'https://ims.gov.il/he/aviation_data';

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

// --- AIRMET (IMS Tel Aviv FIR area warnings) ----------------------------------------
// DDMM coordinate pairs in the raw text: "N3255 E03535" -> [32.91667, 35.58333].
export function parseAirmetCoords(text) {
  const re = /([NS])(\d{2})(\d{2})\s+([EW])(\d{3})(\d{2})/g;
  const out = []; let m;
  while ((m = re.exec(String(text || '')))) {
    const lat = (Number(m[2]) + Number(m[3]) / 60) * (m[1] === 'S' ? -1 : 1);
    const lon = (Number(m[5]) + Number(m[6]) / 60) * (m[4] === 'W' ? -1 : 1);
    if (Number.isFinite(lat) && Number.isFinite(lon)) out.push([Number(lat.toFixed(5)), Number(lon.toFixed(5))]);
  }
  return out;
}
// "VALID ddhhmm/ddhhmm" is UTC, and it is the authoritative validity -- the IMS item's own
// valid_from/valid_to are LOCAL (Israel), an hour or three off. Anchor the day-of-month to
// the issue date so a window that crosses midnight (or a month) resolves.
export function parseAirmetValidity(text, issueDate) {
  const m = /VALID\s+(\d{2})(\d{2})(\d{2})\/(\d{2})(\d{2})(\d{2})/.exec(String(text || ''));
  if (!m) return { validFrom: null, validTo: null };
  const base = new Date((issueDate || new Date().toISOString().slice(0, 10)) + 'T00:00:00Z');
  if (isNaN(base)) return { validFrom: null, validTo: null };
  const mk = (dd, hh, mm) => {
    const d = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), Number(dd), Number(hh), Number(mm)));
    if (d.getUTCDate() < base.getUTCDate() - 2) d.setUTCMonth(d.getUTCMonth() + 1);
    return d.toISOString();
  };
  return { validFrom: mk(m[1], m[2], m[3]), validTo: mk(m[4], m[5], m[6]) };
}
const AIRMET_HAZARDS = [
  [/\bMT\s*OBSC\b/i, 'MT OBSC'], [/\bMTW\b|MOUNTAIN\s+WAVE/i, 'MTW'],
  [/\bTURB\b/i, 'TURB'], [/\bICE\b|\bICING\b/i, 'ICE'],
  [/\bIFR\b/i, 'IFR'], [/\bSFC\s*WIND\b/i, 'SFC WIND'],
  [/\bTS\b|THUNDERSTORM/i, 'TS'], [/\bDS\b|\bSS\b|DUST|SAND/i, 'DUST'],
];
export function classifyAirmet(text) {
  for (const [re, tag] of AIRMET_HAZARDS) if (re.test(String(text || ''))) return tag;
  return 'AIRMET';
}
// IMS `data.area_warnings` is an object keyed by warning id; each has `lines[].content`.
// Join the lines, pull the phenomenon, validity and polygon out of the raw text.
// The IMS area-warnings bucket can hold more than AIRMETs: a SIGMET, or an aerodrome (AD
// WRNG) or wind-shear (WS WRNG) warning, each announced in the raw text. Read the product
// from the text so nothing is mislabelled -- this layer keeps only AIRMETs.
export function airmetProduct(text) {
  const t = String(text || '');
  if (/\bAIRMET\b/i.test(t)) return 'AIRMET';
  if (/\bSIGMET\b/i.test(t)) return 'SIGMET';
  if (/\bWS\s*WRNG\b|WIND\s*SHEAR/i.test(t)) return 'WS';
  if (/\bAD\s*WRNG\b|AERODROME\s+WARNING/i.test(t)) return 'AD';
  return 'OTHER';
}
export function parseImsAirmets(areaWarnings) {
  const items = areaWarnings && typeof areaWarnings === 'object' ? Object.values(areaWarnings) : [];
  const out = [];
  for (const w of items) {
    const raw = (Array.isArray(w && w.lines) ? w.lines.map(l => l && l.content).filter(Boolean).join(' ') : '')
      .replace(/\s+/g, ' ').trim();
    if (!raw) continue;
    if (airmetProduct(raw) !== 'AIRMET') continue;   // AD / WS / SIGMET are not this layer
    const { validFrom, validTo } = parseAirmetValidity(raw, String((w && w.issue_date) || '').slice(0, 10));
    out.push({
      id: String((w && w.wid) || ''), hazard: classifyAirmet(raw),
      validFrom, validTo, coords: parseAirmetCoords(raw), raw,
    });
  }
  return out;
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

// AIRMET follows the SIGMET rule, not the WX rule: no active AIRMET over Israel is the
// common case and real information, so an empty list from a good fetch publishes. Only a
// failed or malformed fetch withholds, leaving the last-good branch untouched.
export function airmetPublishable({ airmetOk }) {
  return airmetOk === true;
}
// Coverage, not merely non-emptiness. The workflow asks for a FIXED list of Israeli fields,
// so a 200 carrying one station is a truncated response, not the weather: publishing it blanked
// METAR and TAF for the other twelve under a fresh generatedAt, which the staleness monitor
// reads as healthy. A field can legitimately go quiet, so the bar is a share rather than all of
// them -- below it, last-good survives untouched.
export const WX_MIN_COVERAGE = 0.6;
// Publishability is measured against what this feed NORMALLY carries -- the last-good file --
// not against the requested id list. Measuring against the request froze the feed the moment
// it shipped: IDS asks for 13 Israeli stations, but only five (LLBG, LLER, LLHA, LLHZ, LLIB)
// ever file METAR/TAF with AWC; the rest are military or small fields that never do. 60% of 13
// is 8, which is unreachable in normal operation, so every run after the gate went live
// skipped the publish and wx.json sat frozen for hours while the workflow reported success.
// The baseline keeps the property the gate was added for -- a sudden collapse (5 -> 1, or one
// endpoint erroring) still withholds -- without demanding coverage the world does not supply.
export function wxPublishable({ metarsOk, tafsOk, stations, baseline }) {
  if (!metarsOk || !tafsOk) return false;      // a half-answered pair is never publishable
  const have = Object.keys(stations || {}).length;
  if (have < 1) return false;
  const base = Number.isFinite(baseline) ? baseline : 0;
  if (base < 1) return true;                   // nothing to compare against yet
  return have >= Math.max(1, Math.ceil(base * WX_MIN_COVERAGE));
}

async function fetchJson(url, fetchImpl) {
  const r = await fetchImpl(url, { headers: UA });
  if (!r.ok) throw new Error(url.replace(AWC, '') + ' ' + r.status);
  return r.json();
}

export async function buildAviationFeeds({ firs, ids, bbox, fetchImpl = fetch, prevUrl = null,
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

  // IMS aviation feed -> AIRMETs for the Tel Aviv FIR. Same fail-closed shape as SIGMET: a
  // non-array or missing area_warnings is treated as a bad fetch, not "no warnings".
  let airmets = [], airmetOk = false;
  try {
    const body = await fetchJson(IMS_AVIATION, fetchImpl);
    const areas = body && body.data && body.data.area_warnings;
    if (areas !== undefined && (areas === null || typeof areas === 'object')) {
      airmets = parseImsAirmets(areas || {});
      airmetOk = true;
    } else {
      throw new Error('aviation_data has no data.area_warnings');
    }
  } catch (e) { warn('ims airmet:', e.message); }

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
  // How many stations the live feed already carries. Fetched, not assumed: if it cannot be
  // read (first run, branch missing, network) the baseline is 0 and any non-empty result
  // publishes -- the same behaviour this script had before the gate existed.
  let baseline = 0;
  if (prevUrl) {
    try {
      const prev = await fetchJson(prevUrl, fetchImpl);
      baseline = Object.keys((prev && prev.stations) || {}).length;
    } catch (e) { warn('last-good wx.json unreadable (' + e.message + '); publishing on any data'); }
  }

  const result = { sigmet: 'skipped', wx: 'skipped', airmet: 'skipped',
    sigmets: sigmets.length, airmets: airmets.length,
    stations: Object.keys(stations).length };
  if (airmetPublishable({ airmetOk })) {
    write('airmet/airmet.json', JSON.stringify({
      generatedAt: new Date().toISOString(), source: 'IMS area warnings (ims.gov.il)', airmets,
    }, null, 1));
    log('AIRMETs:', airmets.length);
    result.airmet = 'published';
  } else {
    warn('::error::AIRMET publish skipped; preserving last-good branch.');
  }
  if (sigmetPublishable({ sigOk })) {
    write('sigmet/sigmet.json', JSON.stringify({
      generatedAt: new Date().toISOString(), source: 'NOAA AWC isigmet', sigmets,
    }, null, 1));
    log('SIGMETs:', sigmets.length);
    result.sigmet = 'published';
  } else {
    warn('::error::SIGMET publish skipped; preserving last-good branch.');
  }
  if (wxPublishable({ metarsOk, tafsOk, stations, baseline })) {
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
    warn('::error::WX publish skipped (' + Object.keys(stations).length +
      ' stations, last good ' + baseline + '); preserving last-good branch.');
  }
  if (result.sigmet === 'skipped' && result.wx === 'skipped' && result.airmet === 'skipped') {
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
    // The live feed, used only as the coverage baseline. Overridable so the workflow can
    // point at a fork's branch; unset simply means "publish whatever we got".
    prevUrl: process.env.PREV_WX_URL ||
      'https://raw.githubusercontent.com/msupino/NavigationApp/wx-data/wx.json',
  });
}
