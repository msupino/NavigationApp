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
import { iaaStations } from './parse-metar.mjs';

// AWC reports visibility in statute miles; the app now displays kilometres, and the IAA feed
// is already km, so normalise the AWC fallback to km too. P6SM ("6+") is the ">=10 km" marker.
export function smVisToKm(v) {
  const s = String(v == null ? '' : v).trim();
  const m = s.match(/^([0-9.]+)(\+?)$/);
  if (!m) return s;
  if (m[2]) return '10+';                       // 6+ SM -> "10+ km"
  const km = Math.round(parseFloat(m[1]) * 1.60934 * 10) / 10;
  return (km >= 10 ? '10+' : String(km).replace(/\.0$/, ''));
}
export function normalizeAwcVis(stations) {
  for (const st of Object.values(stations || {})) {
    if (st.metar && st.metar.visib != null) st.metar.visib = smVisToKm(st.metar.visib);
    if (st.taf && Array.isArray(st.taf.fcsts)) {
      for (const f of st.taf.fcsts) if (f.visib != null) f.visib = smVisToKm(f.visib);
    }
  }
  return stations;
}

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
// SIGMET/AIRMET "WI" coordinates are an ordered vertex list. The IMS occasionally lists
// them in an order that, drawn point-to-point, crosses itself -- a bowtie rather than the
// intended area (observed: a Golan-to-Negev corridor whose four corners were listed
// N, N, S, S, so the two long edges crossed). When that happens the corners are still the
// right corners; only the traversal order is wrong. Reorder by angle about the centroid,
// which turns any self-crossing list of convex/star-shaped points into a simple polygon.
// A ring that is already simple is returned unchanged, so well-formed multi-point areas are
// never altered.
export function repairRing(coords) {
  let ring = Array.isArray(coords) ? coords.filter(c => Array.isArray(c) && c.length === 2) : [];
  // These lists usually repeat the first point to close the ring; drop it so it does not
  // sit as a zero-length edge (and skew the centroid) during the check and reorder.
  if (ring.length > 1) {
    const a = ring[0], b = ring[ring.length - 1];
    if (a[0] === b[0] && a[1] === b[1]) ring = ring.slice(0, -1);
  }
  if (ring.length < 4) return ring;                 // 3 points cannot self-cross
  const ccw = (A, B, C) => (C[0] - A[0]) * (B[1] - A[1]) - (B[0] - A[0]) * (C[1] - A[1]);
  const inter = (a, b, c, d) =>
    (ccw(a, c, d) > 0) !== (ccw(b, c, d) > 0) && (ccw(a, b, c) > 0) !== (ccw(a, b, d) > 0);
  const n = ring.length;
  let crosses = false;
  for (let i = 0; i < n && !crosses; i++) {
    for (let j = i + 1; j < n; j++) {
      if (Math.abs(i - j) <= 1 || Math.abs(i - j) === n - 1) continue;
      if (inter(ring[i], ring[(i + 1) % n], ring[j], ring[(j + 1) % n])) { crosses = true; break; }
    }
  }
  if (!crosses) return ring;
  const cx = ring.reduce((s, p) => s + p[0], 0) / n;
  const cy = ring.reduce((s, p) => s + p[1], 0) / n;
  return ring.slice().sort((a, b) => Math.atan2(a[0] - cx, a[1] - cy) - Math.atan2(b[0] - cx, b[1] - cy));
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
      validFrom, validTo, coords: repairRing(parseAirmetCoords(raw)), raw,
    });
  }
  return out;
}

