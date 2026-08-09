// @ts-check
// Every gist edit starts with "what is the key called?" -- and the tune panel showed only
// the human label. The label now carries the registry key: hover for it, click to copy.
const { test, expect } = require('./_setup');

async function bootTune(page) {
  await page.addInitScript(() => {
    try { for (const s of ['build', 'view', 'display']) localStorage.setItem('navaid.sec.' + s, '1'); } catch (e) {}
  });
  await page.goto('?lang=en&nogist&tune=1');
  // Rows live inside closed <details> groups (zero box = not "visible"), so wait for
  // attachment and open every group.
  await page.waitForSelector('.tune-row', { state: 'attached' });
  await page.evaluate(() => document.querySelectorAll('details.tune-group')
    .forEach(d => { d.open = true; }));
}

test('the label tooltip is the registry key', async ({ page }) => {
  await bootTune(page);
  const row = page.locator('.tune-row', { has: page.locator('#tune-vorLabelMinZoom-number') });
  await expect(row.locator('.tune-label')).toHaveAttribute('title', 'vorLabelMinZoom');
});

test('clicking the label copies the key and says so', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await bootTune(page);
  const row = page.locator('.tune-row', { has: page.locator('#tune-vorLabelMinZoom-number') });
  await row.locator('.tune-label').click();
  await expect(row.locator('.tune-label')).toContainText('vorLabelMinZoom ✓ copied');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('vorLabelMinZoom');
  // ...and the label restores itself, so the panel does not stay littered with confirmations.
  await expect(row.locator('.tune-label')).not.toContainText('copied', { timeout: 3000 });
  // The click must not have toggled or focused the row's control into a changed value.
  expect(await page.evaluate(() => tune('vorLabelMinZoom'))).toBe(10);
});

test('the find box matches by key name, not only by label', async ({ page }) => {
  await bootTune(page);
  await page.fill('#tune-find', 'lsaLabelFontPx');
  const visible = page.locator('.tune-row:visible', { has: page.locator('#tune-lsaLabelFontPx-number') });
  await expect(visible).toHaveCount(1);
});
