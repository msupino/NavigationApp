// @ts-check
// Some plates we ship are not the CAA's file byte-for-byte -- LLAR's CVFR chart is theirs
// rotated to portrait, because the georeferenced overlay corners were fitted against that
// orientation. Such a plate can never hash-match the index, so it sat in the drift report on
// every run for ever, under a guessed cause ("aerodrome withdrawn?") that was not true: the
// AIP carries three Arad annexes and two of ours match them today.
//
// docs/data/plate-derived.json records what each such plate was derived FROM. The question
// for those becomes "is the file we reworked still the published one", and the dangerous
// answer is the lenient one -- a map that says "ours is fine" after the source has been
// amended would hide a stale chart behind our own edit. That is the property tested hardest
// here.
const { test, expect } = require('./_setup');
const { readFileSync, existsSync } = require('fs');
const { join } = require('path');
const { execFileSync } = require('child_process');

const root = join(__dirname, '..');
const mapPath = join(root, 'docs/data/plate-derived.json');
const derived = () => JSON.parse(readFileSync(mapPath, 'utf8'));
const entries = () => Object.entries(derived()).filter(([k]) => !k.startsWith('_'));

test('the classifier keeps a reworked plate honest when its source is amended away', () => {
  // scripts/aip-drift.py --selftest exercises classify() offline: no index fetch, no network.
  const out = execFileSync('python3', [join(root, 'scripts/aip-drift.py'), '--selftest'],
    { encoding: 'utf8', cwd: root });
  expect(out).toContain('derived, source published        -> reworked');
  // The load-bearing case: the moment the CAA amends the file we reworked, ours is stale
  // again and must say so.
  expect(out).toContain('derived, source amended away     -> drifted');
  expect(out).not.toMatch(/^FAIL/m);
});

test('every derived plate names a real file and a real upstream hash', () => {
  const rows = entries();
  expect(rows.length).toBeGreaterThan(0);
  for (const [rel, info] of rows) {
    expect(existsSync(join(root, rel)), rel + ' is listed but not shipped').toBe(true);
    // The index keys every file by SHA-512 of the PDF: 128 hex characters, nothing else.
    expect(info.source, rel + ' has no source hash').toMatch(/^[0-9a-f]{128}$/);
    // A hash with no explanation is a hash nobody can check later.
    expect(String(info.transform || '').length, rel + ' does not say what was done to it')
      .toBeGreaterThan(10);
  }
});

test('a derived plate is not simply the upstream file under another name', () => {
  // If ours were byte-identical to the source it would hash-match on its own and belong in
  // neither this map nor the drift report. An entry here means a real transform.
  const { createHash } = require('crypto');
  for (const [rel, info] of entries()) {
    const own = createHash('sha512').update(readFileSync(join(root, rel))).digest('hex');
    expect(own, rel + ' is identical to its recorded source; drop it from the map')
      .not.toBe(info.source);
  }
});

test('the script reads the map rather than carrying the exception in code', () => {
  const src = readFileSync(join(root, 'scripts/aip-drift.py'), 'utf8');
  expect(src).toMatch(/plate-derived\.json/);
  expect(src).toMatch(/def classify\(/);
  // And it no longer states an aerodrome is withdrawn when the index plainly carries files
  // for it -- that guess is what nearly got a published Arad chart deleted.
  expect(src).toMatch(/published per file, no single pack/);
});
