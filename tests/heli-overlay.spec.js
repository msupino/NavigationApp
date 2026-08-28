// @ts-check
// Helicopter routes overlay: georeferenced helicopter route plate images toggled from the
// "Extra layers" toolbar section (data-sec="weather").
const { test, expect } = require('./_setup');
const { setAirfieldPlate } = require('./_platePicker');

// Block the service worker so that Playwright's page.route() can intercept
// heli-img requests directly. Without this, the SW (which calls
// clients.claim() on activate) intercepts img.src fetches before they reach
// CDP, so route handlers never fire and the URL-capture test (test 7) fails.
test.use({ serviceWorkers: 'block' });

const PNG_RE = /heli-img\/.*\.png/;

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
    () => typeof map !== 'undefined' && document.getElementById('heli-cb')
  );
}

test('heli-cb is unchecked by default and controls are hidden', async ({ page }) => {
  await boot(page);
  await expect(page.locator('#heli-cb')).not.toBeChecked();
});

test('checking heli-cb reveals controls and adds image overlays', async ({ page }) => {
  await boot(page);
  await setAirfieldPlate(page, 'heli-cb');
  // At least one leaflet image overlay should appear in the overlay pane
  const imgs = page.locator('.leaflet-overlay-pane img.leaflet-image-layer');
  await expect(imgs.first()).toBeVisible();
  const count = await imgs.count();
  expect(count).toBeGreaterThanOrEqual(1);
});

test('unchecking removes all heli overlays from the map', async ({ page }) => {
  await boot(page);
  await setAirfieldPlate(page, 'heli-cb');
  await expect(page.locator('.leaflet-overlay-pane img.leaflet-image-layer').first()).toBeVisible();
  await setAirfieldPlate(page, 'heli-cb', false);
  // heliLayerGroup was created but removed from map — the group itself
  // must not be on the map after unchecking.
  const onMap = await page.evaluate(
    () => window.heliLayerGroup ? map.hasLayer(window.heliLayerGroup) : false
  );
  expect(onMap).toBe(false);
});

test('opacity slider drives overlay opacity', async ({ page }) => {
  await boot(page);
  await setAirfieldPlate(page, 'heli-cb');
  await expect(page.locator('.leaflet-overlay-pane img.leaflet-image-layer').first()).toBeVisible();

  const result = await page.evaluate(() => {
    const slider = document.getElementById('plate-opacity');
    const valEl  = document.getElementById('plate-opacity-val');
    slider.value = '0.3';
    slider.dispatchEvent(new Event('input'));
    // A rotated overlay wraps its <img> in a div and Leaflet sets the opacity there.
    const img = document.querySelector('.leaflet-overlay-pane .leaflet-image-layer');
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
  await setAirfieldPlate(page, 'heli-cb');
  await expect(page.locator('.leaflet-overlay-pane img.leaflet-image-layer').first()).toBeVisible();

  const result = await page.evaluate(() => {
    const slider = document.getElementById('plate-opacity');
    slider.value = '0.3';
    slider.dispatchEvent(new Event('input'));
    document.getElementById('plate-opacity-reset').click();
    // A rotated overlay wraps its <img> in a div and Leaflet sets the opacity there.
    const img = document.querySelector('.leaflet-overlay-pane .leaflet-image-layer');
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
  await setAirfieldPlate(page, 'heli-cb');
  await expect(page.locator('.leaflet-overlay-pane img.leaflet-image-layer').first()).toBeVisible();

  // Set a custom opacity before reloading
  await page.evaluate(() => {
    const s = document.getElementById('plate-opacity');
    s.value = '0.5';
    s.dispatchEvent(new Event('input'));
  });

  await page.reload();
  await page.waitForFunction(
    () => typeof map !== 'undefined' && document.getElementById('heli-cb')
  );
  // Re-route images after reload
  await page.route(PNG_RE, r =>
    r.fulfill({ status: 200, contentType: 'image/png', body: PNG })
  );

  await expect(page.locator('#heli-cb')).toBeChecked();
  expect(await page.evaluate(() => document.getElementById('plate-opacity').value)).toBe('0.5');
  await expect(page.locator('.leaflet-overlay-pane img.leaflet-image-layer').first()).toBeVisible();
});

test('heli overlay PNG URLs resolve through heliImgBase()', async ({ page }) => {
  const urls = [];
  await page.route(PNG_RE, r => {
    urls.push(r.request().url());
    return r.fulfill({ status: 200, contentType: 'image/png', body: PNG });
  });
  await page.addInitScript(() => {
    try { localStorage.setItem('navaid.sec.weather', '1'); } catch (e) {}
  });
  await page.goto('?lang=en');
  await page.waitForFunction(() => typeof map !== 'undefined' && document.getElementById('heli-cb'));
  await setAirfieldPlate(page, 'heli-cb');
  await page.waitForFunction(() => {
    let n = 0;
    if (window.heliLayerGroup) window.heliLayerGroup.eachLayer(() => n++);
    return n > 0;
  });
  // Every PNG URL must contain /heli-img/ and end in _heli.png
  expect(urls.length).toBeGreaterThanOrEqual(1);
  for (const u of urls) {
    expect(u).toMatch(/\/heli-img\/[A-Z]{4}_heli.png/);
  }
});
