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
  const kind = url.includes('isigmet') ? 'isigmet' : url.includes('metar') ? 'metar' : 'taf';
  const spec = plan[kind];
  if (!spec) return { ok: false, status: 500, json: async () => ({}) };
  if (spec.status) return { ok: false, status: spec.status, json: async () => ({}) };
  return { ok: true, status: 200, json: async () => spec.body };
};

async function run(plan) {
  const mod = await import('../scripts/build-aviation-feeds.mjs');
  const written = {};
  const result = await mod.buildAviationFeeds({
    firs: FIRS, ids: IDS, bbox: BBOX,
    fetchImpl: fakeFetch(plan),
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
