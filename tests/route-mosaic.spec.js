// @ts-check
// Charts → Satellite mosaic: a grid of static satellite previews, one per route
// waypoint, each labelled and clickable to open the full satellite modal.
const { test, expect } = require('./_setup');

async function boot(page) {
  await page.addInitScript(() => { try { localStorage.setItem('navaid.sec.charts', '1'); } catch (e) {} });
  await page.goto('?lang=en');
  await page.waitForFunction(() => typeof state !== 'undefined' &&
    typeof showRouteMosaicModal === 'function');
}

test('mosaic shows one labelled satellite preview per waypoint', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => {
    state.waypoints = [
      { lat: 32.18, lng: 34.83, name: 'LLHZ' },
      { lat: 32.55, lng: 34.92, name: 'HADERA' },
      { lat: 32.81, lng: 35.04, name: 'LLHA' },
    ];
    if (typeof syncLegs === 'function') syncLegs();
  });
  await page.evaluate(() => document.getElementById('mosaic-btn').click());
  const modal = page.locator('.route-mosaic-modal');
  await expect(modal).toBeVisible();
  // One cell per waypoint, each with a label + a satellite snippet (3×3 tiles).
  await expect(modal.locator('.route-mosaic-cell')).toHaveCount(3);
  await expect(modal).toContainText('LLHZ');
  await expect(modal).toContainText('HADERA');
  await expect(modal.locator('.route-mosaic-cell .satellite-snippet')).toHaveCount(3);
  await expect(modal.locator('.route-mosaic-cell').first()
    .locator('.satellite-snippet img')).toHaveCount(9);
  // Direction arrows between consecutive waypoints (n-1) + a print button.
  await expect(modal.locator('.route-mosaic-arrow')).toHaveCount(2);
  await expect(modal.locator('.route-mosaic-print')).toBeVisible();
});

test('mosaic zoom slider re-renders previews at the chosen zoom', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => {
    state.waypoints = [{ lat: 32.18, lng: 34.83, name: 'LLHZ' }];
    if (typeof syncLegs === 'function') syncLegs();
  });
  await page.evaluate(() => document.getElementById('mosaic-btn').click());
  const modal = page.locator('.route-mosaic-modal');
  const zoom = modal.locator('.route-mosaic-zoom input[type="range"]');
  await expect(zoom).toBeVisible();
  await zoom.fill('11');
  await zoom.dispatchEvent('input');
  // Esri tile URLs embed the zoom: .../tile/{z}/{y}/{x}.
  await expect.poll(async () => modal.locator('.satellite-snippet img').first()
    .getAttribute('src')).toContain('/tile/11/');
});

test('mosaic size slider resizes the previews', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => {
    state.waypoints = [{ lat: 32.18, lng: 34.83, name: 'LLHZ' }];
    if (typeof syncLegs === 'function') syncLegs();
  });
  await page.evaluate(() => document.getElementById('mosaic-btn').click());
  const modal = page.locator('.route-mosaic-modal');
  const size = modal.locator('.route-mosaic-size input[type="range"]');
  await expect(size).toBeVisible();
  const cell = modal.locator('.route-mosaic-cell').first();
  const before = (await cell.boundingBox()).width;
  await size.fill('400');
  await size.dispatchEvent('input');
  await expect.poll(async () => (await cell.boundingBox()).width).toBeGreaterThan(before + 50);
});

test('mosaic layer selector uses Hebrew labels in the Hebrew UI', async ({ page }) => {
  await page.addInitScript(() => { try { localStorage.setItem('navaid.sec.charts', '1'); } catch (e) {} });
  await page.goto('?lang=he');
  await page.waitForFunction(() => typeof state !== 'undefined' && typeof showRouteMosaicModal === 'function');
  await page.evaluate(() => {
    state.waypoints = [{ lat: 32.18, lng: 34.83, name: 'LLHZ' }];
    if (typeof syncLegs === 'function') syncLegs();
  });
  await page.evaluate(() => document.getElementById('mosaic-btn').click());
  const sel = page.locator('.route-mosaic-modal .route-mosaic-layer');
  // Value stays the English key; the visible label is Hebrew.
  await expect(sel.locator('option[value="Navigation"]')).toHaveText('ניווט');
  await expect(sel.locator('option[value="Satellite"]')).toHaveText('לוויין');
});

test('pressing the mosaic button twice does not stack a second modal', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => {
    state.waypoints = [{ lat: 32.18, lng: 34.83, name: 'LLHZ' }];
    if (typeof syncLegs === 'function') syncLegs();
  });
  await page.evaluate(() => document.getElementById('mosaic-btn').click());
  await page.evaluate(() => document.getElementById('mosaic-btn').click());
  await expect(page.locator('.route-mosaic-modal')).toHaveCount(1);
});

