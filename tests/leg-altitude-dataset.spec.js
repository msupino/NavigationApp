const fs = require('fs');
const path = require('path');
const { test, expect } = require('./_setup');

// Schema / consistency checks only. We deliberately do NOT assert specific
// altitudes per segment: those are DATA (correctable from the chart, and the
// live tuning gist can override them at runtime), so mirroring them in a test
// caught no bug and forced a test edit on every correction. What's worth
// guarding is structural: endpoints resolve to real waypoint ids, the
// null↔oneWay pairing is valid, statuses are in range, and directionPool stays
// derivable from segments.
const ALTITUDE_PATH = path.join(__dirname, '..', 'docs', 'data', 'cvfr-leg-altitude.json');
const NAV_PATH = path.join(__dirname, '..', 'docs', 'data', 'cvfr-nav-waypoints.json');
const AIRFIELDS_PATH = path.join(__dirname, '..', 'docs', 'data', 'airfields.json');

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
  test('has the expected top-level shape', () => {
    const data = readJson(ALTITUDE_PATH);

    expect(data.version).toBe(1);
    expect(Object.prototype.hasOwnProperty.call(data, 'points')).toBe(false);
    expect(Array.isArray(data.segments)).toBe(true);
    expect(Array.isArray(data.directionPool)).toBe(true);
    expect(data.sourceCharts.map(c => c.id)).toEqual(['north', 'south']);
  });

  test('every segment endpoint resolves to a real waypoint/airfield id', () => {
    const data = readJson(ALTITUDE_PATH);
    const nav = readJson(NAV_PATH).waypoints;
    const airfields = readJson(AIRFIELDS_PATH).airfields;
    const ids = [...nav.map(p => p.name), ...airfields.map(p => p.name)];
    const idSet = new Set(ids);

    expect(idSet.size).toBe(ids.length);            // ids are unique across both datasets
    for (const segment of data.segments) {
      expect(idSet.has(segment.from)).toBe(true);   // catches a typo'd id that would never match at runtime
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

  test('a null altitude is only allowed on a one-way segment (single direction)', () => {
    const data = readJson(ALTITUDE_PATH);
    const invalidNulls = data.segments.flatMap(segment => {
      const nullKeys = ['inboundAltitude', 'outboundAltitude'].filter(key => segment[key] === null);
      if (nullKeys.length === 0) return [];
      if (segment.oneWay === true && nullKeys.length === 1) return [];
      return [`${segment.from}-${segment.to}.${nullKeys.join('+')}`];
    });
    expect(invalidNulls).toEqual([]);
  });

  test('directionPool is derivable from segments (no drift)', () => {
    const data = readJson(ALTITUDE_PATH);
    const toKey = dir => [dir.from, dir.to, dir.altitude, dir.segment, dir.field].join('|');
    const expectedKeys = directionPoolFromSegments(data.segments).map(toKey).sort();
    const actualKeys = data.directionPool.map(toKey).sort();
    expect(actualKeys).toEqual(expectedKeys);
  });
});
