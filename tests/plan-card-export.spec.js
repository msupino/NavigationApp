// #378 — drag-to-place flight-plan card on the PNG export. The same
// drawFlightPlanTable() renders the live preview and the exported PNG, so the
// card is true WYSIWYG. Tests cover the renderer, the modal toggle (gated on a
// page frame), placement + drag, and cleanup.
const { test, expect } = require('./_setup');
const { hideToolbarMenus } = require('./_toolbar');

async function boot(page) {
  await page.goto('?lang=en');
  await page.waitForFunction(() => typeof state !== 'undefined' &&
    typeof showExportModal === 'function' && typeof setPage === 'function' &&
    typeof drawFlightPlanTable === 'function' && typeof draw === 'function');
}

async function route(page) {
  await page.evaluate(() => {
    state.waypoints = [
      { lat: 32.18, lng: 34.83, name: 'LLHZ' },
      { lat: 32.44, lng: 34.90, name: 'HADERA' },
      { lat: 32.70, lng: 35.57, name: 'LLIB' },
    ];
    state.legs = []; syncLegs();
    state.legs.forEach((l, i) => { l.flightSpeed = 110; l.inboundAltitude = 2500 + i * 1000; });
    fitView();
  });
}

test('drawFlightPlanTable renders a sized table; none without a route', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(() => {
    const c = document.createElement('canvas').getContext('2d');
    const empty = drawFlightPlanTable(c, 0, 0, 400, 200, 'tl');   // no legs
    state.waypoints = [{ lat: 32, lng: 34.8, name: 'A' }, { lat: 32.4, lng: 35, name: 'B' }];
    state.legs = []; syncLegs(); state.legs[0].flightSpeed = 100;
    const rect = drawFlightPlanTable(c, 10, 20, 99999, 64, 'tl');
    return { empty, rect };
  });
  expect(r.empty).toBeNull();
  expect(r.rect.w).toBeGreaterThan(50);
  expect(r.rect.h).toBeGreaterThan(20);
  expect(r.rect.x).toBe(10);
});

test('export modal: plan checkbox is gated on a route, not a page frame', async ({ page }) => {
  await boot(page);
  // No route → checkbox disabled.
  await page.evaluate(() => showExportModal());
  await expect(page.locator('#export-plan-cb')).toBeDisabled();
  await page.evaluate(() => { document.querySelector('.modal-cancel').click(); });
  // With a route but NO page frame → still enabled (a page is not required).
  await route(page);
  await page.evaluate(() => showExportModal());
  await expect(page.locator('#export-plan-cb')).toBeEnabled();
});

test('checking the box places a card; it clears on cancel', async ({ page }) => {
  await boot(page);
  await route(page);
  await page.evaluate(() => { setPage('A4'); draw(); showExportModal(); });
  await page.locator('#export-plan-cb').check();
  // planCard set, inside the frame, and drawn (rect captured).
  const inside = await page.evaluate(() => {
    draw();
    const fr = pageFrameRect(), r = planCardRect;
    return !!planCard && !!r && r.x >= fr.x && r.y >= fr.y;
  });
  expect(inside).toBe(true);
  // Backdrop opens up for dragging on the live map.
  await expect(page.locator('.modal-back.export-place')).toHaveCount(1);
  // Cancel clears the placement.
  await page.evaluate(() => { document.querySelector('.modal-cancel').click(); });
  expect(await page.evaluate(() => planCard)).toBeNull();
});

