// @ts-check
// The Israel chart layers cover only the FIR; an OpenStreetMap underlay fills
// the surrounding area beneath them. It's present for the limited chart layers
// and removed for the already-global Satellite / OpenStreetMap layers.
const { test, expect } = require('./_setup');

const PANE = '.leaflet-basemapUnderlay-pane';

test('OSM underlay is present under the CVFR chart, gone for full-coverage layers', async ({ page }) => {
  await page.addInitScript(() => { try { localStorage.setItem('navaid.layer', 'CVFR'); localStorage.setItem('navaid.sec.view', '1'); } catch (e) {} });
  await page.goto('?lang=en');
  await page.waitForFunction(() => typeof map !== 'undefined' && typeof updateBasemapUnderlay === 'function');

  // Underlay pane exists below the tile pane and loads OSM tiles.
  expect(await page.evaluate(() => {
    const p = document.querySelector('.leaflet-basemapUnderlay-pane');
    const tp = document.querySelector('.leaflet-tile-pane');
    return p && tp ? (parseInt(getComputedStyle(p).zIndex) < parseInt(getComputedStyle(tp).zIndex)) : false;
  })).toBe(true);
  await expect(page.locator(`${PANE} img`).first()).toHaveAttribute('src', /^https:\/\/[a-c]\.tile\.openstreetmap\.org\//);

  // Switch to OpenStreetMap (global) → underlay removed (redundant).
  await page.locator('#layer-select').selectOption('OpenStreetMap');
  await expect(page.locator(`${PANE} img`)).toHaveCount(0);

  // Back to a chart layer → underlay returns.
  await page.locator('#layer-select').selectOption('Navigation');
  await expect(page.locator(`${PANE} img`).first()).toHaveAttribute('src', /^https:\/\/[a-c]\.tile\.openstreetmap\.org\//);
});
