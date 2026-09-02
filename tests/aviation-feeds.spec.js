// @ts-check
// The NOAA feed build (scripts/build-aviation-feeds.mjs), extracted from aviation-data.yml.
//
// These rules decide whether a feed is published at all, and a scheduled workflow runs only
// from the default branch — so it cannot be exercised until after it is promoted. While the
// build lived in a YAML heredoc the only available check was grepping the workflow for source
// text, which cannot tell a working guard from a commented-out one. Hence these.
const { test, expect } = require('./_setup');

const BBOX = { s: 28, n: 35, w: 32, e: 38 };
const FIRS = ['LLLL', 'LCCC'];
const IDS = ['LLBG', 'LLHZ'];

// A fetch stand-in: one entry per endpoint, each either a body or an { status } to fail with.
const fakeFetch = plan => async url => {
  const kind = url.includes('ims.gov.il') ? 'ims'
    : url.includes('isigmet') ? 'isigmet' : url.includes('metar') ? 'metar' : 'taf';
  const spec = plan[kind];
  if (!spec) return { ok: false, status: 500, json: async () => ({}) };
  if (spec.status) return { ok: false, status: spec.status, json: async () => ({}) };
  return { ok: true, status: 200, json: async () => spec.body };
};

async function run(plan, iaaRaw = null) {
  const mod = await import('../scripts/build-aviation-feeds.mjs');
  const written = {};
  const result = await mod.buildAviationFeeds({
    firs: FIRS, ids: IDS, bbox: BBOX,
    fetchImpl: fakeFetch(plan), iaaRaw,
    write: (file, body) => { written[file] = body; },
    log: () => {}, warn: () => {},
  });
  return { result, written, mod };
}

const metar = icaoId => ({ icaoId, rawOb: icaoId + ' 12010KT' });
const taf = icaoId => ({ icaoId, rawTAF: 'TAF ' + icaoId });

test('a healthy fetch publishes both feeds', async () => {
  const { result, written } = await run({
    isigmet: { body: [{ firId: 'LLLL', hazard: 'TS', coords: [{ lat: 32, lon: 34.9 }] }] },
    metar: { body: [metar('LLBG'), metar('LLHZ')] },
    taf: { body: [taf('LLBG')] },
  });
  expect(result.sigmet).toBe('published');
  expect(result.wx).toBe('published');
  expect(JSON.parse(written['sigmet/sigmet.json']).sigmets).toHaveLength(1);
  expect(Object.keys(JSON.parse(written['wx/wx.json']).stations).sort())
    .toEqual(['LLBG', 'LLHZ']);
});

test('no SIGMETs over Israel still publishes — emptiness is real information', async () => {
  const { result, written } = await run({
    isigmet: { body: [] },
    metar: { body: [metar('LLBG')] },
    taf: { body: [taf('LLBG')] },
  });
  // Most days there are none. Withholding here would freeze a stale SIGMET on the map long
  // after it expired, which is worse than publishing the truth that there are none.
  expect(result.sigmet).toBe('published');
  expect(JSON.parse(written['sigmet/sigmet.json']).sigmets).toEqual([]);
});

test('an empty station map is NEVER published', async () => {
  // The opposite rule, and the reason the two are not one helper: a 200 carrying an empty
  // array would blank every field's METAR and TAF while reporting success.
  const { result, written } = await run({
    isigmet: { body: [] },
    metar: { body: [] },
    taf: { body: [] },
  });
  expect(result.wx).toBe('skipped');
  expect(written['wx/wx.json']).toBeUndefined();
});

test('a response that lost icaoId is treated as empty, not as stations', async () => {
  // The shape changing is the likelier failure than the array emptying: same consequence,
  // and `Array.isArray` alone would wave it through.
  const { result, written } = await run({
    isigmet: { body: [] },
    metar: { body: [{ station_id: 'LLBG', rawOb: 'LLBG 12010KT' }] },
    taf: { body: [{ station_id: 'LLBG' }] },
  });
  expect(result.wx).toBe('skipped');
  expect(written['wx/wx.json']).toBeUndefined();
});

