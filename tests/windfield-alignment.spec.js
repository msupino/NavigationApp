// @ts-check
// Reported from the field: the particle field is drawn offset from the map — a viewport-sized
// box of streamlines sitting down/right of where the wind actually is, with blank margins on
// the other two sides. Measure the canvas against the map container.
const { test, expect } = require('./_setup');

const OM_RE = /^https:\/\/api\.open-meteo\.com\//;

function gridBody(url) {
  const d0 = new Date().toISOString().slice(0, 10);
  const d1 = new Date(Date.now() + 864e5).toISOString().slice(0, 10);
  const time = [];
  for (let h = 0; h < 24; h++) time.push(d0 + 'T' + String(h).padStart(2, '0') + ':00');
  for (let h = 0; h < 24; h++) time.push(d1 + 'T' + String(h).padStart(2, '0') + ':00');
  const lv = (String(url || '').match(/wind_speed_(\d+)hPa/) || [])[1] || '900';
  const hourly = { time };
  hourly['wind_speed_' + lv + 'hPa'] = new Array(time.length).fill(10);
  hourly['wind_direction_' + lv + 'hPa'] = new Array(time.length).fill(270);
  return JSON.stringify(new Array(600).fill({ hourly }));
}

async function bootWithField(page) {
  await page.route(OM_RE, r => r.fulfill({ status: 200, contentType: 'application/json',
    body: gridBody(r.request().url()) }));
  await page.addInitScript(() => { try { localStorage.setItem('navaid.sec.weather', '1'); } catch (e) {} });
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof map !== 'undefined' && !!document.getElementById('windfield-cb'));
  await page.evaluate(() => {
    const cb = document.getElementById('windfield-cb');
    cb.checked = true; cb.dispatchEvent(new Event('change'));
  });
  await page.waitForFunction(() => !!document.querySelector('canvas.velocity-overlay'), null,
    { timeout: 20000 });
  await page.waitForTimeout(1200);
}

// Offset of the field canvas from the map container, in CSS pixels. The canvas is built over
// the whole container ([[0,0],[size.x,size.y]]), so anything other than a match means the
// particles are painted somewhere the wind is not.
const offset = page => page.evaluate(() => {
  const c = document.querySelector('canvas.velocity-overlay');
  const m = document.getElementById('map') || map.getContainer();
  const a = c.getBoundingClientRect(), b = m.getBoundingClientRect();
  return {
    dx: Math.round(a.left - b.left), dy: Math.round(a.top - b.top),
    cw: Math.round(a.width), ch: Math.round(a.height),
    mw: Math.round(b.width), mh: Math.round(b.height),
    pane: c.parentElement && c.parentElement.className,
    paneTransform: c.parentElement ? getComputedStyle(c.parentElement).transform : '',
  };
});

test('the field stays aligned with the map after a pan', async ({ page }) => {
  await bootWithField(page);
  const before = await offset(page);
  expect(Math.abs(before.dx), 'x offset before panning').toBeLessThanOrEqual(2);
  expect(Math.abs(before.dy), 'y offset before panning').toBeLessThanOrEqual(2);

  // Pan the way a pilot does — drag the map, not setView.
  await page.evaluate(() => map.panBy([220, 160], { animate: false }));
  await page.waitForTimeout(1200);
  const after = await offset(page);
  expect(Math.abs(after.dx), 'x offset after panning: ' + JSON.stringify(after)).toBeLessThanOrEqual(2);
  expect(Math.abs(after.dy), 'y offset after panning: ' + JSON.stringify(after)).toBeLessThanOrEqual(2);
  // ...and it still covers the viewport rather than shrinking to a sub-box.
  expect(after.cw).toBeGreaterThanOrEqual(after.mw - 2);
  expect(after.ch).toBeGreaterThanOrEqual(after.mh - 2);
});

test('the field stays aligned after a zoom', async ({ page }) => {
  await bootWithField(page);
  await page.evaluate(() => map.setZoom(map.getZoom() - 1, { animate: false }));
  await page.waitForTimeout(1200);
  const after = await offset(page);
  expect(Math.abs(after.dx), 'x offset after zoom: ' + JSON.stringify(after)).toBeLessThanOrEqual(2);
  expect(Math.abs(after.dy), 'y offset after zoom: ' + JSON.stringify(after)).toBeLessThanOrEqual(2);
});

test('the wind at a screen point is the wind at that point on the map', async ({ page }) => {
  await bootWithField(page);
  await page.evaluate(() => map.panBy([220, 160], { animate: false }));
  await page.waitForTimeout(1200);
  // The field is uniform, so geography cannot be checked from the vectors alone. What CAN be
  // checked is that the extent the layer was started with matches the viewport it is drawn
  // over: a mismatch is exactly the reported symptom.
  const r = await page.evaluate(() => {
    let lyr = null;
    map.eachLayer(l => { if (l._windy) lyr = l; });
    const b = map.getBounds();
    const w = lyr._windy;
    return {
      windyExtent: w.__extent || null,
      mapSW: [b.getSouthWest().lng, b.getSouthWest().lat],
      mapNE: [b.getNorthEast().lng, b.getNorthEast().lat],
    };
  });
  // Recorded by the patch below; if absent the patch is not in this build.
  if (!r.windyExtent) test.skip(true, 'build does not record the started extent');
  expect(Math.abs(r.windyExtent[0][0] - r.mapSW[0])).toBeLessThan(0.05);
  expect(Math.abs(r.windyExtent[1][1] - r.mapNE[1])).toBeLessThan(0.05);
});

test('the field follows a viewport resize', async ({ page }) => {
  // The reported box was SMALLER than the viewport and offset — the signature of a canvas
  // built for an older container size. On a phone that happens without any user intent: the
  // browser's URL bar hides on scroll and the viewport grows.
  await page.setViewportSize({ width: 800, height: 700 });
  await bootWithField(page);
  const before = await offset(page);
  await page.setViewportSize({ width: 800, height: 900 });
  await page.waitForTimeout(1500);
  const after = await offset(page);
  expect(Math.abs(after.dx), 'x offset after resize: ' + JSON.stringify(after)).toBeLessThanOrEqual(2);
  expect(Math.abs(after.dy), 'y offset after resize: ' + JSON.stringify(after)).toBeLessThanOrEqual(2);
  expect(after.ch, 'canvas height did not follow the viewport: ' + JSON.stringify({ before, after }))
    .toBeGreaterThanOrEqual(after.mh - 2);
});
