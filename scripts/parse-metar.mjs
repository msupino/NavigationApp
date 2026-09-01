// Parse raw ICAO METAR/TAF text into the same station-object shape the app already consumes
// (the fields decodeMetar/decodeTaf read), so the IAA feed is a drop-in for the AWC one.
//
// Visibility is normalised to KILOMETRES here (the value the app now displays): the raw is
// metric (9999 / CAVOK / NNNN metres) for Israeli fields, and any statute-mile group is
// converted. "10+" means "10 km or more" (9999 / CAVOK / P6SM).
//
// This module is pure (no I/O) so it unit-tests without the network.

const SM_TO_KM = 1.60934;

// Metres/SM → a km string the app appends " km" to. ">=10 km" collapses to "10+".
function metersToKm(m) {
  if (m >= 9999) return '10+';
  const km = m / 1000;
  return trimNum(km >= 10 ? 10 : km) + (km >= 10 ? '+' : '');
}
function trimNum(n) {
  return String(Math.round(n * 10) / 10).replace(/\.0$/, '');
}
// One visibility token → km string (or null if not a visibility group).
export function visToKm(tok) {
  if (tok === 'CAVOK') return '10+';
  if (tok === 'P6SM') return '10+';
  // N/NNSM, NSM, M1/4SM (statute miles)
  let m = tok.match(/^(M)?(\d+)(?:\/(\d+))?SM$/);
  if (m) {
    let sm = m[3] ? Number(m[2]) / Number(m[3]) : Number(m[2]);
    if (m[1]) sm = Math.max(0, sm - 0.01);  // "M" = less than
    return trimNum(sm * SM_TO_KM);
  }
  // 4-digit metres, optional directional suffix (9999, 3000NW, 0800)
  m = tok.match(/^(\d{4})(N|NE|E|SE|S|SW|W|NW)?$/);
  if (m) return metersToKm(Number(m[1]));
  return null;
}

// dddffKT / dddffGggKT / VRBffKT (also KMH/MPS, normalised to knots).
function parseWind(tok) {
  const m = tok.match(/^(\d{3}|VRB)(\d{2,3})(?:G(\d{2,3}))?(KT|MPS|KMH)$/);
  if (!m) return null;
  const factor = m[4] === 'MPS' ? 1.94384 : m[4] === 'KMH' ? 0.539957 : 1;
  const kt = v => (v == null ? null : Math.round(Number(v) * factor));
  return {
    wdir: m[1] === 'VRB' ? 'VRB' : Number(m[1]),
    wspd: kt(m[2]),
    wgst: m[3] ? kt(m[3]) : null,
  };
}

const CLOUD_COVER = /^(FEW|SCT|BKN|OVC|VV)(\d{3})(CB|TCU)?$/;
const CLOUD_NIL = /^(SKC|CLR|NSC|NCD|NCD)$/;
const WX_TOKEN = /^(\+|-|VC)?(MI|BC|PR|DR|BL|SH|TS|FZ|RA|DZ|SN|SG|PL|GR|GS|IC|UP|BR|FG|FU|VA|DU|SA|HZ|PY|PO|SQ|FC|DS|SS){1,3}$/;

// Split a forecast body (the part after wind onward) into visibility, weather, clouds.
function parseBody(tokens) {
  const out = { visib: null, wxString: '', clouds: [] };
  const wx = [];
  for (const tok of tokens) {
    if (tok === 'CAVOK') { out.visib = '10+'; continue; }
    if (out.visib == null) { const v = visToKm(tok); if (v != null) { out.visib = v; continue; } }
    const c = tok.match(CLOUD_COVER);
    if (c) { out.clouds.push({ cover: c[1], base: Number(c[2]) * 100 }); continue; }
    if (CLOUD_NIL.test(tok)) { out.clouds.push({ cover: tok }); continue; }
    if (WX_TOKEN.test(tok) && tok !== 'NSC') wx.push(tok);
  }
  out.wxString = wx.join(' ');
  return out;
}

// A raw METAR (with or without the leading "METAR"/"SPECI") → the app's metar object.
export function parseMetar(raw) {
  const clean = String(raw || '').replace(/=$/, '').trim().replace(/\s+/g, ' ');
  const toks = clean.split(' ');
  let i = 0;
  if (toks[i] === 'METAR' || toks[i] === 'SPECI') i++;
  const icaoId = /^[A-Z]{4}$/.test(toks[i]) ? toks[i++] : null;
  if (!icaoId) return null;
  if (/^\d{6}Z$/.test(toks[i])) i++;                 // DDHHMMZ
  if (toks[i] === 'AUTO' || toks[i] === 'COR') i++;
  const out = { icaoId, rawOb: clean, wdir: null, wspd: null, wgst: null,
    visib: null, wxString: '', clouds: [], temp: null, dewp: null, altim: null };
  const w = parseWind(toks[i] || '');
  if (w) { Object.assign(out, w); i++; if (/^\d{3}V\d{3}$/.test(toks[i] || '')) i++; }  // variable range
  // Temp/dew and QNH can appear anywhere after; scan the rest, feed the geometry to parseBody.
  const bodyToks = [];
  for (; i < toks.length; i++) {
    const tok = toks[i];
    let m = tok.match(/^(M)?(\d{1,2})\/(M)?(\d{1,2})$/);          // temperature/dewpoint
    if (m) { out.temp = (m[1] ? -1 : 1) * Number(m[2]); out.dewp = (m[3] ? -1 : 1) * Number(m[4]); continue; }
    m = tok.match(/^Q(\d{3,4})$/);                                // QNH hPa
    if (m) { out.altim = Number(m[1]); continue; }
    m = tok.match(/^A(\d{4})$/);                                  // altimeter inHg → hPa
    if (m) { out.altim = Math.round((Number(m[1]) / 100) * 33.8639); continue; }
    if (tok === 'NOSIG' || tok === 'RMK') break;                 // trend/remarks: stop
    bodyToks.push(tok);
  }
  const body = parseBody(bodyToks);
  out.visib = body.visib; out.wxString = body.wxString; out.clouds = body.clouds;
  return out;
}

