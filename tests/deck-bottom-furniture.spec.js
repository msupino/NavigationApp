// @ts-check
// Everything that speaks from the bottom edge of a phone has to clear the deck. A toast is
// drawn at z-index 5000 and the deck at 2400, so a warning placed 24px off the bottom of the
// screen did not sit beside the five buttons -- it sat on top of them, covering the menu the
// warning was asking the pilot to use. Reported as: in mobile mode a popup warning hides the
// bottom menu.
const { test, expect } = require('./_setup');

const PHONE = { width: 390, height: 844 };

async function boot(page) {
  await page.setViewportSize(PHONE);
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => window.NavAid && typeof NavAid.refreshMobileDeck === 'function');
  await page.evaluate(() => {
    const b = document.getElementById('boot-loading');
    if (b) b.remove();
    document.documentElement.classList.remove('app-booting');
  });
  await expect(page.locator('#deck-bar')).toBeVisible();
}

// The top edge of the deck. Nothing anchored to the bottom may reach past it.
const deckTop = page => page.evaluate(() =>
  document.getElementById('deck-bar').getBoundingClientRect().top);

test('a toast sits above the deck, not over it', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => showToast('Airspace unavailable'));
  const toast = page.locator('.toast.show');
  await expect(toast).toBeVisible();
  const box = await toast.boundingBox();
  expect(box).not.toBeNull();
  expect(box.y + box.height).toBeLessThanOrEqual(await deckTop(page));
});

test('a toast does not cover the deck buttons it is asking about', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => showToast('Airspace unavailable'));
  await expect(page.locator('.toast.show')).toBeVisible();
  // Geometry, not a hit test: a toast is pointer-events:none, so it never blocked a tap --
  // it covered the labels, which is the whole complaint. Nothing it draws may land inside
  // any button's box.
  const hit = await page.evaluate(() => {
    const t = document.querySelector('.toast.show').getBoundingClientRect();
    const over = [];
    for (const btn of document.querySelectorAll('#deck-bar .deck-btn')) {
      const b = btn.getBoundingClientRect();
      if (t.left < b.right && t.right > b.left && t.top < b.bottom && t.bottom > b.top) {
        over.push(btn.textContent.trim());
      }
    }
    return over;
  });
  expect(hit).toEqual([]);
});

test('the update notice and the overlay spinner clear it too', async ({ page }) => {
  await boot(page);
  const top = await deckTop(page);
  // Both are placed by CSS alone, so the computed bottom is the whole answer -- and reading
  // it this way does not depend on either one having something to announce right now.
  const bottoms = await page.evaluate(() => {
    const mk = (cls) => {
      const el = document.createElement('div');
      el.className = cls;
      el.textContent = 'x';
      document.body.appendChild(el);
      const b = el.getBoundingClientRect();
      el.remove();
      return b.bottom;
    };
    return { notice: mk('build-update-notice'), spinner: mk('overlay-loading') };
  });
  expect(bottoms.notice).toBeLessThanOrEqual(top);
  expect(bottoms.spinner).toBeLessThanOrEqual(top);
});

test('with the deck off, the toast keeps its place at the bottom', async ({ page }) => {
  await page.setViewportSize(PHONE);
  await page.goto('?lang=en&nogist&deck=0');
  await page.waitForFunction(() => typeof showToast === 'function');
  await page.evaluate(() => showToast('Airspace unavailable'));
  const box = await page.locator('.toast.show').boundingBox();
  // 24px off the bottom, as it was before the deck existed: the move is the deck's doing and
  // must not follow the feature around when the gist withdraws it.
  expect(Math.round(844 - (box.y + box.height))).toBe(24);
});
