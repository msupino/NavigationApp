// @ts-check
// The SIGWX viewer pinch-zooms and pans its chart: the app ships user-scalable=no, so on a
// phone the whole sheet sat ~330 px wide and its table could not be read.
const { test, expect } = require('./_setup');
const fs = require('fs');
const path = require('path');

const PNG = fs.readFileSync(path.join(__dirname, 'sigwx-overlay.spec.js'), 'utf8').match(/const PNG = '([^']+)'/)[1];

async function open(page, vp) {
  await page.setViewportSize(vp);
  await page.route(/ims-data\/ims\/pwx\.json/, r => r.fulfill({ status: 404, body: '' }));
  await page.route(/ims-data\/ims\/sigwx\.json/, r => r.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify({ generatedAt: 'x', times: [{ valid: '12:00', day: '24/06/2026', png: 'ims/sigwx/1200.png' }] }) }));
  await page.route(/ims-data\/ims\/sigwx\/.*\.png/, r => r.fulfill({ status: 200, contentType: 'image/png',
    headers: { 'access-control-allow-origin': '*' }, body: Buffer.from(PNG, 'base64') }));
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => window.NavAid && typeof NavAid.openSigwxViewer === 'function'
    && !document.getElementById('sigwx-btn').hidden);
  await page.evaluate(() => NavAid.openSigwxViewer());
  await page.waitForFunction(() => { const i = document.querySelector('.sigwx-modal .sigwx-img'); return i && i.complete && i.offsetWidth > 50; });
}
const zoomState = page => page.evaluate(() => {
  const img = document.querySelector('.sigwx-modal .sigwx-img');
  const f = img.parentNode.getBoundingClientRect(), r = img.getBoundingClientRect();
  return { scale: r.width / img.offsetWidth, left: r.left - f.left, top: r.top - f.top,
    right: r.right - f.right, bottom: r.bottom - f.bottom, fw: f.width, fh: f.height };
});

test('two fingers zoom about the point between them, and the chart never leaves its frame (phone)', async ({ page }) => {
  await open(page, { width: 390, height: 800 });
  expect((await zoomState(page)).scale).toBeCloseTo(1, 2);
  // A pinch, as the browser delivers it: two pointers down, then moved apart.
  await page.evaluate(() => {
    const frame = document.querySelector('.sigwx-modal .sigwx-zoom');
    const r = frame.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const ev = (type, id, x, y) => frame.dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: 'touch',
      clientX: x, clientY: y, bubbles: true }));
    ev('pointerdown', 1, cx - 20, cy); ev('pointerdown', 2, cx + 20, cy);
    for (let i = 1; i <= 10; i++) { ev('pointermove', 1, cx - 20 - i * 6, cy); ev('pointermove', 2, cx + 20 + i * 6, cy); }
    ev('pointerup', 1, cx - 80, cy); ev('pointerup', 2, cx + 80, cy);
  });
  const z = await zoomState(page);
  expect(z.scale).toBeGreaterThan(3.5);            // fingers 40 px apart -> 160 px: x4
  expect(z.left).toBeLessThanOrEqual(0.5);         // the frame stays covered: no gap at any edge
  expect(z.top).toBeLessThanOrEqual(0.5);
  expect(z.right).toBeGreaterThanOrEqual(-0.5);
  expect(z.bottom).toBeGreaterThanOrEqual(-0.5);
  // One finger pans, and still cannot drag the chart out of its frame.
  await page.evaluate(() => {
    const frame = document.querySelector('.sigwx-modal .sigwx-zoom');
    const r = frame.getBoundingClientRect();
    const ev = (type, x, y) => frame.dispatchEvent(new PointerEvent(type, { pointerId: 3, pointerType: 'touch', clientX: x, clientY: y, bubbles: true }));
    ev('pointerdown', r.left + 10, r.top + 10); ev('pointermove', r.left + 2000, r.top + 2000); ev('pointerup', r.left + 2000, r.top + 2000);
  });
  const panned = await zoomState(page);
  expect(panned.left).toBeCloseTo(0, 0);           // stopped at the edge
  expect(panned.top).toBeCloseTo(0, 0);
});

test('a double tap toggles close in and back to the whole chart', async ({ page }) => {
  await open(page, { width: 390, height: 800 });
  const tap = () => page.evaluate(() => {
    const frame = document.querySelector('.sigwx-modal .sigwx-zoom');
    const r = frame.getBoundingClientRect();
    const ev = type => frame.dispatchEvent(new PointerEvent(type, { pointerId: 9, pointerType: 'touch',
      clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, bubbles: true }));
    ev('pointerdown'); ev('pointerup');
  });
  await tap(); await tap();
  expect((await zoomState(page)).scale).toBeCloseTo(2.5, 1);
  await page.waitForTimeout(350);
  await tap(); await tap();
  expect((await zoomState(page)).scale).toBeCloseTo(1, 2);
});

test('on a desktop the wheel zooms, and a new time starts from the whole chart', async ({ page }) => {
  await open(page, { width: 1280, height: 900 });
  const box = await page.locator('.sigwx-modal .sigwx-zoom').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, -500);
  expect((await zoomState(page)).scale).toBeGreaterThan(2);
  await page.evaluate(() => { const img = document.querySelector('.sigwx-modal .sigwx-img'); img.dispatchEvent(new Event('load')); });
  expect((await zoomState(page)).scale).toBeCloseTo(1, 2);
});
