// @ts-check
// Regression coverage for PR #304 (deploy.yml): the single deploy sed pass
// must rewrite every cache-bust marker (index.html ?v=, core.js version:,
// JSON data-file ?v= literals, SW CACHE constant) to a common SHA.
//
// This is a unit-style test: we extract the sed lines from the workflow
// and run them against the actual source files, asserting that every
// marker we care about ends up rewritten. No browser needed.
const { test, expect } = require('./_setup');
const fs = require('fs');
const cp = require('child_process');
const path = require('path');

function deployYml() {
  return fs.readFileSync(
    path.join(__dirname, '..', '.github', 'workflows', 'deploy.yml'),
    'utf8');
}

function run(sed, file) {
  // macOS BSD sed: `-i` must be followed by a backup suffix; use `''` for
  // in-place with no backup. (`sed -i -E` wrongly treats `-E` as the suffix.)
  cp.execFileSync('sed', ['-i', '', '-E', sed, file]);
}

function tmpCopy(src) {
  const dst = path.join('/tmp', `navaid-test-${Date.now()}-${Math.random().toString(36).slice(2)}-${path.basename(src)}`);
  fs.copyFileSync(src, dst);
  return dst;
}

test.describe('#304 — deploy sed bumps every cache-bust marker', () => {
  test('deploy.yml contains the four rewrite patterns', async () => {
    const yml = deployYml();
    expect(yml).toMatch(/sed -i -E "s\/\\\?v=\[A-Za-z0-9\]\+\/\?v=/);
    expect(yml).toMatch(/version: '\\1-\$\{SHA[^}]*\}'/);
    expect(yml).toMatch(/nav-waypoints\|airfields/);
    expect(yml).toMatch(/const CACHE = 'navaid-/);
  });

  test('sed rewrites core.js data-file ?v= and version: to the target SHA', async () => {
    const file = tmpCopy(path.join(__dirname, '..', 'docs', 'core.js'));
    const SHA = 'abc1234';
    run(`s/version: '([0-9]+\\.[0-9]+)(-[A-Za-z0-9]+)?'/version: '\\1-${SHA}'/g`, file);
    run(`s/(nav-waypoints|airfields)\\.json\\?v=[A-Za-z0-9]+/\\1.json?v=${SHA}/g`, file);
    const out = fs.readFileSync(file, 'utf8');
    expect(out).toMatch(new RegExp(`version: '1\\.0-${SHA}'`));
    expect(out).toMatch(new RegExp(`nav-waypoints\\.json\\?v=${SHA}`));
    expect(out).toMatch(new RegExp(`airfields\\.json\\?v=${SHA}`));
    fs.unlinkSync(file);
  });

  test('sed rewrites he/strings.js data-file ?v= too', async () => {
    const file = tmpCopy(path.join(__dirname, '..', 'docs', 'he', 'strings.js'));
    const SHA = 'def5678';
    run(`s/(nav-waypoints|airfields)\\.json\\?v=[A-Za-z0-9]+/\\1.json?v=${SHA}/g`, file);
    const out = fs.readFileSync(file, 'utf8');
    expect(out).toMatch(new RegExp(`nav-waypoints\\.json\\?v=${SHA}`));
    expect(out).toMatch(new RegExp(`airfields\\.json\\?v=${SHA}`));
    fs.unlinkSync(file);
  });

  test('sed rewrites sw.js CACHE constant to navaid-<sha>', async () => {
    const file = tmpCopy(path.join(__dirname, '..', 'docs', 'sw.js'));
    const SHA = 'cafe9999';
    run(`s/const CACHE = 'navaid-[A-Za-z0-9_-]+'/const CACHE = 'navaid-${SHA}'/`, file);
    const out = fs.readFileSync(file, 'utf8');
    expect(out).toMatch(new RegExp(`const CACHE = 'navaid-${SHA}'`));
    fs.unlinkSync(file);
  });

  test('sed rewrites index.html ?v= globally', async () => {
    const file = tmpCopy(path.join(__dirname, '..', 'docs', 'index.html'));
    const SHA = 'deadbeef';
    run(`s/\\?v=[A-Za-z0-9]+/?v=${SHA}/g`, file);
    const out = fs.readFileSync(file, 'utf8');
    // Every remaining ?v= occurrence must carry the new SHA.
    const remaining = out.match(/\?v=[A-Za-z0-9]+/g) || [];
    expect(remaining.length).toBeGreaterThan(0);
    for (const m of remaining) expect(m).toBe(`?v=${SHA}`);
    fs.unlinkSync(file);
  });
});
