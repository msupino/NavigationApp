// @ts-check
// The app ships user-scalable=no so a stray two-finger touch cannot leave the whole
// cockpit UI scaled and offset mid-flight. That also means browser zoom is unavailable
// everywhere, so the two places that genuinely need it own the gesture themselves:
// the plate viewer (a dense A4 sheet squeezed to a phone's width) and the inspector's
// satellite thumbnail (a fixed-zoom tile grid that previously had no zoom at all).
const { test, expect } = require('./_setup');

const PHONE = { width: 390, height: 844 };

async function boot(page) {
  await page.goto('?lang=en');
  await page.waitForFunction(() => !document.getElementById('boot-loading'));
}

test.describe('plate viewer', () => {
  async function openPlate(page) {
    await boot(page);
    await page.waitForFunction(() => typeof showPlateViewer === 'function');
    await page.evaluate(() => showPlateViewer('LLHZ_airport_CVFR.pdf', 'LLHZ VAC'));
    await expect(page.locator('.modal-back.plate-viewer')).toBeVisible();
  }

  test('zoom widens the sheet so the wrapper has something to pan', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await openPlate(page);
    const pct = page.locator('.plate-zoom-pct');
    await expect(pct).toHaveText('100%');
    await page.locator('.plate-zoom-btn').last().click();
    await expect(pct).toHaveText('150%');
    // Applied as width, not a transform, so overflow:auto keeps doing the panning.
    const w = await page.locator('.plate-canvas').first().evaluate(e => e.style.width);
    expect(w).toBe('150%');
  });

  test('the percentage button returns to fit width', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await openPlate(page);
    const zoomIn = page.locator('.plate-zoom-btn').last();
    await zoomIn.click();
    await zoomIn.click();
    await expect(page.locator('.plate-zoom-pct')).toHaveText('225%');
    await page.locator('.plate-zoom-pct').click();
    await expect(page.locator('.plate-zoom-pct')).toHaveText('100%');
  });

  test('the ends of the range dim the button rather than removing it', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await openPlate(page);
    const zoomOut = page.locator('.plate-zoom-btn').first();
    const zoomIn = page.locator('.plate-zoom-btn').last();
    await expect(zoomOut).toBeVisible();
    await expect(zoomOut).toBeDisabled();          // at fit width already
    for (let i = 0; i < 10 && await zoomIn.isEnabled(); i++) await zoomIn.click();
    await expect(zoomIn).toBeVisible();
    await expect(zoomIn).toBeDisabled();           // clamped at 600%
    await expect(page.locator('.plate-zoom-pct')).toHaveText('600%');
    await expect(zoomOut).toBeEnabled();           // and the other end reopens
  });
});

test.describe('satellite thumbnail', () => {
  async function openInspector(page) {
    await boot(page);
    await page.waitForFunction(() => typeof appendSatelliteSnippet === 'function');
    await page.evaluate(() => {
      const body = document.getElementById('insp-body');
      body.innerHTML = '';
      appendSatelliteSnippet(body, { lat: 32.18, lng: 34.83 }, 'LLHZ');
      document.getElementById('inspector').classList.remove('hidden');
    });
  }

  test('the thumbnail zooms by re-rendering the tile grid', async ({ page }) => {
    await openInspector(page);
    const snip = page.locator('.satellite-snippet');
    const before = await snip.getAttribute('data-zoom');
    await page.locator('.sat-zoom-btn').last().click();
    await expect(page.locator('.satellite-snippet'))
      .toHaveAttribute('data-zoom', String(Number(before) + 1));
  });

  test('zooming does not consume the tap that opens the full view', async ({ page }) => {
    await openInspector(page);
    // The zoom buttons stopPropagation, and the replaced snippet is re-wired, so a
    // tap on the thumbnail after zooming still opens the expanded satellite map.
    await page.locator('.sat-zoom-btn').last().click();
    await expect(page.locator('.modal-back .satellite-preview-modal')).toHaveCount(0);
    await page.locator('.satellite-snippet').click();
    await expect(page.locator('.satellite-preview-modal')).toBeVisible();
  });

  test('the thumbnail keeps its zoom buttons at the ends of the range', async ({ page }) => {
    await openInspector(page);
    const zOut = page.locator('.sat-zoom-btn').first();
    for (let i = 0; i < 20 && await zOut.isEnabled(); i++) await zOut.click();
    await expect(zOut).toBeVisible();
    await expect(zOut).toBeDisabled();
    await expect(page.locator('.sat-zoom-btn').last()).toBeEnabled();
  });
});
