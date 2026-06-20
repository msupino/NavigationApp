// @ts-check
// Remote tuning config (gist) overrides the baked-in TUNE defaults at boot,
// and falls back silently to those defaults when the fetch fails.
const { test, expect } = require('./_setup');

// Anchored at both ends so it can only match the gist host + filename, never a
// look-alike host embedded elsewhere in a URL (CodeQL js/regex/missing-anchor).
const CONFIG_RE = /^https:\/\/gist\.githubusercontent\.com\/[^?#]*\/navaid-config\.json(?:[?#].*)?$/;

async function boot(page) {
  await page.goto('?lang=en');
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
