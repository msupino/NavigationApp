// @ts-check
// The two in-flight controls used to wear emoji, which every phone drew differently and
// which said nothing about flying. They now draw their own marks: the follow button wears
// the VOR symbol the chart uses for a station (it holds the map on one point), and the
// orientation button is a compass needle pointing at something real on the screen, with the
// track written under it while a fix is driving the map.
const { test, expect } = require('./_setup');

async function boot(page) {
  await page.addInitScript(() => {
    window.__geoCb = null;
    navigator.geolocation.watchPosition = (cb) => { window.__geoCb = cb; return 11; };
    navigator.geolocation.clearWatch = () => {};
  });
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof startLiveLocation === 'function' &&
    !!document.getElementById('follow-lock') && !!document.getElementById('orient-toggle'));
  await page.evaluate(() => startLiveLocation());
}

const fix = (page, hdg) => page.evaluate((h) => {
  window.__geoCb({ coords: { latitude: 32.1, longitude: 34.9, accuracy: 6, speed: 40, altitude: 300, heading: h }, timestamp: Date.now() });
}, hdg);

test('the follow button is the VOR symbol, red while it is holding', async ({ page }) => {
  await boot(page);
  const on = await page.evaluate(() => document.getElementById('follow-lock').innerHTML);
  expect(on).toContain('<svg');
  expect(on).toContain('#c8442e');                       // lit
  expect(await page.evaluate(() =>
    document.getElementById('follow-lock').classList.contains('follow-on'))).toBe(true);

  await page.click('#follow-lock');
  const off = await page.evaluate(() => document.getElementById('follow-lock').innerHTML);
  expect(off).toContain('#7a7a7a');                      // grey, and the square is not lit
  expect(await page.evaluate(() =>
    document.getElementById('follow-lock').classList.contains('follow-on'))).toBe(false);
});

// A ring with four ticks and a filled centre -- the same three parts drawVorSymbol() paints
// on the chart, so the button and the station read as the same idea.
test('the follow symbol is the one the chart draws for a station', async ({ page }) => {
  await boot(page);
  const parts = await page.evaluate(() => {
    const svg = document.querySelector('#follow-lock svg');
    return {
      circles: svg.querySelectorAll('circle').length,     // ring + centre
      ticks: (svg.querySelector('path').getAttribute('d').match(/M/g) || []).length,
    };
  });
  expect(parts).toEqual({ circles: 2, ticks: 4 });
});

test('the compass points where the aircraft is going, and says the track', async ({ page }) => {
  await boot(page);
  await fix(page, 75);
  await page.waitForFunction(() => /075/.test(document.getElementById('orient-toggle').textContent));
  const northUp = await page.evaluate(() => {
    const b = document.getElementById('orient-toggle');
    return { rot: b.querySelector('g').getAttribute('transform'), hdg: b.textContent.trim() };
  });
  expect(northUp.rot).toBe('rotate(75 12 12)');          // the chart is still; the track turns
  expect(northUp.hdg).toBe('075°');
});

test('with the chart turned to the track, the needle points at north instead', async ({ page }) => {
  await boot(page);
  await fix(page, 75);
  await page.click('#orient-toggle');                     // heading up
  await page.waitForFunction(() =>
    document.getElementById('orient-toggle').classList.contains('orient-on'));
  const rot = await page.evaluate(() =>
    document.getElementById('orient-toggle').querySelector('g').getAttribute('transform'));
  // Heading up rotates the map by 360 - track, and the needle follows the map so it keeps
  // pointing at north rather than spinning with the aircraft.
  expect(rot).toBe('rotate(285 12 12)');
});

test('with no fix yet there is no track to write', async ({ page }) => {
  await boot(page);
  expect(await page.evaluate(() =>
    document.getElementById('orient-toggle').textContent.trim())).toBe('');
});
