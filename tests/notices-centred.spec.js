// @ts-check
// Reported from the phone: "notifications should be in the middle of the screen" (a question
// opened pinned to the top) and "multiple notifications hide one another" (two toasts at once
// were drawn in the same place, over the coordinate readout).
const { test, expect } = require('./_setup');

const PHONE = { width: 390, height: 844 };

async function boot(page) {
  await page.setViewportSize(PHONE);
  await page.goto('?lang=he&nogist');
  await page.waitForFunction(() => typeof showToast === 'function' && typeof appConfirm === 'function');
}

test('several toasts at once each get their own line', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => { showToast('לא עוקב — המפה בשליטתכם'); showToast('צפון למעלה'); });
  const boxes = await page.locator('.toast.show').evaluateAll(els =>
    els.map(e => { const r = e.getBoundingClientRect(); return { top: r.top, bottom: r.bottom }; }));
  expect(boxes).toHaveLength(2);
  expect(boxes[0].bottom).toBeLessThanOrEqual(boxes[1].top);      // stacked, not on top of each other
});

test('the same message again is one line, not two', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => { showToast('צפון למעלה'); showToast('צפון למעלה'); });
  await expect(page.locator('.toast.show')).toHaveCount(1);
});

test('no more than three lines: the oldest makes way', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => ['א', 'ב', 'ג', 'ד'].forEach(m => showToast(m)));
  await expect(page.locator('.toast.show')).toHaveCount(3);
  await expect(page.locator('.toast.show').first()).toHaveText('ב');
});

test('a question opens in the middle of the phone screen, not pinned to the top', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => { appConfirm('להסיר את כל ציוני הדרך וההערות?'); });
  const box = await page.locator('.follow-me-ask-modal').boundingBox();
  const back = await page.locator('.modal-back:has(.follow-me-ask-modal)').boundingBox();
  const mid = back.y + back.height / 2;
  expect(Math.abs(box.y + box.height / 2 - mid)).toBeLessThan(4);
});

test('a message that arrives while a question is open does not cover it', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => { appConfirm('להסיר את כל ציוני הדרך וההערות?'); showToast('צפון למעלה'); });
  const q = await page.locator('.follow-me-ask-modal').boundingBox();
  const t = await page.locator('.toast.show').boundingBox();
  expect(t.y + t.height).toBeLessThanOrEqual(q.y);
});
