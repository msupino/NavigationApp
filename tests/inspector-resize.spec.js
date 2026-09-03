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

const resizeCss = page => page.locator('#inspector').evaluate(e => getComputedStyle(e).resize);

test('the panel offers a resize grip on the desktop layout', async ({ page }) => {
  await boot(page);
  expect(await resizeCss(page)).toBe('both');
});

test('the phone bottom sheet has no grip — there is no free dimension to drag', async ({ page }) => {
  await boot(page, PHONE);
  // Full-width sheet with a capped height: a grip would sit over the content and move
  // nothing. Same rule the header drag already follows.
  expect(await resizeCss(page)).toBe('none');
});

test('the size is remembered and restored on this device', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => {
    const el = document.getElementById('inspector');
    el.style.width = '420px';
    el.style.height = '500px';
  });
  // The observer debounces; wait for the write rather than racing it.
  await expect.poll(() => page.evaluate(() => localStorage.getItem('navaid.inspSize')), { timeout: 5000 })
    .toContain('420');

  await page.goto('?lang=en');
  await page.waitForFunction(() => !document.getElementById('boot-loading'));
  await openAirfield(page);
  const box = await page.locator('#inspector').boundingBox();
  expect(Math.round(box.width)).toBe(420);
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
  expect(await resizeCss(page)).toBe('both');
  await page.evaluate(() => { setTune('featureInspectorResize', false); applyInspSize(); });
  // Only a gist switch may remove a control outright — this is that switch, not a platform
  // or data condition hiding one.
  expect(await resizeCss(page)).toBe('none');
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
