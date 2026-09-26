// @ts-check
// SIGWX significant-weather MAP overlay: crops the IMS low-level prog-chart map
// panel and overlays it on the map (georeferenced like PWX), toggle + time +
// opacity. Hidden until the sigwx manifest loads.
const { test, expect } = require('./_setup');

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAMgAAACWCAIAAAAUvlBOAAABlklEQVR4nO3UsQ0AIBADsYfJGZ0luALJHiDVKWvOwHP7/SQIi4jHIiEsEsIiISwSwiIhLBLCIiEsEsIiISwSwiIhLBLCIiEsEsIiISwSwiIhLBLCIiEsEsIiISwSwiIhLBLCIiEsEsIiISwSwiIhLBLCIiEsEsIiISwSwiIhLBLCIiEsEsIiISwSwiIhLBLCIiEsEsIiISwSwiIhLBLCIiEsEsIiISwSwiIhLBLCIiEsEsIiISwSwiIhLBLCIiEsEsIiISwSwiIhLBLCIiEsEsIiISwSwiIhLBLCIiEsEsIiISwSwiIhLBLCIiEsEsIiISwSwiIhLBLCIiEsEsIiISwSwiIhLBLCIiEsEsIiISwSwiIhLBLCIiEsEsIiISwSwiIhLBLCIiEsEsIiISyExT88FglhkRAWCWGREBYJYZEQFglhkRAWCWGREBYJYZEQFglhkRAWCWGREBYJYZEQFglhkRAWCWGREBYJYZEQFglhkRAWCWGREBYJYZEQFglhkRAWCWGREBYJYZEQFglhkRAWCWExhQve2wGshbOUjwAAAABJRU5ErkJggg==';

async function boot(page, times) {
  await page.route(/ims-data\/ims\/pwx\.json/, r => r.fulfill({ status: 404, body: '' }));
  await page.route(/ims-data\/ims\/sigwx\.json/, r => r.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ generatedAt: '2026-06-24T04:00:00Z', source: 'x',
      times: times || [{ valid: '12:00', day: '24/06/2026', png: 'ims/sigwx/1200.png' }] }),
  }));
  // Serve the chart PNG with CORS so the client-side crop canvas isn't tainted.
  await page.route(/ims-data\/ims\/sigwx\/.*\.png/, r => r.fulfill({
    status: 200, contentType: 'image/png',
    headers: { 'access-control-allow-origin': '*' },
    body: Buffer.from(PNG, 'base64'),
  }));
  await page.addInitScript(() => { try { localStorage.setItem('navaid.sec.weather', '1'); } catch (e) {} });
  await page.goto('?lang=en');
  await page.waitForFunction(() => typeof map !== 'undefined' && document.getElementById('sigwx-ov-cb'));
}

test('SIGWX overlay box reveals when the manifest loads', async ({ page }) => {
  await boot(page);
  await expect(page.locator('#sigwx-ov')).toBeVisible();
  await expect(page.locator('#sigwx-ov-controls')).toBeHidden();
  // Time dropdown is populated from the manifest.
  await expect(page.locator('#wx-time option')).toHaveCount(1);
});

test('toggling adds a cropped image overlay; persists across reload', async ({ page }) => {
  await boot(page);
  await page.locator('#sigwx-ov-cb').check();
  // Three cropped overlays appear (map panel + table + title header), data: URLs.
  const img = page.locator('img.sigwx-ov-layer');
  await expect(img).toHaveCount(3);
  await expect(img.first()).toHaveAttribute('src', /^data:image\/png/);
  // Persisted on; restored after reload.
  await page.reload();
  await page.waitForFunction(() => document.getElementById('sigwx-ov-cb'));
  await expect(page.locator('#sigwx-ov-cb')).toBeChecked();
  await expect(page.locator('img.sigwx-ov-layer')).toHaveCount(3);
});

test('no SIGWX times → overlay box stays hidden', async ({ page }) => {
  await boot(page, []);
  await page.waitForTimeout(400);
  await expect(page.locator('#sigwx-ov')).toBeHidden();
});

const legendSorted = `[...document.querySelectorAll('img.sigwx-ov-legend')].sort((a, b) => a.offsetHeight - b.offsetHeight)`;

