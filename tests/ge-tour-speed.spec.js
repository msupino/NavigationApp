// Google Earth tour speed picker (#1372). The KML carries fixed <gx:duration>
// values — Earth has no playback-speed control — so the multiplier has to scale
// the durations we write at export time.
const { test, expect } = require('./_setup');

async function boot(page) {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof syncLegs === 'function');
  await page.evaluate(() => {
    state.waypoints = [
      { lat: 32.0, lng: 34.9, name: 'A' },
      { lat: 32.4, lng: 35.1, name: 'B' },
      { lat: 32.8, lng: 34.8, name: 'C' },
    ];
    state.legs = []; syncLegs();
    state.legs.forEach(l => { l.flightSpeed = 90; l.inboundAltitude = 3000; });
    draw();
  });
}

// Capture the KML instead of downloading it.
async function kmlFor(page, speed) {
  return page.evaluate(async (sp) => {
    if (sp !== null) setGeTourSpeed(sp);
    let text = null;
    const realCreate = URL.createObjectURL;
    URL.createObjectURL = blob => { window.__kmlBlob = blob; return 'blob:stub'; };
    const realClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {};
    const realRevoke = URL.revokeObjectURL;
    URL.revokeObjectURL = () => {};
    const realConfirm = window.confirm;
    window.confirm = () => true;
    try {
      await flyRoute();
      document.querySelector('.modal-btns button:nth-child(2)').click();
      text = await window.__kmlBlob.text();
    } finally {
      URL.createObjectURL = realCreate;
      URL.revokeObjectURL = realRevoke;
      HTMLAnchorElement.prototype.click = realClick;
      window.confirm = realConfirm;
      document.querySelectorAll('.modal-back').forEach(e => e.remove());
    }
    return text;
  }, speed);
}

const totalDur = kml =>
  [...kml.matchAll(/<gx:duration>([\d.]+)<\/gx:duration>/g)]
    .reduce((a, m) => a + Number(m[1]), 0);

test('speed picker shows the four speeds, 1x selected by default', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => flyRoute());
  const sel = page.locator('#ge-tour-speed');
  await expect(sel).toBeVisible();
  expect(await sel.locator('option').allTextContents())
    .toEqual(['0.5x', '1x (normal)', '2x', '4x']);
  await expect(sel).toHaveValue('1');
});

test('picking a speed persists it to localStorage and survives a reload', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => flyRoute());
  await page.selectOption('#ge-tour-speed', '2');
  expect(await page.evaluate(() => localStorage.getItem('navaid.geTourSpeed'))).toBe('2');
  await boot(page);
  await page.evaluate(() => flyRoute());
  await expect(page.locator('#ge-tour-speed')).toHaveValue('2');
});

test('1x is stored as the absence of the key', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => flyRoute());
  await page.selectOption('#ge-tour-speed', '4');
  await page.selectOption('#ge-tour-speed', '1');
  expect(await page.evaluate(() => localStorage.getItem('navaid.geTourSpeed'))).toBeNull();
});

test('2x halves the tour, 0.5x doubles it', async ({ page }) => {
  await boot(page);
  const base = totalDur(await kmlFor(page, 1));
  expect(base).toBeGreaterThan(0);
  const fast = totalDur(await kmlFor(page, 2));
  const slow = totalDur(await kmlFor(page, 0.5));
  expect(fast).toBeLessThan(base);
  expect(slow).toBeGreaterThan(base);
  expect(fast / base).toBeCloseTo(0.5, 1);
  expect(slow / base).toBeCloseTo(2, 1);
});

test('no camera move is shorter than kmlTourMinSegSec even at 4x', async ({ page }) => {
  await boot(page);
  const kml = await kmlFor(page, 4);
  const floor = await page.evaluate(() => Number(tune('kmlTourMinSegSec')));
  const durs = [...kml.matchAll(/<gx:duration>([\d.]+)<\/gx:duration>/g)].map(m => Number(m[1]));
  expect(durs.length).toBeGreaterThan(3);
  expect(Math.min(...durs)).toBeGreaterThanOrEqual(floor);
});

test('the base pace comes from the tune keys', async ({ page }) => {
  await boot(page);
  const base = totalDur(await kmlFor(page, 1));
  // These ~24 NM legs sit on the kmlTourLegMaxSec clamp at the default pace, so
  // only lowering the per-minute pace is observable without also raising the clamp.
  await page.evaluate(() => setTune('kmlTourSecPerFlightMin', 1));
  const faster = totalDur(await kmlFor(page, null));
  expect(faster).toBeLessThan(base);
  await page.evaluate(() => { setTune('kmlTourSecPerFlightMin', 8); setTune('kmlTourLegMaxSec', 300); });
  const slower = totalDur(await kmlFor(page, null));
  expect(slower).toBeGreaterThan(base);
});

test('an invalid stored speed falls back to 1x', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => localStorage.setItem('navaid.geTourSpeed', '99'));
  expect(await page.evaluate(() => geTourSpeed())).toBe(1);
  await page.evaluate(() => flyRoute());
  await expect(page.locator('#ge-tour-speed')).toHaveValue('1');
});

test('the speed row is legible in both themes', async ({ page }) => {
  await boot(page);
  const colors = await page.evaluate(() => {
    const read = () => {
      document.querySelectorAll('.modal-back').forEach(e => e.remove());
      flyRoute();
      const row = document.getElementById('ge-tour-speed-row');
      const sel = document.getElementById('ge-tour-speed');
      return {
        row: getComputedStyle(row).color,
        sel: getComputedStyle(sel).color,
        selBg: getComputedStyle(sel).backgroundColor,
        modalBg: getComputedStyle(row.closest('.modal')).backgroundColor,
      };
    };
    document.body.classList.add('theme-light');
    const light = read();
    document.body.classList.remove('theme-light');
    const dark = read();
    return { light, dark };
  });
  const lum = css => {
    const [r, g, b] = css.match(/[\d.]+/g).map(Number);
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  };
  // Text must sit on the opposite side of mid-grey from its background in each
  // theme — the first cut of this row hardcoded dark-theme colors and vanished
  // on the light modal.
  expect(lum(colors.light.row)).toBeLessThan(0.5);
  expect(lum(colors.light.modalBg)).toBeGreaterThan(0.5);
  expect(lum(colors.light.sel)).toBeLessThan(0.5);
  expect(lum(colors.light.selBg)).toBeGreaterThan(0.5);
  expect(lum(colors.dark.row)).toBeGreaterThan(0.5);
  expect(lum(colors.dark.modalBg)).toBeLessThan(0.5);
  expect(lum(colors.dark.sel)).toBeGreaterThan(0.5);
  expect(lum(colors.dark.selBg)).toBeLessThan(0.5);
});
