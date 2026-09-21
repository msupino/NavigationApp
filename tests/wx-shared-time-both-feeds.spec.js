// @ts-check
// PWX and SIGWX share one #wx-time dropdown, and the two feeds do not carry the same hours:
// PWX runs three-hourly off the latest model run, SIGWX publishes the prog charts. So the
// time NEAREST now -- which is how the dropdown seeds itself -- is regularly one only PWX
// has. PWX has always claimed a time it can draw (NavWxTime.prefer, on every level change);
// SIGWX never did, so it sat on a PWX-only hour drawing nothing and showing its "unavailable"
// watermark over a chart it could have drawn perfectly well.
//
// Observed on a PR preview at 09:54Z on 21/09: SIGWX offered 18:00 that day, PWX offered
// 12:00, the dropdown seeded to 12:00 (two hours away, against eight) and the map carried a
// SIGWX — Unavailable stamp. The fixtures below are that day.
const { test, expect } = require('./_setup');

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMCAYAAAB7P3qAAAAAAElFTkSuQmCC',
  'base64');
const BOUNDS = { s: 29.88, n: 33.82, w: 33.31, e: 36.69 };

// 09:54Z on 21/06/2026 — the hour the report came from, moved to a fixed date.
async function freeze(page) {
  await page.addInitScript(() => {
    const fixed = Date.UTC(2026, 5, 21, 9, 54);
    const RealDate = Date;
    // eslint-disable-next-line no-global-assign
    Date = class extends RealDate {
      constructor(...a) { super(...(a.length ? a : [fixed])); }
      static now() { return fixed; }
    };
  });
}

const sig = (day, valid) => ({ valid, day, png: 'ims/sigwx/' + day.slice(0, 2) + valid.slice(0, 2) + '.png' });
const pwx = (day, valid) => ({ valid, day, png: 'ims/pwx/' + day.slice(0, 2) + valid.slice(0, 2) + '.png' });

// The real shape of the two manifests that day: SIGWX skips 12:00, PWX has it and it is the
// nearest hour to now.
const SIGWX = { generatedAt: '2026-06-21T09:18:18Z', times: [
  sig('20/06/2026', '06:00'), sig('20/06/2026', '12:00'),
  sig('21/06/2026', '18:00'), sig('22/06/2026', '00:00'), sig('22/06/2026', '03:00')] };
const PWX = { generatedAt: '2026-06-21T09:18:18Z', bounds: BOUNDS, levels: [{
  level: '950', label: 'FL020', times: [
    pwx('21/06/2026', '12:00'), pwx('21/06/2026', '18:00'),
    pwx('22/06/2026', '00:00'), pwx('22/06/2026', '03:00'), pwx('22/06/2026', '06:00')] }] };

async function boot(page, { sigwx = SIGWX, pwxManifest = PWX } = {}) {
  await freeze(page);
  await page.route(/ims-data\/ims\/(sigwx|pwx)\/.*\.png/, r =>
    r.fulfill({ status: 200, contentType: 'image/png', body: PNG }));
  await page.route(/ims-data\/ims\/sigwx\.json/, r => r.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify(sigwx) }));
  await page.route(/ims-data\/ims\/pwx\.json/, r => r.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify(pwxManifest) }));
  await page.addInitScript(() => {
    for (const s of ['build', 'view', 'display', 'charts', 'export', 'print'])
      try { localStorage.setItem('navaid.sec.' + s, '1'); } catch (e) {}
  });
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => document.getElementById('sigwx-ov-cb')
    && document.querySelectorAll('#wx-time option').length > 0);
}

const turnOn = (page, id) => page.evaluate((cbId) => {
  const cb = document.getElementById(cbId);
  cb.checked = true;
  cb.dispatchEvent(new Event('change', { bubbles: true }));
}, id);
const wxValue = page => page.evaluate(() => document.getElementById('wx-time').value);
const watermark = page => page.locator('#weather-unavailable-watermark');

test('the nearest hour is the one only PWX publishes', async ({ page }) => {
  await boot(page);
  // The premise of the bug, asserted rather than assumed: with neither overlay on, the
  // dropdown seeds across the union and lands on a time SIGWX does not have.
  expect(await wxValue(page)).toBe('21/06/2026|12:00');
});

