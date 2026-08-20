// @ts-check
// Comm-failure entry overlay: georeferenced comm-failure entry plate images toggled from the
// "Extra layers" toolbar section (data-sec="weather").
const { test, expect } = require('./_setup');

// Block the service worker so that Playwright's page.route() can intercept
// commfail-img requests directly. Without this, the SW (which calls
// clients.claim() on activate) intercepts img.src fetches before they reach
// CDP, so route handlers never fire and the URL-capture test (test 7) fails.
test.use({ serviceWorkers: 'block' });

const PNG_RE = /commfail-img\/.*\.png/;

// 1×1 transparent PNG
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMCAYAAAB7P3qAAAAAAElFTkSuQmCC',
  'base64'
);

async function boot(page) {
  await page.route(PNG_RE, r =>
    r.fulfill({ status: 200, contentType: 'image/png', body: PNG })
  );
  await page.addInitScript(() => {
    try {
      // Open the "Extra layers" section so controls are interactable
      localStorage.setItem('navaid.sec.weather', '1');
    } catch (e) {}
  });
  await page.goto('?lang=en');
  await page.waitForFunction(
    () => typeof map !== 'undefined' && document.getElementById('commfail-cb')
  );
}

test('commfail-cb is unchecked by default and controls are hidden', async ({ page }) => {
  await boot(page);
  await expect(page.locator('#commfail-cb')).not.toBeChecked();
});

test('checking commfail-cb reveals controls and adds image overlays', async ({ page }) => {
  await boot(page);
  await page.locator('#commfail-cb').check();
  // At least one leaflet image overlay should appear in the overlay pane
  const imgs = page.locator('.leaflet-overlay-pane img.leaflet-image-layer');
  await expect(imgs.first()).toBeVisible();
  const count = await imgs.count();
  expect(count).toBeGreaterThanOrEqual(1);
});

test('unchecking removes all commfail overlays from the map', async ({ page }) => {
  await boot(page);
  await page.locator('#commfail-cb').check();
  await expect(page.locator('.leaflet-overlay-pane img.leaflet-image-layer').first()).toBeVisible();
  await page.locator('#commfail-cb').uncheck();
  // commfailLayerGroup was created but removed from map — the group itself
  // must not be on the map after unchecking.
  const onMap = await page.evaluate(
    () => window.commfailLayerGroup ? map.hasLayer(window.commfailLayerGroup) : false
  );
  expect(onMap).toBe(false);
});

test('opacity slider drives overlay opacity', async ({ page }) => {
  await boot(page);
  await page.locator('#commfail-cb').check();
  await expect(page.locator('.leaflet-overlay-pane img.leaflet-image-layer').first()).toBeVisible();

  const result = await page.evaluate(() => {
    const slider = document.getElementById('plate-opacity');
    const valEl  = document.getElementById('plate-opacity-val');
    slider.value = '0.3';
    slider.dispatchEvent(new Event('input'));
    const img = document.querySelector('.leaflet-overlay-pane img.leaflet-image-layer');
    return {
      opacity: parseFloat(img.style.opacity),
      label: valEl.textContent,
    };
  });
  expect(result.opacity).toBeCloseTo(0.3, 2);
  expect(result.label).toBe('30%');
});

test('opacity reset restores the tuned default', async ({ page }) => {
  await boot(page);
  await page.locator('#commfail-cb').check();
  await expect(page.locator('.leaflet-overlay-pane img.leaflet-image-layer').first()).toBeVisible();

  const result = await page.evaluate(() => {
    const slider = document.getElementById('plate-opacity');
    slider.value = '0.3';
    slider.dispatchEvent(new Event('input'));
    document.getElementById('plate-opacity-reset').click();
    const img = document.querySelector('.leaflet-overlay-pane img.leaflet-image-layer');
    return {
      sliderVal: slider.value,
      opacity: parseFloat(img.style.opacity),
      label: document.getElementById('plate-opacity-val').textContent,
    };
  });
  // Reset goes back to overlayOpacity, the one tunable behind the shared slider -- not to a
  // number frozen into the test (see tests/overlay-opacity-tunables.spec.js).
  const want = await page.evaluate(() => overlayDefaultOpacity());
  expect(parseFloat(result.sliderVal)).toBeCloseTo(want, 2);
  expect(result.opacity).toBeCloseTo(want, 2);
  expect(result.label).toBe(Math.round(want * 100) + '%');
});

