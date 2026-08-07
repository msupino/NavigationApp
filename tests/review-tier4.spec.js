// @ts-check
// Fourth batch from the whole-codebase review: the data feeds must not present partial data as
// complete, must not report success when they published nothing, and a missing CDN script must
// not leave a working-looking app over a blank chart.
const { test, expect } = require('./_setup');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');

// --- the WX feed needs COVERAGE, not just one station -------------------------------
async function feeds() {
  return import('../scripts/build-aviation-feeds.mjs');
}

test('a collapsed station list is not published as fresh weather', async () => {
  const { wxPublishable, WX_MIN_COVERAGE } = await feeds();
  const ids = ['LLBG', 'LLER', 'LLHA', 'LLHZ', 'LLIB'];
  const stations = n => Object.fromEntries(ids.slice(0, n).map(id => [id, {}]));
  // Coverage is judged against what the feed NORMALLY carries -- the last-good file -- not
  // against the workflow's requested id list. Judging against the request froze the feed the
  // moment the gate shipped: IDS asks for 13 Israeli stations, but only these five ever file
  // METAR/TAF with AWC, so the 60% bar (8 of 13) was unreachable and every run skipped.
  const ok = (n, baseline) => wxPublishable({ metarsOk: true, tafsOk: true,
    stations: stations(n), baseline });
  // A collapse against the established baseline is still withheld: one station out of a
  // normal five is a truncated response, not the weather, and publishing it would blank the
  // rest under a current generatedAt that the staleness monitor reads as healthy.
  expect(ok(1, 5)).toBe(false);
  const need = Math.ceil(5 * WX_MIN_COVERAGE);
  expect(ok(need - 1, 5)).toBe(false);
  expect(ok(need, 5)).toBe(true);
  // The normal day: exactly what the feed has always carried, published.
  expect(ok(5, 5)).toBe(true);
  // A half-answered pair is never publishable, whatever the coverage.
  expect(wxPublishable({ metarsOk: false, tafsOk: true, stations: stations(5), baseline: 5 })).toBe(false);
  expect(wxPublishable({ metarsOk: true, tafsOk: false, stations: stations(5), baseline: 5 })).toBe(false);
  // No baseline yet (first run, unreadable branch) -> any data publishes, as before the gate.
  expect(wxPublishable({ metarsOk: true, tafsOk: true, stations: stations(1) })).toBe(true);
  expect(wxPublishable({ metarsOk: true, tafsOk: true, stations: {}, baseline: 0 })).toBe(false);
  // The gate must never demand more than the world supplies: the live five-station reality
  // has to clear a bar computed from itself.
  expect(ok(5, 5)).toBe(true);
});

test('a feed that publishes nothing exits non-zero', async () => {
  const { buildAviationFeeds } = await feeds();
  const written = {};
  const prevExit = process.exitCode;
  const warnings = [];
  await buildAviationFeeds({
    firs: ['LLLL'], ids: ['LLBG', 'LLHZ'], bbox: { s: 28, n: 35, w: 32, e: 38 },
    fetchImpl: async () => ({ ok: false, status: 503, json: async () => ({}) }),
    write: (f, b) => { written[f] = b; },
    log: () => {}, warn: (...a) => warnings.push(a.join(' ')),
  });
  expect(written).toEqual({});
  // A green check with an empty annotations panel is indistinguishable from a run that
  // published both feeds -- that is how SIGWX sat frozen for ~9 h (#1429).
  expect(process.exitCode).toBe(1);
  expect(warnings.join('\n')).toMatch(/::error::/);
  process.exitCode = prevExit;                                    // do not fail this run
});