test('turning SIGWX on moves to an hour SIGWX can draw', async ({ page }) => {
  await boot(page);
  await turnOn(page, 'sigwx-ov-cb');
  expect(await wxValue(page)).toBe('21/06/2026|18:00');
  await expect(watermark(page)).toBeHidden();
});

test('with both overlays on, the hour is one they can both draw', async ({ page }) => {
  await boot(page);
  await turnOn(page, 'ims-pwx-cb');
  await turnOn(page, 'sigwx-ov-cb');
  // 18:00 is in both lists; 12:00 is PWX-only. One chart both can show beats two half-shown,
  // and neither overlay may drag the dropdown somewhere the other cannot follow.
  expect(await wxValue(page)).toBe('21/06/2026|18:00');
  await expect(watermark(page)).toBeHidden();
});

// The path the report actually came from. The overlay is restored from localStorage, which
// sets the checkbox DIRECTLY -- so the change listener never fires -- and it does so AFTER
// the manifest has already been merged, when the claim on a renderable time is still gated
// on a layer that is not yet on. Both feeds restore this way, so both were affected.
// The expected hour differs by layer, and that is the point: PWX can already draw the
// union's nearest (12:00), so prefer() stands down and nothing moves. SIGWX cannot, so it
// has to claim 18:00. Both must end up showing a chart.
for (const [layer, key, expected] of [
  ['SIGWX', 'navaid.sigwxOv', '21/06/2026|18:00'],
  ['PWX', 'navaid.imsPwx', '21/06/2026|12:00'],
]) {
  test('a reload with ' + layer + ' already on lands on an hour it can draw', async ({ page }) => {
    await freeze(page);
    await page.route(/ims-data\/ims\/(sigwx|pwx)\/.*\.png/, r =>
      r.fulfill({ status: 200, contentType: 'image/png', body: PNG }));
    await page.route(/ims-data\/ims\/sigwx\.json/, r => r.fulfill({
      status: 200, contentType: 'application/json', body: JSON.stringify(SIGWX) }));
    await page.route(/ims-data\/ims\/pwx\.json/, r => r.fulfill({
      status: 200, contentType: 'application/json', body: JSON.stringify(PWX) }));
    await page.addInitScript((k) => {
      for (const s of ['build', 'view', 'display', 'charts', 'export', 'print'])
        try { localStorage.setItem('navaid.sec.' + s, '1'); } catch (e) {}
      // What the previous session left behind: the layer was on. No wxTime is stored, so
      // nothing is pinned and the dropdown is free to be moved.
      try { localStorage.setItem(k, JSON.stringify({ on: true, level: '950', valid: '' })); } catch (e) {}
    }, key);
    await page.goto('?lang=en&nogist');
    await page.waitForFunction(() => document.querySelectorAll('#wx-time option').length >= 5);
    await expect.poll(() => wxValue(page)).toBe(expected);
    await expect(watermark(page)).toBeHidden();
  });
}

test('a time the pilot picked is never moved for them', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => {
    const sel = document.getElementById('wx-time');
    sel.value = '20/06/2026|06:00';               // SIGWX-only, and a day old
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await turnOn(page, 'ims-pwx-cb');
  // PWX cannot draw it and says so with its watermark. A deliberate choice is not something
  // another layer gets to overrule.
  expect(await wxValue(page)).toBe('20/06/2026|06:00');
  await expect(watermark(page)).toBeVisible();
});

test('with nothing in common, the layer that was switched on wins and the other says so', async ({ page }) => {
  await boot(page, {
    sigwx: { generatedAt: 'x', times: [sig('21/06/2026', '18:00')] },
    pwxManifest: { generatedAt: 'x', bounds: BOUNDS,
      levels: [{ level: '950', label: 'FL020', times: [pwx('21/06/2026', '12:00')] }] },
  });
  await turnOn(page, 'ims-pwx-cb');
  await turnOn(page, 'sigwx-ov-cb');
  expect(await wxValue(page)).toBe('21/06/2026|18:00');
  // The watermark is for exactly this: the feeds genuinely share no hour, so one chart is
  // shown and the other is named as missing rather than quietly absent.
  await expect(watermark(page)).toBeVisible();
  await expect(watermark(page)).toContainText('Wind/temp');
});
