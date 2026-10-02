// @ts-check
// The language picker lives in Settings, a word written in the current language: someone who
// opens the Hebrew default and reads no Hebrew could not find their way to English. So a
// switch stays in sight -- a globe and the OTHER language's own name ("English" while the app
// is Hebrew), named in that language for a screen reader too.
const { test, expect } = require('./_setup');

test('phone: the strip carries a globe switch named in the other language, and it switches', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('?lang=he&nogist');
  const btn = page.locator('#deck-strip .deck-strip-lang');
  await expect(btn).toBeVisible();
  await expect(btn).toHaveText('English');
  await expect(btn).toHaveAttribute('aria-label', 'Switch to English');
  expect(await btn.locator('svg').count()).toBe(1);
  expect((await btn.boundingBox()).height).toBeGreaterThanOrEqual(44);
  await Promise.all([page.waitForURL(/lang=en/), btn.click()]);
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.locator('#deck-strip .deck-strip-lang')).toHaveText('עברית');
});

test('desktop: the menubar keeps a globe switch in sight, and stays one row', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('?lang=he&nogist');
  const btn = page.locator('#lang-quick');
  await expect(btn).toBeVisible();
  await expect(btn).toHaveAttribute('title', 'Switch to English');
  expect(await btn.locator('svg').count()).toBe(1);
  const h = await page.evaluate(() => document.getElementById('toolbar').getBoundingClientRect().height);
  expect(h).toBeLessThan(45);
  await Promise.all([page.waitForURL(/lang=en/), btn.click()]);
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
});
