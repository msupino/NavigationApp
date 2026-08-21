// @ts-check
// An overlay plate is a ~700 KB scan and a layer is one per airfield, so on a phone over
// cellular the toggle is followed by seconds of nothing. The plate viewer says "Loading…"
// while it waits; the Extra layers said nothing at all, so the switch looked broken.
const { test, expect } = require('./_setup');

async function boot(page) {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof loadCircuitOverlays === 'function'
    && Array.isArray(window.airfields) && window.airfields.length > 0);
}

test('the marker shows while the plates are on the wire, and goes when they land', async ({ page }) => {
  // Hold the images until the test lets them through, so the "loading" state is observable.
  await page.route('**/circuit-img/*.png', async (route) => {
    await new Promise(r => setTimeout(r, 400));
    await route.continue();
  });
  await boot(page);
  const during = await page.evaluate(() => {
    showCircuit = true; loadCircuitOverlays(); circuitLayerGroup.addTo(map);
    const el = document.querySelector('.overlay-loading');
    return { count: overlayLoadingCount(), text: el.textContent, shown: el.classList.contains('show') };
  });
  expect(during.count).toBeGreaterThan(0);
  expect(during.text).toMatch(/loading/i);
  expect(during.shown).toBe(true);
  // ...and it goes by itself once the last plate is in.
  await expect(page.locator('.overlay-loading')).not.toHaveClass(/show/, { timeout: 15000 });
  expect(await page.evaluate(() => overlayLoadingCount())).toBe(0);
});

test('a plate that never arrives does not leave the marker up', async ({ page }) => {
  await page.route('**/circuit-img/*.png', route => route.abort());
  await boot(page);
  await page.evaluate(() => { showCircuit = true; loadCircuitOverlays(); circuitLayerGroup.addTo(map); });
  await expect(page.locator('.overlay-loading')).not.toHaveClass(/show/, { timeout: 15000 });
  expect(await page.evaluate(() => overlayLoadingCount())).toBe(0);
});

// It must not take input: the pilot carries on panning while the charts load.
test('the marker never takes a touch', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => { showCircuit = true; loadCircuitOverlays(); circuitLayerGroup.addTo(map); });
  const pe = await page.locator('.overlay-loading').evaluate(el => getComputedStyle(el).pointerEvents);
  expect(pe).toBe('none');
});

test('it follows the light theme', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => {
    document.body.classList.add('theme-light');
    showCircuit = true; loadCircuitOverlays(); circuitLayerGroup.addTo(map);
  });
  const lum = await page.locator('.overlay-loading').evaluate(el => {
    const m = getComputedStyle(el).backgroundColor.match(/\d+/g).map(Number);
    return (0.299 * m[0] + 0.587 * m[1] + 0.114 * m[2]) / 255;
  });
  expect(lum).toBeGreaterThan(0.8);
});

// The wait a pilot notices most is the FIRST one: app shell, Leaflet, then the chart tiles.
// Nothing of ours has run at that point, so the marker is written into the HTML and taken
// down once the map has something on it.
test.describe('the first load says it is loading', () => {
  test('the marker is in the HTML itself, before any script runs', async ({ page }) => {
    const html = await (await page.request.get('/index.html')).text();
    expect(html).toContain('id="boot-loading"');
    // Styled inline: the stylesheet has not arrived either.
    expect(html).toMatch(/id="boot-loading"[\s\S]{0,400}position:fixed/);
  });

  test('it goes once the map has painted', async ({ page }) => {
    await page.goto('?lang=en&nogist');
    await page.waitForFunction(() => typeof map !== 'undefined');
    await expect(page.locator('#boot-loading')).toHaveCount(0, { timeout: 15000 });
  });

  // A tile server that never answers must not leave the app looking dead when it is
  // perfectly usable offline.
  test('a chart that never loads still clears it', async ({ page }) => {
    await page.route('**/tiles/**', route => route.abort());
    await page.route('**/*.png', route => route.abort());
    await page.goto('?lang=en&nogist');
    await page.waitForFunction(() => typeof clearBootLoading === 'function');
    await expect(page.locator('#boot-loading')).toHaveCount(0, { timeout: 20000 });
  });
});
