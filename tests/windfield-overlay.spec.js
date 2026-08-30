// @ts-check
// Live wind-field overlay (prototype): a coarse Open-Meteo winds-aloft grid fed
// to the leaflet-velocity animated particle layer. The toggle fetches the grid
// and adds a canvas overlay; unchecking removes it.
const { test, expect } = require('./_setup');

// Anchored to the Open-Meteo API origin so it can't match a look-alike host
// embedded elsewhere in a URL (CodeQL js/regex/missing-anchor).
const OM_RE = /^https:\/\/api\.open-meteo\.com\//;

// 48 hourly samples (forecast_days=2) starting today 00:00Z — uniform 10 m/s
// from 270°. Echoes whatever pressure level the request asked for so the same
// mock serves any altitude.
function gridBody(url) {
  const day0 = new Date().toISOString().slice(0, 10);
  const day1 = new Date(Date.now() + 864e5).toISOString().slice(0, 10);
  const time = [];
  for (let h = 0; h < 24; h++) time.push(day0 + 'T' + String(h).padStart(2, '0') + ':00');
  for (let h = 0; h < 24; h++) time.push(day1 + 'T' + String(h).padStart(2, '0') + ':00');
  const n = time.length;
  const lv = (String(url || '').match(/wind_speed_(\d+)hPa/) || [])[1] || '900';
  const hourly = { time };
  hourly['wind_speed_' + lv + 'hPa'] = new Array(n).fill(10);
  hourly['wind_direction_' + lv + 'hPa'] = new Array(n).fill(270);
  return JSON.stringify(new Array(600).fill({ hourly }));   // ≥ grid point count
}

async function boot(page) {
  await page.route(OM_RE, r => r.fulfill({ status: 200, contentType: 'application/json', body: gridBody(r.request().url()) }));
  await page.addInitScript(() => { try { localStorage.setItem('navaid.sec.weather', '1'); } catch (e) {} });
  await page.goto('?lang=en');
  await page.waitForFunction(() => typeof map !== 'undefined' && document.getElementById('windfield-cb'));
  // leaflet-velocity loads from CDN — wait for it before toggling.
  await page.waitForFunction(() => typeof L !== 'undefined' && typeof L.velocityLayer === 'function', null, { timeout: 20000 });
}

// Checking the box auto-fetches the grid (a "Loading wind…" banner shows while
// it's in flight) and renders the field.
async function loadWind(page) {
  await page.locator('#windfield-cb').check();
}

test('toggling the wind field adds a velocity canvas; untoggling removes it', async ({ page }) => {
  await boot(page);
  const canvases = () => page.locator('.leaflet-windfield-pane canvas');
  const before = await canvases().count();
  await loadWind(page);
  // Velocity layer renders a canvas into the overlay pane once the grid loads.
  await expect(canvases()).toHaveCount(before + 1, { timeout: 10000 });
  await page.locator('#windfield-cb').uncheck();
  await expect(canvases()).toHaveCount(before);
});

test('the grid request covers many points over Israel in m/s', async ({ page }) => {
  let url = '';
  await page.route(OM_RE, r => { url = r.request().url(); return r.fulfill({ status: 200, contentType: 'application/json', body: gridBody(url) }); });
  await page.addInitScript(() => { try { localStorage.setItem('navaid.sec.weather', '1'); } catch (e) {} });
  await page.goto('?lang=en');
  await page.waitForFunction(() => typeof L !== 'undefined' && typeof L.velocityLayer === 'function', null, { timeout: 20000 });
  await loadWind(page);
  await expect.poll(() => url).toMatch(/wind_speed_\d+hPa/);
  const lats = new URLSearchParams(url.split('?')[1]).get('latitude').split(',');
  expect(lats.length).toBeGreaterThan(50);             // a real grid, not a point
  expect(url).toContain('wind_speed_unit=ms');
});

test('opacity slider shows with the field and drives the canvas opacity', async ({ page }) => {
  await boot(page);
  await expect(page.locator('#windfield-controls')).toBeHidden();
  await loadWind(page);
  await expect(page.locator('#windfield-controls')).toBeVisible();
  await expect(page.locator('.leaflet-windfield-pane canvas')).toHaveCount(1, { timeout: 10000 });
  const op = page.locator('#windfield-opacity');
  await op.fill('0.4');
  await op.dispatchEvent('input');
  const canvasOpacity = await page.locator('.leaflet-windfield-pane canvas').evaluate(c => c.style.opacity);
  expect(parseFloat(canvasOpacity)).toBeCloseTo(0.4, 2);
  await expect(page.locator('#windfield-opacity-val')).toHaveText('40%');
});

