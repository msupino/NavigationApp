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

// Time-relative manifest: NEAR is the current hour (the overlay defaults to the
// chart nearest "now"), FAR is +6h. Two levels, each carrying both times.
const z = n => String(n).padStart(2, '0');
const NEAR = new Date(Math.floor(Date.now() / 3600e3) * 3600e3);
const FAR = new Date(NEAR.getTime() + 6 * 3600e3);
const hhmm = d => z(d.getUTCHours()) + z(d.getUTCMinutes());
const valid = d => z(d.getUTCHours()) + ':' + z(d.getUTCMinutes());
const dmy = d => z(d.getUTCDate()) + '/' + z(d.getUTCMonth() + 1) + '/' + d.getUTCFullYear();
const label = d => valid(d) + 'Z (' + dmy(d) + ')';
const lvlTimes = code => [
  { valid: valid(NEAR), day: dmy(NEAR), png: `ims/pwx/${code}/${hhmm(NEAR)}.png` },
  { valid: valid(FAR), day: dmy(FAR), png: `ims/pwx/${code}/${hhmm(FAR)}.png` },
];
const MANIFEST = {
  generatedAt: '2026-06-21T09:00:00Z',
  run: '202606210912',
  bounds: { s: 29.88, n: 33.82, w: 33.31, e: 36.69 },
  levels: [
    { level: '50', label: 'FL180', times: lvlTimes('50') },
    { level: '90', label: 'FL030', times: lvlTimes('90') },
  ],
};

async function boot(page, { withManifest } = { withManifest: true }) {
  await page.route(PNG_RE, r => r.fulfill({ status: 200, contentType: 'image/png', body: PNG }));
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
  const times = await page.locator('#ims-pwx-time option').allTextContents();
  expect(times.length).toBe(2);
  expect(times[0]).toContain(valid(NEAR));         // chronological: NEAR first
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
  await expect(img).toHaveAttribute('src', new RegExp('ims/pwx/90/' + hhmm(NEAR) + '\\.png'));   // default FL030, nearest now
  // Toggling off removes it.
  await page.locator('#ims-pwx-cb').uncheck();
  await expect(page.locator('.leaflet-overlay-pane img.leaflet-image-layer')).toHaveCount(0);
});

test('history: same valid time on different days are distinct; default is nearest now', async ({ page }) => {
  // A past chart and a near chart that share the SAME valid HH:MM but differ by
  // day — they must produce two separate options, and the overlay must default
  // to the near one, not the 24h-old collision.
  const past = new Date(NEAR.getTime() - 24 * 3600e3);   // same HH:MM, yesterday
  const hist = {
    ...MANIFEST,
    levels: [{ level: '90', label: 'FL030', times: [
      { valid: valid(past), day: dmy(past), png: `ims/pwx/90/${hhmm(past)}-old.png` },
      { valid: valid(NEAR), day: dmy(NEAR), png: `ims/pwx/90/${hhmm(NEAR)}.png` },
    ] }],
  };
  await page.route(PNG_RE, r => r.fulfill({ status: 200, contentType: 'image/png', body: PNG }));
  await page.route(MANIFEST_RE, r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(hist) }));
  await page.addInitScript(() => { try { localStorage.setItem('navaid.sec.weather', '1'); } catch (e) {} });
  await page.goto('?lang=en');
  await page.waitForFunction(() => typeof map !== 'undefined' && document.getElementById('ims-pwx'));
  await expect(page.locator('#ims-pwx-time option')).toHaveCount(2);   // not collapsed to 1
  await page.locator('#ims-pwx-cb').check();
  // Defaults to the near chart, not the 24h-old one.
  await expect(page.locator('.leaflet-overlay-pane img.leaflet-image-layer'))
    .toHaveAttribute('src', new RegExp('ims/pwx/90/' + hhmm(NEAR) + '\\.png'));
});

