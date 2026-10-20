// @ts-check
// Asked: minute markers blue going, red coming back (with the return path on), with a size slider
// and the two colours in Display -> Minute markers; and a colour for the return arrows.
const { test, expect } = require('./_setup');

test.use({ viewport: { width: 1000, height: 700 } });

async function boot(page) {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof drawMinuteMarkers === 'function' && document.getElementById('minute-size'));
  await page.evaluate(() => {
    state.waypoints = [{ lat: 32.1, lng: 34.8, name: 'A' }, { lat: 32.4, lng: 34.95, name: 'B' }];
    syncLegs(); map.setView([32.25, 34.875], 11, { animate: false }); draw();
  });
}
// The colours drawn along the leg, by side: count pixels near each colour on either side of the line.
const inkBySide = (page) => page.evaluate(() => {
  const a = map.latLngToContainerPoint([32.1, 34.8]), b = map.latLngToContainerPoint([32.4, 34.95]);
  const c = octx.canvas, k = c.width / c.clientWidth, d = octx.getImageData(0, 0, c.width, c.height).data;
  const near = (r, g, bb, t) => (x, y) => { const i = (Math.round(y * k) * c.width + Math.round(x * k)) * 4; return Math.abs(d[i] - r) + Math.abs(d[i + 1] - g) + Math.abs(d[i + 2] - bb) < t && d[i + 3] > 200; };
  const blue = near(0x15, 0x65, 0xc0, 60), red = near(0xc6, 0x28, 0x28, 60);
  const L = Math.hypot(b.x - a.x, b.y - a.y), nx = -(b.y - a.y) / L, ny = (b.x - a.x) / L;
  const out = { blueR: 0, blueL: 0, redR: 0, redL: 0 };
  for (let t = 0.05; t < 0.95; t += 0.004) for (let s = 3; s < 30; s += 1) {
    const x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t;
    if (blue(x + nx * s, y + ny * s)) out.blueR++; if (blue(x - nx * s, y - ny * s)) out.blueL++;
    if (red(x + nx * s, y + ny * s)) out.redR++; if (red(x - nx * s, y - ny * s)) out.redL++;
  }
  return out;
});

test('blue minute marks going; red ones for the way back on the other side, only with the return shown', async ({ page }) => {
  await boot(page);
  let s = await inkBySide(page);
  expect(s.blueR).toBeGreaterThan(20);              // right of A->B, as the CAAI standard puts them
  expect(s.redL + s.redR).toBeLessThan(5);
  await page.evaluate(() => { const c = document.getElementById('ret-cb'); c.checked = true; c.dispatchEvent(new Event('change')); draw(); });
  s = await inkBySide(page);
  expect(s.redL).toBeGreaterThan(20);               // right of B->A is left of A->B
});

test('Display -> Minute markers: size and both colours, remembered; return arrow colour beside the leg arrow', async ({ page }) => {
  await boot(page);
  await expect(page.locator('#minute-to-color')).toHaveValue('#1565c0');
  await expect(page.locator('#minute-from-color')).toHaveValue('#c62828');
  await page.evaluate(() => {
    const c = document.getElementById('minute-to-color'); c.value = '#00aa00'; c.dispatchEvent(new Event('input'));
    const z = document.getElementById('minute-size'); z.value = '1.5'; z.dispatchEvent(new Event('input'));
    const r = document.getElementById('return-arrow-color'); r.value = '#ff8800'; r.dispatchEvent(new Event('input'));
  });
  expect(await page.evaluate(() => [tune('minuteMarkerToColor'), minuteMarkerSize, tune('returnKiteFillColor')])).toEqual(['#00aa00', 1.5, '#ff8800']);
  await page.reload();
  await page.waitForFunction(() => document.getElementById('minute-size'));
  expect(await page.evaluate(() => [tune('minuteMarkerToColor'), minuteMarkerSize, tune('returnKiteFillColor')])).toEqual(['#00aa00', 1.5, '#ff8800']);
  await expect(page.locator('label:has(#return-arrow-color) span')).toHaveText('Return arrow color');
});

test('the Show return path toggle names its shortcut', async ({ page }) => {
  await page.goto('?lang=en&nogist');
  await expect(page.locator('label:has(#ret-cb) span')).toHaveText('Show return path (B)');
});

test('the way-back colours are dimmed, saying why, while the return path is off', async ({ page }) => {
  await boot(page);
  const from = page.locator('#minute-from-color');
  await expect(from).toHaveAttribute('aria-disabled', 'true');
  await expect(from).toHaveAttribute('data-why', /return path/);
  await expect(page.locator('#return-arrow-color')).toHaveAttribute('aria-disabled', 'true');
  await page.evaluate(() => { const c = document.getElementById('ret-cb'); c.checked = true; c.dispatchEvent(new Event('change')); });
  await expect(from).not.toHaveAttribute('aria-disabled', 'true');
  await expect(page.locator('#minute-to-color')).not.toHaveAttribute('aria-disabled', 'true');   // the way out, always
});
