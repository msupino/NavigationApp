// @ts-check
const { test, expect } = require('./_setup');
const { pressShortcut } = require('./_toolbar');

// e2e-deployed pulls real map tiles; z=8 pane + loupe CSS settle can exceed
// the default 15s test timeout without these budgets.
const deployedPreview = !!process.env.EXPECTED_SHA;
const magnifierTileReadyMs = deployedPreview ? 35_000 : (process.env.CI ? 25_000 : 12_000);
const magnifierCalibTestMs = deployedPreview ? 120_000 : (process.env.CI ? 120_000 : 60_000);
// Tile-pane readiness for z=8 (pan / margin / Perfecting tests).
const magnifierPaneTileMs = deployedPreview ? 45_000 : (process.env.CI ? 35_000 : 18_000);
const CHART_TILE_RE = /^https?:\/\/([^/]*\.)?flight-maps\.com\/tiles\//;
const TILE_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
  'base64');

async function fulfillTile(route, delayMs = 0) {
  if (delayMs > 0) await new Promise(r => setTimeout(r, delayMs));
  return route.fulfill({
    status: 200,
    contentType: 'image/png',
    body: TILE_PNG,
  });
}

function isChartTileUrl(url) {
  try {
    const { hostname } = new URL(url);
    return hostname === 'flight-maps.com' || hostname.endsWith('.flight-maps.com');
  } catch (_) {
    return false;
  }
}

