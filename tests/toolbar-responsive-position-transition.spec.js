// @ts-check
// Desktop and floating-mobile toolbar positions use separate storage keys. Crossing the
// responsive boundary must also separate their live inline geometry.
const { test, expect } = require('./_setup');

async function bootDesktop(page, lang, mobilePosition) {
  await page.setViewportSize({ width: 1200, height: 900 });
  await page.addInitScript(({ language, savedMobile }) => {
    localStorage.clear();
    localStorage.setItem('navaid.toolbarPosDesktop.' + language,
      JSON.stringify({ x: 180, y: 90 }));
    if (savedMobile) {
      localStorage.setItem('navaid.toolbarPos.' + language, JSON.stringify(savedMobile));
    }
  }, { language: lang, savedMobile: mobilePosition });
  await page.goto('?lang=' + lang + '&nogist');
  // The wide menubar is almost viewport-wide, so x is clamped; its distinct y proves the
  // saved desktop geometry was applied before the responsive transition.
  await page.waitForFunction(() => document.getElementById('toolbar').style.top === '90px');
}

for (const lang of ['en', 'he']) {
  test('desktop coordinates do not leak into an unsaved ' + lang + ' mobile position', async ({ page }) => {
    await bootDesktop(page, lang, null);
    await page.setViewportSize({ width: 390, height: 780 });
    await page.waitForFunction(() => document.getElementById('toolbar').classList.contains('collapsed'));

    const box = await page.locator('#toolbar').boundingBox();
    expect(box).not.toBeNull();
    if (lang === 'en') expect(Math.round(box.x)).toBe(8);
    else expect(Math.round(390 - box.x - box.width)).toBe(8);
  });
}

test('a saved mobile position wins after leaving desktop mode', async ({ page }) => {
  await bootDesktop(page, 'en', { x: 44, y: 55 });
  await page.setViewportSize({ width: 390, height: 780 });
  await page.waitForFunction(() => document.getElementById('toolbar').style.left === '44px');

  const box = await page.locator('#toolbar').boundingBox();
  expect(box).not.toBeNull();
  expect(Math.round(box.x)).toBe(44);
  expect(Math.round(box.y)).toBe(55);
});
