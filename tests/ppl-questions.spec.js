// @ts-check
// The PPL practical-exam question bank: a standalone page at /ppl-questions.html (not linked
// from the app). It loads nothing from a third party, and its answers open one at a time, by
// section, or by search.
const { test, expect } = require('./_setup');

test('the page lists 131 questions, toggles an answer, filters by section and search', async ({ page }) => {
  await page.goto('ppl-questions.html');
  const origin = new URL(page.url()).origin;
  const foreign = [];
  page.on('request', (r) => { const u = r.url(); if (!u.startsWith('data:') && new URL(u).origin !== origin) foreign.push(u); });
  await page.reload();                                  // count only what the page itself asks for
  await expect(page.locator('article.q')).toHaveCount(131);
  expect(foreign).toEqual([]);
  const first = page.locator('#q1');
  await expect(first.locator('.answer')).toBeHidden();
  await first.locator('.toggle').click();
  await expect(first.locator('.answer')).toBeVisible();
  await expect(first.locator('.toggle')).toHaveAttribute('aria-expanded', 'true');
  await page.locator('.chip[data-sec="5"]').click();
  await expect(page.locator('article.q:visible')).toHaveCount(6);
  await page.locator('.chip[data-sec="0"]').click();
  await page.locator('#search').fill('NOTAM');
  expect(await page.locator('article.q:visible').count()).toBeGreaterThan(0);
  expect(await page.locator('article.q:visible').count()).toBeLessThan(131);
  await expect(page.locator('a.home')).toBeVisible();   // a way back to NavAid on the web
});
