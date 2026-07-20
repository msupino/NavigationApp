// @ts-check
// Remote tuning config (gist) overrides the baked-in TUNE defaults at boot,
// and falls back silently to those defaults when the fetch fails.
const { test, expect } = require('./_setup');

// Anchored at both ends so it can only match the gist host + filename, never a
// look-alike host embedded elsewhere in a URL (CodeQL js/regex/missing-anchor).
const CONFIG_RE = /^https:\/\/gist\.githubusercontent\.com\/[^?#]*\/navaid-config\.json(?:[?#].*)?$/;

async function boot(page, query = '?lang=en') {
  await page.goto(query);
  await page.waitForFunction(
    () => typeof tune === 'function' && typeof loadRemoteConfig === 'function');
}

test('remote config overrides a baked-in tuning default', async ({ page }) => {
  // Serve a config that flips a couple of known keys to non-default values.
  await page.route(CONFIG_RE, route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ waypointStrokeWidthPx: 7, planCardBgColor: '#123456' }),
  }));
  await boot(page);
  // loadRemoteConfig fires on load; wait until it has applied.
  await page.waitForFunction(() => tune('waypointStrokeWidthPx') === 7);
  expect(await page.evaluate(() => tune('waypointStrokeWidthPx'))).toBe(7);
  expect(await page.evaluate(() => tune('planCardBgColor'))).toBe('#123456');
});

test('invalid / out-of-range remote values are rejected, defaults kept', async ({ page }) => {
  await page.route(CONFIG_RE, route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      waypointStrokeWidthPx: 9999,     // above max → clamped, not verbatim
      planCardBgColor: 'not-a-color',  // invalid → rejected
      bogusKeyNotInTune: 42,           // unknown → ignored
    }),
  }));
  await boot(page);
  await page.waitForTimeout(300);
  const v = await page.evaluate(() => tune('waypointStrokeWidthPx'));
  expect(v).toBeLessThanOrEqual(10);                       // clamped to spec.max
  // invalid colour rejected → baked-in default stands
  expect(await page.evaluate(() => tune('planCardBgColor'))).toBe('#ffffff');
});

test('tuning panel reflects the gist values once they load', async ({ page }) => {
  await page.route(CONFIG_RE, route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ waypointStrokeWidthPx: 7 }),
  }));
  await boot(page, '?lang=en&tune=1');                 // open the hidden tune panel
  // Panel is built synchronously with baked-in defaults; the gist lands async
  // and should push its value into the control.
  await expect(page.locator('#tune-waypointStrokeWidthPx-number')).toHaveValue('7.00');
  await expect(page.locator('#tune-subtitle')).toContainText('from gist');
});

test('gist can flip a default layer-visibility toggle on for a fresh visitor', async ({ page }) => {
  await page.route(CONFIG_RE, route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ defaultShowVor: true }),
  }));
  await boot(page);
  // Reconciliation runs in the gist .then(); the VOR checkbox should switch on
  // for a visitor who never set it, and the key stays unset so the gist keeps
  // controlling it next boot (rather than freezing after the first load).
  await expect.poll(() => page.evaluate(() => document.getElementById('vor-cb').checked)).toBe(true);
  expect(await page.evaluate(() => tune('defaultShowVor'))).toBe(true);
  expect(await page.evaluate(() => localStorage.getItem('navaid.showVorStations'))).toBeNull();
});

test('a user\'s explicit toggle choice wins over the gist default', async ({ page }) => {
  await page.addInitScript(() => {
    try { localStorage.setItem('navaid.showVorStations', '0'); } catch (e) { /* */ }
  });
  await page.route(CONFIG_RE, route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ defaultShowVor: true }),   // gist says on…
  }));
  await boot(page);
  await page.waitForTimeout(400);
  // …but the user explicitly set it off, so it stays off.
  expect(await page.evaluate(() => document.getElementById('vor-cb').checked)).toBe(false);
  expect(await page.evaluate(() => localStorage.getItem('navaid.showVorStations'))).toBe('0');
});

test('bool tune keys accept string and numeric truthy forms from the gist', async ({ page }) => {
  await page.route(CONFIG_RE, route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ defaultShowMsa: '1', defaultShowDrift: 0 }),
  }));
  await boot(page);
  await expect.poll(() => page.evaluate(() => tune('defaultShowMsa'))).toBe(true);
  expect(await page.evaluate(() => tune('defaultShowDrift'))).toBe(false);
});

test('fetch failure falls back to baked-in defaults', async ({ page }) => {
  await page.route(CONFIG_RE, route => route.abort());
  await boot(page);
  await page.waitForTimeout(300);
  // No override applied → tune() returns the baked-in spec default, whatever it is.
  const { got, def } = await page.evaluate(() => ({
    got: tune('waypointStrokeWidthPx'),
    def: NavAid.tuningDefaults.waypointStrokeWidthPx.value,
  }));
  expect(got).toBe(def);
});

test('?nogist skips the gist fetch and keeps baked-in defaults', async ({ page }) => {
  // Serve a valid override — but the param should stop us from ever fetching it.
  let fetched = false;
  await page.route(CONFIG_RE, route => { fetched = true; route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ waypointStrokeWidthPx: 7 }),
  }); });
  await boot(page, '?lang=en&nogist');
  await page.waitForTimeout(300);
  expect(fetched).toBe(false);                              // never requested
  const { got, def, disabled } = await page.evaluate(() => ({
    got: tune('waypointStrokeWidthPx'),
    def: NavAid.tuningDefaults.waypointStrokeWidthPx.value,
    disabled: NavAid.gistDisabled,
  }));
  expect(disabled).toBe(true);
  expect(got).toBe(def);                                    // override not applied
});

test('?gist=0 also skips the gist fetch', async ({ page }) => {
  let fetched = false;
  await page.route(CONFIG_RE, route => { fetched = true; route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ waypointStrokeWidthPx: 7 }),
  }); });
  await boot(page, '?lang=en&gist=0');
  await page.waitForTimeout(300);
  expect(fetched).toBe(false);
  expect(await page.evaluate(() => tune('waypointStrokeWidthPx')))
    .toBe(await page.evaluate(() => NavAid.tuningDefaults.waypointStrokeWidthPx.value));
});
