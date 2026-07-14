// @ts-check
// IMS PWX wind/temperature chart overlay. The control is hidden until the
// ims-data manifest loads; once it does, toggling it on adds a georeferenced
// image overlay to the map at the manifest's bounds.
const { test, expect } = require('./_setup');

const MANIFEST_RE = /ims-data\/ims\/pwx\.json/;
const PNG_RE = /ims-data\/ims\/pwx\/.*\.png/;

// 1x1 transparent PNG.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMCAYAAAB7P3qAAAAAAElFTkSuQmCC',
  'base64');

const MANIFEST = {
  generatedAt: '2026-06-21T09:00:00Z',
  run: '202606210912',
  bounds: { s: 29.88, n: 33.82, w: 33.31, e: 36.69 },
  levels: [
    { level: '50', label: 'FL180', times: [
      { valid: '12:00', day: '21/06/2026', png: 'ims/pwx/50/1200.png' },
      { valid: '18:00', day: '21/06/2026', png: 'ims/pwx/50/1800.png' },
    ] },
    { level: '90', label: 'FL030', times: [
      { valid: '12:00', day: '21/06/2026', png: 'ims/pwx/90/1200.png' },
      { valid: '18:00', day: '21/06/2026', png: 'ims/pwx/90/1800.png' },
    ] },
  ],
};

async function boot(page, { withManifest } = { withManifest: true }) {
  await page.route(PNG_RE, r => r.fulfill({ status: 200, contentType: 'image/png', body: PNG }));
  // Keep the shared #wx-time dropdown deterministic — the SIGWX feed also
  // populates it, so stub it out in this PWX-focused spec.
  await page.route(/ims-data\/ims\/sigwx\.json/, r => r.fulfill({ status: 404, body: '' }));
  await page.route(/ims-data\/ims\/sigwx\.json/, r => r.fulfill({ status: 404, body: '' }));
  await page.route(MANIFEST_RE, r => withManifest
    ? r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MANIFEST) })
    : r.fulfill({ status: 404, body: '' }));
  // Keep the "view" toolbar section expanded so the control is interactable.
  await page.addInitScript(() => { try { localStorage.setItem('navaid.sec.weather', '1'); } catch (e) {} });
  await page.goto('?lang=en');
  await page.waitForFunction(() => typeof map !== 'undefined' && document.getElementById('ims-pwx'));
}

test('control stays hidden when no ims-data manifest exists', async ({ page }) => {
  await boot(page, { withManifest: false });
  await page.waitForTimeout(400);
  await expect(page.locator('#ims-pwx')).toBeHidden();
});

test('manifest reveals the control and populates levels', async ({ page }) => {
  await boot(page);
  await expect(page.locator('#ims-pwx')).toBeVisible();
  const levels = await page.locator('#ims-pwx-level option').allTextContents();
  expect(levels).toEqual(['FL030', 'FL180']);   // lowest altitude first (default)
  // Times follow the selected level.
  const times = await page.locator('#wx-time option').allTextContents();
  expect(times.length).toBe(2);
  expect(times[0]).toContain('12:00');
  // Model run time (from the chart filename) shown in the control.
  await expect(page.locator('#ims-pwx-run')).toContainText('21/06 09:12Z');
});

