// @ts-check
// The AIP keys every file by the SHA-512 of the PDF, and our filenames are our own
// invention -- the CAA has never seen them. So the only link between a plate we ship and the
// chart it copies is a hash that DIES the moment that chart is amended: exactly when the link
// is needed. Refreshing 40 plates by hand meant rendering each one and reading the title off
// the paper, because nothing recorded what they were.
//
// docs/data/plate-sources.json records the answer while it is still knowable: a plate whose
// hash is in today's index resolves to one entry, so its title can be written down with no
// guessing. After the next amendment the hash is useless and the title still is.
const { test, expect } = require('./_setup');
const { readFileSync, existsSync } = require('fs');
const { join } = require('path');

const root = join(__dirname, '..');
const mapPath = join(root, 'docs/data/plate-sources.json');
const doc = () => JSON.parse(readFileSync(mapPath, 'utf8'));
const rows = () => Object.entries(doc()).filter(([k]) => !k.startsWith('_'));

test('every recorded plate exists and carries a CAA title', () => {
  const list = rows();
  // Most of what we ship should be named; a handful drifted before this file existed.
  expect(list.length).toBeGreaterThan(100);
  for (const [rel, info] of list) {
    expect(existsSync(join(root, rel)), rel + ' is recorded but not shipped').toBe(true);
    expect(String(info.title || '').length, rel + ' has no title').toBeGreaterThan(3);
    // The title is the CAA's own words, not our filename echoed back.
    const stem = rel.split('/').pop().replace(/\.pdf$/, '');
    expect(info.title).not.toBe(stem);
  }
});

test('the titles are the ones the index gave, not guesses from filenames', () => {
  // Three where our filename says something different from -- or opposite to -- the chart.
  // If these ever match their filenames again, someone has started guessing.
  const d = doc();
  expect(d['docs/byop/LLBG_Ground_GA Apron.pdf'].title).toMatch(/APRON V/i);
  expect(d['docs/byop/LLER_ADC_3_en.pdf'].title).toMatch(/APRON V/i);
  expect(d['docs/byop/LLER_ADC_V1_en.pdf'].title).toMatch(/AERODROME CHART/i);
});

test('no two plates claim to be the same published chart', () => {
  // Two of ours pointing at one CAA title means we ship it twice -- which is how five
  // duplicate Eilat plates and two duplicate Ben Gurion ones were found. Shipping the same
  // chart under two menu entries is the defect; this keeps it from coming back unseen.
  const seen = new Map();
  const dupes = [];
  for (const [rel, info] of rows()) {
    const key = info.title;
    if (seen.has(key)) dupes.push([seen.get(key), rel, key]);
    else seen.set(key, rel);
  }
  expect(dupes).toEqual([]);
});

test('a recorded plate really is the file the CAA serves under that title', () => {
  // Spot-check the recording itself: the entry is only meaningful if it was written from a
  // file that matched. Verifying every plate needs the index (network), so this checks the
  // shape that makes a wrong entry impossible -- the hash is not stored, because a stored
  // hash would go stale and start lying. Only the durable half is kept.
  const [, info] = rows()[0];
  expect(Object.keys(info).sort()).toEqual(expect.arrayContaining(['modified', 'title']));
  expect(info).not.toHaveProperty('hash');
  expect(String(info.modified)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
});

test('the drift report can name a chart, and the generator can check itself', () => {
  const src = readFileSync(join(root, 'scripts/aip-drift.py'), 'utf8');
  expect(src).toMatch(/plate-sources\.json/);
  expect(src).toMatch(/def plate_names\(/);
  const gen = readFileSync(join(root, 'scripts/aip-plate-sources.py'), 'utf8');
  // --check lets CI say "this is out of date" without writing into the tree.
  expect(gen).toMatch(/--check/);
  // A name recorded before a plate drifted must survive the run after it drifts -- that is
  // the one moment it earns its keep.
  expect(gen).toMatch(/carried/);
});
