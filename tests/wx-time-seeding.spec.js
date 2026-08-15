// @ts-check
// The shared #wx-time dropdown is filled by two feeds fetched independently (PWX and SIGWX)
// and by every PWX flight level. It used to seed its default off whichever answered FIRST and
// never reconsider, so response order decided which chart a pilot saw — and a level change
// could leave a time selected that the new level does not publish, which removed the overlay
// entirely rather than showing one of that level's valid charts.
const { test, expect } = require('./_setup');

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMCAYAAAB7P3qAAAAAAElFTkSuQmCC',
  'base64');
const BOUNDS = { s: 29.88, n: 33.82, w: 33.31, e: 36.69 };

// Freeze the clock at 23:45Z on 21/06/2026, where "nearest to now" spans the day boundary.
async function freezeNearMidnight(page) {
  await page.addInitScript(() => {
    const fixed = Date.UTC(2026, 5, 21, 23, 45);
    const RealDate = Date;
    // eslint-disable-next-line no-global-assign
    Date = class extends RealDate {
      constructor(...a) { super(...(a.length ? a : [fixed])); }
      static now() { return fixed; }
    };
  });
}

async function serve(page, { pwx, sigwx, sigwxDelayMs = 0, pwxDelayMs = 0, lang = 'en' }) {
  await page.route(/ims-data\/ims\/.*\.png/, r =>
    r.fulfill({ status: 200, contentType: 'image/png', body: PNG }));
  await page.route(/ims-data\/ims\/pwx\.json/, async r => {
    if (pwxDelayMs) await new Promise(res => setTimeout(res, pwxDelayMs));
    if (!pwx) return r.fulfill({ status: 404, body: '' });
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(pwx) });
  });
  await page.route(/ims-data\/ims\/sigwx\.json/, async r => {
    if (sigwxDelayMs) await new Promise(res => setTimeout(res, sigwxDelayMs));
    if (!sigwx) return r.fulfill({ status: 404, body: '' });
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(sigwx) });
  });
  await page.addInitScript(() => {
    for (const s of ['build', 'view', 'display', 'charts', 'export', 'print'])
      try { localStorage.setItem('navaid.sec.' + s, '1'); } catch (e) {}
  });
  await page.goto('?lang=' + lang + '&nogist');
}

const labels = page => page.evaluate(() =>
  Array.from(document.querySelectorAll('#wx-time option'), o => o.textContent));
const selected = page => page.evaluate(() => {
  const s = document.getElementById('wx-time');
  return s.options.length ? s.options[s.selectedIndex].textContent : null;
});

test('a feed that answers second can still supply the closer time', async ({ page }) => {
  await freezeNearMidnight(page);
  // Exactly the review's reproduction: PWX answers at once with only yesterday's 18:00,
  // SIGWX answers 500 ms later with today's 00:00 — fifteen minutes away instead of six
  // hours stale. The old code set seeded=true on the first feed and never looked again.
  await serve(page, {
    pwx: { generatedAt: '2026-06-21T18:00:00Z', bounds: BOUNDS,
      levels: [{ level: '90', label: 'FL030', times: [
        { valid: '18:00', day: '21/06/2026', png: 'ims/pwx/90/a.png' }] }] },
    sigwx: { generatedAt: '2026-06-21T18:00:00Z', times: [
      { valid: '00:00', day: '22/06/2026', png: 'ims/sigwx/b.png' }] },
    sigwxDelayMs: 500,
  });
  await page.waitForFunction(() => document.querySelectorAll('#wx-time option').length === 2);
  expect(await labels(page)).toEqual(['21/06/2026 18:00Z', '22/06/2026 00:00Z']);
  expect(await selected(page)).toBe('22/06/2026 00:00Z');
});