function chartTileZoom(url) {
  const m = url.match(/\/tiles\/[^/]+\/(\d+)\//);
  return m ? parseInt(m[1], 10) : null;
}

test.describe('Magnifying glass', () => {
  test.describe.configure({ timeout: deployedPreview ? 120_000 : 60_000 });

  test.beforeEach(async ({ page }) => {
    await page.route(CHART_TILE_RE, route => fulfillTile(route));
    await page.addInitScript(() => {
      try {
        localStorage.clear();
        sessionStorage.clear();
        for (const s of ['build','view','display','charts','export','print'])
          localStorage.setItem('navaid.sec.' + s, '1');
      } catch (e) {}
    });
    await page.goto('?lang=en');
    await page.waitForFunction(() => typeof state !== 'undefined');
    // ensure nav-waypoints are loaded for the snapping logic
    await page.waitForFunction(() => window.navWP && window.navWP.length > 0);
  });

  test('button exists in View section and toggles magnifier', async ({ page }) => {
    const btn = page.locator('#tool-magnifier');
    await expect(btn).toBeVisible();
    await expect(btn).toHaveText(/Magnifying glass/);
    // starts inactive
    await expect(btn).not.toHaveClass(/active/);
    await expect(page.locator('#magnifier')).not.toBeVisible();
    // click to activate
    await btn.click();
    await expect(btn).toHaveClass(/active/);
    await expect(page.locator('#magnifier')).toBeVisible();
    // settings panel visible
    await expect(page.locator('#magnifier-settings')).not.toHaveClass(/hidden/);
    // click to deactivate
    await btn.click();
    await expect(page.locator('#magnifier')).not.toBeVisible();
  });

  test('magnifier follows mouse when active', async ({ page }) => {
    await page.locator('#tool-magnifier').click();
    const mag = page.locator('#magnifier');
    await expect(mag).toBeVisible();
    // move mouse over the map
    const mapBox = await page.locator('#map').boundingBox();
    if (!mapBox) { test.skip(true, 'map not found'); return; }
    const cx = mapBox.x + mapBox.width / 2;
    const cy = mapBox.y + mapBox.height / 2;
    await page.mouse.move(cx, cy);
    // magnifier should be positioned near the cursor
    const magBox = await mag.boundingBox();
    expect(magBox).toBeTruthy();
    if (magBox) {
      expect(Math.abs(magBox.x + magBox.width / 2 - cx)).toBeLessThan(10);
    }
  });

  test('zoom slider updates magnifierZoom', async ({ page }) => {
    await page.locator('#tool-magnifier').click();
    await page.waitForSelector('#mag-zoom');
    const slider = page.locator('#mag-zoom');
    // set to 3
    await slider.fill('3');
    await slider.dispatchEvent('input');
    const zoomVal = await page.evaluate(() => window.magnifierZoom);
    expect(zoomVal).toBe(3);
  });

  test('click-to-lock toggles on click and selects underlying item', async ({ page }) => {
    await page.locator('#tool-magnifier').click();
    const mag = page.locator('#magnifier');
    await expect(mag).toBeVisible();
    // move to a position
    const mapBox = await page.locator('#map').boundingBox();
    if (!mapBox) { test.skip(true, 'map not found'); return; }
    // first, add a couple waypoints so there's something to select. In
    // desktop-menubar mode the preset-open section dropdowns overlay the map,
    // so a "map" click can land on a dropdown button instead — this test used
    // to flakily hit the Charts dropdown's Mosaic button, whose modal then
    // closed all menus and hid #tool-add (60s click timeout). Close the menus
    // and toggle add-mode via its keyboard shortcut, no dropdowns involved.
    await pressShortcut(page, 'a');
    await page.waitForFunction(() => state.mode === 'add');
    const wp1x = mapBox.x + 400, wp1y = mapBox.y + 300;
    const wp2x = mapBox.x + 600, wp2y = mapBox.y + 300;
    await page.mouse.click(wp1x, wp1y);
    await page.mouse.click(wp2x, wp2y);
    await page.keyboard.press('a'); // exit add mode — magnifier stays on
    await page.waitForFunction(() => state.mode !== 'add');
    // move to first waypoint and click to lock
    await page.mouse.move(wp1x, wp1y);
    const boxBefore = await mag.boundingBox();
    await page.mouse.click(wp1x, wp1y);
    // movement should be locked now
    await page.mouse.move(mapBox.x + 800, mapBox.y + 400);
    const boxAfter = await mag.boundingBox();
    expect(boxBefore?.x).toBe(boxAfter?.x);
    expect(boxBefore?.y).toBe(boxAfter?.y);
    // click again to unlock and select something
    await page.mouse.click(wp2x, wp2y);
    // move mouse — magnifier should follow
    await page.mouse.move(mapBox.x + 700, mapBox.y + 350);
    const boxReleased = await mag.boundingBox();
    expect(boxReleased?.x).not.toBe(boxAfter?.x);
  });

  test('ESC closes magnifier', async ({ page }) => {
    await page.locator('#tool-magnifier').click();
    await expect(page.locator('#magnifier')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#magnifier')).not.toBeVisible();
    await expect(page.locator('#tool-magnifier')).not.toHaveClass(/active/);
  });

  test('settings close button closes magnifier', async ({ page }) => {
    await page.locator('#tool-magnifier').click();
    await expect(page.locator('#magnifier-settings')).not.toHaveClass(/hidden/);
    await page.locator('#mag-settings-close').click();
    await expect(page.locator('#magnifier')).not.toBeVisible();
  });

  // Regression: an earlier iteration of the hi-res loader positioned the
  // sub-tiles at world-pixel coords (e.g. xNum*256 ≈ 78 000 px) while
  // Leaflet's cloned tiles are positioned via `transform: translate3d(local,
  // local, 0)` against an arbitrary tile-pane origin. That put every hi-res
  // tile ~80 000 px from the magnifier viewport and only the blurry z=mapZoom
  // clones remained visible. This test pins the loader to the cloned tile's
  // local coord system: each hi-res sub-tile must share its parent clone's
  // top-left x/y (with the dx*sz / dy*sz sub-pixel grid offsets).
  test('high-res sub-tiles align with the cloned parent tile', async ({ page }) => {
    // Wait for the base tile layer to populate the pane before flipping the
    // magnifier on — the loader needs real `<img>` elements to parse.
    await page.waitForFunction(
      () => document.querySelectorAll('.leaflet-tile-pane img').length > 4,
      { timeout: 10000 });
    await page.waitForTimeout(1000);

    const mapBox = await page.locator('#map').boundingBox();
    if (!mapBox) { test.skip(true, 'map not found'); return; }
    await page.mouse.move(mapBox.x + mapBox.width / 2, mapBox.y + mapBox.height / 2);
    await page.locator('#tool-magnifier').click();
    // Wait for the observable condition under test instead of sampling after
    // a fixed delay. On a busy CI worker the initial loupe rebuild can be
    // superseded while its hi-res tiles are settling, briefly leaving only
    // the cloned map-zoom layer in the DOM.
    await page.waitForFunction(() => {
      const zooms = new Set();
      for (const el of document.querySelectorAll('#mag-content img')) {
        if (!el.src) continue;
        try {
          const parts = new URL(el.src).pathname.split('/');
          const z = parseInt(parts[parts.length - 3], 10);
          if (Number.isFinite(z)) zooms.add(z);
        } catch (e) { /* wait for another image */ }
      }
      return zooms.size >= 2;
    }, { timeout: magnifierTileReadyMs });

    const report = await page.evaluate(() => {
      const content = document.getElementById('mag-content');
      if (!content) return { error: 'no mag-content' };
      // Tile clones live inside a `tileWrap` div (it carries the rotate-pane
      // matrix); query all <img> wherever nested rather than direct children.
      const kids = Array.from(content.querySelectorAll('img'));
      // Group children by the tile zoom encoded in their `src`. The clones
      // come straight from `.leaflet-tile-pane img` (current map zoom); the
      // hi-res sub-tiles use one of the deeper native zoom levels.
      const byZ = {};
      const localPos = el => {
        if (el.style.left) {
          return { x: parseFloat(el.style.left), y: parseFloat(el.style.top) };
        }
        if (el.style.transform) {
          try {
            const m = new DOMMatrixReadOnly(el.style.transform);
            return { x: m.is2D ? m.e : m.m41, y: m.is2D ? m.f : m.m42 };
          } catch (e) { /* fall through */ }
        }
        return null;
      };
      for (const el of kids) {
        if (el.tagName !== 'IMG' || !el.src) continue;
        let z;
        try {
          const parts = new URL(el.src).pathname.split('/');
          z = parseInt(parts[parts.length - 3], 10);
        } catch (e) { continue; }
        if (!Number.isFinite(z)) continue;
        (byZ[z] = byZ[z] || []).push({
          src: el.src, pos: localPos(el),
          w: parseFloat(el.style.width) || el.clientWidth,
        });
      }
      return { byZ, mapZoom: map.getZoom() };
    });

    expect(report.error).toBeUndefined();
    const zs = Object.keys(report.byZ).map(Number).sort();
    // Must have both the clone layer AND a deeper-zoom hi-res layer.
    expect(zs.length).toBeGreaterThanOrEqual(2);
    const clonedZ = Math.min(...zs);
    const hiresZ = Math.max(...zs);
    expect(hiresZ).toBeGreaterThan(clonedZ);

    const clones = report.byZ[clonedZ];
    const hires = report.byZ[hiresZ];
    expect(clones.length).toBeGreaterThan(0);
    expect(hires.length).toBeGreaterThan(0);
    // Clones live in Leaflet's local tile-pane coords (~ a few hundred px).
    // If the hi-res loader regressed back to world-pixel positioning the
    // sub-tiles would sit at ~xNum*256 — easily 50 000+ px away.
    const maxClonedX = Math.max(...clones.map(c => Math.abs(c.pos.x)));
    const maxHiresX = Math.max(...hires.map(h => Math.abs(h.pos.x)));
    expect(maxHiresX).toBeLessThan(maxClonedX + 1024);

    // Every loaded hi-res sub-tile must sit on the sub-pixel grid of one of
    // the cloned tiles (i.e. `hi.pos - clone.pos` ≈ (dx*sz, dy*sz) with dx,
    // dy ∈ [0, sub)). If positioning had regressed back to world-pixel
    // coords, the modulus check would fail for every hi-res tile because
    // they'd be 50 000+ px from any clone.
    const sub = Math.pow(2, hiresZ - clonedZ);
    const sz = 256 / sub;
    let aligned = 0;
    for (const h of hires) {
      const ok = clones.some(c => {
        const ddx = h.pos.x - c.pos.x;
        const ddy = h.pos.y - c.pos.y;
        if (ddx < -0.5 || ddy < -0.5) return false;
        if (ddx > (sub - 1) * sz + 0.5) return false;
        if (ddy > (sub - 1) * sz + 0.5) return false;
        const rx = ddx % sz, ry = ddy % sz;
        return (rx < 0.5 || rx > sz - 0.5) && (ry < 0.5 || ry > sz - 0.5);
      });
      if (ok) aligned++;
    }
    // ALL hi-res tiles should be properly placed on a clone's sub-grid.
    expect(aligned).toBe(hires.length);
    // And the sub-tile pixel size must reflect the magnifier's zoom step.
    expect(Math.abs(hires[0].w - sz)).toBeLessThan(1);
  });

  // Adaptive zoom: at low map zooms the loupe must surface readable VFR
  // chart detail (≥ z=12), not just blow up the wide-out z=8 source. The
  // pre-adaptive iteration capped the hi-res target at `mapZoom +
  // ceil(log2(magnifierZoom))`, so at the country-wide z=8 view the loupe
  // would only fetch z=9 / z=10 tiles — chart labels still illegible. The
  // adaptive design floors the hi-res FETCH zoom at MAG_BASELINE_Z (12);
  // those tiles are downsampled on display to the slider's magnification.
  test('adaptive: low map zoom fetches z>=12 hi-res tiles', async ({ page }) => {
    await page.evaluate(() => map.setZoom(8));
    await page.waitForFunction(
      () => Array.from(document.querySelectorAll('.leaflet-tile-pane img'))
              .some(i => /\/8\/\d+\/\d+\.png/.test(i.src)),
      { timeout: 10000 });
    await page.waitForTimeout(1000);

    const mapBox = await page.locator('#map').boundingBox();
    if (!mapBox) { test.skip(true, 'map not found'); return; }
    await page.mouse.move(mapBox.x + mapBox.width / 2, mapBox.y + mapBox.height / 2);
    await page.locator('#tool-magnifier').click();
    await page.waitForTimeout(2500);

    const report = await page.evaluate(() => {
      const kids = Array.from(document.querySelectorAll('#mag-content img'));
      const zs = new Set();
      for (const el of kids) {
        if (!el.src) continue;
        try {
          const p = new URL(el.src).pathname.split('/');
          const z = parseInt(p[p.length - 3], 10);
          if (Number.isFinite(z)) zs.add(z);
        } catch (e) {}
      }
      return {
        zs: [...zs].sort((a, b) => a - b),
        slider: window.magnifierZoom,
        mapZoom: map.getZoom(),
      };
    });
    // Cloned tiles at z=8, hi-res must reach the readability baseline.
    expect(report.zs).toContain(8);
    expect(Math.max(...report.zs)).toBeGreaterThanOrEqual(12);
  });

  // Slider calibration: the loupe's visible CSS scale must EQUAL the
  // slider value, regardless of how deep the adaptive `sub` goes. A
  // pre-fix iteration set `_magEffS = max(slider, sub)`, so at base z=8
  // / slider 4.75 the loupe rendered at 16× — almost 4× the user's
  // dialled-in value. Hi-res tiles can still be deeper (z>=12) so they
  // downsample to slider density for crispness; that's an orthogonal
  // implementation detail.
  test('slider value === visible CSS scale (z=8, slider=4.75)', async ({ page }) => {
    test.setTimeout(magnifierCalibTestMs);
    await page.evaluate(() => map.setZoom(8));
    await page.waitForFunction(
      () => Array.from(document.querySelectorAll('.leaflet-tile-pane img'))
              .some(i => /\/8\/\d+\/\d+\.png/.test(i.src)),
      { timeout: magnifierTileReadyMs });
    await page.waitForTimeout(1000);

    const mapBox = await page.locator('#map').boundingBox();
    if (!mapBox) { test.skip(true, 'map not found'); return; }
    await page.mouse.move(mapBox.x + mapBox.width / 2, mapBox.y + mapBox.height / 2);
    // Open the magnifier first — `#mag-zoom` lives in the
    // `magnifier-settings` panel which is `display:none` until then.
    await page.locator('#tool-magnifier').click();
    await page.waitForTimeout(800);

    // Now dial the slider to 4.75 (the value from the bug report).
    await page.locator('#mag-zoom').fill('4.75');
    await page.locator('#mag-zoom').dispatchEvent('input');
    await page.waitForTimeout(1500);

    const report = await page.evaluate(() => {
      const content = document.getElementById('mag-content');
      const trMatch = /scale\(([\d.]+)\)/.exec(content.style.transform || '');
      const kids = Array.from(document.querySelectorAll('#mag-content img'));
      const zs = new Set();
      for (const el of kids) {
        if (!el.src) continue;
        try {
          const p = new URL(el.src).pathname.split('/');
          const z = parseInt(p[p.length - 3], 10);
          if (Number.isFinite(z)) zs.add(z);
        } catch (e) {}
      }
      return {
        contentScale: trMatch ? parseFloat(trMatch[1]) : null,
        slider: window.magnifierZoom,
        zs: [...zs].sort((a, b) => a - b),
      };
    });
    // Visible scale must EQUAL the slider — not 16, not 8, not anything
    // else. The pre-fix bug had this at 16 even though slider=4.75.
    expect(report.slider).toBe(4.75);
    expect(report.contentScale).toBeCloseTo(4.75, 5);
    // Sub-tile fetch is still adaptive: deeper tiles get fetched (>=11)
    // so the on-screen pixels remain crisp after slider downsampling.
    expect(Math.max(...report.zs)).toBeGreaterThanOrEqual(11);
  });

  // Same calibration invariant holds at slider=1: the loupe shows the
  // map at 1× (no magnification). Pre-fix this rendered at sub=16 — a
  // 16× mystery zoom on a "1×" slider setting.
  test('slider value === visible CSS scale (z=8, slider=1)', async ({ page }) => {
    test.setTimeout(magnifierCalibTestMs);
    await page.evaluate(() => map.setZoom(8));
    await page.waitForFunction(
      () => Array.from(document.querySelectorAll('.leaflet-tile-pane img'))
              .some(i => /\/8\/\d+\/\d+\.png/.test(i.src)),
      { timeout: magnifierTileReadyMs });
    await page.waitForTimeout(800);

    const mapBox = await page.locator('#map').boundingBox();
    if (!mapBox) { test.skip(true, 'map not found'); return; }
    await page.mouse.move(mapBox.x + mapBox.width / 2, mapBox.y + mapBox.height / 2);
    await page.locator('#tool-magnifier').click();
    await page.waitForTimeout(800);

    await page.locator('#mag-zoom').fill('1');
    await page.locator('#mag-zoom').dispatchEvent('input');
    await page.waitForFunction(() => {
      const content = document.getElementById('mag-content');
      if (!content) return false;
      const m = /scale\(([\d.]+)\)/.exec(content.style.transform || '');
      if (!m) return false;
      return Math.abs(parseFloat(m[1]) - 1) < 0.01;
    }, { timeout: 25_000 });

    const contentScale = await page.evaluate(() => {
      const content = document.getElementById('mag-content');
      const m = /scale\(([\d.]+)\)/.exec(content.style.transform || '');
      return m ? parseFloat(m[1]) : null;
    });
    expect(contentScale).toBeCloseTo(1, 5);
  });

  // "Perfecting…" indicator: appears inside the loupe while hi-res sub-tiles
  // are in flight, disappears once they all settle. Throttling chart tile
  // responses guarantees the indicator stays visible long enough for the test
  // to observe — otherwise a fast LAN cache hit could flip it on and off
  // within a single frame.
  test('shows "Perfecting…" indicator while hi-res tiles load, hides after', async ({ page }) => {
    // Default suite timeout is 15s — this test throttles tiles (1s each in
    // parallel) then waits up to 20s for the indicator to clear; under load
    // or slow runners the whole interaction can exceed 15s.
    test.setTimeout(deployedPreview ? 120_000 : 60_000);
    // Slow every chart tile fetch by 1000 ms so the
    // indicator's `show` class stays visible long enough for Playwright
    // to poll it. Important: the 169-tile hi-res grid is fetched in
    // parallel (HTTP/2 multiplexes; even on HTTP/1.1 each route handler
    // sleeps independently in Node's event loop), so total settle time
    // is approximately `throttle + RTT`, not `(tiles / 6) * throttle`.
    // A pre-fix 100 ms throttle locally produced only a ~375 ms `show`
    // window — narrower than Playwright's ~150 ms polling interval on
    // CI, which made the assertion miss the class entirely on most runs.
    // 1000 ms is comfortably wider than the polling cadence while
    // staying well under the 20 s post-settle assertion below.
    //
    await page.unroute(CHART_TILE_RE);
    await page.route(CHART_TILE_RE, route => fulfillTile(route, 1000));

    await page.evaluate(() => map.setZoom(8));
    await page.waitForFunction(
      () => Array.from(document.querySelectorAll('.leaflet-tile-pane img'))
              .some(i => /\/8\/\d+\/\d+\.png/.test(i.src)),
      { timeout: magnifierPaneTileMs });
    await page.waitForTimeout(800);

    const mapBox = await page.locator('#map').boundingBox();
    if (!mapBox) { test.skip(true, 'map not found'); return; }
    await page.mouse.move(mapBox.x + mapBox.width / 2, mapBox.y + mapBox.height / 2);

    await page.locator('#tool-magnifier').click();

    const loading = page.locator('#magnifier .mag-loading');
    // Text content reflects the i18n key.
    await expect(loading).toHaveText('Perfecting…');
    // Indicator becomes visible while throttled hi-res tiles are in flight.
    // Throttle is 1000 ms per tile (parallel), so the `show` class is up
    // for ~1 s — comfortably wider than Playwright's polling cadence.
    await expect(loading).toHaveClass(/show/, { timeout: 4000 });
    // …and hides once they all settle (load or error). All ~169 tiles
    // fan out in parallel, so total settle time ≈ throttle + RTT.
    // 20 s gives plenty of cushion for a couple extra rebuilds
    // (move/layeradd) along the way.
    await expect(loading).not.toHaveClass(/show/, { timeout: deployedPreview ? 45_000 : 35_000 });
  });

  // Edge case: at the layer's maxNativeZoom (CVFR = 13) the rebuild fetches
  // ZERO hi-res sub-tiles (targetExp = maxNZ - refZ = 0). The indicator
  // must never become visible — otherwise the user sees a confusing flicker
  // on a view that's already as crisp as it'll get.
  test('no indicator at max native zoom (zero hi-res fetches)', async ({ page }) => {
    await page.evaluate(() => map.setZoom(13));
    await page.waitForFunction(
      () => Array.from(document.querySelectorAll('.leaflet-tile-pane img'))
              .some(i => /\/13\/\d+\/\d+\.png/.test(i.src)),
      { timeout: magnifierPaneTileMs });
    await page.waitForTimeout(500);

    const mapBox = await page.locator('#map').boundingBox();
    if (!mapBox) { test.skip(true, 'map not found'); return; }
    await page.mouse.move(mapBox.x + mapBox.width / 2, mapBox.y + mapBox.height / 2);

    await page.locator('#tool-magnifier').click();
    await page.waitForTimeout(300);

    // Indicator element exists (createMagnifier always appends it) but the
    // .show class never got applied because no hi-res tiles were fetched.
    const loading = page.locator('#magnifier .mag-loading');
    await expect(loading).not.toHaveClass(/show/);

    // Move the cursor — this scheduled a rebuild via updateMagnifier. The
    // indicator must STILL stay hidden because targetExp is still 0.
    await page.mouse.move(mapBox.x + mapBox.width / 2 + 80,
                          mapBox.y + mapBox.height / 2 + 80);
    await page.waitForTimeout(400);
    await expect(loading).not.toHaveClass(/show/);
  });

  // Hebrew translation surfaces correctly in the loading pill.
  test('"Perfecting…" indicator uses Hebrew translation in he locale', async ({ page }) => {
    await page.goto('?lang=he');
    await page.waitForFunction(() => typeof state !== 'undefined');
    await page.evaluate(() => map.setZoom(8));
    await page.waitForFunction(
      () => Array.from(document.querySelectorAll('.leaflet-tile-pane img'))
              .some(i => /\/8\/\d+\/\d+\.png/.test(i.src)),
      { timeout: magnifierPaneTileMs });

    const mapBox = await page.locator('#map').boundingBox();
    if (!mapBox) { test.skip(true, 'map not found'); return; }
    await page.mouse.move(mapBox.x + mapBox.width / 2, mapBox.y + mapBox.height / 2);
    await page.locator('#tool-magnifier').click();

    const loading = page.locator('#magnifier .mag-loading');
    await expect(loading).toHaveText('משכלל…');
  });

  // Refresh-on-pan regression. The pre-fix wiring only dirtied the loupe
  // on `moveend` — and never scheduled a rebuild — so during a drag the
  // hi-res tiles inside the loupe stayed stale. The user had to zoom out
  // and back in to force a refresh. We assert here that programmatically
  // panning the map mid-magnifier triggers a fresh rebuild batch, which
  // is what feeds the new hi-res tile fetch around the new viewport.
  test('pan refreshes loupe content without needing a zoom', async ({ page }) => {
    await page.evaluate(() => map.setZoom(8));
    await page.waitForFunction(
      () => Array.from(document.querySelectorAll('.leaflet-tile-pane img'))
              .some(i => /\/8\/\d+\/\d+\.png/.test(i.src)),
      { timeout: magnifierPaneTileMs });
    await page.waitForTimeout(800);

    const mapBox = await page.locator('#map').boundingBox();
    if (!mapBox) { test.skip(true, 'map not found'); return; }
    await page.mouse.move(mapBox.x + mapBox.width / 2, mapBox.y + mapBox.height / 2);
    await page.locator('#tool-magnifier').click();
    await page.waitForTimeout(800);

    // Snapshot the current batch via the data-batch attribute on a hi-res
    // sub-tile (rebuildMagnifier stamps every fetched tile with the active
    // batch id). A panBy that re-runs rebuild will leave NEW tiles with a
    // larger batch number.
    const readBatch = () => page.evaluate(() => {
      const imgs = Array.from(document.querySelectorAll('#mag-content img[data-batch]'));
      return imgs.length ? Math.max(...imgs.map(i => Number(i.dataset.batch))) : null;
    });
    const before = await readBatch();
    expect(before).not.toBeNull();

    await page.evaluate(() => map.panBy([180, 0], { animate: false }));
    // Allow the rAF-coalesced rebuild to land + tiles to attach.
    await page.waitForTimeout(600);

    const after = await readBatch();
    expect(after).toBeGreaterThan(before);
  });

  // Threshold regression: the pre-fix moveThreshold was magnifierSize/3
  // (≈ 133 px) regardless of how zoomed-in the loupe was. The threshold
  // now scales with the slider — `magnifierSize/2/slider` — so it
  // matches the prefetched source-pixel margin around the cursor. At
  // slider=2 / magnifierSize=400 that's 100 px; we move 150 to comfortably
  // exceed it while staying well below the pre-fix 133 px deadband.
  test('cursor move past prefetched margin refreshes hi-res tiles', async ({ page }) => {
    await page.evaluate(() => map.setZoom(8));
    await page.waitForFunction(
      () => Array.from(document.querySelectorAll('.leaflet-tile-pane img'))
              .some(i => /\/8\/\d+\/\d+\.png/.test(i.src)),
      { timeout: magnifierPaneTileMs });
    await page.waitForTimeout(800);

    const mapBox = await page.locator('#map').boundingBox();
    if (!mapBox) { test.skip(true, 'map not found'); return; }
    const cx = mapBox.x + mapBox.width / 2;
    const cy = mapBox.y + mapBox.height / 2;
    await page.mouse.move(cx, cy);
    await page.locator('#tool-magnifier').click();
    // Bump to 2× so the slider-scaled refetch threshold under test is
    // comfortably smaller than the cursor move below.
    await page.locator('#mag-zoom').fill('2');
    await page.locator('#mag-zoom').dispatchEvent('input');
    await page.waitForTimeout(800);

    const readBatch = () => page.evaluate(() => {
      const imgs = Array.from(document.querySelectorAll('#mag-content img[data-batch]'));
      return imgs.length ? Math.max(...imgs.map(i => Number(i.dataset.batch))) : null;
    });
    const before = await readBatch();
    expect(before).not.toBeNull();

    // 150 client px — above the new slider-based threshold (100 at
    // slider=2, magnifierSize=400) but still on the same screen so we
    // know it's a "real" cursor move that should refetch.
    await page.mouse.move(cx + 150, cy);
    await page.waitForTimeout(500);

    const after = await readBatch();
    expect(after).toBeGreaterThan(before);
  });

  // Locked-loupe content refresh. When the user clicks to lock the loupe
  // (`_magFixed = true`) cursor moves stop following — but a map pan must
  // STILL refresh the content under the loupe, because the geographic
  // point at the loupe's centre changes as the map moves.
  test('locked loupe still refreshes content when map pans', async ({ page }) => {
    await page.evaluate(() => map.setZoom(8));
    await page.waitForFunction(
      () => Array.from(document.querySelectorAll('.leaflet-tile-pane img'))
              .some(i => /\/8\/\d+\/\d+\.png/.test(i.src)),
      { timeout: magnifierPaneTileMs });
    await page.waitForTimeout(800);

    const mapBox = await page.locator('#map').boundingBox();
    if (!mapBox) { test.skip(true, 'map not found'); return; }
    const cx = mapBox.x + mapBox.width / 2;
    const cy = mapBox.y + mapBox.height / 2;
    await page.mouse.move(cx, cy);
    await page.locator('#tool-magnifier').click();
    // Bump to 2× to exercise the slider-scaled hi-res refresh path.
    await page.locator('#mag-zoom').fill('2');
    await page.locator('#mag-zoom').dispatchEvent('input');
    await page.waitForTimeout(800);

    // Lock the loupe at the current cursor position.
    await page.mouse.click(cx, cy);
    await page.waitForTimeout(200);
    const mag = page.locator('#magnifier');
    const lockedBox = await mag.boundingBox();
    expect(lockedBox).toBeTruthy();

    const readBatch = () => page.evaluate(() => {
      const imgs = Array.from(document.querySelectorAll('#mag-content img[data-batch]'));
      return imgs.length ? Math.max(...imgs.map(i => Number(i.dataset.batch))) : null;
    });
    const before = await readBatch();
    expect(before).not.toBeNull();

    await page.evaluate(() => map.panBy([180, 0], { animate: false }));
    await page.waitForTimeout(600);

    // Loupe position must NOT have moved (lock holds it on screen).
    const stillLockedBox = await mag.boundingBox();
    expect(Math.abs((stillLockedBox?.x ?? 0) - (lockedBox?.x ?? 0))).toBeLessThan(2);
    // …but the content MUST have refreshed: a new batch landed.
    const after = await readBatch();
    expect(after).toBeGreaterThan(before);
  });

  // Overlay-attach regression: when the map pans, the route / waypoints
  // / notes drawn on the overlay canvas must stay anchored to the
  // underlying terrain inside the loupe. Pre-fix, `rebuildMagnifier`
  // captured `overlay.toDataURL()` BEFORE the overlay's own pan-time
  // redraw landed (interact.js's `scheduleDraw` runs in a separate rAF
  // from the loupe rebuild), so the loupe showed a stale snapshot of
  // the overlay even though the cloned tiles were fresh. The visible
  // symptom was waypoint dots / leg lines appearing to "float" off the
  // terrain as the user dragged. We fixed it by calling `draw()`
  // synchronously inside `rebuildMagnifier` immediately before the
  // capture, so the toDataURL always reflects post-pan state.
  test('pan keeps overlay anchored to terrain (no drift)', async ({ page }) => {
    // Plant a single waypoint so the overlay actually has pixels worth
    // capturing. Without a route, both pre-fix and post-fix captures are
    // mostly empty and the comparison below is meaningless.
    await page.evaluate(() => {
      const c = map.getCenter();
      state.waypoints = [{ lat: c.lat, lng: c.lng, name: 'WP1' }];
      if (typeof syncLegs === 'function') syncLegs();
      draw();
    });
    await page.waitForTimeout(200);

    const mapBox = await page.locator('#map').boundingBox();
    if (!mapBox) { test.skip(true, 'map not found'); return; }
    const cx = mapBox.x + mapBox.width / 2;
    const cy = mapBox.y + mapBox.height / 2;
    await page.mouse.move(cx, cy);
    await page.locator('#tool-magnifier').click();
    await page.waitForTimeout(800);

    // Pan synchronously so map state + 'move'/'moveend' fire in one tick;
    // the loupe should rebuild and capture a FRESH overlay reflecting
    // the new map center.
    await page.evaluate(() => map.panBy([180, 0], { animate: false }));
    await page.waitForTimeout(600);

    const match = await page.evaluate(() => {
      const overlay = document.getElementById('overlay');
      const liveSrc = overlay.toDataURL();
      // Post-#388 the loupe captures the overlay into a same-sized
      // `<canvas>` via `drawImage` (no per-frame `toDataURL` re-encode
      // — that was ~10–20 ms per rAF on a 1080p canvas). We re-encode
      // the captured canvas here just to compare pixels with the live
      // overlay; the on-disk pixels must still match.
      const canvases = Array.from(
        document.querySelectorAll('#mag-content canvas'));
      const capture = canvases.length ? canvases[canvases.length - 1] : null;
      const loupeSrc = capture ? capture.toDataURL() : null;
      return { equal: loupeSrc === liveSrc, liveLen: liveSrc.length,
               loupeLen: loupeSrc ? loupeSrc.length : 0 };
    });
    // Loupe's most-recent overlay capture must EQUAL the live overlay
    // post-pan. If they diverge, the loupe captured the overlay before
    // draw() updated it for the new map state — i.e., the drift bug.
    expect(match.equal).toBe(true);
  });

  // Tile-count guard: with the center-based fetch the hi-res grid stays
  // small (loupeR = magnifierSize/(2*slider) source pixels, so at the
  // default slider=2 / z=8 / sub=16 case we only fetch a 13×13 grid).
  // A regression that drops back to the world-pixel layout or to the
  // subdivide-every-clone iteration would push this past 1 000.
  test('adaptive: hi-res tile count per rebuild stays bounded', async ({ page }) => {
    const tileReqs = new Set();
    page.on('request', r => {
      const u = r.url();
      if (isChartTileUrl(u)) tileReqs.add(u);
    });
    await page.evaluate(() => map.setZoom(8));
    await page.waitForFunction(
      () => Array.from(document.querySelectorAll('.leaflet-tile-pane img'))
              .some(i => /\/8\/\d+\/\d+\.png/.test(i.src)),
      { timeout: 10000 });
    await page.waitForTimeout(1000);

    const mapBox = await page.locator('#map').boundingBox();
    if (!mapBox) { test.skip(true, 'map not found'); return; }
    await page.mouse.move(mapBox.x + mapBox.width / 2, mapBox.y + mapBox.height / 2);
    tileReqs.clear();
    await page.locator('#tool-magnifier').click();
    // Bump to 2× so the adaptive fetch runs at the scale this guard covers.
    await page.locator('#mag-zoom').fill('2');
    await page.locator('#mag-zoom').dispatchEvent('input');
    await page.waitForTimeout(2500);

    // count hi-res (≥ z=11) requests; we don't care about cloned-zoom hits.
    let hires = 0;
    for (const u of tileReqs) {
      const z = chartTileZoom(u);
      if (z && z >= 11) hires++;
    }
    expect(hires).toBeGreaterThan(0);
    // The loupe now opens at 1× and is bumped to 2×, so the settle window
    // captures both the open burst and the zoom-change rebuilds — more tile
    // requests than a single fresh-at-2× open. The bound still catches the
    // real regressions (subdivide-every-clone / world-pixel coords push the
    // count into the tens of thousands) without flaking on the legitimate
    // two-burst case.
    expect(hires).toBeLessThan(6000);
  });
});