test('toggling on adds a georeferenced image overlay at the manifest bounds', async ({ page }) => {
  await boot(page);
  await expect(page.locator('#ims-pwx-controls')).toBeHidden();
  await page.locator('#ims-pwx-cb').check();
  await expect(page.locator('#ims-pwx-controls')).toBeVisible();
  // Leaflet renders an <img class="leaflet-image-layer"> in the overlay pane.
  const img = page.locator('.leaflet-overlay-pane img.leaflet-image-layer');
  await expect(img).toHaveCount(1);
  await expect(img).toHaveAttribute('src', /ims\/pwx\/90\//);   // default FL030 (time auto-set to nearest now)
  // Toggling off removes it.
  await page.locator('#ims-pwx-cb').uncheck();
  await expect(page.locator('.leaflet-overlay-pane img.leaflet-image-layer')).toHaveCount(0);
});

test('changing the level keeps the selected valid time', async ({ page }) => {
  await boot(page);
  await page.locator('#ims-pwx-cb').check();
  await page.locator('#wx-time').selectOption('18:00');   // pick a non-default period
  await page.locator('#ims-pwx-level').selectOption('50');      // switch FL (FL180 also has 18:00)
  expect(await page.locator('#wx-time').inputValue()).toBe('18:00');
  await expect(page.locator('.leaflet-overlay-pane img.leaflet-image-layer'))
    .toHaveAttribute('src', /ims\/pwx\/50\/1800\.png/);
});

test('overlay on/off + selection persists across reload', async ({ page }) => {
  await boot(page);
  await page.locator('#ims-pwx-cb').check();
  await page.locator('#ims-pwx-level').selectOption('50');
  await page.locator('#wx-time').selectOption('18:00');
  await expect(page.locator('.leaflet-overlay-pane img.leaflet-image-layer')).toHaveCount(1);
  await page.reload();
  await page.waitForFunction(() => document.getElementById('ims-pwx') && !document.getElementById('ims-pwx').hidden);
  // Restored: toggle on, same level/time, overlay re-added.
  await expect(page.locator('#ims-pwx-cb')).toBeChecked();
  expect(await page.locator('#ims-pwx-level').inputValue()).toBe('50');
  expect(await page.locator('#wx-time').inputValue()).toBe('18:00');
  await expect(page.locator('.leaflet-overlay-pane img.leaflet-image-layer'))
    .toHaveAttribute('src', /ims\/pwx\/50\/1800\.png/);
});

test('lat/lng tune offset nudges the overlay bounds', async ({ page }) => {
  await boot(page);
  await page.locator('#ims-pwx-cb').check();
  const shifted = await page.evaluate(() => {
    const layer = () => { let f = null; map.eachLayer(l => { if (l.getBounds && l._url) f = l; }); return f; };
    // Pin a zero baseline — the baked-in default offset is non-zero, so
    // resetTune would leave it offset and the measured delta would be wrong.
    setTune('imsPwxLatOffset', 0);
    NavAid.refreshImsPwx();
    const before = layer().getBounds().getSouth();
    setTune('imsPwxLatOffset', 0.1);
    NavAid.refreshImsPwx();
    return { before, after: layer().getBounds().getSouth() };
  });
  expect(shifted.after - shifted.before).toBeCloseTo(0.1, 3);
});

test('lat/lng tune scale zooms the overlay bounds', async ({ page }) => {
  await boot(page);
  await page.locator('#ims-pwx-cb').check();
  const r = await page.evaluate(() => {
    const layer = () => { let f = null; map.eachLayer(l => { if (l.getBounds && l._url) f = l; }); return f; };
    const span = () => { const b = layer().getBounds(); return b.getNorth() - b.getSouth(); };
    // Pin scale=1 — the baked-in default is non-unity, so resetTune would
    // leave it scaled and the measured ratio would be wrong.
    setTune('imsPwxLatScale', 1);
    NavAid.refreshImsPwx();
    const before = span();
    setTune('imsPwxLatScale', 1.1);
    NavAid.refreshImsPwx();
    return { before, after: span() };
  });
  expect(r.after / r.before).toBeCloseTo(1.1, 2);   // span scaled ~10%
});

test('dark mode plates only the footer band (gradient), not the whole image', async ({ page }) => {
  await page.addInitScript(() => { try { localStorage.setItem('navaid.theme', 'dark'); } catch (e) {} });
  await boot(page);                                   // force dark (default is now light)
  await page.locator('#ims-pwx-cb').check();
  const bgi = await page.locator('.leaflet-overlay-pane img.leaflet-image-layer')
    .evaluate(el => getComputedStyle(el).backgroundImage);
  expect(bgi).toContain('linear-gradient');           // a bottom band, not a full fill
  expect(bgi).toMatch(/rgba\(255,\s*255,\s*255/);     // white footer plate
});

test('light mode leaves the overlay backdrop off', async ({ page }) => {
  await page.addInitScript(() => { try { localStorage.setItem('navaid.theme', 'light'); } catch (e) {} });
  await boot(page);
  await page.locator('#ims-pwx-cb').check();
  const bgi = await page.locator('.leaflet-overlay-pane img.leaflet-image-layer')
    .evaluate(el => getComputedStyle(el).backgroundImage);
  expect(bgi).toBe('none');                           // light map suffices
});

test('imsPwxDarkBackdropAlpha=0 disables the backdrop', async ({ page }) => {
  await boot(page);
  await page.locator('#ims-pwx-cb').check();
  const bgi = await page.evaluate(() => {
    setTune('imsPwxDarkBackdropAlpha', 0);
    applyTuningCssVars();
    return getComputedStyle(document.querySelector('.leaflet-image-layer')).backgroundImage;
  });
  expect(bgi).toBe('none');                           // off
});

test('rotation tune rotates the overlay image', async ({ page }) => {
  await boot(page);
  await page.locator('#ims-pwx-cb').check();
  const t = await page.evaluate(() => {
    setTune('imsPwxRotationDeg', 5);
    NavAid.refreshImsPwx();
    return document.querySelector('.leaflet-overlay-pane img.leaflet-image-layer').style.transform;
  });
  expect(t).toMatch(/rotate\(5deg\)/);
});

test('opacity reset restores the default opacity', async ({ page }) => {
  await boot(page);
  await page.locator('#ims-pwx-cb').check();
  const r = await page.evaluate(() => {
    const s = document.getElementById('wx-opacity');
    const def = s.value;
    s.value = '0.3'; s.dispatchEvent(new Event('input'));
    const mid = document.querySelector('.leaflet-overlay-pane img.leaflet-image-layer').style.opacity;
    const midLabel = document.getElementById('wx-opacity-val').textContent;
    document.getElementById('wx-opacity-reset').click();
    return { def, after: s.value,
      midOp: parseFloat(mid), midLabel,
      resetLabel: document.getElementById('wx-opacity-val').textContent,
      resetOp: parseFloat(document.querySelector('.leaflet-overlay-pane img.leaflet-image-layer').style.opacity) };
  });
  expect(r.midOp).toBeCloseTo(0.3, 2);        // slider drove the overlay
  expect(r.midLabel).toBe('30%');             // value shown as percent
  expect(r.after).toBe(r.def);                // reset restored the slider
  expect(r.resetLabel).toBe(Math.round(parseFloat(r.def) * 100) + '%');
  expect(r.resetOp).toBeCloseTo(parseFloat(r.def), 2);  // and the overlay
});