test('the reverse arrival order reaches the same selection', async ({ page }) => {
  await freezeNearMidnight(page);
  await serve(page, {
    pwx: { generatedAt: '2026-06-21T18:00:00Z', bounds: BOUNDS,
      levels: [{ level: '90', label: 'FL030', times: [
        { valid: '18:00', day: '21/06/2026', png: 'ims/pwx/90/a.png' }] }] },
    sigwx: { generatedAt: '2026-06-21T18:00:00Z', times: [
      { valid: '00:00', day: '22/06/2026', png: 'ims/sigwx/b.png' }] },
    pwxDelayMs: 500,
  });
  await page.waitForFunction(() => document.querySelectorAll('#wx-time option').length === 2);
  // The default must not depend on which fetch wins — that is the whole defect.
  expect(await selected(page)).toBe('22/06/2026 00:00Z');
});

test("a pilot's own choice is not overridden by a later feed", async ({ page }) => {
  await freezeNearMidnight(page);
  await serve(page, {
    pwx: { generatedAt: '2026-06-21T18:00:00Z', bounds: BOUNDS,
      levels: [{ level: '90', label: 'FL030', times: [
        { valid: '18:00', day: '21/06/2026', png: 'ims/pwx/90/a.png' }] }] },
    sigwx: { generatedAt: '2026-06-21T18:00:00Z', times: [
      { valid: '00:00', day: '22/06/2026', png: 'ims/sigwx/b.png' },
      { valid: '03:00', day: '22/06/2026', png: 'ims/sigwx/c.png' }] },
    sigwxDelayMs: 900,
  });
  await page.waitForFunction(() => document.querySelectorAll('#wx-time option').length >= 1);
  // Choose the stale one deliberately, before the second feed lands.
  await page.evaluate(() => {
    const s = document.getElementById('wx-time');
    s.value = '21/06/2026|18:00';
    s.dispatchEvent(new Event('change'));
  });
  await page.waitForFunction(() => document.querySelectorAll('#wx-time option').length === 3);
  // Re-seeding must never move a selection the pilot made: they may be studying that chart.
  expect(await selected(page)).toBe('21/06/2026 18:00Z');
});

test('a stored day-qualified choice wins over "nearest now"', async ({ page }) => {
  await freezeNearMidnight(page);
  await page.addInitScript(() => {
    try { localStorage.setItem('navaid.wxTime', '21/06/2026|18:00'); } catch (e) {}
  });
  await serve(page, {
    pwx: { generatedAt: '2026-06-21T18:00:00Z', bounds: BOUNDS,
      levels: [{ level: '90', label: 'FL030', times: [
        { valid: '18:00', day: '21/06/2026', png: 'ims/pwx/90/a.png' }] }] },
    sigwx: { generatedAt: '2026-06-21T18:00:00Z', times: [
      { valid: '00:00', day: '22/06/2026', png: 'ims/sigwx/b.png' }] },
    sigwxDelayMs: 400,
  });
  await page.waitForFunction(() => document.querySelectorAll('#wx-time option').length === 2);
  // It carries a day, so it is a real earlier decision rather than a guess — it stands even
  // though 00:00 is closer to the frozen clock.
  expect(await selected(page)).toBe('21/06/2026 18:00Z');
});

test('a legacy time-only stored value keeps its hour but not an assumed day', async ({ page }) => {
  await freezeNearMidnight(page);
  await page.addInitScript(() => {
    // Written by a build that keyed on the valid time alone: the day it meant is unknown.
    try { localStorage.setItem('navaid.wxTime', '18:00'); } catch (e) {}
  });
  await serve(page, {
    pwx: { generatedAt: '2026-06-21T18:00:00Z', bounds: BOUNDS,
      levels: [{ level: '90', label: 'FL030', times: [
        { valid: '18:00', day: '21/06/2026', png: 'ims/pwx/90/a.png' }] }] },
    sigwx: { generatedAt: '2026-06-21T18:00:00Z', times: [
      // The same hour on an OLDER day sorts first, so a plain first-match lands on a chart
      // more than a day stale.
      { valid: '18:00', day: '20/06/2026', png: 'ims/sigwx/b.png' },
      { valid: '00:00', day: '22/06/2026', png: 'ims/sigwx/c.png' }] },
    sigwxDelayMs: 400,
  });
  await page.waitForFunction(() => document.querySelectorAll('#wx-time option').length === 3);
  // The hour is a real preference and is kept — but which DAY of it was never recorded, so
  // it is resolved to the nearest rather than to whichever option happens to come first.
  expect(await labels(page))
    .toEqual(['20/06/2026 18:00Z', '21/06/2026 18:00Z', '22/06/2026 00:00Z']);
  expect(await selected(page)).toBe('21/06/2026 18:00Z');
});

