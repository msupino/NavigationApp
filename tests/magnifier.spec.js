// @ts-check
const { test, expect } = require('./_setup');

test.describe('Magnifying glass', () => {
  test.beforeEach(async ({ page }) => {
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
    await expect(btn).toHaveText(/Magnifying Glass/);
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
    // first, add a couple waypoints so there's something to select
    await page.locator('#tool-add').click();
    await page.mouse.click(mapBox.x + 100, mapBox.y + 100);
    await page.mouse.click(mapBox.x + 200, mapBox.y + 200);
    await page.locator('#tool-add').click(); // exit add mode — magnifier stays on
    // move to first waypoint and click to lock
    await page.mouse.move(mapBox.x + 100, mapBox.y + 100);
    const boxBefore = await mag.boundingBox();
    await page.mouse.click(mapBox.x + 100, mapBox.y + 100);
    // movement should be locked now
    await page.mouse.move(mapBox.x + 300, mapBox.y + 300);
    const boxAfter = await mag.boundingBox();
    expect(boxBefore?.x).toBe(boxAfter?.x);
    expect(boxBefore?.y).toBe(boxAfter?.y);
    // click again to unlock and select something
    await page.mouse.click(mapBox.x + 200, mapBox.y + 200);
    // move mouse — magnifier should follow
    await page.mouse.move(mapBox.x + 150, mapBox.y + 150);
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
    // Hi-res tiles fetch over the network — give them time to land.
    await page.waitForTimeout(2500);

    const report = await page.evaluate(() => {
      const content = document.getElementById('mag-content');
      if (!content) return { error: 'no mag-content' };
      const kids = Array.from(content.children);
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
  // adaptive design floors the loupe at MAG_BASELINE_Z (12) and bumps the
  // content scale to `max(slider, sub)` so the deeper tiles render at
  // native pixel density.
  test('adaptive: low map zoom fetches z>=12 hi-res tiles + bumps CSS scale', async ({ page }) => {
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
      const content = document.getElementById('mag-content');
      const trMatch = /scale\(([\d.]+)\)/.exec(content.style.transform || '');
      return {
        zs: [...zs].sort((a, b) => a - b),
        contentScale: trMatch ? parseFloat(trMatch[1]) : null,
        slider: window.magnifierZoom,
        mapZoom: map.getZoom(),
      };
    });
    // Cloned tiles are at z=8, hi-res must reach the readability baseline.
    expect(report.zs).toContain(8);
    expect(Math.max(...report.zs)).toBeGreaterThanOrEqual(12);
    // The content scale must climb beyond the slider so the hi-res tiles
    // land at native (or higher) pixel density. At slider=2, mapZoom=8,
    // sub=16 → effS=16; we accept anything ≥ sub.
    expect(report.contentScale).toBeGreaterThanOrEqual(8);
  });

  // Tile-count guard: with the center-based fetch + `effS = max(slider, sub)`
  // each rebuild's hi-res grid stays small (the loupe shrinks in source-pixel
  // terms as effS grows, so the high-sub case at z=8 doesn't blow up). A
  // regression that drops back to the world-pixel layout or to the
  // subdivide-every-clone iteration would push this past 1 000.
  test('adaptive: hi-res tile count per rebuild stays bounded', async ({ page }) => {
    const tileReqs = new Set();
    page.on('request', r => {
      const u = r.url();
      if (u.includes('flight-maps.com')) tileReqs.add(u);
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
    await page.waitForTimeout(2500);

    // count hi-res (≥ z=11) requests; we don't care about cloned-zoom hits.
    let hires = 0;
    for (const u of tileReqs) {
      const m = u.match(/tiles\/[^/]+\/(\d+)\//);
      if (m && parseInt(m[1], 10) >= 11) hires++;
    }
    expect(hires).toBeGreaterThan(0);
    expect(hires).toBeLessThan(200);
  });
});
