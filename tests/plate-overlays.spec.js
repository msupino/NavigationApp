// @ts-check
// Airfield-plate overlays as a group: mutual exclusivity (only one plate layer
// at a time) and the single shared opacity slider that drives whichever plate
// is showing. Toggles + shared slider live in the "Airfield plates" frame of
// the Extra-layers section (data-sec="weather").
const { test, expect } = require('./_setup');
const { setAirfieldPlate } = require('./_platePicker');

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
  await setAirfieldPlate(page, 'circuit-cb');
  await page.locator('#plate-type').selectOption('cvfr-cb');
  await page.locator('#plate-type').selectOption('heli-cb');

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
  await setAirfieldPlate(page, 'cvfr-cb');
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
  await page.locator('#plate-type').selectOption('heli-cb');
  const afterSwitch = await page.evaluate(() => {
    // A rotated overlay wraps its <img> in a div and Leaflet sets the opacity there.
    const img = document.querySelector('.leaflet-overlay-pane .leaflet-image-layer');
    return img ? parseFloat(img.style.opacity) : null;
  });
  expect(afterSwitch).toBeCloseTo(0.3, 2);
});

test('airfield chart checkbox reveals its type dropdown like instrument charts', async ({ page }) => {
  await boot(page);
  const controls = await page.evaluate(() => {
    const frame = document.getElementById('plate-enabled-cb').closest('.tb-layer-frame');
    const legacy = document.getElementById('plate-type-state');
    return {
      pickerVisible: !!document.getElementById('plate-enabled-cb').getClientRects().length,
      selectVisible: !!document.getElementById('plate-type').getClientRects().length,
      legacyVisible: !!legacy.getClientRects().length,
      options: Array.from(document.getElementById('plate-type').options).map(option => option.value),
      visibleCheckboxes: Array.from(frame.querySelectorAll('input[type="checkbox"]'))
        .filter(input => input.getClientRects().length).map(input => input.id),
    };
  });
  expect(controls).toEqual({
    pickerVisible: true,
    selectVisible: false,
    legacyVisible: false,
    options: CBS,
    visibleCheckboxes: ['plate-enabled-cb'],
  });
  await page.locator('#plate-enabled-cb').check();
  await expect(page.locator('#plate-type')).toBeVisible();
});

test('disabling remembers the type and changing it while enabled switches charts', async ({ page }) => {
  await boot(page);
  await setAirfieldPlate(page, 'cvfr-cb');
  await page.locator('#plate-type').selectOption('commfail-cb');
  await page.locator('#plate-enabled-cb').uncheck();

  expect(await page.evaluate(() => ({
    selected: document.getElementById('plate-type').value,
    stored: localStorage.getItem('navaid.plateType'),
    active: ['circuit-cb', 'training-cb', 'cvfr-cb', 'heli-cb', 'commfail-cb']
      .filter(id => document.getElementById(id).checked),
  }))).toEqual({ selected: 'commfail-cb', stored: 'commfail-cb', active: [] });

  await page.locator('#plate-enabled-cb').check();
  expect(await page.evaluate(() => ({
    enabled: document.getElementById('plate-enabled-cb').checked,
    commfail: document.getElementById('commfail-cb').checked,
  }))).toEqual({ enabled: true, commfail: true });
});