test('a preserved IMS category is announced, and two preserved is an error', async () => {
  const { reportStatus } = await import('../scripts/finalize-ims-manifests.mjs');
  const said = [];
  const realErr = console.error;
  console.error = (...a) => said.push(a.join(' '));
  try {
    const oneStuck = reportStatus({ pwx: { status: 'preserved', expected: 5, actual: 4 },
      sigwx: { status: 'updated', expected: 5, actual: 5 } });
    const bothStuck = reportStatus({ pwx: { status: 'preserved', expected: 5, actual: 4 },
      sigwx: { status: 'preserved', expected: 5, actual: 3 } });
    console.error = realErr;
    expect(oneStuck).toBe(false);
    expect(bothStuck).toBe(true);
  } finally { console.error = realErr; }
  const out = said.join('\n');
  expect(out).toMatch(/::warning::PWX kept its last-good/);
  expect(out).toMatch(/::error::Neither chart category advanced/);
});

// --- the NOTAM feed must not publish half a list as complete ------------------------
test('the NOTAM feed demands near-complete detail and records its coverage', () => {
  const yml = read('.github/workflows/notam.yml');
  // At the old 0.5 a Radware throttle that let the list through but blocked half the detail
  // pages published a HALF list under a fresh generatedAt, with the missing NOTAMs -- possibly
  // a route closure or an active danger area -- indistinguishable from "no NOTAM there".
  expect(yml).not.toMatch(/uniq\.length \* 0\.5/);
  expect(yml).toMatch(/Math\.ceil\(uniq\.length \* 0\.9\)/);
  // Coverage travels with the payload, so a consumer can tell a full list from a clipped one.
  expect(yml).toContain('out.detailOk = detailOk;');
  expect(yml).toContain('out.detailTotal = uniq.length;');
  // Publishing nothing is loud, and not a green check.
  expect(yml).toMatch(/::error::Not publishing/);
  expect(yml).toContain('process.exitCode = 1;');
});

test('every scheduled publisher declares its token scope and a concurrency group', () => {
  const YAML = require('yaml');
  for (const rel of ['.github/workflows/notam.yml', '.github/workflows/aviation-data.yml',
    '.github/workflows/ims-charts.yml']) {
    const doc = YAML.parse(read(rel));
    // notam.yml was the only one with neither: its token took the repository default scopes,
    // and two overlapping runs could force-push the data branch in either order.
    expect(doc.permissions, rel).toEqual({ contents: 'write' });
    expect(doc.concurrency, rel).toBeTruthy();
    expect(doc.concurrency.group, rel).toBeTruthy();
  }
});

// --- a missing CDN script must be visible ------------------------------------------
test('a blocked CDN dependency shows an error instead of a blank chart', async ({ page }) => {
  // Exactly the first-load condition where the service worker has nothing cached yet.
  // Anchored at the scheme and host: an unanchored /unpkg\.com/ also matches a URL that
  // merely CONTAINS that text (https://evil.example/unpkg.com/leaflet@1.9.4/...), so the
  // matcher would block more than the dependency it names.
  await page.route(/^https:\/\/unpkg\.com\/leaflet@1\.9\.4\//, r => r.abort());
  const consoleErrors = [];
  page.on('pageerror', e => consoleErrors.push(String(e.message)));
  await page.goto('?lang=en&nogist');
  const alert = page.locator('#boot-error');
  await expect(alert).toBeVisible();
  await expect(alert).toContainText(/could not load/i);
  // A plain substring, not a URL pattern -- this asserts the message names the host.
  await expect(alert).toContainText('unpkg.com');
  // The toolbar used to render completely over an empty grey map with nothing said.
  expect(await alert.getAttribute('role')).toBe('alert');
});

test('a normal load shows no boot error', async ({ page }) => {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof map !== 'undefined');
  await expect(page.locator('#boot-error')).toHaveCount(0);
});

// --- the dependency my own workflow test relies on -------------------------------
test('yaml is a declared dependency, not a transitive accident', () => {
  const pkg = JSON.parse(read('package.json'));
  // tests/workflow-hardening.spec.js and this file require('yaml'). It resolved only because
  // cspell happens to depend on it, so a cspell bump could have broken the suite with
  // MODULE_NOT_FOUND -- in a spec whose whole job is guarding the workflows.
  expect(pkg.devDependencies).toHaveProperty('yaml');
  const lock = JSON.parse(read('package-lock.json'));
  expect(Object.keys(lock.packages || {})).toContain('node_modules/yaml');
});