// IMS `data.warnings` carries the per-aerodrome products -- AD WRNG (aerodrome) and WS WRNG
// (wind shear) -- keyed by an internal id, each an array of lines whose text names the field
// and the warning. These are point warnings, not FIR polygons, so they do not belong on the
// AIRMET map; they surface in the airfield weather panel. Key them by ICAO (the first token
// of the raw text) with the product, validity and raw line, so a field can show its own.
export function parseImsAirfieldWarnings(warnings) {
  const out = {};
  const groups = warnings && typeof warnings === 'object' ? Object.values(warnings) : [];
  for (const g of groups) {
    const arr = Array.isArray(g) ? g : [g];
    const raw = arr.map(l => l && l.content).filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
    if (!raw) continue;
    const product = airmetProduct(raw);
    if (product !== 'AD' && product !== 'WS') continue;   // this map is aerodrome AD/WS only
    const icao = (raw.match(/\b(LL[A-Z]{2})\b/) || [])[1];
    if (!icao) continue;
    const { validFrom, validTo } = parseAirmetValidity(raw,
      String((arr[0] && arr[0].valid_from) || '').slice(0, 10));
    (out[icao] = out[icao] || []).push({ product, validFrom, validTo, raw });
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
  iaaRaw = null, write = writeFileSync, log = console.log, warn = console.error } = {}) {
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

  // IMS aviation feed -> AIRMETs for the Tel Aviv FIR. Fail-closed like SIGMET, but the bar
  // for "good fetch" is a valid `data` OBJECT -- not the presence of area_warnings. The IMS
  // OMITS area_warnings (and warnings) entirely when none are in force, which is the common
  // case; treating that absence as a bad fetch froze the last AIRMET in the branch forever
  // (it never republished empty, so an expired area kept being served). A missing key is
  // "none", only a failed fetch or a non-object data withholds.
  let airmets = [], airfieldWarnings = {}, airmetOk = false;
  try {
    const body = await fetchJson(IMS_AVIATION, fetchImpl);
    const data = body && body.data;
    if (data && typeof data === 'object') {
      const areas = data.area_warnings;
      if (areas != null && typeof areas !== 'object') throw new Error('area_warnings is not an object');
      airmets = parseImsAirmets(areas || {});
      airfieldWarnings = parseImsAirfieldWarnings(data.warnings || {});
      airmetOk = true;
    } else {
      throw new Error('aviation_data has no data object');
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
  // IAA (brin.iaa.gov.il MobileAeroinfo) is the primary source: native Israeli OPMET, already
  // metric, and it carries fields AWC does not ingest (e.g. Herzliya). The raw METAR/TAF text
  // is fetched by the workflow (Radware-gated, curl-only) and passed in as iaaRaw; AWC stays
  // the fallback so weather never goes dark if IAA is blocked. AWC's statute-mile visibility
  // is normalised to km so BOTH sources publish the same km value the app renders.
  const awcStations = normalizeAwcVis(collectStations(metars, tafs));
  let iaa = {};
  try {
    if (iaaRaw && (iaaRaw.metars || iaaRaw.tafs)) iaa = iaaStations(iaaRaw.metars || [], iaaRaw.tafs || []);
  } catch (e) { warn('iaa parse:', e.message); }
  // Use IAA only when it parsed a sensible number of fields — at least as many as AWC, and
  // never fewer than 3. A thin IAA result (a partial page, a parse regression) falls back to
  // AWC rather than shipping a near-empty weather feed.
  const useIaa = Object.keys(iaa).length >= Math.max(3, Object.keys(awcStations).length);
  const stations = useIaa ? iaa : awcStations;
  const wxSource = useIaa ? 'IAA (brin.iaa.gov.il MobileAeroinfo)' : 'NOAA AWC';
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
      generatedAt: new Date().toISOString(), source: 'IMS area warnings (ims.gov.il)',
      airmets, airfieldWarnings,
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
  // When IAA supplied the stations, its own success stands in for the AWC ok flags.
  if (wxPublishable({ metarsOk: useIaa || metarsOk, tafsOk: useIaa || tafsOk, stations, baseline })) {
    write('wx/wx.json', JSON.stringify({
      generatedAt: new Date().toISOString(), source: wxSource, stations,
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

// Fetch the raw METAR/TAF from IAA's MobileAeroinfo (the primary weather source). Same
// Radware-gated, curl-only, list -> detail pattern the NOTAM job uses: the list page carries
// truncated previews + row ids, the full text is on maiDetails.aspx?rowID=. Network + curl,
// so this stays out of the pure buildAviationFeeds() and only runs from the CLI; failure
// returns null and the build falls back to AWC. Verified in CI, like NOTAM.
async function fetchIaaWeatherRaw() {
  const { execFileSync } = await import('node:child_process');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const UA_S = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
  const MB = 'https://brin.iaa.gov.il/MobileAeroinfo';
  const JAR = join(tmpdir(), 'iaa-wx-jar.txt');
  const curl = (url, referer) => {
    try {
      return execFileSync('curl', ['-sS', '-f', '-m', '30', '--retry', '4', '--retry-all-errors',
        '-A', UA_S, '-b', JAR, '-c', JAR, '-H', 'Referer: ' + referer,
        '-H', 'Accept: text/html,application/xhtml+xml', url],
        { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
    } catch (e) { return ''; }
  };
  // Strip every tag (which removes <script>/</script> too) and decode a few entities, then
  // pull the OPMET lines out by their fixed "METAR|TAF LLxx" shape. We never render this HTML
  // — it is only scanned for METAR/TAF strings — and script text cannot match that shape, so
  // no separate <script>…</script> removal is needed (and none of the incomplete-sanitization
  // it would invite).
  const strip = h => String(h).replace(/<[^>]+>/g, ' ').replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
  try {
    execFileSync('rm', ['-f', JAR]);
  } catch (e) { /* fresh jar */ }
  const list = curl(MB + '/maiWeather.aspx', MB + '/maiNotam.aspx');
  if (!list || /Block ID|Error 100/.test(list)) { console.error('iaa weather list blocked/empty'); return null; }
  // Each clickable row: rowClicked('id') — but the site encodes the quotes as &#39;, so decode
  // entities first (the NOTAM job does the same) or the ids never match and nothing is fetched.
  const listDec = list.replace(/&#39;/g, "'");
  const rowIds = [];
  const re = /rowClicked\('(\d+)'\)/g; let m;
  while ((m = re.exec(listDec))) rowIds.push(m[1]);
  console.log('IAA weather rows: ' + rowIds.length);
  const metars = [], tafs = [];
  let dbg = 0;
  for (const id of [...new Set(rowIds)]) {
    const txt = strip(curl(MB + '/maiDetails.aspx?rowID=' + id, MB + '/maiNotam.aspx'));
    if (dbg < 2) { console.log('IAA detail[' + id + '] (' + txt.length + '): ' + txt.slice(0, 220)); dbg++; }
    if (!txt || /Block ID|Error 100/.test(txt)) continue;
    const mt = txt.match(/\b((?:METAR|SPECI)\s+LL[A-Z]{2}\b[\s\S]*?)(?:=|$)/);
    const tf = txt.match(/\bTAF(?:\s+(?:AMD|COR))?\s+LL[A-Z]{2}\b[\s\S]*?(?:=|$)/);
    if (mt) metars.push(mt[1].trim());
    if (tf) tafs.push(tf[0].trim());
  }
  if (!metars.length && !tafs.length) { console.error('iaa weather: no messages parsed'); return null; }
  console.log('IAA raw: ' + metars.length + ' METAR, ' + tafs.length + ' TAF');
  return { metars, tafs };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const split = v => (v || '').split(',').map(s => s.trim()).filter(Boolean);
  let iaaRaw = null;
  try { iaaRaw = await fetchIaaWeatherRaw(); } catch (e) { console.error('iaa fetch:', e.message); }
  await buildAviationFeeds({
    firs: split(process.env.FIRS),
    ids: split(process.env.IDS),
    bbox: { s: 28, n: 35, w: 32, e: 38 },
    iaaRaw,
    // The live feed, used only as the coverage baseline. Overridable so the workflow can
    // point at a fork's branch; unset simply means "publish whatever we got".
    prevUrl: process.env.PREV_WX_URL ||
      'https://raw.githubusercontent.com/msupino/NavigationApp/wx-data/wx.json',
  });
}
