// @ts-check
// Realtime own-position (GPS) + track recording (#676). Geolocation is mocked
// so the watch can be fired deterministically.
const { test, expect } = require('@playwright/test');

async function bootWithGeo(page) {
  await page.addInitScript(() => {
    navigator.geolocation.watchPosition = (ok) => {
      window.__fireFix = c => ok({ coords: c });
      return 42;
    };
    navigator.geolocation.clearWatch = () => {};
  });
  await page.goto('?lang=en');
  await page.waitForFunction(() => typeof toggleLiveLocation === 'function');
}

const FIX = { latitude: 32.1, longitude: 34.8, accuracy: 30, altitude: 762, speed: 51.4 };

test('location toggle shows a position marker + alt/speed readout', async ({ page }) => {
  await bootWithGeo(page);
  const btn = page.locator('#navaid-loc-btn');
  await expect(btn).toBeVisible();
  await btn.click();
  await expect(btn).toHaveClass(/active/);
  await page.evaluate(f => window.__fireFix(f), FIX);
  // 762 m → 2500 ft, 51.4 m/s → 100 kt.
  const readout = page.locator('#navaid-loc-readout');
  await expect(readout).toBeVisible();
  await expect(readout).toHaveText('2500 ft  ·  100 kt');
  // A position marker exists on the overlay pane.
  expect(await page.locator('.leaflet-overlay-pane path').count()).toBeGreaterThan(0);
  // Toggling off clears the marker + readout.
  await btn.click();
  await expect(btn).not.toHaveClass(/active/);
  await expect(readout).toBeHidden();
});

test('record toggle starts tracking and draws a breadcrumb polyline', async ({ page }) => {
  await bootWithGeo(page);
  const rec = page.locator('#navaid-rec-btn');
  await rec.click();
  await expect(rec).toHaveClass(/active/);
  // Recording auto-starts location tracking.
  await expect(page.locator('#navaid-loc-btn')).toHaveClass(/active/);
  await page.evaluate(f => window.__fireFix(f), FIX);
  await page.evaluate(f => window.__fireFix({ ...f, latitude: 32.2, longitude: 34.85 }), FIX);
  // A track polyline (≥2 fixes) is on the map.
  const tracked = await page.evaluate(() => {
    let n = 0;
    document.querySelectorAll('.leaflet-overlay-pane path').forEach(p => {
      const d = p.getAttribute('d') || '';
      if ((d.match(/L/g) || []).length >= 1) n++;
    });
    return n;
  });
  expect(tracked).toBeGreaterThan(0);
});
