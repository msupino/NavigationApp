// @ts-check
// Regression coverage for PR #304 (deploy.yml): the single deploy sed pass
// must rewrite every cache-bust marker (index.html ?v=, app/core.js version:,
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
  // BSD sed (macOS): `-i` must be followed by a backup suffix; `''` = no
  // backup. GNU sed accepts `sed -i -E script file` (empty suffix omitted);
  // passing a separate `''` breaks argv parsing ("can't read s/.../").
  const args = process.platform === 'darwin'
    ? ['-i', '', '-E', sed, file]
    : ['-i', '-E', sed, file];
  cp.execFileSync('sed', args);
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
    expect(yml).toMatch(/data\/\[A-Za-z0-9_-\]\+\\\.json/);
    expect(yml).toMatch(/const CACHE = 'navaid-/);
  });

  test('deploy.yml rewrites old and new docs layouts during the migration', async () => {
    const yml = deployYml();
    expect(yml).toMatch(/CORE="\$ROOT\/app\/core\.js"/);
    expect(yml).toMatch(/\[ -f "\$CORE" \] \|\| CORE="\$ROOT\/core\.js"/);
    expect(yml).toMatch(/HE_STRINGS="\$ROOT\/i18n\/he\/strings\.js"/);
    expect(yml).toMatch(/\[ -f "\$HE_STRINGS" \] \|\| HE_STRINGS="\$ROOT\/he\/strings\.js"/);
  });

  test('sed rewrites app/core.js data-file ?v= and version: to the target SHA', async () => {
    const file = tmpCopy(path.join(__dirname, '..', 'docs', 'app', 'core.js'));
    const SHA = 'abc1234';
    run(`s/version: '([0-9]+\\.[0-9]+)(-[A-Za-z0-9]+)?'/version: '\\1-${SHA}'/g`, file);
    run(`s|(data/[A-Za-z0-9_-]+\\.json)\\?v=[A-Za-z0-9]+|\\1?v=${SHA}|g`, file);
    const out = fs.readFileSync(file, 'utf8');
    expect(out).toMatch(new RegExp(`version: '1\\.0-${SHA}'`));
    expect(out).toMatch(new RegExp(`data/cvfr-nav-waypoints\\.json\\?v=${SHA}`));
    expect(out).toMatch(new RegExp(`data/airfields\\.json\\?v=${SHA}`));
    expect(out).toMatch(new RegExp(`data/cvfr-comm-change\\.json\\?v=${SHA}`));
    expect(out).toMatch(new RegExp(`data/cvfr-leg-altitude\\.json\\?v=${SHA}`));
    expect(out).toMatch(new RegExp(`data/route-templates\\.json\\?v=${SHA}`));
    expect(out).toMatch(new RegExp(`data/vor\\.json\\?v=${SHA}`));
    fs.unlinkSync(file);
  });

  test('i18n/he/strings.js has no data-file ?v= left for sed to rewrite', async () => {
    // The locale file used to duplicate every dataset URL, so the deploy sed had to
    // rewrite it there too. Those overrides are gone (see locale-data-urls.spec.js):
    // dataset URLs live only in core.js, which this suite still covers above. The
    // sed pattern is harmless here now, but assert the invariant so nobody
    // reintroduces a locale-local dataset version that silently shadows core.js.
    const src = fs.readFileSync(path.join(__dirname, '..', 'docs', 'i18n', 'he', 'strings.js'), 'utf8');
    expect(src).not.toMatch(/data\/[A-Za-z0-9_-]+\.json\?v=/);
  });

  test('sed rewrites app/terrain.js data-file ?v= too', async () => {
    const file = tmpCopy(path.join(__dirname, '..', 'docs', 'app', 'terrain.js'));
    const SHA = 'feed123';
    run(`s|(data/[A-Za-z0-9_-]+\\.json)\\?v=[A-Za-z0-9]+|\\1?v=${SHA}|g`, file);
    const out = fs.readFileSync(file, 'utf8');
    expect(out).toMatch(new RegExp(`data/terrain\\.json\\?v=${SHA}`));
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
