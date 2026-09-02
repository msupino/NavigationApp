// @ts-check
// Raw ICAO METAR/TAF parser (scripts/parse-metar.mjs) that feeds the IAA weather source.
// Pure, so it runs without the network. Visibility is normalised to kilometres here.
const { test, expect } = require('./_setup');

let P;
test.beforeAll(async () => { P = await import('../scripts/parse-metar.mjs'); });

test('visToKm converts metric and statute-mile visibilities', () => {
  expect(P.visToKm('CAVOK')).toBe('10+');
  expect(P.visToKm('9999')).toBe('10+');
  expect(P.visToKm('7000')).toBe('7');
  expect(P.visToKm('0800')).toBe('0.8');
  expect(P.visToKm('3000NW')).toBe('3');       // directional metres
  expect(P.visToKm('P6SM')).toBe('10+');
  expect(P.visToKm('6SM')).toBe('9.7');
  expect(P.visToKm('M1/4SM')).toBe('0.4');
  expect(P.visToKm('FEW030')).toBe(null);      // not a visibility group
});

test('parseMetar extracts wind, vis(km), clouds, temp/dew, QNH', () => {
  const m = P.parseMetar('METAR LLBG 011520Z 33009KT CAVOK 31/18 Q1009 NOSIG');
  expect(m.icaoId).toBe('LLBG');
  expect(m.wdir).toBe(330); expect(m.wspd).toBe(9); expect(m.wgst).toBe(null);
  expect(m.visib).toBe('10+');
  expect(m.temp).toBe(31); expect(m.dewp).toBe(18); expect(m.altim).toBe(1009);
});

test('parseMetar handles AUTO, variable range, gust, weather, layers, negatives', () => {
  const m = P.parseMetar('METAR LLXX 011250Z AUTO 09008G18KT 060V120 7000 -RA BKN012 OVC030CB M02/M05 Q1013');
  expect(m.wgst).toBe(18);
  expect(m.visib).toBe('7');
  expect(m.wxString).toBe('-RA');
  expect(m.clouds).toEqual([{ cover: 'BKN', base: 1200 }, { cover: 'OVC', base: 3000 }]);
  expect(m.temp).toBe(-2); expect(m.dewp).toBe(-5);
});

test('parseTaf splits FM/BECMG/TEMPO groups with change tags and times', () => {
  const ref = new Date(Date.UTC(2026, 8, 1, 15, 0));
  const t = P.parseTaf('TAF LLHA 011106Z 0112/0212 32014KT 9999 FEW040 BECMG 0114/0116 30012KT TEMPO 0116/0119 6000 TSRA BKN030CB TX31/0112Z TN25/0203Z', ref);
  expect(t.icaoId).toBe('LLHA');
  expect(t.fcsts.map(f => f.fcstChange)).toEqual(['', 'BECMG', 'TEMPO']);
  expect(t.fcsts[0].wdir).toBe(320); expect(t.fcsts[0].visib).toBe('10+');
  expect(t.fcsts[0].clouds).toEqual([{ cover: 'FEW', base: 4000 }]);
  expect(t.fcsts[2].visib).toBe('6'); expect(t.fcsts[2].wxString).toBe('TSRA');
  // times increase across the groups
  expect(t.fcsts[1].timeFrom).toBeGreaterThan(t.fcsts[0].timeFrom);
  expect(t.fcsts[2].timeFrom).toBeGreaterThan(t.fcsts[1].timeFrom);
});

test('iaaStations assembles the app station map from raw strings', () => {
  const st = P.iaaStations(
    ['METAR LLBG 011520Z 33009KT CAVOK 31/18 Q1009', 'METAR LLHZ 011450Z 30010KT 9999 FEW030 29/20 Q1010'],
    ['TAF LLHZ 011105Z 0112/0212 33012KT CAVOK'],
    new Date(Date.UTC(2026, 8, 1, 15, 0)));
  expect(Object.keys(st).sort()).toEqual(['LLBG', 'LLHZ']);
  expect(st.LLBG.metar.visib).toBe('10+');
  expect(st.LLHZ.taf.fcsts.length).toBeGreaterThan(0);
});

test('a METAR trend group is not read as the current observation', () => {
  // TEMPO/BECMG start a FORECAST trend; everything after belongs to it, not to the report.
  const m = P.parseMetar('METAR LLBG 011520Z 33009KT 9999 SCT040 31/18 Q1009 TEMPO 4000 TSRA BKN012');
  expect(m.visib).toBe('10+');                       // the observed 9999, not the trend's 4000
  expect(m.wxString).toBe('');                       // TSRA is forecast, not happening now
  expect(m.clouds).toEqual([{ cover: 'SCT', base: 4000 }]);   // no BKN012 from the trend
  const b = P.parseMetar('METAR LLHA 011450Z 34010KT 9999 FEW030 30/22 Q1009 BECMG 3000 BR');
  expect(b.visib).toBe('10+');
  expect(b.wxString).toBe('');
});
