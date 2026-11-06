// Toolbar group captions must remain readable in the light theme.
const { test, expect } = require('./_setup');

function contrastRatio(fg, bg) {
  const luminance = color => {
    const channels = color.match(/[\d.]+/g).slice(0, 3).map(value => {
      const c = Number(value) / 255;
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
  };
  const a = luminance(fg);
  const b = luminance(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

for (const lang of ['en', 'he']) {
  for (const section of ['weather', 'display']) {
    test(`light-theme ${section} frame captions meet contrast in ${lang}`, async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.addInitScript(() => {
        try {
          localStorage.clear();
          sessionStorage.clear();
          localStorage.setItem('navaid.theme', 'light');
        } catch (e) {}
      });
      await page.goto(`?lang=${lang}&nogist`);
      await page.waitForFunction(() => typeof state !== 'undefined');

      const menu = page.locator(`#toolbar .tb-section[data-sec="${section}"]`);
      await menu.locator('.tb-section-head').click();
      const captions = menu.locator('.tb-frame-title');
      await expect(captions.first()).toBeVisible();

      const ratios = await captions.evaluateAll(elements => elements
        .filter(el => el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().height > 0)
        .map(el => {
          const style = getComputedStyle(el);
          const bg = getComputedStyle(document.querySelector('#toolbar .tb-section-body')).backgroundColor;
          return { text: el.textContent.trim(), fg: style.color, bg };
        }));

      expect(ratios.length).toBeGreaterThan(0);
      for (const caption of ratios) {
        expect(contrastRatio(caption.fg, caption.bg), `${caption.text}: ${caption.fg} on ${caption.bg}`)
          .toBeGreaterThanOrEqual(4.5);
      }
    });
  }
}
