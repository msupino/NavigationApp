// @ts-check
// NavAid does not call fpl.co.il, and must not start.
//
// The NOTAM this app draws come from brin.iaa.gov.il/MobileAeroinfo -- the national source,
// fetched by .github/workflows/notam.yml and published to the notam-data branch. Anyone
// re-serving that data from their own service is doing so under their own agreement with
// their provider, which does not extend to us: taking it from them would make this app the
// third party that agreement forbids.
//
// So the rule is simple and worth a test rather than a comment: nothing in what ships, and
// nothing in what builds it, reaches that host.
const fs = require('fs');
const path = require('path');
const { test, expect } = require('./_setup');

const root = path.join(__dirname, '..');
const FORBIDDEN = /fpl\.co\.il/i;

function filesUnder(dir, exts, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'www') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) filesUnder(full, exts, out);
    else if (exts.includes(path.extname(entry.name))) out.push(full);
  }
  return out;
}

test('nothing in the app, the scripts or the workflows names that service', () => {
  const searched = [
    ...filesUnder(path.join(root, 'docs', 'app'), ['.js']),
    ...filesUnder(path.join(root, 'docs', 'data'), ['.json']),
    ...filesUnder(path.join(root, 'scripts'), ['.js', '.mjs', '.py', '.sh']),
    ...filesUnder(path.join(root, '.github'), ['.yml', '.yaml', '.js', '.mjs']),
    ...filesUnder(path.join(root, 'tests'), ['.js']),
    path.join(root, 'docs', 'index.html'),
    path.join(root, 'docs', 'sw.js'),
  ];
  expect(searched.length).toBeGreaterThan(50);
  const hits = searched
    // This file names it in order to forbid it, which is the one legitimate mention.
    .filter((file) => path.basename(file) !== path.basename(__filename))
    .filter((file) => FORBIDDEN.test(fs.readFileSync(file, 'utf8')))
    .map((file) => path.relative(root, file));
  expect(hits, 'this app must not read from, or name, that service').toEqual([]);
});

// The NOTAM the app actually draws, and where they come from: the national source, through
// our own workflow, published to our own branch.
test('the NOTAM feed is the national source, fetched by us', () => {
  const workflow = fs.readFileSync(path.join(root, '.github/workflows/notam.yml'), 'utf8');
  expect(workflow).toContain('brin.iaa.gov.il/MobileAeroinfo');
  const draw = fs.readFileSync(path.join(root, 'docs/app/draw.js'), 'utf8');
  expect(draw).toContain('notam-data/notam.json');
});
