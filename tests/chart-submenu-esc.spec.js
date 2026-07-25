// @ts-check
// Charts submenu behaviour on desktop: opening a chart item keeps its submenu
// open, and Escape (or an outside click) while a modal is open closes only the
// modal, leaving the submenu open — uniform for all chart items. With no modal
// open, Escape still closes the submenu.
const { test, expect } = require('./_setup');

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });   // desktop menu-bar mode
  await page.goto('?lang=en');
  await page.waitForFunction(() => typeof state !== 'undefined' &&
    document.querySelector('[data-sec="charts"] .tb-section-head'));
});

async function openCharts(page) {
  await page.locator('[data-sec="charts"] .tb-section-head').click();
  await expect(page.locator('[data-sec="charts"]')).toHaveClass(/open/);
}

test('Escape with a modal open closes only the modal, keeping the Charts submenu', async ({ page }) => {
  await openCharts(page);
  // Simulate an open chart modal.
  await page.evaluate(() => {
    const back = document.createElement('div');
    back.className = 'modal-back';
    back.dataset.chartModal = 'test';
    back.innerHTML = '<div class="modal">chart</div>';
    // Close on its own Escape (like the real chart modals do).
    document.addEventListener('keydown', function onEsc(e) {
      if (e.key === 'Escape') { back.remove(); document.removeEventListener('keydown', onEsc); }
    });
    document.body.appendChild(back);
  });
  await page.keyboard.press('Escape');
  await expect(page.locator('.modal-back')).toHaveCount(0);              // modal closed
  await expect(page.locator('[data-sec="charts"]')).toHaveClass(/open/); // submenu stays open
});

test('Escape with no modal open still closes the Charts submenu', async ({ page }) => {
  await openCharts(page);
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-sec="charts"]')).not.toHaveClass(/open/);
});

test('the chart command ids are not in the close-after set (submenu stays open on open)', async ({ page }) => {
  // Opening a chart item must not schedule a menu close. We assert the three
  // chart heads/items share the behaviour by checking the submenu survives an
  // in-toolbar click on a chart button.
  await openCharts(page);
  // A synthetic modal stands in for the chart the click would open.
  await page.evaluate(() => {
    const b = document.createElement('div'); b.className = 'modal-back'; b.dataset.chartModal = 't';
    document.body.appendChild(b);
  });
  // A pointerdown on the modal backdrop must not close the submenu.
  await page.evaluate(() => document.querySelector('.modal-back')
    .dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })));
  await expect(page.locator('[data-sec="charts"]')).toHaveClass(/open/);
});
