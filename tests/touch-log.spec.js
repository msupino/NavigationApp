// @ts-check
// A diagnostic, not a feature: four fixes into "holding a waypoint opens the inspector" it
// was clear that guessing at what a phone sends is the wrong way round. ?touchlog=1 prints
// the actual sequence on screen, on the device where it goes wrong.
const { test, expect } = require('./_setup');

const touch = (page, type, x, y) => page.evaluate(([t, px, py]) => {
  const el = map.getContainer();
  const init = { clientX: px, clientY: py, pageX: px, pageY: py, identifier: 1, target: el };
  const list = t === 'touchend' ? [] : [new Touch(init)];
  el.dispatchEvent(new TouchEvent(t, { bubbles: true, cancelable: true,
    touches: list, targetTouches: list, changedTouches: [new Touch(init)] }));
}, [type, x, y]);

async function boot(page, query) {
  await page.goto('?lang=en&nogist' + (query || ''));
  await page.waitForFunction(() => typeof draw === 'function');
  return page.evaluate(() => {
    state.waypoints = [{ lat: 32.1, lng: 34.8, name: 'A' }, { lat: 32.4, lng: 35.0, name: 'B' }];
    syncLegs(); map.setView([32.25, 34.9], 10); draw();
    const p = map.latLngToContainerPoint([32.1, 34.8]);
    const b = map.getContainer().getBoundingClientRect();
    return { x: Math.round(b.left + p.x), y: Math.round(b.top + p.y) };
  });
}

test('off by default — nothing is drawn and nothing is recorded', async ({ page }) => {
  const at = await boot(page);
  await touch(page, 'touchstart', at.x, at.y);
  await touch(page, 'touchend', at.x, at.y);
  expect(await page.locator('#touch-log').count()).toBe(0);
});

test('?touchlog=1 shows the sequence and what it was decided to be', async ({ page }) => {
  const at = await boot(page, '&touchlog=1');
  await touch(page, 'touchstart', at.x, at.y);
  await touch(page, 'touchend', at.x, at.y);
  const text = await page.locator('#touch-log').textContent();
  expect(text).toContain('touchstart');
  expect(text).toContain('grabbed');
  expect(text).toContain('kind=wp');
  expect(text).toContain('touchend');
  expect(text).toContain('tap=true');
  expect(text).toMatch(/held=\d+ms/);
});

test('a held press is recorded as a grab, with the duration that decided it', async ({ page }) => {
  const at = await boot(page, '&touchlog=1');
  await touch(page, 'touchstart', at.x, at.y);
  await page.waitForTimeout(420);
  await touch(page, 'touchend', at.x, at.y);
  const text = await page.locator('#touch-log').textContent();
  expect(text).toContain('tap=false');
  expect(text).toContain('held=true');
  expect(text).toContain('panel=shut');
});

// It must never eat the touches it exists to record.
test('the panel does not take input', async ({ page }) => {
  await boot(page, '&touchlog=1');
  await touch(page, 'touchstart', 300, 300);
  await touch(page, 'touchend', 300, 300);
  expect(await page.locator('#touch-log').evaluate(el => getComputedStyle(el).pointerEvents)).toBe('none');
});