test('changing PWX level lands on a time that level publishes', async ({ page }) => {
  // Disjoint times per level, which build-ims-chart-jobs.mjs can legitimately produce when
  // upstream availability is partial.
  await serve(page, {
    pwx: { generatedAt: '2026-06-21T09:00:00Z', bounds: BOUNDS, levels: [
      { level: '90', label: 'FL030', times: [
        { valid: '12:00', day: '21/06/2026', png: 'ims/pwx/90/a.png' }] },
      { level: '80', label: 'FL050', times: [
        { valid: '18:00', day: '21/06/2026', png: 'ims/pwx/80/b.png' }] },
    ] },
    sigwx: null,
  });
  await page.waitForFunction(() => document.querySelectorAll('#ims-pwx-level option').length === 2);
  const r = await page.evaluate(async () => {
    const cb = document.getElementById('ims-pwx-cb');
    const lvl = document.getElementById('ims-pwx-level');
    const time = document.getElementById('wx-time');
    cb.checked = true; cb.dispatchEvent(new Event('change'));
    lvl.value = '90'; lvl.dispatchEvent(new Event('change'));      // FL030, offers 12:00 only
    const onA = { level: lvl.value, time: time.value,
      layers: Array.from(document.querySelectorAll('.leaflet-image-layer')).length };
    lvl.value = '80'; lvl.dispatchEvent(new Event('change'));      // FL050, offers 18:00 only
    await new Promise(res => setTimeout(res, 50));
    return { onA, onB: { level: lvl.value, time: time.value,
      layers: Array.from(document.querySelectorAll('.leaflet-image-layer')).length } };
  });
  expect(r.onA.time).toBe('21/06/2026|12:00');
  expect(r.onA.layers).toBeGreaterThan(0);
  // The selector only ever accumulated options, so 12:00 stayed selected, currentTime()
  // returned undefined at FL050, and updateLayer() REMOVED the overlay — changing altitude
  // made the weather disappear despite a valid chart existing at that level.
  expect(r.onB.time).toBe('21/06/2026|18:00');
  expect(r.onB.layers).toBeGreaterThan(0);
});

test('a level change overrides even a pinned time, since it cannot be rendered', async ({ page }) => {
  await serve(page, {
    pwx: { generatedAt: '2026-06-21T09:00:00Z', bounds: BOUNDS, levels: [
      { level: '90', label: 'FL030', times: [
        { valid: '12:00', day: '21/06/2026', png: 'ims/pwx/90/a.png' }] },
      { level: '80', label: 'FL050', times: [
        { valid: '18:00', day: '21/06/2026', png: 'ims/pwx/80/b.png' }] },
    ] },
    sigwx: null,
  });
  await page.waitForFunction(() => document.querySelectorAll('#ims-pwx-level option').length === 2);
  const r = await page.evaluate(async () => {
    const cb = document.getElementById('ims-pwx-cb');
    const lvl = document.getElementById('ims-pwx-level');
    const time = document.getElementById('wx-time');
    cb.checked = true; cb.dispatchEvent(new Event('change'));
    lvl.value = '90'; lvl.dispatchEvent(new Event('change'));
    time.value = '21/06/2026|12:00'; time.dispatchEvent(new Event('change'));   // pinned
    lvl.value = '80'; lvl.dispatchEvent(new Event('change'));
    await new Promise(res => setTimeout(res, 50));
    return { time: time.value,
      layers: Array.from(document.querySelectorAll('.leaflet-image-layer')).length };
  });
  // Asking for a level is asking to see that level; a blank overlay is not an honest answer.
  expect(r.time).toBe('21/06/2026|18:00');
  expect(r.layers).toBeGreaterThan(0);
});

