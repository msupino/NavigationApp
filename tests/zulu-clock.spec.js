// @ts-check
// Zulu/UTC clock map control.
const { test, expect } = require('./_setup');

async function boot(page, lang = 'en') {
  await page.goto(`?lang=${lang}`);
  await page.waitForFunction(() =>
    typeof map !== 'undefined' &&
    typeof window.formatZuluClockTime === 'function' &&
    document.getElementById('zulu-clock') !== null);
}

test.describe('Zulu clock', () => {
  test('renders a live UTC clock in the top-right corner', async ({ page }) => {
    await boot(page);
    const clock = page.locator('#zulu-clock');
    await expect(clock).toBeVisible();
    await expect(clock).toHaveAttribute('dir', 'ltr');
    await expect(clock).toHaveAttribute('aria-label', 'Zulu time (UTC)');
    await expect(clock).toHaveText(/^\d{2}:\d{2}:\d{2}Z$/);

    const box = await clock.boundingBox();
    const viewport = page.viewportSize();
    expect(box).not.toBeNull();
    expect(viewport).not.toBeNull();
    if (box && viewport) {
      expect(box.x + box.width).toBeGreaterThan(viewport.width - 24);
      // Top-right, but dropped below the floating desktop menu bar (~46px).
      expect(box.y).toBeLessThan(80);
    }

    const initial = await clock.textContent();
    await expect.poll(() => clock.textContent(), { timeout: 2500 }).not.toBe(initial);
  });

  test('formats Zulu time from UTC fields, independent of page direction', async ({ page }) => {
    await boot(page, 'he');
    const result = await page.evaluate(() => ({
      htmlDir: document.documentElement.dir,
      clockDir: document.getElementById('zulu-clock').dir,
      fixed: window.formatZuluClockTime(new Date(Date.UTC(2026, 5, 15, 4, 3, 2))),
    }));
    expect(result.htmlDir).toBe('rtl');
    expect(result.clockDir).toBe('ltr');
    expect(result.fixed).toBe('04:03:02Z');
  });

  test('fresh inspector default sits below the clock', async ({ page }) => {
    await page.addInitScript(() => {
      try { localStorage.removeItem('navaid.inspPos'); } catch (e) {}
    });
    await boot(page, 'he');
    await page.evaluate(() => {
      state.waypoints = [{ lat: 32.18, lng: 34.81, name: 'BAZRA' }];
      state.selected = { type: 'wp', index: 0 };
      showInspector();
    });

    const boxes = await page.evaluate(() => {
      const clock = document.getElementById('zulu-clock').getBoundingClientRect();
      const inspector = document.getElementById('inspector').getBoundingClientRect();
      return {
        clockBottom: clock.bottom,
        inspectorTop: inspector.top,
      };
    });
    expect(boxes.inspectorTop).toBeGreaterThanOrEqual(boxes.clockBottom + 12);
  });

  test('the clock can be dragged and the position persists across reload', async ({ page }) => {
    // Fresh context starts with empty localStorage — don't clear via
    // addInitScript (that would also wipe the saved pos on the reload below).
    await boot(page);
    const clock = page.locator('#zulu-clock');
    const before = await clock.boundingBox();
    if (!before) throw new Error('no box');

    await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2);
    await page.mouse.down();
    await page.mouse.move(before.x - 200, before.y + 220, { steps: 6 });
    await page.mouse.up();

    const after = await clock.boundingBox();
    if (!after) throw new Error('no box');
    expect(after.x).toBeLessThan(before.x - 100);
    expect(after.y).toBeGreaterThan(before.y + 120);
    const stored = await page.evaluate(() => localStorage.getItem('navaid.clockPos.en'));
    expect(stored).toBeTruthy();

    await page.reload();
    await page.waitForFunction(() =>
      typeof map !== 'undefined' && document.getElementById('zulu-clock') !== null);
    const reloaded = await clock.boundingBox();
    if (!reloaded) throw new Error('no box');
    expect(Math.abs(reloaded.x - after.x)).toBeLessThan(3);
    expect(Math.abs(reloaded.y - after.y)).toBeLessThan(3);
  });

  test('the legend can be dragged and the position persists across reload', async ({ page }) => {
    await boot(page);
    const legend = page.locator('#map-legend');
    await expect(legend).toBeVisible();
    const before = await legend.boundingBox();
    if (!before) throw new Error('no box');

    await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2);
    await page.mouse.down();
    await page.mouse.move(before.x + 260, before.y - 200, { steps: 6 });
    await page.mouse.up();

    const after = await legend.boundingBox();
    if (!after) throw new Error('no box');
    expect(after.x).toBeGreaterThan(before.x + 140);
    expect(after.y).toBeLessThan(before.y - 100);
    expect(await page.evaluate(() => localStorage.getItem('navaid.legendPos.en'))).toBeTruthy();

    await page.reload();
    await page.waitForFunction(() =>
      typeof map !== 'undefined' && document.getElementById('map-legend') !== null);
    const reloaded = await legend.boundingBox();
    if (!reloaded) throw new Error('no box');
    expect(Math.abs(reloaded.x - after.x)).toBeLessThan(3);
    expect(Math.abs(reloaded.y - after.y)).toBeLessThan(3);
  });

  test('a dragged widget is clamped fully inside the viewport', async ({ page }) => {
    await boot(page);
    const clock = page.locator('#zulu-clock');
    const cb = await clock.boundingBox();
    if (!cb) throw new Error('no box');
    // Drag far past the bottom-right corner.
    await page.mouse.move(cb.x + cb.width / 2, cb.y + cb.height / 2);
    await page.mouse.down();
    await page.mouse.move(5000, 5000, { steps: 8 });
    await page.mouse.up();
    const after = await clock.boundingBox();
    const vp = page.viewportSize();
    if (!after || !vp) throw new Error('no box');
    expect(after.x).toBeGreaterThanOrEqual(-1);
    expect(after.y).toBeGreaterThanOrEqual(-1);
    expect(after.x + after.width).toBeLessThanOrEqual(vp.width + 1);
    expect(after.y + after.height).toBeLessThanOrEqual(vp.height + 1);
  });
});