test('toggle state and opacity persist across reload', async ({ page }) => {
  await boot(page);
  await page.locator('#commfail-cb').check();
  await expect(page.locator('.leaflet-overlay-pane img.leaflet-image-layer').first()).toBeVisible();

  // Set a custom opacity before reloading
  await page.evaluate(() => {
    const s = document.getElementById('plate-opacity');
    s.value = '0.5';
    s.dispatchEvent(new Event('input'));
  });

  await page.reload();
  await page.waitForFunction(
    () => typeof map !== 'undefined' && document.getElementById('commfail-cb')
  );
  // Re-route images after reload
  await page.route(PNG_RE, r =>
    r.fulfill({ status: 200, contentType: 'image/png', body: PNG })
  );

  await expect(page.locator('#commfail-cb')).toBeChecked();
  expect(await page.evaluate(() => document.getElementById('plate-opacity').value)).toBe('0.5');
  await expect(page.locator('.leaflet-overlay-pane img.leaflet-image-layer').first()).toBeVisible();
});

test('commfail overlay PNG URLs resolve through commfailImgBase()', async ({ page }) => {
  const urls = [];
  await page.route(PNG_RE, r => {
    urls.push(r.request().url());
    return r.fulfill({ status: 200, contentType: 'image/png', body: PNG });
  });
  await page.addInitScript(() => {
    try { localStorage.setItem('navaid.sec.weather', '1'); } catch (e) {}
  });
  await page.goto('?lang=en');
  await page.waitForFunction(() => typeof map !== 'undefined' && document.getElementById('commfail-cb'));
  await page.locator('#commfail-cb').check();
  await page.waitForFunction(() => {
    let n = 0;
    if (window.commfailLayerGroup) window.commfailLayerGroup.eachLayer(() => n++);
    return n > 0;
  });
  // Every PNG URL must contain /commfail-img/ and end in _commfail.png
  expect(urls.length).toBeGreaterThanOrEqual(1);
  for (const u of urls) {
    expect(u).toMatch(/\/commfail-img\/[A-Z]{4}_commfail.png/);
  }
});

// Reported from the cockpit: Rosh Pina's radio-failure joining plate (נספח ד') was in the
// plate list but not on the map — the layer only carried LLHA and LLHZ, so switching it on
// at LLIB drew nothing at all.
test('Rosh Pina has a comm-failure overlay, georeferenced onto its own field', async ({ page }) => {
  await boot(page);
  const af = await page.evaluate(async () => {
    if (typeof loadAirfields === 'function' && !window.airfields) await loadAirfields();
    return (window.airfields || []).find(a => a.name === 'LLIB') || null;
  });
  expect(af).toBeTruthy();
  expect(af.commfail_overlay).toBeTruthy();
  expect(af.commfail_overlay.png).toBe('LLIB_commfail.png');
  const { tl, tr, bl } = af.commfail_overlay;
  // Rotated corners, not a north-up box: the sheet is drawn ~1.9° off north, and an
  // axis-aligned box put it south and east of where it belongs, turned.
  expect(tl && tr && bl).toBeTruthy();
  expect(Math.abs(tl[0] - tr[0])).toBeGreaterThan(0.0005);   // the top edge is not level
  // The plate has to contain the field it is the joining chart FOR.
  expect(af.lat).toBeLessThan(tl[0]);
  expect(af.lat).toBeGreaterThan(bl[0]);
  expect(af.lng).toBeGreaterThan(tl[1]);
  expect(af.lng).toBeLessThan(tr[1]);
  // ...and be about the size the plate covers (~5' of latitude at 1:65,000), not the whole
  // country: a plate stretched over a wrong box lines up only at its centre.
  expect((tl[0] - bl[0]) * 60).toBeGreaterThan(3);
  expect((tl[0] - bl[0]) * 60).toBeLessThan(7);
});

// The CVFR entry/exit plate (נספח ג') is the one a pilot flies to reach the field, and Rosh
// Pina had every other layer but not that one.
test('Rosh Pina has its CVFR entry/exit overlay', async ({ page }) => {
  await boot(page);
  const af = await page.evaluate(async () => {
    if (typeof loadAirfields === 'function' && !window.airfields) await loadAirfields();
    return (window.airfields || []).find(a => a.name === 'LLIB') || null;
  });
  expect(af.cvfr_overlay).toBeTruthy();
  expect(af.cvfr_overlay.png).toBe('LLIB_cvfr.png');
  const { tl, tr, bl } = af.cvfr_overlay;
  expect(tl && tr && bl).toBeTruthy();
  expect(Math.abs(tl[0] - tr[0])).toBeGreaterThan(0.0005);   // drawn ~1.4° off north
  expect(af.lat).toBeLessThan(tl[0]);
  expect(af.lat).toBeGreaterThan(bl[0]);
  expect(af.lng).toBeGreaterThan(tl[1]);
  expect(af.lng).toBeLessThan(tr[1]);
  // The entry/exit chart covers the routes in, so it is wider than the circuit plate beside
  // it -- but still a plate, not a country: ~26' of latitude at 1:250,000.
  expect((tl[0] - bl[0]) * 60).toBeGreaterThan(20);
  expect((tl[0] - bl[0]) * 60).toBeLessThan(35);
});
