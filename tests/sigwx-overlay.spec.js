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
  // Two cropped overlays appear (map panel + the legend: title header over table, one image).
  const img = page.locator('img.sigwx-ov-layer');
  await expect(img).toHaveCount(2);
  await expect(img.first()).toHaveAttribute('src', /^data:image\/png/);
  // Persisted on; restored after reload.
  await page.reload();
  await page.waitForFunction(() => document.getElementById('sigwx-ov-cb'));
  await expect(page.locator('#sigwx-ov-cb')).toBeChecked();
  await expect(page.locator('img.sigwx-ov-layer')).toHaveCount(2);
});

test('no SIGWX times → overlay box stays hidden', async ({ page }) => {
  await boot(page, []);
  await page.waitForTimeout(400);
  await expect(page.locator('#sigwx-ov')).toBeHidden();
});

for (const [name, vp, deck] of [['desktop', { width: 1280, height: 900 }, '0'], ['phone', { width: 390, height: 800 }, '1']]) {
  test(`legend: one square, turned in quarter steps, never a popup (${name})`, async ({ page }) => {
    await page.setViewportSize(vp);
    await boot(page);
    if (deck === '1') await page.goto('?lang=en&deck=1');
    await page.waitForFunction(() => document.getElementById('sigwx-ov-cb'));
    await page.evaluate(() => {
      document.getElementById('boot-loading')?.remove(); document.documentElement.classList.remove('app-booting');
      const cb = document.getElementById('sigwx-ov-cb'); if (!cb.checked) { cb.checked = true; cb.dispatchEvent(new Event('change')); }
      if (typeof window.closeToolbarMenus === 'function') window.closeToolbarMenus();
    });
    const legend = page.locator('img.sigwx-ov-legend');
    await expect(legend).toHaveCount(1);                       // header and table are one image
    await page.waitForFunction(() => { const i = document.querySelector('img.sigwx-ov-legend'); return i && i.complete && i.naturalWidth > 0; });
    const shape = await legend.evaluate(e => ({ nw: e.naturalWidth, nh: e.naturalHeight }));
    expect(shape.nw).toBe(shape.nh);                           // square image
    const view = () => page.evaluate(() => {
      const el = document.querySelector('img.sigwx-ov-legend');
      const r = el.getBoundingClientRect();
      const m = /rotate\((-?[\d.]+)deg\)/.exec(el.style.transform);
      return { w: Math.round(r.width), h: Math.round(r.height), cx: Math.round(r.left + r.width / 2),
        cy: Math.round(r.top + r.height / 2), turn: m ? Number(m[1]) : 0 };
    });
    await page.evaluate(() => {
      const lyr = Object.values(map._layers).find(l => l.getElement && l.getElement() === document.querySelector('img.sigwx-ov-legend'));
      map.setView(lyr.getBounds().getCenter(), 8, { animate: false });
      map.setBearing(0);
    });
    const north = await view();
    expect(Math.abs(north.w - north.h)).toBeLessThanOrEqual(3);  // square on screen too
    // Up to 45 degrees it turns with the map; past that it steps back a quarter.
    const at = async b => { await page.evaluate(x => map.setBearing(x), b); return view(); };
    expect((await at(30)).turn).toBe(0);
    expect((await at(60)).turn).toBe(-90);
    const q = await at(90);
    expect(q.turn).toBe(-90);
    // A quarter turn back on a quarter-turned map: the same square, where it was on screen.
    expect(Math.abs(q.w - north.w)).toBeLessThanOrEqual(3);
    expect(Math.abs(q.h - north.h)).toBeLessThanOrEqual(3);
    expect((await at(180)).turn).toBe(-180);
    // ...and it holds through a zoom, which re-places the image.
    await page.evaluate(() => { map.setBearing(90); map.setZoom(9, { animate: false }); });
    expect((await view()).turn).toBe(-90);
    // No popup, no fold-away button.
    await expect(page.locator('.sigwx-legend-chip')).toHaveCount(0);
    expect(await legend.evaluate(e => e.classList.contains('leaflet-interactive'))).toBe(false);
  });
}

test('the legend sits at its tunable place: top 33N, west 36E, and every setting moves it', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => { const cb = document.getElementById('sigwx-ov-cb'); if (!cb.checked) { cb.checked = true; cb.dispatchEvent(new Event('change')); } });
  await page.waitForFunction(() => { const i = document.querySelector('img.sigwx-ov-legend'); return i && i.complete && i.naturalWidth > 0; });
  const bounds = () => page.evaluate(() => {
    const el = document.querySelector('img.sigwx-ov-legend');
    const b = Object.values(map._layers).find(l => l.getElement && l.getElement() === el).getBounds();
    return { n: +b.getNorth().toFixed(2), w: +b.getWest().toFixed(2), e: +b.getEast().toFixed(2), s: +b.getSouth().toFixed(2),
      nw: el.naturalWidth, nh: el.naturalHeight };
  });
  const def = await bounds();
  expect(def).toMatchObject({ n: 33, w: 36, e: 39.5 });
  // The old table offsets (the live gist sets one) no longer move it.
  await page.evaluate(async () => { setTune('sigwxTblLngOffset', -0.48); setTune('sigwxTblLatOffset', 1); redrawAfterTune(); await new Promise(r => setTimeout(r, 500)); });
  expect(await bounds()).toMatchObject({ n: 33, w: 36, e: 39.5 });
  expect(def.nw).toBe(def.nh);
  // Tuned: moved, wider, not a square, and turning in 45-degree steps.
  const tuned = await page.evaluate(async () => {
    setTune('sigwxLegendTopLat', 32.5); setTune('sigwxLegendWestLng', 36.9); setTune('sigwxLegendWidthDeg', 4);
    setTune('sigwxLegendSquare', false); setTune('sigwxLegendStepDeg', 45);
    redrawAfterTune();
    await new Promise(r => setTimeout(r, 600));
    map.setBearing(50);
    const el = document.querySelector('img.sigwx-ov-legend');
    return { turn: (/rotate\((-?[\d.]+)deg\)/.exec(el.style.transform) || [0, 0])[1] };
  });
  const moved = await bounds();
  expect(moved).toMatchObject({ n: 32.5, w: 36.9, e: 40.9 });
  expect(moved.nh).not.toBe(moved.nw);                  // as tall as its content
  expect(Number(tuned.turn)).toBe(-45);                  // 50 degrees rounds to one 45-degree step
});
