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
// Both datasets are projected from cvfr-route-graph.json now; the shapes are unchanged.
const { legAltitude, navWaypoints } = require('./_layerData');
const ALTITUDE_PATH = 'leg-altitude';
const NAV_PATH = 'nav-waypoints';
const AIRFIELDS_PATH = path.join(__dirname, '..', 'docs', 'data', 'airfields.json');

function readJson(file) {
  if (file === ALTITUDE_PATH) return legAltitude('cvfr');
  if (file === NAV_PATH) return navWaypoints('cvfr');
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
        // Canonical, matching legAltitudeKey: same key whichever way the row is stored.
        segment: [segment.from, segment.to].sort().join('-'),
        field: 'inboundAltitude',
      });
    }
    if (Number.isInteger(segment.outboundAltitude)) {
      out.push({
        from: segment.to,
        to: segment.from,
        altitude: segment.outboundAltitude,
        segment: [segment.from, segment.to].sort().join('-'),
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
    // directionPool is no longer carried: it was always derivable from the segments, and a
    // stored copy is one more thing that can drift. The loader derives it; the test below
    // checks the derivation itself.
    expect(Object.prototype.hasOwnProperty.call(data, 'directionPool')).toBe(false);
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
      // 'unknown' is the documented placeholder for a link whose altitudes have not been
      // read off the chart yet: the file's own schema defines it, io.js validateLegAltitudes
      // enforces it (two nulls), and core.js normalizeLegAltitudePairSegment produces it.
      expect(segment.status).toMatch(/^(candidate|reviewed|unknown)$/);
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
      // Two nulls + status=unknown: the row exists, its altitudes are not read yet. Distinct
      // from a single null, which says that DIRECTION is not allowed.
      if (segment.status === 'unknown' && nullKeys.length === 2 && segment.oneWay !== true) return [];
      return [`${segment.from}-${segment.to}.${nullKeys.join('+')}`];
    });
    expect(invalidNulls).toEqual([]);
  });

  test('the pool the app derives at runtime is the one the segments imply', async ({ page }) => {
    // Drift used to be possible because the pool was ALSO stored. It is not any more, so the
    // check moved to the derivation: what legAltitudeDirectionsFromSegments() builds in the
    // running app must be what the segments say, entry for entry.
    const data = readJson(ALTITUDE_PATH);
    await page.goto('?lang=en&nogist');
    await page.waitForFunction(() => typeof legAltitudeDirectionsFromSegments === 'function');
    const actual = await page.evaluate(
      segs => legAltitudeDirectionsFromSegments(segs), data.segments);
    const toKey = dir => [dir.from, dir.to, dir.altitude, dir.segment, dir.field].join('|');
    expect(actual.map(toKey).sort()).toEqual(directionPoolFromSegments(data.segments).map(toKey).sort());
  });
});
