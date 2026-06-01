// @ts-check
// Hidden developer tuning panel (?tune=1): session-only controls that preview
// drawing constants without writing persistence keys.
const { test, expect } = require('./_setup');

async function boot(page, url = '?lang=en&tune=1') {
  await page.addInitScript(() => {
    try {
      localStorage.clear();
      sessionStorage.clear();
    } catch (e) {}
  });
  await page.goto(url);
  await page.waitForFunction(() => typeof state !== 'undefined' && typeof draw === 'function');
}

async function captureDrift(page) {
  return page.evaluate(() => {
    const dashCalls = [];
    const segments = [];
    const realSave = octx.save.bind(octx);
    const realRestore = octx.restore.bind(octx);
    const realSetLineDash = octx.setLineDash.bind(octx);
    const realBeginPath = octx.beginPath.bind(octx);
    const realMoveTo = octx.moveTo.bind(octx);
    const realLineTo = octx.lineTo.bind(octx);
    const realStroke = octx.stroke.bind(octx);
    let last = null;
    octx.save = function () {};
    octx.restore = function () {};
    octx.setLineDash = function (dash) { dashCalls.push(Array.from(dash)); };
    octx.beginPath = function () { last = null; };
    octx.moveTo = function (x, y) { last = { x, y }; };
    octx.lineTo = function (x, y) {
      if (last) segments.push(Math.hypot(x - last.x, y - last.y));
      last = { x, y };
    };
    octx.stroke = function () {};
    drawDriftLines({ x: 0, y: 0 }, { x: 100, y: 0 });
    octx.save = realSave;
    octx.restore = realRestore;
    octx.setLineDash = realSetLineDash;
    octx.beginPath = realBeginPath;
    octx.moveTo = realMoveTo;
    octx.lineTo = realLineTo;
    octx.stroke = realStroke;
    return { dash: dashCalls[0], segments, value: tune('driftDashOnPx') };
  });
}

test.describe('Hidden tuning panel', () => {
  test('is hidden unless the tune query flag is present', async ({ page }) => {
    await boot(page, '?lang=en');
    await expect(page.locator('#tuning-panel')).toHaveCount(0);
  });

  test('opens with ?tune=1 and preserves the flag when lang is added', async ({ page }) => {
    await boot(page, '?tune=1');
    await expect(page.locator('#tuning-panel')).toBeVisible();
    const params = new URL(page.url()).searchParams;
    expect(params.get('tune')).toBe('1');
    expect(params.get('lang')).toBe('en');
  });

  test('drift dash controls redraw without changing endpoint length', async ({ page }) => {
    await boot(page);
    await page.locator('#tune-driftDashOnPx-number').fill('24');

    const out = await captureDrift(page);
    expect(out.value).toBe(24);
    expect(out.dash).toEqual([24, 8]);
    expect(out.segments).toHaveLength(2);
    expect(out.segments[0]).toBeCloseTo(50, 5);
    expect(out.segments[1]).toBeCloseTo(50, 5);

    await page.locator('#tune-driftDashOnPx-reset').click();
    const reset = await captureDrift(page);
    expect(reset.value).toBe(12);
    expect(reset.dash).toEqual([12, 8]);
  });

  test('preview values reset on reload and do not add persistence keys', async ({ page }) => {
    await boot(page);
    await page.locator('#tune-routeLineWidthPx-number').fill('9');
    expect(await page.evaluate(() => tune('routeLineWidthPx'))).toBe(9);
    expect(await page.evaluate(() =>
      Object.keys(localStorage).filter(k => k.indexOf('navaid.tune') === 0)
    )).toEqual([]);

    await page.reload();
    await page.waitForFunction(() => typeof state !== 'undefined' && typeof tune === 'function');
    expect(await page.evaluate(() => tune('routeLineWidthPx'))).toBe(3.5);
    await expect(page.locator('#tune-routeLineWidthPx-number')).toHaveValue('3.5');
  });
});
