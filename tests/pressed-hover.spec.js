// @ts-check
// Reported: "mouse over button removes the highlight" -- "4 buttons act the same, sim, record,
// location and radio problem". A pressed menu-bar button keeps a solid blue fill while the
// pointer is on it, in both themes. The footer buttons' hover wash (8% blue in the light theme,
// 12% white in the dark) is more specific than the pressed rule and replaced it.
const { test, expect } = require('./_setup');

const IDS = ['sim-trigger', 'gps-record', 'gps-live', 'commfail-btn'];
// A solid blue: opaque, and blue well above red.
const solidBlue = (c) => {
  const m = c.match(/[\d.]+/g).map(Number);
  const a = m.length > 3 ? m[3] : 1;
  return a >= 0.9 && m[2] > 150 && m[2] > m[0] + 60;
};

for (const theme of ['light', 'dark']) {
  test(`pressed Sim, Record, Location and Comm fail stay blue under the mouse (${theme})`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 800 });
    await page.goto('?lang=en&nogist');
    await page.waitForFunction((ids) => document.documentElement.classList.contains('menubar')
      && ids.every(id => document.getElementById(id)) && !document.getElementById('boot-loading'), IDS);
    await page.evaluate(({ theme, ids }) => {
      document.body.classList.toggle('theme-light', theme === 'light');
      document.body.classList.toggle('theme-dark', theme === 'dark');
      for (const id of ids) {
        const b = document.getElementById(id);
        b.classList.add('gps-footer-btn');
        b.setAttribute('aria-pressed', 'true');
      }
    }, { theme, ids: IDS });
    for (const id of IDS) {
      const bg = () => page.evaluate((id) => getComputedStyle(document.getElementById(id)).backgroundColor, id);
      await page.mouse.move(5, 400);
      expect(solidBlue(await bg()), id + ' pressed').toBe(true);
      const b = await page.locator('#' + id).boundingBox();
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
      await expect.poll(() => page.evaluate((id) => document.getElementById(id).matches(':hover'), id)).toBe(true);
      const during = await bg();
      expect(solidBlue(during), id + ' hovered: ' + during).toBe(true);
    }
  });
}
