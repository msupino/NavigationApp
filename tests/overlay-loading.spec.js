// @ts-check
// An overlay plate is a ~700 KB scan and a layer is one per airfield, so on a phone over
// cellular the toggle is followed by seconds of nothing. The plate viewer says "Loading…"
// while it waits; the Extra layers said nothing at all, so the switch looked broken.
const { test, expect } = require('./_setup');

async function boot(page) {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof loadCircuitOverlays === 'function'
    && Array.isArray(window.airfields) && window.airfields.length > 0);
}

test('the marker shows while the plates are on the wire, and goes when they land', async ({ page }) => {
  // Hold the images until the test lets them through, so the "loading" state is observable.
  await page.route('**/circuit-img/*.png', async (route) => {
    await new Promise(r => setTimeout(r, 400));
    await route.continue();
  });
  await boot(page);
  const during = await page.evaluate(() => {
    showCircuit = true; loadCircuitOverlays(); circuitLayerGroup.addTo(map);
    const el = document.querySelector('.overlay-loading');
    return { count: overlayLoadingCount(), text: el.textContent, shown: el.classList.contains('show') };
  });
  expect(during.count).toBeGreaterThan(0);
  expect(during.text).toMatch(/loading/i);
  expect(during.shown).toBe(true);
  // ...and it goes by itself once the last plate is in.
  await expect(page.locator('.overlay-loading')).not.toHaveClass(/show/, { timeout: 15000 });
  expect(await page.evaluate(() => overlayLoadingCount())).toBe(0);
});

test('a plate that never arrives does not leave the marker up', async ({ page }) => {
  await page.route('**/circuit-img/*.png', route => route.abort());
  await boot(page);
  await page.evaluate(() => { showCircuit = true; loadCircuitOverlays(); circuitLayerGroup.addTo(map); });
  await expect(page.locator('.overlay-loading')).not.toHaveClass(/show/, { timeout: 15000 });
  expect(await page.evaluate(() => overlayLoadingCount())).toBe(0);
});

// It must not take input: the pilot carries on panning while the charts load.
test('the marker never takes a touch', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => { showCircuit = true; loadCircuitOverlays(); circuitLayerGroup.addTo(map); });
  const pe = await page.locator('.overlay-loading').evaluate(el => getComputedStyle(el).pointerEvents);
  expect(pe).toBe('none');
});

test('it follows the light theme', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => {
    document.body.classList.add('theme-light');
    showCircuit = true; loadCircuitOverlays(); circuitLayerGroup.addTo(map);
  });
  const lum = await page.locator('.overlay-loading').evaluate(el => {
    const m = getComputedStyle(el).backgroundColor.match(/\d+/g).map(Number);
    return (0.299 * m[0] + 0.587 * m[1] + 0.114 * m[2]) / 255;
  });
  expect(lum).toBeGreaterThan(0.8);
});

