// @ts-check
// A message (toast) and the bottom chips share the bottom band on a phone; the chips step back
// while it shows instead of sitting under it. The start-a-route hint is gone while measuring.
const { test, expect } = require('./_setup');

test('while a toast shows, the hint and the coordinate readout wait; measuring hides the hint', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => { try { localStorage.removeItem('navaid.routeHintSeen'); } catch (e) {} });
  await page.goto('?lang=he&nogist');
  await page.waitForFunction(() => typeof measureToggle === 'function' && typeof showToast === 'function');
  const vis = (sel) => page.evaluate((s) => { const e = document.querySelector(s); return e ? getComputedStyle(e).visibility !== 'hidden' && getComputedStyle(e).display !== 'none' : null; }, sel);
  const hintBefore = await vis('#empty-route-hint');
  await page.evaluate(() => showToast('הודעה לבדיקה'));
  await expect.poll(() => vis('#coord-readout')).toBe(false);
  if (hintBefore) expect(await vis('#empty-route-hint')).toBe(false);
  await page.evaluate(() => measureToggle(true));
  expect(await page.evaluate(() => document.body.classList.contains('measuring'))).toBe(true);
  if (hintBefore) {
    await page.evaluate(() => document.querySelectorAll('#toast-stack .toast').forEach(t => t.remove()));
    expect(await vis('#empty-route-hint')).toBe(false);
    await page.evaluate(() => measureToggle(false));
    expect(await vis('#empty-route-hint')).toBe(true);
  }
});
