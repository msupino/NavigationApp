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

for (const [name, vp, deck] of [['desktop', { width: 1280, height: 900 }, '0'], ['phone', { width: 390, height: 800 }, '1']]) {
  test(`the legend stays upright on a turned map, and a tap opens the chart (${name})`, async ({ page }) => {
    await page.setViewportSize(vp);
    await boot(page);
    if (deck === '1') await page.goto('?lang=en&deck=1');
    await page.waitForFunction(() => document.getElementById('sigwx-ov-cb'));
    await page.evaluate(() => {
      document.getElementById('boot-loading')?.remove(); document.documentElement.classList.remove('app-booting');
      const cb = document.getElementById('sigwx-ov-cb'); if (!cb.checked) { cb.checked = true; cb.dispatchEvent(new Event('change')); }
    });
    await expect(page.locator('img.sigwx-ov-legend')).toHaveCount(2);
    // Put the legend on screen, north up, and measure it.
    // Which image is which by shape, not DOM order (the crops land in whichever order they
    // finish): the header is the thin strip, the table the tall block.
    const measure = () => page.evaluate(() => {
      const [hdr, tbl] = [...document.querySelectorAll('img.sigwx-ov-legend')]
        .sort((a, b) => a.offsetHeight - b.offsetHeight).map(e => e.getBoundingClientRect());
      return { w: Math.round(tbl.width), h: Math.round(tbl.height), gap: Math.round(tbl.top - hdr.bottom),
        hdrLeft: Math.round(hdr.left - tbl.left) };
    });
    await page.evaluate(() => {
      const el = [...document.querySelectorAll('img.sigwx-ov-legend')].sort((a, b) => b.offsetHeight - a.offsetHeight)[0];
      const lyr = Object.values(map._layers).find(l => l.getElement && l.getElement() === el);
      map.setView(lyr.getBounds().getCenter(), 8, { animate: false });
      map.setBearing(0);
    });
    const north = await measure();
    // Turned a quarter: the pane turns with the map, the legend must not.
    await page.evaluate(() => { map.setBearing(90); });
    const turned = await measure();
    expect(Math.abs(turned.w - north.w)).toBeLessThanOrEqual(2);
    expect(Math.abs(turned.h - north.h)).toBeLessThanOrEqual(2);
    expect(Math.abs(turned.gap - north.gap)).toBeLessThanOrEqual(2);     // header still directly above
    // ...and still after a zoom, which re-places the images.
    await page.evaluate(() => { map.setZoom(9, { animate: false }); });
    const zoomed = await page.evaluate(() => {
      const r = [...document.querySelectorAll('img.sigwx-ov-legend')].sort((a, b) => b.offsetHeight - a.offsetHeight)[0].getBoundingClientRect();
      return r.width / r.height;
    });
    expect(Math.abs(zoomed - north.w / north.h)).toBeLessThan(0.05);
    // A tap on it opens the viewer on the same chart.
    await page.evaluate(() => {
      // The menu the checkbox was ticked in stays open on desktop, over the map: put it away.
      if (typeof window.closeToolbarMenus === 'function') window.closeToolbarMenus();
      map.setBearing(0); map.setZoom(8, { animate: false });
      // Add-waypoint mode, as in the report: a tap that reached the map would drop a point.
      setMode('add');
    });
    const box = await page.evaluate(() => {
      const r = [...document.querySelectorAll('img.sigwx-ov-legend')].sort((a, b) => b.offsetHeight - a.offsetHeight)[0].getBoundingClientRect();
      const m = map.getContainer().getBoundingClientRect();
      // The middle of the part of the legend inside the map, and check nothing sits over it.
      const x = (Math.max(r.left, m.left) + Math.min(r.right, m.right)) / 2;
      const y = (Math.max(r.top, m.top) + Math.min(r.bottom, m.bottom)) / 2;
      return { x, y, hit: document.elementFromPoint(x, y).className };
    });
    expect(String(box.hit)).toContain('sigwx-ov-legend');
    await page.mouse.click(box.x, box.y);
    await expect(page.locator('.sigwx-modal')).toBeVisible();
    await expect(page.locator('.sigwx-modal .sigwx-time')).toHaveValue('0');
    // ...and only that: the tap does not reach the map and drop a waypoint under the legend.
    expect(await page.evaluate(() => state.waypoints.length)).toBe(0);
  });
}