// The wait a pilot notices most is the FIRST one: app shell, Leaflet, then the chart tiles.
// Nothing of ours has run at that point, so the marker is written into the HTML and taken
// down once the map has something on it.
test.describe('the first load says it is loading', () => {
  test('the marker is in the HTML itself, before any script runs', async ({ page }) => {
    // Relative, so it resolves against this run's baseURL: a deployed PR preview lives under
    // /pr/<n>/, where an absolute '/index.html' fetches the production site instead.
    const html = await (await page.request.get('index.html')).text();
    expect(html).toContain('id="boot-loading"');
    // Styled inline: the stylesheet has not arrived either.
    expect(html).toMatch(/id="boot-loading"[\s\S]{0,400}position:fixed/);
  });

  // Not a generic spinner: the app says who it is while it starts, and the second aircraft
  // flying a circuit around the mark says it is still working. Both are inline in the HTML
  // for the same reason the marker itself is -- nothing else has loaded yet.
  test('it shows the NavAid mark with an aircraft flying round it', async ({ page }) => {
    const html = await (await page.request.get('index.html')).text();
    const boot = html.slice(html.indexOf('id="boot-loading"'));
    expect(boot).toContain('boot-logo');        // the mark, inline as SVG
    expect(boot).toContain('boot-plane');       // the one flying round it
    expect(boot).toMatch(/<svg[^>]*class="boot-logo"/);
    // The keyframes are in the head's inline <style>, ahead of the marker.
    expect(html.indexOf('@keyframes boot-orbit')).toBeGreaterThan(-1);
    expect(html.indexOf('@keyframes boot-orbit')).toBeLessThan(html.indexOf('id="boot-loading"'));
  });

  // The circuit is a real circle in a tilted plane, not an ellipse drawn by hand: the
  // browser foreshortens it and hides the aircraft behind the mark on the far side.
  test('the circuit is flown in three dimensions', async ({ page }) => {
    const html = await (await page.request.get('index.html')).text();
    const style = html.match(/<style>[\s\S]*?boot-orbit[\s\S]*?<\/style>/)[0];
    const boot = html.slice(html.indexOf('<div id="boot-loading"'));
    await page.setContent(style + boot.slice(0, boot.indexOf('</div>', boot.indexOf('NavAid')) + 12));
    const scene = await page.evaluate(() => {
      const mark = document.querySelector('#boot-loading .boot-mark');
      const stage = document.querySelector('#boot-loading .boot-stage');
      const orbit = document.querySelector('#boot-loading .boot-orbit');
      const cs = getComputedStyle;
      return {
        perspective: cs(mark).perspective,
        stage3d: cs(stage).transformStyle,
        orbit3d: cs(orbit).transformStyle,
        // A tilt shows up as a 4x4 matrix; a flat spin stays a 2D matrix().
        matrix: cs(orbit).transform.slice(0, 9),
      };
    });
    expect(scene.perspective).not.toBe('none');
    expect(scene.stage3d).toBe('preserve-3d');
    expect(scene.orbit3d).toBe('preserve-3d');
    expect(scene.matrix).toBe('matrix3d(');
  });

  test('the aircraft actually goes round, and stops for reduced motion', async ({ page }) => {
    // The screen is served, then dropped into a blank page: on this machine the real boot
    // clears in a few hundred ms, which is too short to watch an orbit in.
    const html = await (await page.request.get('index.html')).text();
    const style = html.match(/<style>[\s\S]*?boot-orbit[\s\S]*?<\/style>/)[0];
    const boot = html.slice(html.indexOf('<div id="boot-loading"'));
    const screen = boot.slice(0, boot.indexOf('</div>', boot.indexOf('NavAid')) + 12);
    const where = async () => page.evaluate(() => {
      const r = document.querySelector('#boot-loading .boot-plane').getBoundingClientRect();
      return { x: Math.round(r.x), y: Math.round(r.y) };
    });

    await page.setContent(style + screen);
    const first = await where();
    await page.waitForTimeout(500);            // well under one 3.2s lap
    const later = await where();
    expect(first.x !== later.x || first.y !== later.y).toBe(true);

    // A pilot who has asked the phone for no animation gets a still screen, not a lap.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setContent(style + screen);
    const still = await where();
    await page.waitForTimeout(500);
    expect(await where()).toEqual(still);
  });

  test('it goes once the map has painted', async ({ page }) => {
    await page.goto('?lang=en&nogist');
    await page.waitForFunction(() => typeof map !== 'undefined');
    await expect(page.locator('#boot-loading')).toHaveCount(0, { timeout: 15000 });
  });

  // On a warm cache the map paints in a few hundred ms and the mark used to flash by
  // half-drawn. It is now held for bootLogoMinMs, which is a floor and not an addition: a
  // map that takes longer than that still clears the moment it arrives.
  test('the mark is held long enough to be seen', async ({ page }) => {
    await page.goto('?lang=en&nogist');
    await page.waitForFunction(() => typeof clearBootLoading === 'function');
    const held = await page.evaluate(async () => {
      const gone = () => !document.getElementById('boot-loading');
      while (!gone()) await new Promise((r) => setTimeout(r, 50));
      return window.bootLoadingHeldFor();
    });
    // The 250ms fade-out runs after the hold, so the element outlives the floor slightly.
    expect(held).toBeGreaterThanOrEqual(2000);
  });

  // The floor is read when the map reports itself ready, not when the page loaded, so a gist
  // override or a value typed into the tuning panel takes effect on the very next start.
  test('the hold is a tunable, in the group the panel shows', async ({ page }) => {
    await page.goto('?lang=en&nogist');
    await page.waitForFunction(() => typeof tune === 'function');
    const t = await page.evaluate(() => ({
      value: tune('bootLogoMinMs'),
      declared: !!NavAid.tuningDefaults.bootLogoMinMs,
      grouped: NavAid.tuningGroups.filter(g => g.keys.includes('bootLogoMinMs')).length,
    }));
    expect(t).toEqual({ value: 2000, declared: true, grouped: 1 });
  });

  // A tile server that never answers must not leave the app looking dead when it is
  // perfectly usable offline.
  test('a chart that never loads still clears it', async ({ page }) => {
    await page.route('**/tiles/**', route => route.abort());
    await page.route('**/*.png', route => route.abort());
    await page.goto('?lang=en&nogist');
    await page.waitForFunction(() => typeof clearBootLoading === 'function');
    await expect(page.locator('#boot-loading')).toHaveCount(0, { timeout: 20000 });
  });
});
