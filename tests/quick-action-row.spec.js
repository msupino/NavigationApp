// @ts-check
// PR #245 — Quick-action row at the top of the toolbar: 5 most-used buttons
// are always visible above the collapsible sections, with no duplicate IDs.
const { test, expect } = require('./_setup');

async function boot(page) {
  await page.addInitScript(() => {
    try {
      if (localStorage.getItem('__test_qar_init') !== '1') {
        localStorage.clear();
        sessionStorage.clear();
        localStorage.setItem('__test_qar_init', '1');
      }
    } catch (e) {}
  });
  await page.goto('/?lang=en');
  await page.waitForFunction(() => typeof state !== 'undefined');
}

test.describe('Quick-action row (#tb-quick)', () => {
  test('exists with the 5 expected buttons', async ({ page }) => {
    await boot(page);
    const quick = page.locator('#tb-quick');
    await expect(quick).toBeVisible();

    const ids = await quick.locator('button').evaluateAll(btns => btns.map(b => b.id));
    expect(ids).toEqual(['tool-add', 'tool-note', 'fit', 'plan', 'save']);
  });

  test('is not a collapsible section (no .tb-section class, no header)', async ({ page }) => {
    await boot(page);
    const quick = page.locator('#tb-quick');
    await expect(quick).not.toHaveClass(/tb-section/);
    await expect(quick.locator('.tb-section-head')).toHaveCount(0);
  });

  test('always visible when toolbar is expanded', async ({ page }) => {
    await boot(page);
    await expect(page.locator('#tb-quick')).toBeVisible();
  });

  test.describe('no duplicate IDs — buttons removed from collapsible sections', () => {
    test('tool-add and tool-note not in Build section', async ({ page }) => {
      await boot(page);
      const build = page.locator('.tb-section[data-sec="build"]');
      await expect(build.locator('#tool-add')).toHaveCount(0);
      await expect(build.locator('#tool-note')).toHaveCount(0);
    });

    test('fit not in Build section', async ({ page }) => {
      await boot(page);
      const build = page.locator('.tb-section[data-sec="build"]');
      await expect(build.locator('#fit')).toHaveCount(0);
    });

    test('plan not in Charts section', async ({ page }) => {
      await boot(page);
      const charts = page.locator('.tb-section[data-sec="charts"]');
      await expect(charts.locator('#plan')).toHaveCount(0);
    });

    test('save not in Export section', async ({ page }) => {
      await boot(page);
      const exportSec = page.locator('.tb-section[data-sec="export"]');
      await expect(exportSec.locator('#save')).toHaveCount(0);
    });
  });

  test.describe('CSS styling', () => {
    test('buttons have font-weight 600', async ({ page }) => {
      await boot(page);
      const btn = page.locator('#tb-quick button').first();
      const fw = await btn.evaluate(el => getComputedStyle(el).fontWeight);
      expect(fw).toBe('600');
    });

    test('row has a bottom border divider', async ({ page }) => {
      await boot(page);
      const quick = page.locator('#tb-quick');
      const bb = await quick.evaluate(el => getComputedStyle(el).borderBottom);
      expect(bb).toMatch(/1px/);
    });
  });

  test.describe('quick-action buttons are functional', () => {
    test('tool-add enters add-waypoint mode', async ({ page }) => {
      await boot(page);
      await page.locator('#tb-quick #tool-add').click();
      const hasClass = await page.locator('#map').evaluate(el => el.classList.contains('add'));
      expect(hasClass).toBe(true);
      // Exit mode
      await page.keyboard.press('Escape');
    });

    test('tool-note enters add-note mode', async ({ page }) => {
      await boot(page);
      await page.locator('#tb-quick #tool-note').click();
      const hasAddClass = await page.locator('#map').evaluate(el => el.classList.contains('add'));
      expect(hasAddClass).toBe(true);
      const isActive = await page.locator('#tb-quick #tool-note').evaluate(el => el.classList.contains('active'));
      expect(isActive).toBe(true);
      await page.keyboard.press('Escape');
    });

    test('fit triggers fitView', async ({ page }) => {
      await boot(page);
      await page.evaluate(() => {
        state.waypoints.push({ lat: 32.0, lng: 34.8, name: 'A' });
        state.waypoints.push({ lat: 32.1, lng: 34.9, name: 'B' });
      });
      await page.locator('#tb-quick #fit').click();
      const center = await page.evaluate(() => map.getCenter());
      expect(center.lat).toBeCloseTo(32.05, 1);
    });

    test('plan toggles flight plan modal', async ({ page }) => {
      await boot(page);
      await page.evaluate(() => {
        state.waypoints.push({ lat: 32.0, lng: 34.8, name: 'A' });
        state.waypoints.push({ lat: 32.1, lng: 34.9, name: 'B' });
        syncLegs();
        draw();
      });
      await page.locator('#tb-quick #plan').click();
      await expect(page.locator('.modal-back.flight-plan')).toBeVisible();
      await page.locator('#tb-quick #plan').click();
      await expect(page.locator('.modal-back.flight-plan')).not.toBeVisible();
    });

    test('save triggers JSON export', async ({ page }) => {
      await boot(page);
      await page.evaluate(() => {
        state.waypoints.push({ lat: 32.0, lng: 34.8, name: 'A' });
        state.waypoints.push({ lat: 32.1, lng: 34.9, name: 'B' });
      });
      const download = page.waitForEvent('download', { timeout: 3000 });
      await page.locator('#tb-quick #save').click();
      await download;
    });
  });
});