test('time slider scrubs the forecast hour (0..24 forward) and labels it in Zulu', async ({ page }) => {
  await boot(page);
  await loadWind(page);
  await expect(page.locator('.leaflet-windfield-pane canvas')).toHaveCount(1, { timeout: 10000 });
  // The wind-field time is now driven by the shared look-ahead slider.
  const slider = page.locator('#lookahead-time');
  await expect(slider).toHaveAttribute('max', '24');     // 24h forward
  await expect(slider).toHaveValue('0');                 // starts at "now"
  // Move +6h → label shows the offset then a Zulu time, layer stays.
  await slider.fill('6');
  await slider.dispatchEvent('input');
  await expect(page.locator('#lookahead-time-val')).toHaveText(/\+6h · (\d{2}-\d{2} )?\d{2}:\d{2}Z/);
  await expect(page.locator('.leaflet-windfield-pane canvas')).toHaveCount(1);
});

test('altitude slider refetches at the matching pressure level', async ({ page }) => {
  let url = '';
  await page.route(OM_RE, r => { url = r.request().url(); return r.fulfill({ status: 200, contentType: 'application/json', body: gridBody(url) }); });
  await page.addInitScript(() => { try { localStorage.setItem('navaid.sec.weather', '1'); } catch (e) {} });
  await page.goto('?lang=en');
  await page.waitForFunction(() => typeof L !== 'undefined' && typeof L.velocityLayer === 'function', null, { timeout: 20000 });
  await loadWind(page);
  await expect.poll(() => url).toMatch(/wind_speed_\d+hPa/);
  const lvlOf = u => (u.match(/wind_speed_(\d+)hPa/) || [])[1];
  const lowAltLevel = lvlOf(url);                  // default 1500 ft
  // Raise to the 5000 ft cap → a higher level (lower hPa); the field refetches.
  const alt = page.locator('#windfield-alt');
  await alt.fill('5000');
  await alt.dispatchEvent('change');
  await expect(page.locator('#windfield-alt-val')).toHaveText('5,000 ft');
  await expect.poll(() => lvlOf(url)).not.toBe(lowAltLevel);
  expect(Number(lvlOf(url))).toBeLessThan(Number(lowAltLevel));   // higher alt → lower hPa
});

test('opacity reset restores the default', async ({ page }) => {
  await boot(page);
  await loadWind(page);
  await expect(page.locator('.leaflet-windfield-pane canvas')).toHaveCount(1, { timeout: 10000 });
  const op = page.locator('#windfield-opacity');
  const def = await op.inputValue();                 // HTML default (0.7)
  await op.fill('0.3'); await op.dispatchEvent('input');
  await expect(page.locator('#windfield-opacity-val')).toHaveText('30%');
  await page.locator('#windfield-opacity-reset').click();
  expect(await op.inputValue()).toBe(def);
  await expect(page.locator('#windfield-opacity-val')).toHaveText(Math.round(parseFloat(def) * 100) + '%');
  const o = await page.locator('.leaflet-windfield-pane canvas').evaluate(c => c.style.opacity);
  expect(parseFloat(o)).toBeCloseTo(parseFloat(def), 2);
});

test('wind field renders in a screen-fixed transparent pane', async ({ page }) => {
  await boot(page);
  await loadWind(page);
  await expect(page.locator('.leaflet-windfield-pane canvas')).toHaveCount(1, { timeout: 10000 });
  // The velocity canvas draws in bearing-aware screen coords. It must be a direct child of
  // the map container, not mapPane: an animated canvas composited with the transformed tile
  // panes could blank one underlying tile column until the wind field was removed.
  const r = await page.evaluate(() => {
    const pane = map.getPane('windfield');
    const c = pane && pane.querySelector('canvas');
    const mapRect = map.getContainer().getBoundingClientRect();
    const canvasRect = c && c.getBoundingClientRect();
    return {
      paneTransform: getComputedStyle(pane).transform,        // must be 'none'
      paneParentIsMapContainer: pane.parentElement === map.getContainer(),
      canvasInWindfieldPane: !!c,
      canvasRendered: !!(c && c.width > 0 && c.height > 0),
      canvasOffsetX: canvasRect && canvasRect.left - mapRect.left,
      canvasOffsetY: canvasRect && canvasRect.top - mapRect.top,
      paneBackground: getComputedStyle(pane).backgroundColor,
      canvasBackground: c && getComputedStyle(c).backgroundColor,
    };
  });
  expect(r.paneTransform).toBe('none');         // wind-field pane is NOT rotated
  expect(r.paneParentIsMapContainer).toBe(true);
  expect(r.canvasInWindfieldPane).toBe(true);
  expect(r.canvasRendered).toBe(true);
  expect(Math.abs(r.canvasOffsetX)).toBeLessThan(1);
  expect(Math.abs(r.canvasOffsetY)).toBeLessThan(1);
  expect(r.paneBackground).toBe('rgba(0, 0, 0, 0)');
  expect(r.canvasBackground).toBe('rgba(0, 0, 0, 0)');
});

