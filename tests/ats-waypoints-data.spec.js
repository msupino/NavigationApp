// @ts-check
// The reporting points printed on the ATS routes sheet, as the CAA's own digits: each box on
// the chart carries "32° 21’ 17”N / 034° 31’ 24”E" as live text, so the dataset is read off
// the PDF rather than measured off the picture. scripts/extract-ats-waypoints.py rebuilds it.
const { test, expect } = require('./_setup');
const fs = require('fs');
const path = require('path');

const data = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'docs', 'data', 'ats-waypoints.json'), 'utf8'));
const points = data.waypoints;

test('every point has a five-letter designation and no name appears twice', () => {
  expect(Array.isArray(points)).toBe(true);
  expect(points.length).toBeGreaterThan(70);
  const names = points.map(p => p.name);
  expect(names).toEqual([...names].sort());          // stored sorted, so diffs stay readable
  expect(new Set(names).size).toBe(names.length);
  for (const p of points) expect(p.name).toMatch(/^[A-Z]{5}$/);
});

// The example this dataset was checked against: the chart prints VETEK at
// 32° 21’ 17”N 034° 31’ 24”E, which is 32.35472 / 34.52333 and nothing else.
test('a point reads exactly what the sheet prints', () => {
  const v = points.find(p => p.name === 'VETEK');
  expect(v).toBeTruthy();
  expect(v.lat).toBeCloseTo(32 + 21 / 60 + 17 / 3600, 5);
  expect(v.lng).toBeCloseTo(34 + 31 / 60 + 24 / 3600, 5);
});

// The sheet's own graticule, 33°30'–36°00' E and 29°30'–33°20' N. NOT the shipped raster's
// bounds, which are the tighter box both tick rows label: the sheet draws a little further
// west than that, and PIKOG (033°37'29"E) is genuinely out there on the paper.
test('every point lies inside the sheet it came from', () => {
  for (const p of points) {
    expect(p.lat).toBeGreaterThanOrEqual(29.5);
    expect(p.lat).toBeLessThanOrEqual(33 + 20 / 60);
    expect(p.lng).toBeGreaterThanOrEqual(33.5);
    expect(p.lng).toBeLessThanOrEqual(36.0);
  }
});

// Points the app already knows from the CVFR graph must agree with the ATS sheet where they
// are the same point. They are separate networks, so a difference is not a fault by itself --
// but a point that has drifted miles is a sign the pairing crossed two boxes.
test('names shared with the CVFR graph are in the same place', () => {
  const graph = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'docs', 'data', 'cvfr-route-graph.json'), 'utf8'));
  const nm = (a, b, c, d) => Math.hypot((a - c) * 60, (b - d) * 60 * Math.cos(a * Math.PI / 180));
  let shared = 0;
  for (const p of points) {
    const node = graph.nodes[p.name] || graph.nodes[p.name.toUpperCase()];
    if (!node) continue;
    shared++;
    expect(nm(p.lat, p.lng, node.lat, node.lng)).toBeLessThan(2);
  }
  expect(shared).toBeGreaterThan(0);
});

// A coordinate box next to a VOR or an aerodrome is that facility's position, and the label
// above it is whatever the chart draws there — the extractor drops those, and this is the
// check that none crept back in.
test('no point sits on a published facility', () => {
  const af = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'docs', 'data', 'airfields.json'), 'utf8'));
  const fields = af[Object.keys(af)[0]];
  const vor = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'docs', 'data', 'vor.json'), 'utf8'));
  const vors = vor.vors || (Array.isArray(vor) ? vor : []);
  const nm = (a, b, c, d) => Math.hypot((a - c) * 60, (b - d) * 60 * Math.cos(a * Math.PI / 180));
  for (const p of points) {
    for (const f of [...fields, ...vors]) {
      expect(nm(p.lat, p.lng, f.lat, f.lng)).toBeGreaterThanOrEqual(0.6);
    }
  }
});
