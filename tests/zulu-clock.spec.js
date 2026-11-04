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
  test('renders a live UTC clock, fixed above the coordinates, left of the zoom buttons', async ({ page }) => {
    await boot(page);
    const clock = page.locator('#zulu-clock');
    await expect(clock).toBeVisible();
    await expect(clock).toHaveAttribute('dir', 'ltr');
    await expect(clock).toHaveAttribute('aria-label', 'Zulu time (UTC)');
    await expect(clock).toHaveText(/^\d{2}:\d{2}:\d{2}Z$/);
    await expect(clock).toHaveClass(/zulu-fixed/);

    const pos = await page.evaluate(() => {
      const c = document.getElementById('zulu-clock').getBoundingClientRect();
      const z = document.querySelector('.leaflet-control-zoom').getBoundingClientRect();
      return { right: c.right, bottom: c.bottom, zoomLeft: z.left, vh: window.innerHeight,
        corner: document.getElementById('zulu-clock').parentNode.className };
    });
    expect(pos.corner).toContain('leaflet-bottom leaflet-right');
    expect(pos.right).toBeLessThanOrEqual(pos.zoomLeft);          // left of the zoom buttons
    expect(pos.bottom).toBeGreaterThan(pos.vh - 120);             // down by the coordinates

    const initial = await clock.textContent();
    await expect.poll(() => clock.textContent(), { timeout: 2500 }).not.toBe(initial);
  });

  test('fixed: always above the VOR line, still when it comes and goes, and cannot be dragged', async ({ page }) => {
    await boot(page);
    const place = (show) => page.evaluate((show) => {
      for (const [id, on, txt] of [['vor-readout', show, 'BGN 045\u00b0 12.3 NM']]) {
        const el = document.getElementById(id); el.textContent = txt; el.classList.toggle('show', on);
      }
      for (const sel of ['.wind-readout', '.sigmet-readout']) {
        const el = document.querySelector(sel); if (el) { el.textContent = 'X'; el.classList.toggle('show', show); }
      }
      const c = document.getElementById('zulu-clock').getBoundingClientRect();
      const hit = (sel) => { const el = document.querySelector(sel); if (!el || !el.classList.contains('show')) return false;
        const b = el.getBoundingClientRect(); return c.left < b.right && b.left < c.right && c.top < b.bottom && b.top < c.bottom; };
      return { top: Math.round(c.top), vorTop: Math.round(document.getElementById('vor-readout').getBoundingClientRect().top),
        covers: ['.vor-readout', '.wind-readout', '.sigmet-readout'].filter(hit) };
    }, show);
    const off = await place(false);
    const on = await place(true);
    expect(on.top).toBe(off.top);                         // does not move with the VOR line
    expect(on.covers).toEqual([]);                        // and nothing lands on it
    expect(on.top).toBeLessThan(on.vorTop);               // above the VOR line
    const clock = page.locator('#zulu-clock');
    const before = await clock.boundingBox();
    if (!before) throw new Error('no box');
    await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2);
    await page.mouse.down();
    await page.mouse.move(before.x - 200, before.y - 220, { steps: 6 });
    await page.mouse.up();
    const after = await clock.boundingBox();
    expect(after && Math.abs(after.x - before.x)).toBeLessThan(2);
  });

  test('a clock spot dragged before is dropped once, on every device', async ({ page }) => {
    await page.addInitScript(() => {
      if (!sessionStorage.getItem('__seeded')) {
        sessionStorage.setItem('__seeded', '1');
        localStorage.setItem('navaid.clockPos.en', JSON.stringify({ x: 300, y: 300 }));
        localStorage.removeItem('navaid.clockPosReset');
      }
    });
    await boot(page);
    expect(await page.evaluate(() => [localStorage.getItem('navaid.clockPos.en'), localStorage.getItem('navaid.clockPosReset')]))
      .toEqual([null, '1']);
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
    // The draggable clock's corner (gist zuluClockMovable): the inspector must start below it.
    await page.evaluate(() => { NavAid.tuning.zuluClockMovable = true; window.refreshZuluClockPlacement(); });
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
    // Draggable only when the gist says so (zuluClockMovable); the gist answers after boot, on the
    // reload too. Fresh context starts with empty localStorage.
    await page.route('https://gist.githubusercontent.com/**', r => r.fulfill({
      status: 200, contentType: 'application/json', body: JSON.stringify({ zuluClockMovable: true }) }));
    await boot(page);
    await page.waitForFunction(() => !document.getElementById('zulu-clock').classList.contains('zulu-fixed'));
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
      typeof map !== 'undefined' && document.getElementById('zulu-clock') !== null
      && !document.getElementById('zulu-clock').classList.contains('zulu-fixed'));
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