test('one half of the pair failing withholds the whole WX feed', async () => {
  const { result, written } = await run({
    isigmet: { body: [] },
    metar: { body: [metar('LLBG')] },
    taf: { status: 503 },
  });
  // Publishing METARs without TAFs would silently drop every forecast from the app.
  expect(result.wx).toBe('skipped');
  expect(written['wx/wx.json']).toBeUndefined();
  expect(result.sigmet).toBe('published');      // ...and the other feed is unaffected
});

test('a non-array body is refused even with a 200', async () => {
  const { result, written } = await run({
    isigmet: { body: { error: 'quota' } },
    metar: { body: { error: 'quota' } },
    taf: { body: { error: 'quota' } },
  });
  expect(result.sigmet).toBe('skipped');
  expect(result.wx).toBe('skipped');
  expect(written).toEqual({});
});

test('an HTTP error on every endpoint publishes nothing', async () => {
  const { result, written } = await run({
    isigmet: { status: 500 }, metar: { status: 500 }, taf: { status: 502 },
  });
  expect(result.sigmet).toBe('skipped');
  expect(result.wx).toBe('skipped');
  expect(written).toEqual({});      // last-good on the data branches stays untouched
});

test('SIGMETs are selected by FIR or by the Israel bounding box', async () => {
  const { mod } = await run({ isigmet: { body: [] }, metar: { body: [] }, taf: { body: [] } });
  const picked = mod.selectSigmets([
    { firId: 'LLLL', hazard: 'TS' },                                   // by FIR
    { firId: 'EGTT', hazard: 'TURB', coords: [{ lat: 32, lon: 34.9 }] }, // by bbox
    { firId: 'EGTT', hazard: 'ICE', coords: [{ lat: 51, lon: 0 }] },     // neither
    { firId: 'EGTT', hazard: 'MTW' },                                  // neither, no coords
  ], { firs: FIRS, bbox: BBOX });
  expect(picked.map(s => s.hazard)).toEqual(['TS', 'TURB']);
  // Coordinates are normalised to [lat, lon] pairs, and unusable points dropped.
  const withJunk = mod.selectSigmets([{ firId: 'LLLL', coords: [
    { lat: 32, lon: 34.9 }, { lat: null, lon: 34 }, { lat: 33 },
  ] }], { firs: FIRS, bbox: BBOX });
  expect(withJunk[0].coords).toEqual([[32, 34.9]]);
});

test('the publish predicates are exported and say what they mean', async () => {
  const { mod } = await run({ isigmet: { body: [] }, metar: { body: [] }, taf: { body: [] } });
  expect(mod.sigmetPublishable({ sigOk: true })).toBe(true);
  expect(mod.sigmetPublishable({ sigOk: false })).toBe(false);
  expect(mod.wxPublishable({ metarsOk: true, tafsOk: true, stations: { LLBG: {} } })).toBe(true);
  expect(mod.wxPublishable({ metarsOk: true, tafsOk: true, stations: {} })).toBe(false);
  expect(mod.wxPublishable({ metarsOk: false, tafsOk: true, stations: { LLBG: {} } })).toBe(false);
  expect(mod.wxPublishable({ metarsOk: true, tafsOk: false, stations: { LLBG: {} } })).toBe(false);
});

// --- AIRMET (IMS Tel Aviv FIR) --------------------------------------------------------
// The real feed shape: data.area_warnings is an object keyed by warning id; each carries
// lines[].content whose join is a raw ICAO AIRMET, polygon and validity inside the text.
const imsArea = (wid, content, issue = '2026-08-31 03:00') => ({
  data: { area_warnings: { [wid]: {
    wid, issue_date: issue,
    lines: [{ content: 'LLLL AIRMET 1 VALID 310300/310700 LLBD-' }, { content }],
  } } },
});
const MT_OBSC = 'LLLL TEL AVIV FIR MT OBSC OBS WI N3255 E03535 - N3315 E03535 - '
  + 'N3018 E03435 - N3042 E03426 - N3255 E03535 STNR WKN=';