test('changing the level keeps the selected valid time', async ({ page }) => {
  await boot(page);
  await page.locator('#ims-pwx-cb').check();
  await page.locator('#ims-pwx-time').selectOption({ label: label(FAR) });   // non-default period
  await page.locator('#ims-pwx-level').selectOption('50');                    // switch FL (FL180 also has it)
  expect(await page.locator('#ims-pwx-time').inputValue()).toBe(valid(FAR) + '|' + dmy(FAR));
  await expect(page.locator('.leaflet-overlay-pane img.leaflet-image-layer'))
    .toHaveAttribute('src', new RegExp('ims/pwx/50/' + hhmm(FAR) + '\\.png'));
});

test('overlay on/off + selection persists across reload', async ({ page }) => {
  await boot(page);
  await page.locator('#ims-pwx-cb').check();
  await page.locator('#ims-pwx-level').selectOption('50');
  await page.locator('#ims-pwx-time').selectOption({ label: label(FAR) });
  await expect(page.locator('.leaflet-overlay-pane img.leaflet-image-layer')).toHaveCount(1);
  await page.reload();
  await page.waitForFunction(() => document.getElementById('ims-pwx') && !document.getElementById('ims-pwx').hidden);
  // Restored: toggle on, same level/time, overlay re-added.
  await expect(page.locator('#ims-pwx-cb')).toBeChecked();
  expect(await page.locator('#ims-pwx-level').inputValue()).toBe('50');
  expect(await page.locator('#ims-pwx-time').inputValue()).toBe(valid(FAR) + '|' + dmy(FAR));
  await expect(page.locator('.leaflet-overlay-pane img.leaflet-image-layer'))
    .toHaveAttribute('src', new RegExp('ims/pwx/50/' + hhmm(FAR) + '\\.png'));
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

test('dark mode gives the overlay a translucent white backdrop', async ({ page }) => {
  await boot(page);                                   // default (dark) theme
  await page.locator('#ims-pwx-cb').check();
  const bg = await page.locator('.leaflet-overlay-pane img.leaflet-image-layer')
    .evaluate(el => getComputedStyle(el).backgroundColor);
  expect(bg).toBe('rgba(255, 255, 255, 0.5)');        // restores footer contrast
});

test('light mode leaves the overlay backdrop transparent', async ({ page }) => {
  await page.addInitScript(() => { try { localStorage.setItem('navaid.theme', 'light'); } catch (e) {} });
  await boot(page);
  await page.locator('#ims-pwx-cb').check();
  const bg = await page.locator('.leaflet-overlay-pane img.leaflet-image-layer')
    .evaluate(el => getComputedStyle(el).backgroundColor);
  expect(bg).toBe('rgba(0, 0, 0, 0)');                // transparent — light map suffices
});

test('imsPwxDarkBackdropAlpha=0 disables the backdrop', async ({ page }) => {
  await boot(page);
  await page.locator('#ims-pwx-cb').check();
  const bg = await page.evaluate(() => {
    setTune('imsPwxDarkBackdropAlpha', 0);
    applyTuningCssVars();
    return getComputedStyle(document.querySelector('.leaflet-image-layer')).backgroundColor;
  });
  expect(bg).toMatch(/,\s*0\)$/);                     // alpha 0 → fully off
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
    const s = document.getElementById('ims-pwx-opacity');
    const def = s.value;
    s.value = '0.3'; s.dispatchEvent(new Event('input'));
    const mid = document.querySelector('.leaflet-overlay-pane img.leaflet-image-layer').style.opacity;
    const midLabel = document.getElementById('ims-pwx-opacity-val').textContent;
    document.getElementById('ims-pwx-opacity-reset').click();
    return { def, after: s.value,
      midOp: parseFloat(mid), midLabel,
      resetLabel: document.getElementById('ims-pwx-opacity-val').textContent,
      resetOp: parseFloat(document.querySelector('.leaflet-overlay-pane img.leaflet-image-layer').style.opacity) };
  });
  expect(r.midOp).toBeCloseTo(0.3, 2);        // slider drove the overlay
  expect(r.midLabel).toBe('30%');             // value shown as percent
  expect(r.after).toBe(r.def);                // reset restored the slider
  expect(r.resetLabel).toBe(Math.round(parseFloat(r.def) * 100) + '%');
  expect(r.resetOp).toBeCloseTo(parseFloat(r.def), 2);  // and the overlay
});