for (const [name, vp, deck] of [['desktop', { width: 1280, height: 900 }, '0'], ['phone', { width: 390, height: 800 }, '1']]) {
  test(`legend: level on a slightly turned map, folded into a button past 10 degrees (${name})`, async ({ page }) => {
    await page.setViewportSize(vp);
    await boot(page);
    if (deck === '1') await page.goto('?lang=en&deck=1');
    await page.waitForFunction(() => document.getElementById('sigwx-ov-cb'));
    await page.evaluate(() => {
      document.getElementById('boot-loading')?.remove(); document.documentElement.classList.remove('app-booting');
      const cb = document.getElementById('sigwx-ov-cb'); if (!cb.checked) { cb.checked = true; cb.dispatchEvent(new Event('change')); }
      if (typeof window.closeToolbarMenus === 'function') window.closeToolbarMenus();
    });
    await expect(page.locator('img.sigwx-ov-legend')).toHaveCount(2);
    const measure = () => page.evaluate((expr) => {
      const [hdr, tbl] = eval(expr).map(e => e.getBoundingClientRect());
      return { w: Math.round(tbl.width), h: Math.round(tbl.height), gap: Math.round(tbl.top - hdr.bottom) };
    }, legendSorted);
    await page.evaluate((expr) => {
      const el = eval(expr)[1];
      const lyr = Object.values(map._layers).find(l => l.getElement && l.getElement() === el);
      map.setView(lyr.getBounds().getCenter(), 8, { animate: false });
      map.setBearing(0);
    }, legendSorted);
    const north = await measure();
    // A few degrees: still on the map, still level, header still on the table.
    await page.evaluate(() => { map.setBearing(5); });
    const slight = await measure();
    expect(Math.abs(slight.w - north.w)).toBeLessThanOrEqual(2);
    expect(Math.abs(slight.h - north.h)).toBeLessThanOrEqual(2);
    expect(Math.abs(slight.gap - north.gap)).toBeLessThanOrEqual(2);
    await expect(page.locator('.sigwx-legend-chip')).toHaveCount(0);
    // Turned past 10 degrees: the legend folds away, a button takes its place...
    await page.evaluate(() => { map.setBearing(75); setMode('add'); });
    expect(await page.evaluate((expr) => eval(expr).map(e => getComputedStyle(e).visibility), legendSorted))
      .toEqual(['hidden', 'hidden']);
    const chip = page.locator('.sigwx-legend-chip');
    await expect(chip).toBeVisible();
    // ...which opens the chart, and goes no further than that.
    await chip.click();
    await expect(page.locator('.sigwx-modal')).toBeVisible();
    await expect(page.locator('.sigwx-modal .sigwx-time')).toHaveValue('0');
    expect(await page.evaluate(() => state.waypoints.length)).toBe(0);
    // North up again: the legend is back on the map and the button gone.
    await page.keyboard.press('Escape');
    await page.evaluate(() => { setMode(null); map.setBearing(0); });
    await expect(chip).toHaveCount(0);
    expect(await page.evaluate((expr) => eval(expr).map(e => getComputedStyle(e).visibility), legendSorted))
      .toEqual(['visible', 'visible']);
  });

  test(`a tap on the legend opens the chart and adds no waypoint (${name})`, async ({ page }) => {
    await page.setViewportSize(vp);
    await boot(page);
    if (deck === '1') await page.goto('?lang=en&deck=1');
    await page.waitForFunction(() => document.getElementById('sigwx-ov-cb'));
    await page.evaluate(() => {
      document.getElementById('boot-loading')?.remove(); document.documentElement.classList.remove('app-booting');
      const cb = document.getElementById('sigwx-ov-cb'); if (!cb.checked) { cb.checked = true; cb.dispatchEvent(new Event('change')); }
      if (typeof window.closeToolbarMenus === 'function') window.closeToolbarMenus();
    });
    await expect(page.locator('img.sigwx-ov-legend')).toHaveCount(2);
    const box = await page.evaluate((expr) => {
      const el = eval(expr)[1];
      const lyr = Object.values(map._layers).find(l => l.getElement && l.getElement() === el);
      map.setView(lyr.getBounds().getCenter(), 8, { animate: false });
      map.setBearing(0);
      setMode('add');
      const r = el.getBoundingClientRect(), m = map.getContainer().getBoundingClientRect();
      const x = (Math.max(r.left, m.left) + Math.min(r.right, m.right)) / 2;
      const y = (Math.max(r.top, m.top) + Math.min(r.bottom, m.bottom)) / 2;
      return { x, y, hit: String(document.elementFromPoint(x, y).className) };
    }, legendSorted);
    expect(box.hit).toContain('sigwx-ov-legend');
    await page.mouse.click(box.x, box.y);
    await expect(page.locator('.sigwx-modal')).toBeVisible();
    expect(await page.evaluate(() => state.waypoints.length)).toBe(0);
  });
}