test('an IMS area warning becomes an AIRMET with polygon, hazard and UTC validity', async () => {
  const { result, written, mod } = await run({
    isigmet: { body: [] }, metar: { body: [] }, taf: { body: [] },
    ims: { body: imsArea('42559', MT_OBSC) },
  });
  expect(result.airmet).toBe('published');
  const a = JSON.parse(written['airmet/airmet.json']).airmets;
  expect(a).toHaveLength(1);
  expect(a[0].id).toBe('42559');
  expect(a[0].hazard).toBe('MT OBSC');
  // DDMM: N3255 -> 32 + 55/60, E03535 -> 35 + 35/60. The ring is repaired to a simple
  // polygon (see the self-crossing test below), so assert the corners are present rather
  // than a fixed order, and that the closing duplicate is dropped.
  expect(a[0].coords).toHaveLength(4);
  expect(a[0].coords).toContainEqual([32.91667, 35.58333]);
  expect(a[0].coords).toContainEqual([30.3, 34.58333]);
  // UTC from the raw "VALID 310300/310700", not the item's local times
  expect(a[0].validFrom).toBe('2026-08-31T03:00:00.000Z');
  expect(a[0].validTo).toBe('2026-08-31T07:00:00.000Z');
  void mod;
});

test('no active AIRMET still publishes — emptiness is real information', async () => {
  const { result, written } = await run({
    isigmet: { body: [] }, metar: { body: [] }, taf: { body: [] },
    ims: { body: { data: { area_warnings: {} } } },
  });
  expect(result.airmet).toBe('published');
  expect(JSON.parse(written['airmet/airmet.json']).airmets).toEqual([]);
});

test('a valid IMS response with no area_warnings publishes empty (absence is real)', async () => {
  // The IMS OMITS area_warnings entirely when none are in force. That is "no AIRMETs",
  // not a bad fetch -- it must publish empty so an expired area stops being served.
  const { result, written } = await run({
    isigmet: { body: [] }, metar: { body: [] }, taf: { body: [] },
    ims: { body: { data: { metars: {}, atis: {}, tafors: {} } } },
  });
  expect(result.airmet).toBe('published');
  expect(JSON.parse(written['airmet/airmet.json']).airmets).toEqual([]);
});

test('a truly malformed IMS response withholds AIRMET, preserving last-good', async () => {
  const { result, written } = await run({
    isigmet: { body: [] }, metar: { body: [] }, taf: { body: [] },
    ims: { body: { data: null } },                  // no data object at all
  });
  expect(result.airmet).toBe('skipped');
  expect(written['airmet/airmet.json']).toBeUndefined();
});

test('an HTTP error from IMS withholds AIRMET but does not block SIGMET', async () => {
  const { result } = await run({
    isigmet: { body: [{ firId: 'LLLL', hazard: 'TS', coords: [{ lat: 32, lon: 34.9 }] }] },
    metar: { body: [] }, taf: { body: [] }, ims: { status: 503 },
  });
  expect(result.sigmet).toBe('published');
  expect(result.airmet).toBe('skipped');
});

test('the AIRMET helpers are exported and parse the raw text', async () => {
  const mod = await import('../scripts/build-aviation-feeds.mjs');
  expect(mod.airmetPublishable({ airmetOk: true })).toBe(true);
  expect(mod.airmetPublishable({ airmetOk: false })).toBe(false);
  expect(mod.classifyAirmet('... MT OBSC ...')).toBe('MT OBSC');
  expect(mod.classifyAirmet('... SFC WIND ...')).toBe('SFC WIND');
  expect(mod.classifyAirmet('nothing recognised')).toBe('AIRMET');
  // S/W hemispheres and DDMM minutes
  expect(mod.parseAirmetCoords('WI S0130 W00045')).toEqual([[-1.5, -0.75]]);
  expect(mod.parseAirmetValidity('VALID 010600/010900', '2026-09-01'))
    .toEqual({ validFrom: '2026-09-01T06:00:00.000Z', validTo: '2026-09-01T09:00:00.000Z' });
});

