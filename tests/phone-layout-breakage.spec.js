// UI-review batch 1: things that sat under, off or over something else on a phone (and one
// dialog footer on a desktop). Every case here failed before the fix.
const { test, expect } = require('./_setup');

async function boot(page, w, h, q = '?lang=en&nogist') {
  await page.addInitScript(() => {
    navigator.geolocation.watchPosition = cb => { window.__geo = cb; return 1; };
  });
  await page.setViewportSize({ width: w, height: h });
  await page.goto(q);
  await page.waitForFunction(() => window.NavAid && document.querySelector('.rotate-ctrl') && document.getElementById('deck-strip'));
  await page.waitForTimeout(1500);
  const ok = page.getByRole('button', { name: /^Accept/ });
  if (await ok.count()) await ok.first().click().catch(() => {});
}
const goLive = (page) => page.evaluate(() => {
  for (const k of Object.keys(NavAid.tuningDefaults)) if (/^feature/.test(k) && NavAid.tuningDefaults[k].type === 'bool') NavAid.tuning[k] = true;
  ['refreshAtcRadioFeature', 'refreshFollowMeMapControl', 'draw'].forEach(f => { try { window[f] && window[f](); } catch (e) {} });
  startLiveLocation();
  __geo({ coords: { latitude: 32.18, longitude: 34.83, accuracy: 5 }, timestamp: Date.now() });
});

for (const [w, h] of [[360, 640], [375, 667], [390, 760], [390, 844]]) {
  test(`in-flight column fits between strip and deck at ${w}x${h}`, async ({ page }) => {
    await boot(page, w, h);
    await goLive(page);
    await page.waitForTimeout(600);
    const r = await page.evaluate(() => {
      const corner = document.querySelector('.rotate-ctrl').parentNode;
      const strip = document.getElementById('deck-strip').getBoundingClientRect().bottom;
      const bar = document.querySelector('.deck-btn-menu').getBoundingClientRect().top;
      const rec = document.getElementById('gps-rec-indicator');
      const recBottom = rec && !rec.hidden ? rec.getBoundingClientRect().bottom : 0;
      const items = [...corner.children].filter(e => e.getClientRects().length && getComputedStyle(e).position !== 'absolute')
        .map(e => e.getBoundingClientRect());
      return { strip, bar, recBottom, top: Math.min(...items.map(b => b.top)), bottom: Math.max(...items.map(b => b.bottom)),
        voice: document.querySelector('.voice-ctrl').getBoundingClientRect().top, n: items.length };
    });
    expect(r.n).toBeGreaterThan(8);
    expect(r.top).toBeGreaterThanOrEqual(Math.max(r.strip, r.recBottom));
    expect(r.bottom).toBeLessThanOrEqual(r.bar);
    expect(r.voice).toBeGreaterThan(r.strip);
  });
}

test('the column keeps its top-to-bottom order when it wraps', async ({ page }) => {
  await boot(page, 360, 640);
  await goLive(page);
  const order = await page.evaluate(() => {
    const corner = document.querySelector('.rotate-ctrl').parentNode;
    const rank = ['voice-ctrl', 'orient-ctrl', 'follow-ctrl', 'follow-me-ctrl', 'editlock-ctrl', 'measure-ctrl', 'atc-fab-control', 'rotate-ctrl'];
    // Within one visual column, a higher rank sits lower. A column is the controls sharing a RIGHT
    // edge: they are right-aligned (the right-hand ones on the screen edge), and differ in width.
    const by = {};
    for (const c of rank) { const el = corner.querySelector('.' + c); if (el && el.getClientRects().length) { const b = el.getBoundingClientRect(); (by[Math.round(b.right)] = by[Math.round(b.right)] || []).push([b.top, rank.indexOf(c)]); } }
    return Object.values(by).map(col => col.sort((a, b) => a[0] - b[0]).map(x => x[1]));
  });
  for (const col of order) expect(col).toEqual([...col].sort((a, b) => a - b));
  expect(order.length).toBe(2);
});

// Seen in the before/after screenshots: wrapped, the second column landed on the coordinates and on
// the empty-route hint. They step left of the whole column now; on a tall phone nothing moves.
for (const [w, h, wraps] of [[360, 640, true], [390, 844, false]]) {
  test(`coordinates and the hint stay clear of the control column at ${w}x${h}`, async ({ page }) => {
    await boot(page, w, h);
    const before = await page.evaluate(() => document.getElementById('coord-readout').getBoundingClientRect().right);
    await goLive(page);
    await page.waitForTimeout(800);
    const r = await page.evaluate(() => {
      const corner = document.querySelector('.rotate-ctrl').parentNode;
      const items = [...corner.children].filter(e => e.getClientRects().length && getComputedStyle(e).position !== 'absolute')
        .map(e => e.getBoundingClientRect());
      const hit = (a, b) => a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1;
      const out = {};
      for (const id of ['coord-readout', 'empty-route-hint']) {
        const el = document.getElementById(id);
        if (!el || !el.getClientRects().length) continue;
        const b = el.getBoundingClientRect();
        out[id] = { over: items.filter(i => hit(i, b)).length, left: b.left, right: b.right };
      }
      // Columns by their shared right edge: the controls are right-aligned and differ in width.
      out.cols = new Set(items.map(i => Math.round(i.right))).size;
      return out;
    });
    expect(r.cols > 1).toBe(wraps);
    expect(r['coord-readout'].over).toBe(0);
    if (r['empty-route-hint']) { expect(r['empty-route-hint'].over).toBe(0); expect(r['empty-route-hint'].left).toBeGreaterThanOrEqual(0); }
    if (!wraps) expect(Math.round(r['coord-readout'].right)).toBe(Math.round(before));
  });
}

