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

test('the printed flight-plan card follows the selected route direction', async ({ page }) => {
  await boot(page);
  const labels = await page.evaluate(() => {
    state.waypoints = [
      { lat: 32.00, lng: 34.0, name: 'ALPHA' },
      { lat: 32.05, lng: 34.0, name: 'BRAVO' },
      { lat: 32.00, lng: 34.0, name: 'ALPHA' },
    ];
    state.legs = [];
    syncLegs();
    state.legs.forEach(l => { l.flightSpeed = 100; });
    const render = filter => {
      window.legDirFilter = filter;
      const ctx = document.createElement('canvas').getContext('2d');
      const seen = [];
      const fillText = ctx.fillText.bind(ctx);
      ctx.fillText = text => { seen.push(String(text)); fillText(text, 0, 0); };
      drawFlightPlanTable(ctx, 0, 0, 1000, 120, 'tl');
      return seen;
    };
    const outbound = render('out');
    const back = render('back');
    window.legDirFilter = 'both';
    return { outbound, back };
  });
  expect(labels.outbound).toContain('BRAVO');
  expect(labels.outbound).not.toContain('ALPHA');
  expect(labels.back).toContain('ALPHA');
  expect(labels.back).not.toContain('BRAVO');
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

test('plan checkbox updates live when the route is added while the panel is open', async ({ page }) => {
  await boot(page);
  // Open with no route → disabled.
  await page.evaluate(() => showExportModal());
  await expect(page.locator('#export-plan-cb')).toBeDisabled();
  // Add a route WITHOUT reopening the panel → it enables live.
  await route(page);
  await page.evaluate(() => draw());
  await expect(page.locator('#export-plan-cb')).toBeEnabled();
  // Clear the route → disables again.
  await page.evaluate(() => { state.waypoints = []; state.legs = []; syncLegs(); draw(); });
  await expect(page.locator('#export-plan-cb')).toBeDisabled();
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

test('a card added while the paper frame is larger than the viewport is visible', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 700 });
  await boot(page);
  await route(page);
  await page.evaluate(() => {
    setPage('A4');
    map.zoomIn(3, { animate: false });
    draw();
    showExportModal();
  });
  await page.locator('#export-plan-cb').check();
  const placed = await page.evaluate(() => {
    draw();
    const fr = pageFrameRect(), r = planCardRect;
    const mapBox = map.getContainer().getBoundingClientRect();
    const toolbarBox = document.getElementById('toolbar').getBoundingClientRect();
    return { fr, r, toolbarBottom: toolbarBox.bottom - mapBox.top,
      viewport: { w: map.getSize().x, h: map.getSize().y } };
  });
  expect(placed.fr.x).toBeLessThan(0); // proves the page top-left is off-screen
  expect(placed.r.x + placed.r.w).toBeGreaterThan(0);
  expect(placed.r.y + placed.r.h).toBeGreaterThan(0);
  expect(placed.r.x).toBeLessThan(placed.viewport.w);
  expect(placed.r.y).toBeLessThan(placed.viewport.h);
  expect(placed.r.y).toBeGreaterThan(placed.toolbarBottom);
});

test('Fit fits the selected paper frame instead of the route', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 700 });
  await boot(page);
  const fitted = await page.evaluate(() => {
    state.waypoints = [
      { lat: 32.1800, lng: 34.8300, name: 'A' },
      { lat: 32.1805, lng: 34.8305, name: 'B' },
    ];
    state.legs = [];
    syncLegs();
    setPage('A4');
    map.zoomIn(3, { animate: false });
    document.getElementById('fit').click();
    const fr = pageFrameRect();
    return { fr, viewport: { w: map.getSize().x, h: map.getSize().y } };
  });
  expect(fitted.fr.x).toBeGreaterThanOrEqual(-1);
  expect(fitted.fr.y).toBeGreaterThanOrEqual(-1);
  expect(fitted.fr.x + fitted.fr.w).toBeLessThanOrEqual(fitted.viewport.w + 1);
  expect(fitted.fr.y + fitted.fr.h).toBeLessThanOrEqual(fitted.viewport.h + 1);
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

test('mobile: the backdrop opens up so the placed card can be dragged', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await boot(page);
  await route(page);
  await page.evaluate(() => { setPage('A4'); draw(); showExportModal(); });
  // Centered/dimmed modal while nothing is placed — the backdrop still blocks.
  await expect(page.locator('.modal-back.export-place')).toHaveCount(0);
  await page.locator('#export-plan-cb').check();
  // With a card placed the backdrop MUST become click-through, or cardDown never
  // sees a mousedown and the card is stuck with its resize grip unreachable.
  await expect(page.locator('.modal-back.export-place')).toHaveCount(1);
  await page.locator('#export-plan-cb').uncheck();
  await expect(page.locator('.modal-back.export-place')).toHaveCount(0);
});

