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
    expect(Math.round(box.y)).toBe(8);
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

test('a queued desktop restore cannot overwrite mobile after a rapid mode flip', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 780 });
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem('navaid.toolbarPosDesktop.en', JSON.stringify({ x: 120, y: 90 }));
  });
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => document.getElementById('toolbar').classList.contains('collapsed'));

  await page.evaluate(() => {
    const nativeRequestAnimationFrame = window.requestAnimationFrame;
    const queued = [];
    window.requestAnimationFrame = callback => {
      queued.push(callback);
      return queued.length;
    };
    window.__toolbarTestFrameCount = () => queued.length;
    window.__flushToolbarTestFrames = () => {
      window.requestAnimationFrame = nativeRequestAnimationFrame;
      for (const callback of queued.splice(0)) callback(performance.now());
    };
  });

  await page.setViewportSize({ width: 1200, height: 900 });
  // Poll by timer because requestAnimationFrame is intentionally held above. Also require
  // queued work: the media query can change before its listener queues the restore.
  await page.waitForFunction(() => {
    const desktop = matchMedia('(min-width: 681px) and (hover: hover) and (pointer: fine)').matches;
    return desktop && !document.getElementById('toolbar').classList.contains('collapsed') &&
      window.__toolbarTestFrameCount() > 0;
  }, null, { polling: 10 });
  await page.setViewportSize({ width: 390, height: 780 });
  await page.waitForFunction(() => {
    const desktop = matchMedia('(min-width: 681px) and (hover: hover) and (pointer: fine)').matches;
    return !desktop && document.getElementById('toolbar').classList.contains('collapsed');
  }, null, { polling: 10 });
  await page.evaluate(() => window.__flushToolbarTestFrames());

  const box = await page.locator('#toolbar').boundingBox();
  expect(box).not.toBeNull();
  expect(Math.round(box.x)).toBe(8);
  expect(Math.round(box.y)).toBe(8);
});