test('wind canvas stays at the map origin after pan and rotation', async ({ page }) => {
  await boot(page);
  await loadWind(page);
  await expect(page.locator('.leaflet-windfield-pane canvas')).toHaveCount(1, { timeout: 10000 });
  await page.evaluate(() => {
    map.panBy([260, 90], { animate: false });
    map.setBearing(35);
  });
  await page.waitForTimeout(600);                // debounced field rebuild after rotation
  const offset = await page.evaluate(() => {
    const mapRect = map.getContainer().getBoundingClientRect();
    const canvasRect = document.querySelector('.leaflet-windfield-pane canvas').getBoundingClientRect();
    return { x: canvasRect.left - mapRect.left, y: canvasRect.top - mapRect.top };
  });
  expect(Math.abs(offset.x)).toBeLessThan(1);
  expect(Math.abs(offset.y)).toBeLessThan(1);
});

// Deliberately replaces "a rotated map hides the wind field and shows a north-up note".
// That test encoded a workaround, not a requirement: the field was withheld above 0° bearing
// on the belief that leaflet-velocity bakes an unplaceable north-up grid. It does not — its
// per-pixel inversion and its u/v→screen Jacobian both go through the rotation-aware map
// projection; it simply never rebuilds on rotation, so the field went stale. It is rebuilt
// now, and the direction assertions live in tests/windfield-rotation.spec.js.
test('a rotated map keeps the wind field, with no north-up note', async ({ page }) => {
  await boot(page);
  await loadWind(page);
  const canvas = page.locator('.leaflet-windfield-pane canvas');
  await expect(canvas).toHaveCount(1, { timeout: 10000 });
  await page.evaluate(() => map.setBearing(45));
  await page.waitForTimeout(600);            // debounced rebuild
  // The field survives the rotation instead of being torn down...
  await expect(canvas).toHaveCount(1);
  // ...and nothing apologises for a limitation that no longer exists.
  await expect(page.locator('#windfield-status')).toBeHidden();
  await page.evaluate(() => map.setBearing(0));
  await page.waitForTimeout(600);
  await expect(canvas).toHaveCount(1);
});

test('a north-up pan keeps the wind field (no spurious removal)', async ({ page }) => {
  await boot(page);
  await loadWind(page);
  const canvas = page.locator('.leaflet-windfield-pane canvas');
  await expect(canvas).toHaveCount(1, { timeout: 10000 });
  // bearing 0: pans are handled natively by Leaflet; the field must not be torn
  // down (and no north-up note should appear).
  await page.evaluate(() => map.panBy([150, 90], { animate: false }));
  await page.waitForTimeout(200);   // let any moveend rAF settle
  await expect(canvas).toHaveCount(1);
  await expect(page.locator('#windfield-status')).toBeHidden();
});

test('wind-field toggle persists across reload', async ({ page }) => {
  await boot(page);
  await loadWind(page);
  await expect(page.locator('.leaflet-windfield-pane canvas')).toHaveCount(1, { timeout: 10000 });
  await page.reload();
  await page.waitForFunction(() => document.getElementById('windfield-cb'));
  await expect(page.locator('#windfield-cb')).toBeChecked();
});

// Boot with a request counter so tests can assert whether a fetch happened.
async function bootCounting(page, ref) {
  await page.route(OM_RE, r => { ref.n++; return r.fulfill({ status: 200, contentType: 'application/json', body: gridBody(r.request().url()) }); });
  await page.addInitScript(() => { try { localStorage.setItem('navaid.sec.weather', '1'); } catch (e) {} });
  await page.goto('?lang=en');
  await page.waitForFunction(() => typeof L !== 'undefined' && typeof L.velocityLayer === 'function', null, { timeout: 20000 });
}

test('checking the box auto-fetches (no Load button) and renders', async ({ page }) => {
  const ref = { n: 0 };
  await bootCounting(page, ref);
  await expect(page.locator('#windfield-load')).toHaveCount(0);           // button is gone
  await page.locator('#windfield-cb').check();
  await expect(page.locator('.leaflet-windfield-pane canvas')).toHaveCount(1, { timeout: 10000 });
  expect(ref.n).toBeGreaterThan(0);                                       // fetched automatically
});