// DDHH[MM] + a reference issue Date → unix seconds, choosing the month so the time sits near
// the issue (a valid period can roll into the next month). hh=24 means 00:00 the next day.
function ddToEpoch(dd, hh, mm, ref) {
  let H = hh, D = dd;
  const mk = (mon) => Date.UTC(ref.getUTCFullYear(), mon, D, H === 24 ? 0 : H, mm || 0) +
    (H === 24 ? 86400000 : 0);
  let t = mk(ref.getUTCMonth());
  if (t < ref.getTime() - 3 * 86400000) t = mk(ref.getUTCMonth() + 1);   // wrapped to next month
  else if (t > ref.getTime() + 20 * 86400000) t = mk(ref.getUTCMonth() - 1);
  return Math.floor(t / 1000);
}

// A raw TAF → { icaoId, rawTAF, fcsts:[{fcstChange, timeFrom, wdir, wspd, wgst, visib, wxString, clouds}] }.
export function parseTaf(raw, now = new Date()) {
  const clean = String(raw || '').replace(/=$/, '').trim().replace(/\s+/g, ' ');
  const toks = clean.split(' ');
  let i = 0;
  if (toks[i] === 'TAF') i++;
  if (toks[i] === 'AMD' || toks[i] === 'COR') i++;
  const icaoId = /^[A-Z]{4}$/.test(toks[i]) ? toks[i++] : null;
  if (!icaoId) return null;
  let issue = now;
  const im = (toks[i] || '').match(/^(\d{2})(\d{2})(\d{2})Z$/);
  if (im) { issue = new Date(ddToEpoch(Number(im[1]), Number(im[2]), Number(im[3]), now) * 1000); i++; }
  const vp = (toks[i] || '').match(/^(\d{2})(\d{2})\/(\d{2})(\d{2})$/);   // valid period DDHH/DDHH
  let baseFrom = issue;
  if (vp) { baseFrom = new Date(ddToEpoch(Number(vp[1]), Number(vp[2]), 0, now) * 1000); i++; }

  // Split the remaining tokens into groups at FM/BECMG/TEMPO/PROB boundaries.
  const groups = [{ change: '', from: Math.floor(baseFrom.getTime() / 1000), toks: [] }];
  for (; i < toks.length; i++) {
    const tok = toks[i];
    let m = tok.match(/^FM(\d{2})(\d{2})(\d{2})$/);
    if (m) { groups.push({ change: '', from: ddToEpoch(+m[1], +m[2], +m[3], now), toks: [] }); continue; }
    if (tok === 'BECMG' || tok === 'TEMPO') {
      const p = (toks[i + 1] || '').match(/^(\d{2})(\d{2})\/(\d{2})(\d{2})$/);
      const from = p ? ddToEpoch(+p[1], +p[2], 0, now) : Math.floor(Date.now() / 1000);
      if (p) i++;
      groups.push({ change: tok, from, toks: [] });
      continue;
    }
    if (/^PROB\d{2}$/.test(tok)) {                     // PROBxx [TEMPO] DDHH/DDHH — treat as TEMPO
      let j = i + 1;
      if (toks[j] === 'TEMPO') j++;
      const p = (toks[j] || '').match(/^(\d{2})(\d{2})\/(\d{2})(\d{2})$/);
      const from = p ? ddToEpoch(+p[1], +p[2], 0, now) : Math.floor(Date.now() / 1000);
      i = p ? j : i;
      groups.push({ change: 'TEMPO', from, toks: [] });
      continue;
    }
    if (/^(TX|TN)M?\d{2}\//.test(tok)) continue;        // TX/TN temperature extremes: skip
    groups[groups.length - 1].toks.push(tok);
  }

  const fcsts = groups.map(g => {
    const w = parseWind(g.toks[0] || '');
    const rest = w ? g.toks.slice(1) : g.toks;
    if (w && /^\d{3}V\d{3}$/.test(rest[0] || '')) rest.shift();
    const body = parseBody(rest);
    return {
      fcstChange: g.change, timeFrom: g.from,
      wdir: w ? w.wdir : null, wspd: w ? w.wspd : null, wgst: w ? w.wgst : null,
      visib: body.visib, wxString: body.wxString, clouds: body.clouds,
    };
  }).filter(f => f.wdir != null || f.visib != null || f.clouds.length || f.wxString);

  return { icaoId, rawTAF: clean, fcsts };
}

// Assemble the app's stations map from arrays of raw METAR/TAF strings (the IAA feed).
export function iaaStations(rawMetars, rawTafs, now = new Date()) {
  const stations = {};
  for (const r of rawMetars || []) { const m = parseMetar(r); if (m && m.icaoId) (stations[m.icaoId] ||= {}).metar = m; }
  for (const r of rawTafs || []) { const t = parseTaf(r, now); if (t && t.icaoId) (stations[t.icaoId] ||= {}).taf = t; }
  return stations;
}
