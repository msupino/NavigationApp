// @ts-check
// Voice alerts as a map button, not only a checkbox in View/Set. It is a thing a pilot changes
// WHILE flying — the cabin got noisy, a passenger is asleep — and a toggle you have to open a
// menu to reach is one you leave where it is. It appears on the same condition as the other
// in-flight controls: only while a fix is driving the map.
const { test, expect } = require('./_setup');

async function boot(page) {
  await page.addInitScript(() => {
    window.__geoCb = null;
    navigator.geolocation.watchPosition = (cb) => { window.__geoCb = cb; return 17; };
    navigator.geolocation.clearWatch = () => {};
  });
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof startLiveLocation === 'function' &&
    !!document.getElementById('voice-toggle'));
}

const shown = (page) => page.evaluate(() =>
  getComputedStyle(document.getElementById('voice-toggle').parentNode).display !== 'none');

test('it appears only while a fix is driving the map', async ({ page }) => {
  await boot(page);
  expect(await shown(page)).toBe(false);
  await page.evaluate(() => startLiveLocation());
  expect(await shown(page)).toBe(true);
  await page.evaluate(() => stopLiveLocation());
  expect(await shown(page)).toBe(false);
});

test('it sits above the orientation button, at the top of the column', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => startLiveLocation());
  const order = await page.evaluate(() => {
    const rowOf = (el) => {
      const corner = document.querySelector('.leaflet-bottom.leaflet-right');
      const row = el && el.closest('.leaflet-control');
      return row ? Array.prototype.indexOf.call(corner.children, row) : -1;
    };
    return {
      voice: rowOf(document.getElementById('voice-toggle')),
      orient: rowOf(document.getElementById('orient-toggle')),
      follow: rowOf(document.getElementById('follow-lock')),
    };
  });
  expect(order.voice).toBeLessThan(order.orient);
  expect(order.orient).toBeLessThan(order.follow);
});

test('tapping it speaks or silences, and says which it is', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => startLiveLocation());
  const off = await page.evaluate(() => {
    const b = document.getElementById('voice-toggle');
    return { on: window.voiceAlerts === true, pressed: b.getAttribute('aria-pressed'), label: b.getAttribute('aria-label') };
  });
  expect(off.on).toBe(false);
  expect(off.label).toMatch(/silent/i);
  await page.click('#voice-toggle');
  const on = await page.evaluate(() => {
    const b = document.getElementById('voice-toggle');
    return { on: window.voiceAlerts === true, pressed: b.getAttribute('aria-pressed'), label: b.getAttribute('aria-label') };
  });
  expect(on.on).toBe(true);
  expect(on.pressed).toBe('true');
  expect(on.label).toMatch(/spoken/i);
});

test('the button and the View/Set checkbox are the same switch', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => startLiveLocation());
  await page.click('#voice-toggle');
  expect(await page.evaluate(() => document.getElementById('voice-alerts-cb').checked)).toBe(true);
  const back = await page.evaluate(() => {
    const cb = document.getElementById('voice-alerts-cb');
    cb.checked = false; cb.onchange({ target: cb });
    return { global: window.voiceAlerts, pressed: document.getElementById('voice-toggle').getAttribute('aria-pressed') };
  });
  expect(back.global).toBe(false);
  expect(back.pressed).toBe('false');            // the map button followed the menu
});

test('the choice survives a reload', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => startLiveLocation());
  await page.click('#voice-toggle');
  expect(await page.evaluate(() => localStorage.getItem('navaid.voiceAlerts'))).toBe('1');
  await page.reload();
  await page.waitForFunction(() => typeof window.voiceAlerts === 'boolean');
  expect(await page.evaluate(() => window.voiceAlerts)).toBe(true);
});
