// Israel NOTAMs from the Israel Airports Authority (IAA AeroInfo), parsed one way everywhere.
//
// Two routes to the same source:
// - The apps ask IAA themselves. Capacitor's native HTTP makes the request in native code, where
//   the browser's same-origin rule does not apply, and from the pilot's own (Israeli) connection,
//   which IAA serves -- so the app's NOTAMs are as fresh as IAA's, not as the last hourly run.
// - A browser cannot (no CORS on IAA), so it reads notam.json, which the hourly "Update NOTAMs"
//   Action builds through a relay. That Action requires this file, so both parse identically.
//
// Loaded in the later phase (index.html): the first chart never waits for it. Until it is
// here, or whenever IAA does not answer, loadNotam() reads notam.json as before.
(function (root) {
  'use strict';

  const IAA_NOTAMS_URL = 'https://aeroinfo.iaa.gov.il/api/api/AeroInfo/GetNotams';
  // Israel's FIR always has many active NOTAMs; far fewer is a degraded upstream, not a quiet day.
  const MIN_NOTAMS = 10;

  // --- geometry from the raw ICAO NOTAM ---
  // Q-line trailing field: DDMM[NS]DDDMM[EW]RRR (RRR = radius NM; 000/999 = FIR-wide -> skip).
  // Otherwise item-E lists DDMMSS coordinates -> polygon (>=3) or a single point + "x NM RADIUS".
  const geomFromRaw = (raw, icao) => {
    const T = String(raw || '').toUpperCase();
    // Border-buffer NOTAMs ("FM LEBANON BOUNDARY TO 8KM") carry no usable coordinates -- leave
    // them geomless so the app traces the national border arc itself (buildNotamBorderAreas).
    // A Q-line circle here would suppress that and draw a wrong little circle.
    if (/\b(LEBANON|SYRIA|EGYPT|JORDAN)\b/.test(T) && /\bBORD\w*|\bBOUND\w*/.test(T)) return null;
    // Explicit item-E coordinate polygon (precise) -- for any NOTAM.
    const toks = T.match(/\d{6}[NS]\d{7}[EW]/g) || [];
    const pts = toks.map(tok => {
      const m = tok.match(/^(\d{2})(\d{2})(\d{2})([NS])(\d{3})(\d{2})(\d{2})([EW])$/);
      if (!m) return null;
      const lat = +m[1] + +m[2] / 60 + +m[3] / 3600;
      const lng = +m[5] + +m[6] / 60 + +m[7] / 3600;
      return [m[4] === 'S' ? -lat : lat, m[8] === 'W' ? -lng : lng];
    }).filter(Boolean);
    if (pts.length >= 3) return { type: 'polygon', coords: pts };
    // Circles are only meaningful for FIR-wide (LLLL) area NOTAMs. Airfield-specific NOTAMs
    // (LLBG/LLHZ/...) are surfaced via their airfield marker + inspector, so don't scatter
    // circles over the aerodrome -- leave them geomless (list / airfield only).
    if (icao !== 'LLLL') return null;
    // Radius in NM or KM (Israeli NOTAMs use both) -> NM.
    const radNm = T.match(/(\d+(?:\.\d+)?)\s*NM\s*RADIUS|RADIUS\s*(?:OF\s+)?(\d+(?:\.\d+)?)\s*NM/);
    const radKm = T.match(/(\d+(?:\.\d+)?)\s*KM\s*RADIUS|RADIUS\s*(?:OF\s+)?(\d+(?:\.\d+)?)\s*KM/);
    const rad = radNm ? +(radNm[1] || radNm[2]) : (radKm ? +(radKm[1] || radKm[2]) * 0.539957 : null);
    if (pts.length >= 1 && rad) return { type: 'circle', lat: pts[0][0], lng: pts[0][1], radiusNm: rad };
    // Fallback: Q-line centre+radius (coarse). The Q-line radius is the NOTAM's coverage
    // extent, which for FIR-wide or admin NOTAMs is huge (25-121 NM) and blankets the chart.
    // Only draw a small local circle (<=12 NM); larger ones are list-only (real hazard areas
    // carry explicit item-E coordinates handled above). Match ONLY within the Q-line (up to
    // " A)") so a coordless Q-line can't leak into item-E.
    const qline = (T.match(/\bQ\)([\s\S]*?)\bA\)/) || [])[1] || '';
    const q = qline.match(/(\d{2})(\d{2})([NS])(\d{3})(\d{2})([EW])(\d{3})(?:\s|$)/);
    if (q) {
      const r = +q[7];
      if (r > 0 && r <= 12) {
        const lat = +q[1] + +q[2] / 60, lng = +q[4] + +q[5] / 60;
        return { type: 'circle', lat: q[3] === 'S' ? -lat : lat, lng: q[6] === 'W' ? -lng : lng, radiusNm: r };
      }
    }
    return null;
  };
  // B)/C) time YYMMDDHHmm -> ISO (all NOTAM times are UTC).
  const iso = (s) => {
    const m = String(s).match(/^(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/);
    return m ? `20${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:00Z` : '';
  };

  // IAA's array of { notamID, locationIndicator, messageText, validFromDate, validToDate } ->
  // the notam.json records the app draws. This is a CVFR / LSA (VFR) planner, so IFR-only and
  // checklist NOTAMs are dropped by the Q-line traffic field (keep V / IV, drop I / K).
  // Throws when the list is degraded -- too few NOTAMs, or too few parsed -- so a caller keeps
  // its last good set instead of passing a thin list off as complete.
  function parseIaaNotams(arr) {
    if (!Array.isArray(arr)) throw new Error('IAA did not return an array');
    // Dedup by NOTAM id so the threshold compares like-for-like.
    const uniq = [...new Map(arr.filter(x => x && x.notamID && x.messageText).map(x => [x.notamID, x])).values()];
    if (uniq.length < MIN_NOTAMS) throw new Error('only ' + uniq.length + ' NOTAMs (< ' + MIN_NOTAMS + ')');
    const notams = [];
    let ok = 0, skipped = 0;
    for (const it of uniq) {
      // The full raw ICAO text (Q/A/B/C/E), flattened to one line so the field regexes behave
      // exactly as they did on the scraped single-line text.
      const raw = String(it.messageText).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      if (!raw) continue;
      ok++;
      const icao = String(it.locationIndicator || '').toUpperCase();
      const b = raw.match(/\bB\)\s*(\d{10})/), c = raw.match(/\bC\)\s*(\d{10}|PERM)/i);
      // validFromDate/validToDate (DD/MM/YYYY HH:MM) as a fallback.
      const vf = String(it.validFromDate || '').match(/(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})/);
      const vt = String(it.validToDate || '').match(/(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})/);
      const start = b ? iso(b[1]) : (vf ? `${vf[3]}-${vf[2]}-${vf[1]}T${vf[4]}:${vf[5]}:00Z` : '');
      const end = c ? (/PERM/i.test(c[1]) ? 'PERM' : iso(c[1]))
        : (vt ? `${vt[3]}-${vt[2]}-${vt[1]}T${vt[4]}:${vt[5]}:00Z` : '');
      const e = raw.match(/\bE\)\s*([\s\S]*?)\s*(?:\bF\)\s*(?:GND|SFC|FL|UNL|AMSL|AGL|\d)|\bG\)\s*(?:GND|SFC|FL|UNL|AMSL|\d)|$)/);
      let text = e ? e[1].trim() : '';
      if (text && (text.match(/\)/g) || []).length > (text.match(/\(/g) || []).length) text = text.replace(/\)\s*$/, '').trim();
      const tm = raw.match(/\bQ\)\s*[A-Z]{4}\/Q[A-Z]{4}\/([IVK]+)\b/);
      const traffic = tm ? tm[1].toUpperCase() : '';
      const qc = raw.match(/\bQ\)\s*[A-Z]{4}\/Q([A-Z]{4})\b/);
      const type = qc ? qc[1] : '';
      // Skip IFR-only and checklist NOTAMs (not relevant to VFR/LSA). Unknown traffic kept.
      if (traffic === 'I' || traffic === 'K') { skipped++; continue; }
      notams.push({ id: it.notamID, icao, type, text: text || it.notamID, start, end, geom: geomFromRaw(raw, icao) });
    }
    // Only when nearly every NOTAM parsed -- a half list presented as complete is the
    // false-safe this app refuses (see terrain.js on MSA).
    if (ok < Math.max(MIN_NOTAMS, Math.ceil(uniq.length * 0.9))) {
      throw new Error('too few parsed: ' + ok + '/' + uniq.length);
    }
    return { notams, detailOk: ok, detailTotal: uniq.length, skipped };
  }

  // The request IAA's own NOTAM page makes: every region, series 3, active now.
  function iaaRequestBody(now) {
    return {
      fromDate: new Date(now == null ? Date.now() : now).toISOString(),
      hoursAhead: '0',
      regions: 'North,Center,South',
      locations: '',
      series: '3',
      nonActive: false,
    };
  }

  const nativeHttp = () => {
    const C = typeof window !== 'undefined' && window.Capacitor;
    return (C && typeof C.isNativePlatform === 'function' && C.isNativePlatform()
      && C.Plugins && C.Plugins.CapacitorHttp) || null;
  };

  // The app only: IAA's NOTAMs, straight from IAA, in notam.json's shape. Throws on any failure
  // (no native HTTP, network, HTTP status, a block page, a degraded list) so loadNotam() falls
  // back to notam.json.
  async function fetchIaaDirect() {
    const http = nativeHttp();
    if (!http) throw new Error('no native HTTP');
    const res = await http.request({
      url: IAA_NOTAMS_URL,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      data: iaaRequestBody(),
      connectTimeout: 15000,
      readTimeout: 20000,
    });
    if (!res || res.status < 200 || res.status >= 300) throw new Error('IAA HTTP ' + (res && res.status));
    // Native HTTP hands back parsed JSON for a JSON response, a string otherwise (a block page).
    let data = res.data;
    if (typeof data === 'string') data = JSON.parse(data);
    const parsed = parseIaaNotams(data);
    return {
      generatedAt: new Date().toISOString(),
      source: 'IAA (direct)',
      fir: 'LLLL',
      notams: parsed.notams,
      detailOk: parsed.detailOk,
      detailTotal: parsed.detailTotal,
    };
  }

  const api = { IAA_NOTAMS_URL, MIN_NOTAMS, geomFromRaw, iso, parseIaaNotams, iaaRequestBody,
    fetchIaaDirect, usable: () => !!nativeHttp() };
  if (typeof module === 'object' && module.exports) { module.exports = api; return; }
  root.NavAidNotamIaa = api;
  // NOTAMs already loaded from notam.json before this module arrived: in the app, take the
  // fresher IAA set now rather than at the next hazard re-poll.
  if (api.usable() && typeof notams !== 'undefined' && notams !== null &&
      typeof refreshHazardFeeds === 'function') {
    Promise.resolve().then(() => refreshHazardFeeds()).catch(() => {});
  }
})(typeof window !== 'undefined' ? window : globalThis);