test('a Loading wind banner shows while fetching, then clears', async ({ page }) => {
  // Delay the grid response so the banner is observable mid-fetch.
  await page.route(OM_RE, async r => {
    await new Promise(s => setTimeout(s, 800));
    return r.fulfill({ status: 200, contentType: 'application/json', body: gridBody(r.request().url()) });
  });
  await page.addInitScript(() => { try { localStorage.setItem('navaid.sec.weather', '1'); } catch (e) {} });
  await page.goto('?lang=en');
  await page.waitForFunction(() => typeof L !== 'undefined' && typeof L.velocityLayer === 'function', null, { timeout: 20000 });
  await page.locator('#windfield-cb').check();
  const banner = page.locator('#windfield-status.windfield-loading');
  await expect(banner).toBeVisible();                                     // banner during fetch
  await expect(banner).toHaveText(/loading/i);
  await expect(page.locator('.leaflet-windfield-pane canvas')).toHaveCount(1, { timeout: 10000 });
  await expect(page.locator('#windfield-status')).toBeHidden();           // clears when loaded
});

test('a failed fetch hides the sliders and clears the toggle', async ({ page }) => {
  // Wind grid request fails → field unavailable.
  await page.route(OM_RE, r => r.fulfill({ status: 500, contentType: 'text/plain', body: 'err' }));
  await page.addInitScript(() => { try { localStorage.setItem('navaid.sec.weather', '1'); } catch (e) {} });
  await page.goto('?lang=en');
  await page.waitForFunction(() => typeof L !== 'undefined' && typeof L.velocityLayer === 'function', null, { timeout: 20000 });
  // click (not check) — the error path unchecks it, so check()'s state
  // assertion would race and fail.
  await page.locator('#windfield-cb').click();
  // Error surfaces; sliders hidden; toggle cleared; no canvas.
  await expect(page.locator('#windfield-status')).toBeVisible();
  await expect(page.locator('#windfield-controls')).toBeHidden();
  await expect(page.locator('#windfield-cb')).not.toBeChecked();
  await expect(page.locator('.leaflet-windfield-pane canvas')).toHaveCount(0);
});

test('a refetch queued mid-fetch does not leak into a later re-enable', async ({ page }) => {
  const ref = { n: 0 };
  // Slow responses so we can act while a fetch is in flight (busy === true).
  await page.route(OM_RE, async r => {
    ref.n++;
    await new Promise(s => setTimeout(s, 800));
    return r.fulfill({ status: 200, contentType: 'application/json', body: gridBody(r.request().url()) });
  });
  await page.addInitScript(() => { try { localStorage.setItem('navaid.sec.weather', '1'); } catch (e) {} });
  await page.goto('?lang=en');
  await page.waitForFunction(() => typeof L !== 'undefined' && typeof L.velocityLayer === 'function', null, { timeout: 20000 });
  const cb = page.locator('#windfield-cb');
  await cb.check();                              // fetch #1 in flight
  await expect.poll(() => ref.n).toBe(1);
  // Altitude change while busy queues a refetch (refetchPending = true)…
  const alt = page.locator('#windfield-alt');
  await alt.fill('5000');
  await alt.dispatchEvent('change');
  // …then turn the field OFF before the fetch resolves. The queued refetch must
  // be dropped, not leaked into the next enable.
  await cb.uncheck();
  await page.waitForTimeout(1100);              // fetch #1 settles; no leaked refetch
  expect(ref.n).toBe(1);
  // Re-enable → exactly one fresh fetch, not a double from a stale pending flag.
  await cb.check();
  await page.waitForTimeout(1100);
  expect(ref.n).toBe(2);
});

test('unchecking mid-fetch leaves no orphan wind layer', async ({ page }) => {
  // Delay the grid so we can uncheck before it resolves.
  await page.route(OM_RE, async r => {
    await new Promise(s => setTimeout(s, 1000));
    return r.fulfill({ status: 200, contentType: 'application/json', body: gridBody(r.request().url()) });
  });
  await page.addInitScript(() => { try { localStorage.setItem('navaid.sec.weather', '1'); } catch (e) {} });
  await page.goto('?lang=en');
  await page.waitForFunction(() => typeof L !== 'undefined' && typeof L.velocityLayer === 'function', null, { timeout: 20000 });
  await page.locator('#windfield-cb').check();
  await page.locator('#windfield-cb').uncheck();     // before the fetch resolves
  await page.waitForTimeout(1500);                    // let the stale fetch finish
  await expect(page.locator('.leaflet-windfield-pane canvas')).toHaveCount(0);
  await expect(page.locator('#windfield-cb')).not.toBeChecked();
});
