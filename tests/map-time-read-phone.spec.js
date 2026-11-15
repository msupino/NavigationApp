// @ts-check
// Reported: "the slider on mobile doesn't show the in-effect time". In the dark theme the phone's
// clock card stayed light, and its readout -- light text -- sat on white: the hour in effect was
// there, and unreadable. The card is dark in the dark theme, and the readout is bold 13 px.
const { test, expect } = require('./_setup');

test.use({ hasTouch: true, isMobile: true, viewport: { width: 412, height: 915 } });

for (const theme of ['light', 'dark']) test(`the phone's map clock shows the hour in effect, readable (${theme})`, async ({ page }) => {
  await page.addInitScript(t => { try { localStorage.setItem('navaid.theme', t); } catch (e) {} }, theme);
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof NavAid !== 'undefined' && NavAid.refreshMapClock);
  const got = await page.evaluate(() => {
    setTune('hideIdleMapClockOnPhone', false);
    NavAid.refreshMapClock();
    const s = document.getElementById('map-time-slider');
    s.value = '3'; s.dispatchEvent(new Event('input'));
    const rgb = c => (c.match(/[\d.]+/g) || []).map(Number);
    // A colour over its ground: the card's background composited over white (light) / black.
    const over = (fg, bg) => fg.length > 3 && fg[3] < 1
      ? fg.slice(0, 3).map((v, i) => v * fg[3] + bg[i] * (1 - fg[3])) : fg.slice(0, 3);
    const lum = c => {
      const l = c.map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
      return 0.2126 * l[0] + 0.7152 * l[1] + 0.0722 * l[2];
    };
    const card = getComputedStyle(document.getElementById('map-time'));
    const read = document.getElementById('map-time-read');
    const ground = document.body.classList.contains('theme-dark') ? [0, 0, 0] : [255, 255, 255];
    const bg = over(rgb(card.backgroundColor), ground);
    const fg = rgb(getComputedStyle(read).color).slice(0, 3);
    const [a, b] = [lum(fg), lum(bg)].sort((x, y) => y - x);
    return { text: read.textContent, ratio: (a + 0.05) / (b + 0.05),
      size: parseFloat(getComputedStyle(read).fontSize), weight: Number(getComputedStyle(read).fontWeight) };
  });
  expect(got.text).toMatch(/\+3h · \d\d:00Z/);
  expect(got.ratio).toBeGreaterThanOrEqual(4.5);
  expect(got.size).toBeGreaterThanOrEqual(13);
  expect(got.weight).toBeGreaterThanOrEqual(700);
});