test('with no page frame the card is bounded by the viewport, not unclamped', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 700 });
  await boot(page);
  await route(page);
  // No setPage() → pageFrameRect() is null; the exporter captures the viewport.
  await page.evaluate(() => { draw(); showExportModal(); });
  await page.locator('#export-plan-cb').check();
  const r = await page.evaluate(() => {
    draw();
    const size = map.getSize();
    // Try to shove it far off-screen; the clamp must keep it inside the viewport.
    planCard.x = 5000; planCard.y = 5000;
    const mb = map.getContainer().getBoundingClientRect();
    return { frame: pageFrameRect(), size: { x: size.x, y: size.y }, rect: planCardRect, mb: { x: mb.left, y: mb.top } };
  });
  expect(r.frame).toBeNull();                     // genuinely no page frame
  // Drag it: the move clamp is what keeps it on the page. Dispatch straight at the
  // map container (cardDown is a capture listener there) instead of driving the
  // real mouse — page furniture such as the footer buttons sits over the computed
  // coordinate, so a synthetic pointer never reached the map and this assertion
  // passed even with the clamp reverted.
  const after = await page.evaluate(() => {
    planCard.x = 40; planCard.y = 40; draw();
    const mapEl = map.getContainer();
    const mb = mapEl.getBoundingClientRect();
    const at = (type, cx, cy, target) => target.dispatchEvent(
      new MouseEvent(type, { clientX: cx, clientY: cy, bubbles: true, cancelable: true }));
    const x0 = mb.left + planCardRect.x + 15, y0 = mb.top + planCardRect.y + 8;
    at('mousedown', x0, y0, mapEl);
    at('mousemove', x0 + 4000, y0 + 4000, window);
    at('mouseup', x0 + 4000, y0 + 4000, window);
    const s = map.getSize();
    return { card: { x: planCard.x, y: planCard.y }, rect: planCardRect, size: { x: s.x, y: s.y } };
  });
  // Prove the drag was actually delivered (guards against a silent no-op again).
  expect(after.card.x).toBeGreaterThan(40);
  expect(after.card.x + after.rect.w).toBeLessThanOrEqual(after.size.x + 1);
  expect(after.card.y + after.rect.h).toBeLessThanOrEqual(after.size.y + 1);
});

test('cancel keeps a toolbar change made while the panel was open', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 1000 });
  await boot(page);
  await route(page);
  // Start ON, so the open-time snapshot the panel would replay is "on".
  await page.evaluate(() => {
    const cb = document.getElementById('cumtime-cb');
    cb.checked = true; window.showCumTime = true; draw();
    showExportModal();
  });
  expect(await page.evaluate(() => showCumTime)).toBe(true);
  // Now turn it OFF from the TOOLBAR while the click-through panel is open — a
  // value that no longer matches what the panel put there.
  await page.evaluate(() => {
    const cb = document.getElementById('cumtime-cb');
    cb.checked = false;
    cb.dispatchEvent(new Event('change'));
  });
  expect(await page.evaluate(() => showCumTime)).toBe(false);
  await page.evaluate(() => { document.querySelector('.modal-cancel').click(); });
  // Cancel must NOT replay its open-time snapshot over the user's toolbar change.
  expect(await page.evaluate(() => showCumTime)).toBe(false);
  expect(await page.evaluate(() => document.getElementById('cumtime-cb').checked)).toBe(false);
});

test('a closed panel leaves no Escape handler behind', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 1000 });
  await boot(page);
  await route(page);
  // Open and close the panel a few times, then change an overlay from the toolbar.
  for (let i = 0; i < 3; i++) {
    await page.evaluate(() => showExportModal());
    await page.evaluate(() => { document.querySelector('.modal-cancel').click(); });
  }
  // A leaked handler would run restoreOrig(), whose most observable effect is
  // nulling planCard. Plant one with no panel open: it must survive Escape. The
  // old assertion used showNavWP at its compiled-in default, so every leaked
  // handler's captured value matched and firing them was a coincidental no-op.
  await page.evaluate(() => { window.planCard = { x: 10, y: 10, scale: 1 }; });
  await page.keyboard.press('Escape');            // no panel open — must be inert
  expect(await page.evaluate(() => planCard)).not.toBeNull();
  await page.evaluate(() => { window.planCard = null; });
});
