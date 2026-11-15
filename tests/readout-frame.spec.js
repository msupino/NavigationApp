// @ts-check
// Reported: "recording or location changes the menu layout, make the additional info in a new
// frame, not change top menu size". On the desktop menu bar the live readout has a frame of its
// own; the bar keeps its size. On a phone the deck's strip shows it, as before.
const { test, expect } = require('./_setup');

const live = (page) => page.evaluate(() => {
  window.gpsLiveOn = true; window.gpsPositionLive = () => true; window.gpsRecording = true;
  window.gpsOwn = { lat: 32.1, lng: 34.9, hdg: 40, t: Date.now(), acc: 8 };
  if (typeof updateGpsRecIndicator === 'function') updateGpsRecIndicator();
  const el = document.getElementById('gps-readout');
  el.textContent = '1 pts · 00:00 · 92 kt · 2450 ft · 30.10″';
  el.classList.add('live-active');
});

for (const lang of ['en', 'he']) {
  test(`desktop (${lang}): the readout is in its own frame and the menu bar keeps its height`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 800 });
    await page.goto(`?lang=${lang}&nogist`);
    await page.waitForFunction(() => document.documentElement.classList.contains('menubar') && typeof updateGpsRecIndicator === 'function');
    const before = await page.evaluate(() => document.getElementById('toolbar').getBoundingClientRect().height);
    await live(page);
    const r = await page.evaluate(() => {
      const tb = document.getElementById('toolbar').getBoundingClientRect();
      const frame = document.getElementById('gps-readout-frame');
      const f = frame.getBoundingClientRect();
      return { h: tb.height, inFrame: document.getElementById('gps-readout').parentNode === frame,
        shown: getComputedStyle(frame).display !== 'none', belowBar: f.top >= tb.bottom - 1 };
    });
    expect(r).toEqual({ h: before, inFrame: true, shown: true, belowBar: true });
    // ...and it does not cover the GPS chip: the chip steps down below it ("it hides the gps info").
    await page.evaluate(() => { if (window.NavAid && NavAid.gpsStatus && NavAid.gpsStatus.tick) NavAid.gpsStatus.tick(); });
    await expect.poll(() => page.evaluate(() => {
      const chip = document.getElementById('gps-status');
      if (!chip || chip.hidden) return 'no chip';
      return chip.getBoundingClientRect().top >= document.getElementById('gps-readout-frame').getBoundingClientRect().bottom;
    }), { timeout: 4000 }).toBe(true);
  });
}

test('the frame is empty and hidden while nothing is live', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 800 });
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => document.documentElement.classList.contains('menubar'));
  expect(await page.evaluate(() => getComputedStyle(document.getElementById('gps-readout-frame')).display)).toBe('none');
});

test.describe('phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  test('the readout stays where the deck reads it', async ({ page }) => {
    await page.goto('?lang=en&nogist');
    await page.waitForFunction(() => document.body.classList.contains('deck-on'));
    expect(await page.evaluate(() => document.getElementById('gps-readout').closest('#gps-readout-frame'))).toBeNull();
  });
});
