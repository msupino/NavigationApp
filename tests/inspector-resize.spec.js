// @ts-check
// 280px is right for a waypoint and cramped for a big airfield — charts, comms, two weather
// reports. The panel can be resized from its corner, the size is remembered per device, and
// featureInspectorResize can remove the grip entirely.
const { test, expect } = require('./_setup');

const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1280, height: 900 };

async function openAirfield(page) {
  await page.waitForFunction(() => typeof showInspector === 'function' && typeof state !== 'undefined');
  await page.evaluate(async () => {
    if (airfields === null) await loadAirfields();
    state.selected = { type: 'airfield', index: airfields.findIndex(a => a.name === 'LLBG') };
    showInspector();
  });
  await expect(page.locator('#inspector')).toBeVisible();
}

async function boot(page, size = DESKTOP) {
  await page.setViewportSize(size);
  await page.goto('?lang=en');
  await page.waitForFunction(() => !document.getElementById('boot-loading'));
  await openAirfield(page);
}

const gripVisible = page => page.locator('.insp-grip').isVisible();

async function moveInspector(page, x, y) {
  const header = await page.locator('#insp-header').boundingBox();
  await page.mouse.move(header.x + 10, header.y + 10);
  await page.mouse.down();
  await page.mouse.move(x + 10, y + 10, { steps: 8 });
  await page.mouse.up();
}

async function expectInspectorInsideViewport(page) {
  const viewport = page.viewportSize();
  for (const selector of ['#inspector', '.insp-grip']) {
    await expect.poll(async () => {
      const box = await page.locator(selector).boundingBox();
      return box && box.x >= 0 && box.y >= 0 &&
        box.x + box.width <= viewport.width && box.y + box.height <= viewport.height;
    }).toBe(true);
    const box = await page.locator(selector).boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
  }
}

// Drag the grip by (dx, dy) with real pointer events.
async function dragGrip(page, dx, dy) {
  const g = await page.locator('.insp-grip').boundingBox();
  await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2);
  await page.mouse.down();
  await page.mouse.move(g.x + g.width / 2 + dx, g.y + g.height / 2 + dy, { steps: 8 });
  await page.mouse.up();
}

test('the panel offers a resize grip on the desktop layout', async ({ page }) => {
  await boot(page);
  expect(await gripVisible(page)).toBe(true);
});

test('the phone bottom sheet has no grip — there is no free dimension to drag', async ({ page }) => {
  await boot(page, PHONE);
  // Full-width sheet with a capped height: a grip would sit over the content and move
  // nothing. Same rule the header drag already follows.
  expect(await gripVisible(page)).toBe(false);
});

test('dragging the grip widens the panel and the corner follows the cursor', async ({ page }) => {
  await boot(page);
  await moveInspector(page, 350, 96);
  const before = await page.locator('#inspector').boundingBox();
  // Widen and shorten: a big airfield panel already sits at the max-height cap that keeps it
  // on screen, so upward growth is correctly refused and only shrinking proves the axis.
  await dragGrip(page, 120, -100);
  const after = await page.locator('#inspector').boundingBox();
  expect(Math.round(after.width - before.width)).toBeGreaterThan(100);
  expect(Math.round(before.height - after.height)).toBeGreaterThan(70);
  // The gripped edges are the ones that moved: left and top stayed put, so the corner
  // tracked the cursor instead of the opposite side sliding away from it.
  expect(Math.round(after.x)).toBe(Math.round(before.x));
  expect(Math.round(after.y)).toBe(Math.round(before.y));
});

test('the grip tracks the cursor in Hebrew too', async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await page.goto('?lang=he');
  await page.waitForFunction(() => !document.getElementById('boot-loading'));
  await openAirfield(page);
  expect(await page.locator('#inspector').evaluate(e => getComputedStyle(e).direction)).toBe('rtl');
  const before = await page.locator('#inspector').boundingBox();
  await dragGrip(page, 100, 60);
  const after = await page.locator('#inspector').boundingBox();
  // The CSS resizer would have been at the bottom-LEFT here, on the pinned edge. The
  // explicit grip is physically bottom-right in both directions.
  expect(Math.round(after.width - before.width)).toBeGreaterThan(80);
  expect(Math.round(after.x)).toBe(Math.round(before.x));
});

test('the grip cannot shrink the panel to nothing', async ({ page }) => {
  await boot(page);
  await dragGrip(page, -900, -900);
  const box = await page.locator('#inspector').boundingBox();
  expect(box.width).toBeGreaterThanOrEqual(220);
  expect(box.height).toBeGreaterThanOrEqual(120);
});