test('opening another chart closes the mosaic (one chart at a time)', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => {
    state.waypoints = [{ lat: 32.18, lng: 34.83, name: 'LLHZ' }];
    if (typeof syncLegs === 'function') syncLegs();
  });
  await page.evaluate(() => document.getElementById('mosaic-btn').click());
  await expect(page.locator('.route-mosaic-modal')).toBeVisible();
  // Open the NOTAM list → mosaic closes.
  await page.evaluate(() => showNotamModal());
  await expect(page.locator('.notam-modal')).toBeVisible();
  await expect(page.locator('.route-mosaic-modal')).toHaveCount(0);
  // Re-open the mosaic → the NOTAM list closes.
  await page.evaluate(() => document.getElementById('mosaic-btn').click());
  await expect(page.locator('.route-mosaic-modal')).toBeVisible();
  await expect(page.locator('.notam-modal')).toHaveCount(0);
});

test('opening the mosaic closes the toolbar dropdown', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => {
    const sec = document.querySelector('.tb-section[data-sec="charts"]');
    sec.classList.add('open');
  });
  await page.evaluate(() => document.getElementById('mosaic-btn').click());
  await expect(page.locator('.tb-section[data-sec="charts"].open')).toHaveCount(0);
  await expect(page.locator('.route-mosaic-modal')).toBeVisible();
});

test('mosaic layer selector switches the preview tile source', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => {
    state.waypoints = [{ lat: 32.18, lng: 34.83, name: 'LLHZ' }];
    if (typeof syncLegs === 'function') syncLegs();
  });
  await page.evaluate(() => document.getElementById('mosaic-btn').click());
  const modal = page.locator('.route-mosaic-modal');
  const sel = modal.locator('.route-mosaic-layer');
  await expect(sel).toBeVisible();
  // Defaults to Satellite (Esri imagery).
  await expect(sel).toHaveValue('Satellite');
  expect(await modal.locator('.satellite-snippet img').first().getAttribute('src'))
    .toContain('World_Imagery');
  // Switch to CVFR → previews load chart tiles instead, from whichever host this deployment
  // draws them from (our mirror off the live site — see tiles-live-site-only.spec.js).
  await sel.selectOption('CVFR');
  // Anchored at the scheme and matching the host exactly: an unanchored alternation would
  // also accept evil.example/?x=flight-maps.com/tiles/cvfr as a chart tile.
  await expect.poll(async () => modal.locator('.satellite-snippet img').first()
    .getAttribute('src')).toMatch(
    /^https:\/\/(flight-maps\.com\/tiles\/cvfr\/|navaid-tiles\.supino\.org\/CVFR\/)/);
});

test('clicking a mosaic cell opens the satellite view for that waypoint', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => {
    state.waypoints = [{ lat: 32.18, lng: 34.83, name: 'LLHZ' }];
    if (typeof syncLegs === 'function') syncLegs();
  });
  await page.evaluate(() => document.getElementById('mosaic-btn').click());
  await page.locator('.route-mosaic-cell').first().click();
  await expect(page.locator('.satellite-preview-modal')).toBeVisible();
});

test('Escape on the satellite picture closes only it, not the mosaic underneath', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => {
    state.waypoints = [{ lat: 32.18, lng: 34.83, name: 'LLHZ' }];
    if (typeof syncLegs === 'function') syncLegs();
  });
  await page.evaluate(() => document.getElementById('mosaic-btn').click());
  await page.locator('.route-mosaic-cell').first().click();
  await expect(page.locator('.satellite-preview-modal')).toBeVisible();

  await page.keyboard.press('Escape');
  // The picture closes; the mosaic behind it stays open.
  await expect(page.locator('.satellite-preview-modal')).toHaveCount(0);
  await expect(page.locator('.route-mosaic-modal')).toBeVisible();

  // A second Escape now closes the mosaic itself.
  await page.keyboard.press('Escape');
  await expect(page.locator('.route-mosaic-modal')).toHaveCount(0);
});

test('mosaic zoom and size sliders each have a reset-to-default button', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => {
    state.waypoints = [{ lat: 32.18, lng: 34.83, name: 'LLHZ' }];
    if (typeof syncLegs === 'function') syncLegs();
  });
  await page.evaluate(() => document.getElementById('mosaic-btn').click());
  const zoom = page.locator('.route-mosaic-zoom input[type="range"]');
  const size = page.locator('.route-mosaic-size input[type="range"]');
  const defZoom = await zoom.inputValue();
  const defSize = await size.inputValue();

  // Move both off their defaults.
  await zoom.fill('12');
  await size.fill('320');
  expect(await zoom.inputValue()).toBe('12');
  expect(await size.inputValue()).toBe('320');

  // Reset each → back to the tuned default.
  await page.locator('.route-mosaic-zoom .route-mosaic-reset').click();
  await page.locator('.route-mosaic-size .route-mosaic-reset').click();
  expect(await zoom.inputValue()).toBe(defZoom);
  expect(await size.inputValue()).toBe(defSize);
  await expect(page.locator('.route-mosaic-size .route-mosaic-zoom-val')).toHaveText(defSize + 'px');
});

test('mosaic with no waypoints shows an empty message', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => { state.waypoints = []; });
  await page.evaluate(() => document.getElementById('mosaic-btn').click());
  const modal = page.locator('.route-mosaic-modal');
  await expect(modal).toBeVisible();
  await expect(modal.locator('.route-mosaic-empty')).toBeVisible();
  await expect(modal.locator('.route-mosaic-cell')).toHaveCount(0);
});