test('AD and WS warnings in the same bucket are not mislabelled as AIRMET', async () => {
  const mod = await import('../scripts/build-aviation-feeds.mjs');
  expect(mod.airmetProduct('LLLL AIRMET 1 VALID ...')).toBe('AIRMET');
  expect(mod.airmetProduct('LLHA AD WRNG 1')).toBe('AD');
  expect(mod.airmetProduct('LLBG WS WRNG 2 WIND SHEAR')).toBe('WS');
  // A bucket holding an AD warning alongside the AIRMET yields only the AIRMET.
  const airmets = mod.parseImsAirmets({
    '1': { wid: '1', issue_date: '2026-08-31 03:00',
           lines: [{ content: 'LLLL AIRMET 1 VALID 310300/310700 MT OBSC OBS WI N3255 E03535 - N3315 E03535 - N3018 E03435 =' }] },
    '2': { wid: '2', issue_date: '2026-08-31 03:00',
           lines: [{ content: 'LLHA AD WRNG 1 VALID 310300/310700 TS' }] },
  });
  expect(airmets).toHaveLength(1);
  expect(airmets[0].id).toBe('1');
});

test('a self-crossing WI vertex order is repaired into a simple polygon', async () => {
  const mod = await import('../scripts/build-aviation-feeds.mjs');
  const seg = (a, b, c, d) => {
    const ccw = (A, B, C) => (C[0] - A[0]) * (B[1] - A[1]) - (B[0] - A[0]) * (C[1] - A[1]);
    return (ccw(a, c, d) > 0) !== (ccw(b, c, d) > 0) && (ccw(a, b, c) > 0) !== (ccw(a, b, d) > 0);
  };
  const selfCrosses = r => {
    const n = r.length;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      if (Math.abs(i - j) <= 1 || Math.abs(i - j) === n - 1) continue;
      if (seg(r[i], r[(i + 1) % n], r[j], r[(j + 1) % n])) return true;
    }
    return false;
  };
  // The live MT OBSC corners, listed N, N, S, S -- drawn in order they bowtie.
  const raw = [[32.9167, 35.5833], [33.25, 35.5833], [30.3, 34.5833], [30.7, 34.4333]];
  expect(selfCrosses(raw)).toBe(true);
  const fixed = mod.repairRing(raw);
  expect(selfCrosses(fixed)).toBe(false);          // repaired to a simple polygon
  expect(fixed).toHaveLength(4);                    // same corners, reordered
  expect([...fixed].sort()).toEqual([...raw].sort());
  // A polygon that is already simple is returned untouched (order preserved).
  const simple = [[32, 34], [33, 34], [33, 35], [32, 35]];
  expect(mod.repairRing(simple)).toEqual(simple);
  // The full parse applies the repair.
  const a = mod.parseImsAirmets({ '1': { wid: '1', issue_date: '2026-08-31 03:00',
    lines: [{ content: 'LLLL AIRMET 1 VALID 310300/310700 MT OBSC OBS WI N3255 E03535 - N3315 E03535 - N3018 E03435 - N3042 E03426 - N3255 E03535 =' }] } });
  expect(selfCrosses(a[0].coords)).toBe(false);
});

test('per-aerodrome AD/WS warnings are keyed by ICAO, AIRMETs excluded', async () => {
  const mod = await import('../scripts/build-aviation-feeds.mjs');
  const w = mod.parseImsAirfieldWarnings({
    a: [{ valid_from: '2026-08-31 12:00', content: 'LLBG AD WRNG 1 VALID 311200/311800 SFC WIND 320/25KT MAX 38KT=' }],
    b: [{ content: 'LLBG WS WRNG 2 VALID 311200/311400 WS APCH RWY 12 SFC WIND 090/08KT 500FT WIND 180/35KT=' }],
    c: [{ content: 'LLHA AD WRNG 1 VALID 010300/010900 TS GR=' }],
    d: [{ content: 'LLLL AIRMET 1 VALID 310300/310700 MT OBSC' }],   // not an AD/WS -> excluded
  });
  expect(Object.keys(w).sort()).toEqual(['LLBG', 'LLHA']);
  expect(w.LLBG.map(x => x.product)).toEqual(['AD', 'WS']);
  expect(w.LLBG[0].validFrom).toBe('2026-08-31T12:00:00.000Z');
  expect(w.LLHA[0].product).toBe('AD');
  expect(mod.parseImsAirfieldWarnings({})).toEqual({});          // none in force
  expect(mod.parseImsAirfieldWarnings(null)).toEqual({});
});