test('the size is remembered and restored on this device', async ({ page }) => {
  await boot(page);
  await moveInspector(page, 350, 96);
  const before = await page.locator('#inspector').boundingBox();
  await dragGrip(page, 140, 0);
  const want = Math.round((await page.locator('#inspector').boundingBox()).width);
  expect(want).toBeGreaterThan(Math.round(before.width));
  expect(await page.evaluate(() => localStorage.getItem('navaid.inspSize'))).toContain('"w"');

  await page.goto('?lang=en');
  await page.waitForFunction(() => !document.getElementById('boot-loading'));
  await openAirfield(page);
  const box = await page.locator('#inspector').boundingBox();
  expect(Math.round(box.width)).toBe(want);
});

test('a desktop size does not follow the panel into the phone layout', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => localStorage.setItem('navaid.inspSize', JSON.stringify({ w: 420, h: 500 })));
  await page.setViewportSize(PHONE);
  await page.goto('?lang=en');
  await page.waitForFunction(() => !document.getElementById('boot-loading'));
  await openAirfield(page);
  // The phone sheet is full-width by design; a stored desktop width would strand it mid-screen.
  const box = await page.locator('#inspector').boundingBox();
  expect(box.width).toBeGreaterThan(PHONE.width - 40);
  expect(await page.locator('#inspector').evaluate(e => e.style.width)).toBe('');
});

test('the gist can remove the grip', async ({ page }) => {
  await boot(page);
  expect(await gripVisible(page)).toBe(true);
  await page.evaluate(() => { setTune('featureInspectorResize', false); applyInspSize(); });
  // Only a gist switch may remove a control outright — this is that switch, not a platform
  // or data condition hiding one.
  expect(await gripVisible(page)).toBe(false);
});

test('a blocked localStorage does not stop the panel opening', async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await page.addInitScript(() => {
    const boom = () => { throw new Error('The operation is insecure.'); };
    Object.defineProperty(window, 'localStorage', { get: boom, configurable: true });
  });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e.message)));
  await page.goto('?lang=en');
  await page.waitForFunction(() => typeof showInspector === 'function');
  await openAirfield(page);
  expect(errors.filter(m => /insecure|SecurityError/i.test(m))).toEqual([]);
});

test('a panel resized on desktop stays reachable after a rotation to a narrow screen', async ({ page }) => {
  await boot(page);
  await dragGrip(page, 150, -80);
  const desk = await page.locator('#inspector').boundingBox();
  expect(desk.x).toBeGreaterThan(400);            // pinned well to the right of a phone screen

  // Rotate / switch to the phone layout without a reload: the media query flips, but inline
  // styles the grip wrote would still beat the sheet's own left/right/bottom.
  await page.setViewportSize(PHONE);
  await page.waitForFunction(() => !document.getElementById('inspector').style.left);
  const box = await page.locator('#inspector').boundingBox();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(PHONE.width);
  expect(box.width).toBeGreaterThan(PHONE.width - 40);   // full-width sheet again
  for (const prop of ['left', 'top', 'right', 'width', 'height']) {
    expect(await page.locator('#inspector').evaluate((e, p) => e.style[p], prop)).toBe('');
  }
});

test('a panel larger than the window is pulled back inside it', async ({ page }) => {
  await boot(page);
  // State a panel can genuinely be left in: sized and pinned in a big window, which is then
  // made smaller. Set directly rather than dragged, so the case is exercised exactly.
  await page.evaluate(() => {
    const e = document.getElementById('inspector');
    e.style.left = '1100px'; e.style.top = '700px'; e.style.right = 'auto';
    e.style.width = '600px'; e.style.height = '600px';
  });
  await page.setViewportSize({ width: 760, height: 700 });
  await page.evaluate(() => applyInspSize());
  const box = await page.locator('#inspector').boundingBox();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(760);
  await expectInspectorInsideViewport(page);
});

for (const lang of ['en', 'he']) {
  test(`resizing at the screen edges keeps the full inspector reachable (${lang})`, async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto(`?lang=${lang}`);
    await openAirfield(page);
    await moveInspector(page, 850, 100);
    await dragGrip(page, 900, 900);
    await expectInspectorInsideViewport(page);
    await dragGrip(page, -60, -60);
    await expectInspectorInsideViewport(page);
  });
}

test('restoring a low saved position keeps the body and grip above the bottom edge', async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await page.addInitScript(() => {
    localStorage.setItem('navaid.inspPos.en', JSON.stringify({ x: 850, y: 740 }));
    localStorage.setItem('navaid.inspSize', JSON.stringify({ w: 400, h: 500 }));
  });
  await page.goto('?lang=en');
  await openAirfield(page);
  await expectInspectorInsideViewport(page);
});

test('late inspector content growth keeps its bottom controls reachable', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => {
    const body = document.getElementById('insp-body');
    body.replaceChildren(document.createTextNode('Short report'));
  });
  await moveInspector(page, 350, 650);
  await page.evaluate(() => {
    const report = document.createElement('div');
    report.style.height = '500px';
    report.textContent = 'Loaded report';
    document.getElementById('insp-body').appendChild(report);
  });
  await expectInspectorInsideViewport(page);
});
