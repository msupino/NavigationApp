// @ts-check
// Airfield-plate overlays as a group: mutual exclusivity (only one plate layer
// at a time) and the single shared opacity slider that drives whichever plate
// is showing. Toggles + shared slider live in the "Airfield plates" frame of
// the Extra-layers section (data-sec="weather").
const { test, expect } = require('./_setup');

test.use({ serviceWorkers: 'block' });

const PNG_RE = /(circuit|training|cvfr|heli|commfail)-img\/.*\.png/;
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMCAYAAAB7P3qAAAAAAElFTkSuQmCC',
  'base64'
);
const CBS = ['circuit-cb', 'training-cb', 'cvfr-cb', 'heli-cb', 'commfail-cb'];

async function boot(page) {
  await page.route(PNG_RE, r =>
    r.fulfill({ status: 200, contentType: 'image/png', body: PNG })
  );
  await page.addInitScript(() => {
    try { localStorage.setItem('navaid.sec.weather', '1'); } catch (e) {}
  });
  await page.goto('?lang=en');
  await page.waitForFunction(
    () => typeof map !== 'undefined' && document.getElementById('plate-opacity')
  );
}

test('plate overlays are mutually exclusive — enabling one disables the rest', async ({ page }) => {
  await boot(page);
  await page.locator('#circuit-cb').check();
  await page.locator('#cvfr-cb').check();
  await page.locator('#heli-cb').check();

  const state = await page.evaluate(
    ids => ids.map(id => document.getElementById(id).checked),
    CBS
  );
  // Only the last-enabled toggle (heli) stays on.
  expect(state).toEqual([false, false, false, true, false]);

  const groupsOnMap = await page.evaluate(() => ({
    circuit:  window.circuitLayerGroup  ? map.hasLayer(window.circuitLayerGroup)  : false,
    cvfr:     window.cvfrLayerGroup     ? map.hasLayer(window.cvfrLayerGroup)     : false,
    heli:     window.heliLayerGroup     ? map.hasLayer(window.heliLayerGroup)     : false,
  }));
  expect(groupsOnMap).toEqual({ circuit: false, cvfr: false, heli: true });
});

test('restore-on-load shows only one plate even if several were persisted on', async ({ page }) => {
  // Simulate a stale double-on state (e.g. from an old build / cold-start race):
  // two plate toggles saved as enabled. On load only the first may show.
  await page.route(PNG_RE, r =>
    r.fulfill({ status: 200, contentType: 'image/png', body: PNG }));
  await page.addInitScript(() => {
    try {
      localStorage.setItem('navaid.sec.weather', '1');
      localStorage.setItem('navaid.showCircuit', '1');
      localStorage.setItem('navaid.showCvfr', '1');
    } catch (e) {}
  });
  await page.goto('?lang=en');
  await page.waitForFunction(() => typeof map !== 'undefined' && window.airfields);
  const onMap = await page.evaluate(() => ({
    circuit: window.circuitLayerGroup ? map.hasLayer(window.circuitLayerGroup) : false,
    cvfr:    window.cvfrLayerGroup    ? map.hasLayer(window.cvfrLayerGroup)    : false,
  }));
  // Circuit is first in priority → it stays; CVFR is dropped.
  expect(onMap).toEqual({ circuit: true, cvfr: false });
  const checked = await page.evaluate(() => ({
    circuit: document.getElementById('circuit-cb').checked,
    cvfr: document.getElementById('cvfr-cb').checked,
  }));
  expect(checked).toEqual({ circuit: true, cvfr: false });
});

test('the shared plate-opacity slider drives whichever plate is showing', async ({ page }) => {
  await boot(page);
  await page.locator('#cvfr-cb').check();
  await expect(page.locator('.leaflet-overlay-pane img.leaflet-image-layer').first()).toBeVisible();

  const result = await page.evaluate(() => {
    const slider = document.getElementById('plate-opacity');
    slider.value = '0.3';
    slider.dispatchEvent(new Event('input'));
    // A rotated overlay wraps its <img> in a div and Leaflet sets the opacity there.
    const img = document.querySelector('.leaflet-overlay-pane .leaflet-image-layer');
    return { opacity: parseFloat(img.style.opacity), label: document.getElementById('plate-opacity-val').textContent };
  });
  expect(result.opacity).toBeCloseTo(0.3, 2);
  expect(result.label).toBe('30%');

  // Switching to another plate keeps the shared opacity.
  const afterSwitch = await page.evaluate(() => {
    document.getElementById('heli-cb').checked = true;
    document.getElementById('heli-cb').dispatchEvent(new Event('change', { bubbles: true }));
    // A rotated overlay wraps its <img> in a div and Leaflet sets the opacity there.
    const img = document.querySelector('.leaflet-overlay-pane .leaflet-image-layer');
    return img ? parseFloat(img.style.opacity) : null;
  });
  expect(afterSwitch).toBeCloseTo(0.3, 2);
});