// --- IAA-primary weather source (with AWC fallback), visibility normalised to km ---------
test('smVisToKm converts the AWC statute-mile fallback to km', async () => {
  const mod = await import('../scripts/build-aviation-feeds.mjs');
  expect(mod.smVisToKm('6+')).toBe('10+');     // P6SM marker -> 10+ km
  expect(mod.smVisToKm('4.35')).toBe('7');     // 4.35 SM -> 7 km
  expect(mod.smVisToKm('')).toBe('');
});

test('IAA raw is used as the primary weather source when it parses enough fields', async () => {
  const iaaRaw = {
    metars: [
      'METAR LLBG 011520Z 33009KT CAVOK 31/18 Q1009',
      'METAR LLHA 011450Z 34010KT 7000 FEW030 30/22 Q1009',
      'METAR LLHZ 011450Z 30010KT 9999 SCT045 29/20 Q1010',
    ],
    tafs: ['TAF LLHZ 011105Z 0112/0212 33012KT CAVOK'],
  };
  const { written } = await run({
    isigmet: { body: [] }, metar: { body: [metar('LLBG')] }, taf: { body: [taf('LLBG')] },
  }, iaaRaw);
  const wx = JSON.parse(written['wx/wx.json']);
  expect(wx.source).toMatch(/IAA/);
  expect(Object.keys(wx.stations).sort()).toEqual(['LLBG', 'LLHA', 'LLHZ']);
  expect(wx.stations.LLHA.metar.visib).toBe('7');       // native km, from the raw METAR
  expect(wx.stations.LLBG.metar.visib).toBe('10+');
});

test('a thin/blocked IAA result falls back to AWC, converted to km', async () => {
  const { written } = await run({
    isigmet: { body: [] },
    metar: { body: [{ icaoId: 'LLBG', rawOb: 'LLBG', visib: '6+' }, { icaoId: 'LLHZ', rawOb: 'LLHZ', visib: '4.35' }] },
    taf: { body: [taf('LLBG')] },
  }, { metars: ['METAR LLBG 011520Z 33009KT CAVOK'], tafs: [] });   // only 1 station -> too thin
  const wx = JSON.parse(written['wx/wx.json']);
  expect(wx.source).toBe('NOAA AWC');
  expect(wx.stations.LLBG.metar.visib).toBe('10+');     // AWC SM normalised to km
  expect(wx.stations.LLHZ.metar.visib).toBe('7');
});

test('the coverage baseline only applies within the same source', async () => {
  // IAA publishes more stations than AWC. Once IAA had run, an AWC fallback failed the
  // coverage gate against the IAA-sized baseline and NOTHING was published — the feed froze
  // for as long as IAA stayed blocked, which is the outage the fallback exists to prevent.
  const mod = await import('../scripts/build-aviation-feeds.mjs');
  const written = {};
  const prev = { source: 'IAA (brin.iaa.gov.il MobileAeroinfo)',
    stations: Object.fromEntries('ABCDEFGHIJ'.split('').map(c => ['LL' + c + c, { metar: {} }])) };
  const fetchImpl = async url => {
    if (url.includes('wx.json')) return { ok: true, status: 200, json: async () => prev };
    if (url.includes('isigmet')) return { ok: true, status: 200, json: async () => [] };
    if (url.includes('ims.gov.il')) return { ok: false, status: 500, json: async () => ({}) };
    if (url.includes('metar')) return { ok: true, status: 200, json: async () => [metar('LLBG'), metar('LLHA'), metar('LLER'), metar('LLIB'), metar('LLHZ')] };
    return { ok: true, status: 200, json: async () => [taf('LLBG')] };
  };
  await mod.buildAviationFeeds({
    firs: FIRS, ids: IDS, bbox: BBOX, fetchImpl, iaaRaw: null,   // IAA blocked -> AWC fallback
    prevUrl: 'https://example.invalid/wx.json',
    write: (f, b) => { written[f] = b; }, log: () => {}, warn: () => {},
  });
  const wx = JSON.parse(written['wx/wx.json']);      // published, not frozen
  expect(wx.source).toBe('NOAA AWC');
  expect(Object.keys(wx.stations)).toHaveLength(5);
});