test('magnifier settings sit above the deck on a phone', async ({ page }) => {
  await boot(page, 390, 844);
  await page.evaluate(() => { document.getElementById('magnifier-settings').classList.remove('hidden'); });
  const r = await page.evaluate(() => ({
    bottom: document.getElementById('magnifier-settings').getBoundingClientRect().bottom,
    bar: document.querySelector('.deck-btn-menu').getBoundingClientRect().top }));
  expect(r.bottom).toBeLessThanOrEqual(r.bar);
});

test('tuning panel header and close clear the top strip on a phone', async ({ page }) => {
  await boot(page, 390, 844, '?lang=en&nogist&tune=1');
  const r = await page.evaluate(() => ({
    top: document.querySelector('#tuning-panel .tune-head').getBoundingClientRect().top,
    close: document.querySelector('#tuning-panel .tune-close').getBoundingClientRect().top,
    strip: document.getElementById('deck-strip').getBoundingClientRect().bottom,
    bottom: document.getElementById('tuning-panel').getBoundingClientRect().bottom,
    bar: document.querySelector('.deck-btn-menu').getBoundingClientRect().top }));
  expect(r.top).toBeGreaterThanOrEqual(r.strip);
  expect(r.close).toBeGreaterThanOrEqual(r.strip);
  expect(r.bottom).toBeLessThanOrEqual(r.bar);
});

test('route mosaic controls wrap instead of overflowing on a phone', async ({ page }) => {
  await boot(page, 390, 844);
  await page.evaluate(() => {
    state.waypoints = [{ lat: 32.18, lng: 34.83, name: 'A' }, { lat: 32.57, lng: 35.19, name: 'B' }];
    state.legs = [{ speed: 90 }]; draw(); showRouteMosaicModal();
  });
  const r = await page.evaluate(() => {
    const bar = document.querySelector('.route-mosaic-bar');
    return { sw: bar.scrollWidth, cw: bar.clientWidth, right: Math.max(...[...bar.children].map(e => e.getBoundingClientRect().right)) };
  });
  expect(r.sw).toBeLessThanOrEqual(r.cw + 1);
  expect(r.right).toBeLessThanOrEqual(390);
});

test('flight-plan dialog keeps Continue and Cancel in view while the form scrolls', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof airfieldByIcao === 'function' && Array.isArray(airfields) && airfields.length);
  await page.waitForTimeout(1500);
  await page.evaluate(() => {
    state.waypoints = ['LLHZ', 'LLES'].map(n => { const a = airfieldByIcao(n); return { lat: a.lat, lng: a.lng, name: n }; });
    syncLegs(); draw(); showFplDialog();
    // The Advanced block makes the form longer than its box, which is when the row was cut.
    const adv = document.querySelector('.fpl-advanced'); if (adv) adv.open = true;
  });
  await expect(page.locator('#fpl-next')).toBeVisible();
  const r = await page.evaluate(() => {
    const body = document.querySelector('.fpl-body');
    body.scrollTop = 0;
    const after = document.getElementById('fpl-next').getBoundingClientRect();
    return { scrolls: body.scrollHeight > body.clientHeight, bottom: after.bottom, sbBottom: body.getBoundingClientRect().bottom, vh: innerHeight };
  });
  expect(r.scrolls, 'fixture must overflow the box').toBe(true);
  expect(r.bottom).toBeLessThanOrEqual(r.sbBottom + 1);
  expect(r.bottom).toBeLessThanOrEqual(r.vh);
});

test('open attribution closes on Escape and on an outside tap', async ({ page }) => {
  await boot(page, 390, 844);
  const attr = page.locator('.leaflet-control-attribution');
  const toggle = page.locator('.attrib-toggle');
  await toggle.click();
  await expect(attr).toHaveClass(/attrib-open/);
  await page.keyboard.press('Escape');
  await expect(attr).not.toHaveClass(/attrib-open/);
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await toggle.click();
  await expect(attr).toHaveClass(/attrib-open/);
  await page.mouse.click(200, 300);
  await expect(attr).not.toHaveClass(/attrib-open/);
  await toggle.click();
  await expect(attr).toHaveClass(/attrib-open/);
  await toggle.click();                       // the toggle itself still closes it
  await expect(attr).not.toHaveClass(/attrib-open/);
});
