const fs = require('fs');
const path = require('path');
const { test, expect } = require('./_setup');

const ALTITUDE_PATH = path.join(__dirname, '..', 'docs', 'data', 'cvfr-leg-altitude.json');
const NAV_PATH = path.join(__dirname, '..', 'docs', 'data', 'cvfr-nav-waypoints.json');
const AIRFIELDS_PATH = path.join(__dirname, '..', 'docs', 'data', 'airfields.json');
const EXTRACTION_NOTES_PATH = path.join(
  __dirname, '..', 'scripts', 'cvfr-altitude-extraction-notes.json');

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function directionPoolFromSegments(segments) {
  const out = [];
  for (const segment of segments || []) {
    if (Number.isInteger(segment.inboundAltitude)) {
      out.push({
        from: segment.from,
        to: segment.to,
        altitude: segment.inboundAltitude,
        segment: `${segment.from}-${segment.to}`,
        field: 'inboundAltitude',
      });
    }
    if (Number.isInteger(segment.outboundAltitude)) {
      out.push({
        from: segment.to,
        to: segment.from,
        altitude: segment.outboundAltitude,
        segment: `${segment.from}-${segment.to}`,
        field: 'outboundAltitude',
      });
    }
  }
  return out;
}

test.describe('cvfr-leg-altitude.json scaffold', () => {
  test('keeps route endpoints in the source waypoint datasets', () => {
    const data = readJson(ALTITUDE_PATH);

    expect(data.version).toBe(1);
    expect(Object.prototype.hasOwnProperty.call(data, 'points')).toBe(false);
    expect(Array.isArray(data.segments)).toBe(true);
    expect(Array.isArray(data.directionPool)).toBe(true);
    expect(data.sourceCharts.map(c => c.id)).toEqual(['north', 'south']);
  });

  test('keeps point ids unique and segment endpoints valid', () => {
    const data = readJson(ALTITUDE_PATH);
    const nav = readJson(NAV_PATH).waypoints;
    const airfields = readJson(AIRFIELDS_PATH).airfields;
    const ids = [
      ...nav.map(p => p.name),
      ...airfields.map(p => p.name),
    ];
    const idSet = new Set(ids);

    expect(idSet.size).toBe(ids.length);
    for (const segment of data.segments) {
      expect(idSet.has(segment.from)).toBe(true);
      expect(idSet.has(segment.to)).toBe(true);
      expect(segment.from).not.toBe(segment.to);
      expect(segment.status).toMatch(/^(candidate|reviewed)$/);
      expect(Object.prototype.hasOwnProperty.call(segment, 'inboundAltitude')).toBe(true);
      expect(Object.prototype.hasOwnProperty.call(segment, 'outboundAltitude')).toBe(true);
      if (Object.prototype.hasOwnProperty.call(segment, 'oneWay')) {
        expect(typeof segment.oneWay).toBe('boolean');
      }
      for (const key of ['inboundAltitude', 'outboundAltitude']) {
        expect(segment[key] === null || Number.isInteger(segment[key])).toBe(true);
      }
    }
  });

  test('seeds the reviewed ZALMN / DESHE example from the CVFR screenshot', () => {
    const data = readJson(ALTITUDE_PATH);
    const segment = data.segments.find(s => s.from === 'DESHE' && s.to === 'ZALMN');

    expect(segment).toBeTruthy();
    expect(segment.inboundAltitude).toBe(3000);
    expect(segment.outboundAltitude).toBe(2500);
    expect(segment.status).toBe('reviewed');
  });

  test('keeps BOREN / HOTRM outbound at the corrected 2000 ft altitude', () => {
    const data = readJson(ALTITUDE_PATH);
    const segment = data.segments.find(s => s.from === 'BOREN' && s.to === 'HOTRM');

    expect(segment).toBeTruthy();
    expect(segment.inboundAltitude).toBe(1500);
    expect(segment.outboundAltitude).toBe(2000);
  });

  test('fills candidate altitudes or marks one-way blocked directions', () => {
    const data = readJson(ALTITUDE_PATH);
    const byName = new Map(data.segments.map(s => [`${s.from}-${s.to}`, s]));
    const invalidNulls = data.segments.flatMap(segment => {
      const nullKeys = ['inboundAltitude', 'outboundAltitude']
        .filter(key => segment[key] === null);
      if (nullKeys.length === 0) return [];
      if (segment.oneWay === true && nullKeys.length === 1) return [];
      return [`${segment.from}-${segment.to}.${nullKeys.join('+')}`];
    });
    const oneWaySegments = data.segments.filter(segment => segment.oneWay === true);

    expect(invalidNulls).toEqual([]);
    expect(oneWaySegments.length).toBeGreaterThanOrEqual(6);
    expect(byName.get('AAKKO-AHIUD')).toMatchObject({
      inboundAltitude: null,
      outboundAltitude: 2000,
      oneWay: true,
    });
    expect(byName.get('AFFEK-LLHA')).toMatchObject({
      inboundAltitude: 2000,
      outboundAltitude: 1500,
    });
    expect(byName.get('SHRUT-YOTVT')).toMatchObject({
      inboundAltitude: 2500,
      outboundAltitude: 3000,
      status: 'reviewed',
    });
    expect(byName.get('SMRAT-SZION')).toMatchObject({
      inboundAltitude: 1500,
      outboundAltitude: 2000,
    });
    expect(byName.get('EIRON-SDTYM')).toMatchObject({
      inboundAltitude: 3000,
      outboundAltitude: null,
      oneWay: true,
    });
    expect(byName.get('ANATA-HNINA')).toMatchObject({
      inboundAltitude: 5000,
      outboundAltitude: 4500,
    });
    expect(byName.get('ANATA-DUMIM')).toMatchObject({
      inboundAltitude: 4500,
      outboundAltitude: 5000,
    });
    expect(byName.get('DUMIM-YRIHO')).toMatchObject({
      inboundAltitude: 3500,
      outboundAltitude: 4000,
    });
    expect(byName.get('YRIHO-ALMOG')).toMatchObject({
      inboundAltitude: 3500,
      outboundAltitude: 4000,
    });
    expect(byName.get('ENGDI-LLMZ')).toMatchObject({
      inboundAltitude: 3500,
      outboundAltitude: 4000,
    });
    expect(byName.get('BAZRA-DEROR')).toMatchObject({
      inboundAltitude: 800,
      outboundAltitude: 2000,
    });
    expect(byName.get('BAZRA-LLHZ')).toMatchObject({
      inboundAltitude: 1200,
      outboundAltitude: 800,
      source: 'cvfr-map airway adjacency',
    });
    expect(byName.get('DEROR-SHARO')).toMatchObject({
      inboundAltitude: 1500,
      outboundAltitude: 2000,
      source: 'cvfr-map airway adjacency',
    });
    expect(byName.get('SHARO-ZYAAR')).toMatchObject({
      inboundAltitude: 1500,
      outboundAltitude: 2000,
    });
    expect(byName.get('ZYAAR-HADRA')).toMatchObject({
      inboundAltitude: 1500,
      outboundAltitude: 2000,
    });
    expect(byName.get('ZMGEN-TZHOT')).toMatchObject({
      inboundAltitude: 2000,
      outboundAltitude: 2000,
      source: 'cvfr-map airway adjacency',
      armyAirway: true,
      onAtcApproval: true,
    });
    expect(byName.get('TZHOT-LLHB')).toMatchObject({
      inboundAltitude: 2000,
      outboundAltitude: 2000,
      source: 'cvfr-map airway adjacency',
      armyAirway: true,
      onAtcApproval: true,
    });
    expect(byName.get('HADRA-FRDIS')).toMatchObject({
      inboundAltitude: 1500,
      outboundAltitude: 2000,
    });
    expect(byName.get('KUVSH-NCITY')).toMatchObject({
      inboundAltitude: 2500,
      outboundAltitude: 3000,
    });
    expect(byName.get('HTZUK-KNTRY')).toMatchObject({
      inboundAltitude: 1200,
      outboundAltitude: null,
      oneWay: true,
    });
    expect(byName.get('HTZUK-RIDNG')).toMatchObject({
      inboundAltitude: 800,
      outboundAltitude: 1200,
      source: 'route template correction',
    });
    expect(byName.get('SFAIM-HTZUK')).toMatchObject({
      inboundAltitude: 800,
      outboundAltitude: 1600,
      source: 'route template correction',
    });
    expect(byName.get('SFAIM-RIDNG')).toMatchObject({
      inboundAltitude: 800,
      outboundAltitude: 1600,
      source: 'route template correction',
    });
    expect(byName.get('MRISN-NTAIM')).toMatchObject({
      inboundAltitude: 1200,
      outboundAltitude: 1200,
    });
    expect(byName.get('NCITY-OMMER')).toMatchObject({
      inboundAltitude: 3000,
      outboundAltitude: 3500,
    });
    expect(byName.get('NCITY-ZGOAL')).toMatchObject({
      inboundAltitude: 2500,
      outboundAltitude: 3000,
    });
    expect(byName.get('ZGOAL-ZLHAV')).toMatchObject({
      inboundAltitude: 3500,
      outboundAltitude: 3000,
      source: 'cvfr-map airway adjacency',
    });
    expect(byName.get('ZGOAL-OMMER')).toMatchObject({
      inboundAltitude: 3000,
      outboundAltitude: 3500,
      source: 'cvfr-map airway adjacency',
    });
    expect(byName.get('NTAIM-SUPER')).toMatchObject({
      inboundAltitude: 1200,
      outboundAltitude: 800,
    });
    expect(byName.get('NMASD-NITZA')).toMatchObject({
      inboundAltitude: 800,
      outboundAltitude: 1200,
      source: 'maintainer correction',
    });
    expect(byName.get('BOVED-NTAIM')).toMatchObject({
      inboundAltitude: 1200,
      outboundAltitude: 800,
      source: 'route template correction',
    });
    expect(byName.get('HODYA-NITZA')).toMatchObject({
      inboundAltitude: 2000,
      outboundAltitude: 1500,
      source: 'route template correction',
    });
    expect(byName.get('HODYA-REVAH')).toMatchObject({
      inboundAltitude: 1500,
      outboundAltitude: 2000,
      source: 'route template correction',
    });
    expect(byName.get('SOVAL-MINGV')).toMatchObject({
      inboundAltitude: 2500,
      outboundAltitude: 3000,
      source: 'route template correction',
    });
    expect(byName.get('TYONA-NTAIM')).toMatchObject({
      inboundAltitude: 800,
      outboundAltitude: 1200,
      source: 'route template correction',
    });
    expect(byName.get('OLGAH-PELEG')).toMatchObject({
      inboundAltitude: 800,
      outboundAltitude: 1500,
    });
    expect(byName.get('BOKER-OVDAT')).toMatchObject({
      inboundAltitude: 3500,
      outboundAltitude: 4000,
    });
    expect(byName.get('LLEY-ZOFAR')).toMatchObject({
      inboundAltitude: 3500,
      outboundAltitude: 4000,
    });
    expect(byName.has('BOKER-RUHOT')).toBe(false);
    expect(byName.has('HAZVA-ZOFAR')).toBe(false);
    expect(byName.has('OLGAH-VINGT')).toBe(false);
    expect(byName.has('PELEG-SDTYM')).toBe(false);
  });

  test('directionPool mirrors every allowed segment direction', () => {
    const data = readJson(ALTITUDE_PATH);
    const expected = directionPoolFromSegments(data.segments);
    const toKey = dir => [dir.from, dir.to, dir.altitude, dir.segment, dir.field].join('|');
    const expectedKeys = expected.map(toKey).sort();
    const actualKeys = data.directionPool.map(toKey).sort();

    expect(actualKeys).toEqual(expectedKeys);
    expect(data.directionPool).toEqual(expect.arrayContaining([
      {
        from: 'DESHE',
        to: 'ZALMN',
        altitude: 3000,
        segment: 'DESHE-ZALMN',
        field: 'inboundAltitude',
      },
      {
        from: 'ZALMN',
        to: 'DESHE',
        altitude: 2500,
        segment: 'DESHE-ZALMN',
        field: 'outboundAltitude',
      },
    ]));
  });

  test('keeps the extraction review ledger in sync with the altitude data', () => {
    const data = readJson(ALTITUDE_PATH);
    const notes = readJson(EXTRACTION_NOTES_PATH);
    const segments = data.segments.map(segment => `${segment.from}-${segment.to}`);
    const notesByName = new Map(notes.segments.map(segment => [segment.segment, segment]));

    expect(notes.relatedDataset).toBe('docs/data/cvfr-leg-altitude.json');
    expect(notes.sourceCharts.map(chart => chart.id)).toEqual(['north', 'south']);
    expect(notes.sourceCharts.map(chart => chart.region)).toEqual(['north', 'south']);
    expect(notes.sourceCharts.every(chart => chart.url.includes('gov.il'))).toBe(true);
    expect(notes.directionConvention.inboundAltitude).toBe('FROM -> TO');
    expect(notes.directionConvention.outboundAltitude).toBe('TO -> FROM');
    expect(notes.directionConvention.oneWay).toContain('disallowed direction');
    expect(notes.directionConvention.bidirectionalMarker).toContain('pointed ends');
    expect(notes.reviewRules.length).toBeGreaterThanOrEqual(5);
    expect(notes.reviewRules.some(rule =>
      rule.includes('same altitude both directions') &&
      rule.includes('double-ended yellow tags'))).toBe(true);
    expect(notes.reviewRules.some(rule =>
      rule.includes('oneWay=true') && rule.includes('disallowed direction'))).toBe(true);
    expect(notes.reviewRules.some(rule =>
      rule.includes('Omit shortcut candidates') &&
      rule.includes('intermediate reporting point'))).toBe(true);
    expect(notes.segments.map(segment => segment.segment)).toEqual(segments);

    for (const segment of data.segments) {
      const key = `${segment.from}-${segment.to}`;
      const note = notesByName.get(key);
      expect(note).toBeTruthy();
      expect(note).toMatchObject({
        from: segment.from,
        to: segment.to,
        inboundAltitude: segment.inboundAltitude,
        outboundAltitude: segment.outboundAltitude,
        status: segment.status,
        distanceNm: segment.distanceNm,
      });
      expect(note.crop).toBe(`/tmp/navaid-altitude-extract/${segment.from}_${segment.to}.png`);
      expect(typeof note.evidence).toBe('string');
      expect(note.evidence.length).toBeGreaterThan(40);
    }
  });
});
