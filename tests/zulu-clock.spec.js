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
      expect(box.y).toBeLessThan(40);
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
});