test('dragging the card on the map moves it within the frame', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 1000 });
  await boot(page);
  await route(page);
  await page.evaluate(() => { setPage('A4'); draw(); showExportModal(); });
  await page.locator('#export-plan-cb').check();
  await page.evaluate(() => draw());
  await hideToolbarMenus(page);
  const start = await page.evaluate(() => {
    const mapBox = map.getContainer().getBoundingClientRect();
    return { ...planCard, rect: planCardRect, fr: pageFrameRect(), mapBox: { x: mapBox.left, y: mapBox.top } };
  });
  // Drag the card down (the A4 frame is tall — vertical room to move).
  await page.mouse.move(start.mapBox.x + start.rect.x + 15, start.mapBox.y + start.rect.y + 8);
  await page.mouse.down();
  await page.mouse.move(start.mapBox.x + start.rect.x + 15, start.mapBox.y + start.rect.y + 8 + 150, { steps: 8 });
  await page.mouse.up();
  const moved = await page.evaluate(() => ({ ...planCard, fr: pageFrameRect(), rect: planCardRect }));
  expect(moved.y).toBeGreaterThan(start.y + 60);   // moved down
  // Still clamped inside the frame (both axes).
  expect(moved.x).toBeGreaterThanOrEqual(moved.fr.x - 1);
  expect(moved.y).toBeGreaterThanOrEqual(moved.fr.y - 1);
  expect(moved.y + moved.rect.h).toBeLessThanOrEqual(moved.fr.y + moved.fr.h + 1);
});

test('the corner grip resizes the card', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 1000 });
  await boot(page);
  await route(page);
  await page.evaluate(() => { setPage('A4'); draw(); showExportModal(); });
  await page.locator('#export-plan-cb').check();
  await page.evaluate(() => draw());
  await hideToolbarMenus(page);
  const start = await page.evaluate(() => {
    const mapBox = map.getContainer().getBoundingClientRect();
    return { scale: planCard.scale, rect: planCardRect, mapBox: { x: mapBox.left, y: mapBox.top } };
  });
  // Drag the bottom-right grip outward → larger scale.
  await page.mouse.move(start.mapBox.x + start.rect.x + start.rect.w - 6,
    start.mapBox.y + start.rect.y + start.rect.h - 6);
  await page.mouse.down();
  await page.mouse.move(start.mapBox.x + start.rect.x + start.rect.w + 200,
    start.mapBox.y + start.rect.y + start.rect.h + 120, { steps: 8 });
  await page.mouse.up();
  const after = await page.evaluate(() => ({ scale: planCard.scale, rect: planCardRect }));
  expect(after.scale).toBeGreaterThan(start.scale + 0.1);
  expect(after.rect.w).toBeGreaterThan(start.rect.w);
});

test('resizing is clamped to the page frame (no overflow)', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 1000 });
  await boot(page);
  await route(page);
  await page.evaluate(() => { setPage('A4'); draw(); showExportModal(); });
  await page.locator('#export-plan-cb').check();
  await page.evaluate(() => draw());
  await hideToolbarMenus(page);
  const start = await page.evaluate(() => {
    const mb = map.getContainer().getBoundingClientRect();
    return { rect: planCardRect, mapBox: { x: mb.left, y: mb.top } };
  });
  // Drag the grip far past the page edge.
  await page.mouse.move(start.mapBox.x + start.rect.x + start.rect.w - 6,
    start.mapBox.y + start.rect.y + start.rect.h - 6);
  await page.mouse.down();
  await page.mouse.move(start.mapBox.x + start.rect.x + start.rect.w + 2000,
    start.mapBox.y + start.rect.y + start.rect.h + 2000, { steps: 10 });
  await page.mouse.up();
  const res = await page.evaluate(() => {
    const fr = pageFrameRect(), r = planCardRect;
    return { ok: !!(fr && r), withinW: r.x + r.w <= fr.x + fr.w + 1, withinH: r.y + r.h <= fr.y + fr.h + 1 };
  });
  expect(res.ok).toBe(true);
  expect(res.withinW).toBe(true);
  expect(res.withinH).toBe(true);
});

test('export VOR selector shows only when the flight-plan card is added', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 1000 });
  await boot(page);
  await route(page);
  await page.evaluate(() => { setPage('A4'); draw(); showExportModal(); });
  // Hidden until the plan-card checkbox is on.
  await expect(page.locator('#export-vor-select')).toBeHidden();
  await page.locator('#export-plan-cb').check();
  await expect(page.locator('#export-vor-select')).toBeVisible();
  await page.locator('#export-plan-cb').uncheck();
  await expect(page.locator('#export-vor-select')).toBeHidden();
});