test('a pinned SIGWX-only time is not dragged away by PWX on load', async ({ page }) => {
  await page.addInitScript(() => {
    try { localStorage.setItem('navaid.wxTime', '22/06/2026|03:00'); } catch (e) {}
  });
  await serve(page, {
    pwx: { generatedAt: '2026-06-21T09:00:00Z', bounds: BOUNDS, levels: [
      { level: '90', label: 'FL030', times: [
        { valid: '12:00', day: '21/06/2026', png: 'ims/pwx/90/a.png' }] }] },
    sigwx: { generatedAt: '2026-06-21T09:00:00Z', times: [
      { valid: '03:00', day: '22/06/2026', png: 'ims/sigwx/c.png' }] },
    pwxDelayMs: 400,
  });
  await page.waitForFunction(() => document.querySelectorAll('#wx-time option').length === 2);
  // PWX does not publish 03:00, but the PWX overlay is OFF here, so it has no business
  // moving the shared dropdown off the stored choice.
  expect(await page.evaluate(() => document.getElementById('wx-time').value))
    .toBe('22/06/2026|03:00');
});

test('enabled overlays watermark dates that only the other weather feed publishes', async ({ page }) => {
  await serve(page, {
    pwx: { generatedAt: '2026-06-21T09:00:00Z', bounds: BOUNDS, levels: [
      { level: '90', label: 'FL030', times: [
        { valid: '12:00', day: '21/06/2026', png: 'ims/pwx/90/a.png' }] }] },
    sigwx: { generatedAt: '2026-06-21T09:00:00Z', times: [
      { valid: '18:00', day: '21/06/2026', png: 'ims/sigwx/b.png' }] },
  });
  await page.waitForFunction(() => document.querySelectorAll('#wx-time option').length === 2);

  await page.evaluate(() => {
    for (const id of ['ims-pwx-cb', 'sigwx-ov-cb']) {
      const cb = document.getElementById(id);
      cb.checked = true;
      cb.dispatchEvent(new Event('change'));
    }
    const time = document.getElementById('wx-time');
    time.value = '21/06/2026|18:00';
    time.dispatchEvent(new Event('change'));
  });

  const mark = page.locator('#weather-unavailable-watermark');
  await expect(mark).toBeVisible();
  await expect(mark.locator('[data-layer="pwx"]')).toHaveText('Wind/temp — Unavailable');
  await expect(mark.locator('[data-layer="sigwx"]')).toHaveCount(0);
  await expect(mark).toHaveCSS('pointer-events', 'none');

  await page.evaluate(() => {
    const time = document.getElementById('wx-time');
    time.value = '21/06/2026|12:00';
    time.dispatchEvent(new Event('change'));
  });
  await expect(mark.locator('[data-layer="pwx"]')).toHaveCount(0);
  await expect(mark.locator('[data-layer="sigwx"]')).toHaveText('SIGWX — Unavailable');

  await page.evaluate(() => {
    const cb = document.getElementById('sigwx-ov-cb');
    cb.checked = false;
    cb.dispatchEvent(new Event('change'));
  });
  await expect(mark).toBeHidden();
});

test('weather-unavailable watermark is localized in Hebrew', async ({ page }) => {
  await serve(page, {
    lang: 'he',
    pwx: { generatedAt: '2026-06-21T09:00:00Z', bounds: BOUNDS, levels: [
      { level: '90', label: 'FL030', times: [
        { valid: '12:00', day: '21/06/2026', png: 'ims/pwx/90/a.png' }] }] },
    sigwx: { generatedAt: '2026-06-21T09:00:00Z', times: [
      { valid: '18:00', day: '21/06/2026', png: 'ims/sigwx/b.png' }] },
  });
  await page.waitForFunction(() => document.querySelectorAll('#wx-time option').length === 2);
  await page.evaluate(() => {
    const cb = document.getElementById('ims-pwx-cb');
    cb.checked = true;
    cb.dispatchEvent(new Event('change'));
    const time = document.getElementById('wx-time');
    time.value = '21/06/2026|18:00';
    time.dispatchEvent(new Event('change'));
  });
  await expect(page.locator('#weather-unavailable-watermark [data-layer="pwx"]'))
    .toHaveText('רוח/טמפרטורה — לא זמין');
});
