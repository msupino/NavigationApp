// @ts-check
// The IMS chart overlays (wind/temp PWX, significant weather SIGWX) fetch big PNGs — a
// quarter to half a megabyte, seconds on a phone link, and SIGWX then crops three panels on
// canvas before anything paints. Until this banner they gave no sign of doing anything, on
// enable OR on a valid-time change: the map simply sat unchanged.
const { test, expect } = require('./_setup');

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMCAYAAAB7P3qAAAAAAElFTkSuQmCC',
  'base64');
const BOUNDS = { s: 29.88, n: 33.82, w: 33.31, e: 36.69 };
const PWX = {
  generatedAt: '2026-09-01T12:00:00Z', bounds: BOUNDS,
  levels: [{ level: '90', label: 'FL030', times: [
    { valid: '12:00', day: '01/09/2026', png: 'ims/pwx/90/a.png' },
    { valid: '15:00', day: '01/09/2026', png: 'ims/pwx/90/b.png' },
  ] }],
};
const SIGWX = {
  generatedAt: '2026-09-01T12:00:00Z', times: [
    { valid: '12:00', day: '01/09/2026', png: 'ims/sigwx/a.png' },
    { valid: '15:00', day: '01/09/2026', png: 'ims/sigwx/b.png' },
  ],
};

// Serve the manifests immediately but hold the PNGs, so the "loading" window is observable.
async function serve(page, release) {
  await page.route(/ims-data\/ims\/pwx\.json/, r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(PWX) }));
  await page.route(/ims-data\/ims\/sigwx\.json/, r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(SIGWX) }));
  await page.route(/ims-data\/ims\/.*\.png/, async r => {
    await release();                                  // gate: resolves when the test allows
    r.fulfill({ status: 200, contentType: 'image/png', body: PNG });
  });
  await page.addInitScript(() => {
    for (const s of ['build', 'view', 'display', 'charts', 'export', 'print', 'weather'])
      try { localStorage.setItem('navaid.sec.' + s, '1'); } catch (e) {}
  });
  await page.goto('?lang=en&nogist');
}

// The overlays live in the floating "Extra layers" (data-sec="weather") panel; open it so the
// toggles are clickable.
async function openWeather(page) {
  const body = page.locator('[data-sec="weather"] .tb-section-body');
  if (!(await body.isVisible().catch(() => false))) {
    await page.locator('[data-sec="weather"] .tb-section-head').click();
    await body.waitFor({ state: 'visible' });
  }
}

// A gate the test opens by hand: PNG requests block until open() is called.
function gate() {
  let open = null;
  const p = new Promise(res => { open = res; });
  return { wait: () => p, open: () => open() };
}

test('the wind/temp overlay says it is loading, and stops when the chart arrives', async ({ page }) => {
  const g = gate();
  await serve(page, g.wait);
  await page.waitForFunction(() => !document.getElementById('ims-pwx').hidden);

  const status = page.locator('#ims-pwx-status');
  await expect(status).toBeHidden();                  // nothing in flight yet
  await openWeather(page);
  await page.locator('#ims-pwx-cb').check();
  await expect(status).toBeVisible();                 // enable -> loading
  await expect(status).toHaveText(/Loading chart/i);

  g.open();
  await expect(status).toBeHidden();                  // chart painted -> banner cleared
});

test('changing the valid time shows the loading banner again', async ({ page }) => {
  const g1 = gate();
  let current = g1;
  await serve(page, () => current.wait());
  await page.waitForFunction(() => !document.getElementById('ims-pwx').hidden);
  await openWeather(page);
  await page.locator('#ims-pwx-cb').check();
  g1.open();
  await expect(page.locator('#ims-pwx-status')).toBeHidden();

  // Scrub to the other valid time: a different PNG, so the banner must come back.
  const g2 = gate(); current = g2;
  await page.evaluate(() => {
    const sel = document.getElementById('wx-time');
    const other = Array.from(sel.options).find(o => o.value !== sel.value);
    sel.value = other.value;
    sel.dispatchEvent(new Event('change'));
  });
  await expect(page.locator('#ims-pwx-status')).toBeVisible();
  g2.open();
  await expect(page.locator('#ims-pwx-status')).toBeHidden();
});

test('the SIGWX overlay banners its (heavier) chart load too', async ({ page }) => {
  const g = gate();
  await serve(page, g.wait);
  await page.waitForFunction(() => !document.getElementById('sigwx-ov').hidden);

  const status = page.locator('#sigwx-ov-status');
  await expect(status).toBeHidden();
  await openWeather(page);
  await page.locator('#sigwx-ov-cb').check();
  await expect(status).toBeVisible();
  await expect(status).toHaveText(/Loading chart/i);

  g.open();
  await expect(status).toBeHidden();
});
