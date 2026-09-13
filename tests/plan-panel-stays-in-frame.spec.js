// @ts-check
// Reported from the APK, twice, with two screenshots four seconds apart: the flight plan
// opens with its last rows under the deck, and it is not in the same place the second time.
//
// Both are one bug. The panel's remembered position is written to `left`/`top`, which the
// browser resolves against the element's OFFSET PARENT -- and under the phone deck that is
// the flight plan's backdrop, inset below the strip and above the deck, not the window.
// makeModalDraggable measured and stored viewport coordinates, so every open pushed the
// panel down by the strip's height, and closing stored the pushed-down position for the
// next open. On top of that it clamped once, before the profile strip and the leg table
// existed, so a panel that fitted when it was placed no longer fitted when it was filled.
const { test, expect } = require('./_setup');

const PHONE = { width: 390, height: 844 };

async function boot(page) {
  await page.setViewportSize(PHONE);
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof draw === 'function' && window.NavAid
    && typeof NavAid.refreshMobileDeck === 'function' && typeof showFlightPlan === 'function');
  await page.evaluate(() => {
    const b = document.getElementById('boot-loading');
    if (b) b.remove();
    document.documentElement.classList.remove('app-booting');
    state.waypoints = [{ lat: 32.18, lng: 34.83, name: 'HRTZ' },
      { lat: 32.5, lng: 35.0, name: 'MID' },
      { lat: 32.81, lng: 35.04, name: 'LLHA' }];
    syncLegs();
    draw();
  });
}

// Where the panel sits, and where it is allowed to sit: the backdrop is the chart's own
// space under the deck, so "inside the frame" is what a pilot can actually see.
const geometry = (page) => page.evaluate(() => {
  const back = document.querySelector('.modal-back.flight-plan');
  const box = back && back.querySelector('.modal');
  if (!box) return null;
  const b = back.getBoundingClientRect(), m = box.getBoundingClientRect();
  return {
    frame: { top: b.top, bottom: b.bottom, height: b.height },
    box: { top: m.top, bottom: m.bottom, height: m.height },
    left: box.style.left, topStyle: box.style.top,
  };
});

const openPlan = async (page) => {
  await page.evaluate(() => showFlightPlan());
  await expect(page.locator('.modal-back.flight-plan .modal')).toBeVisible();
  // Let the profile strip paint and the size watcher settle.
  await page.waitForTimeout(250);
};
const closePlan = (page) => page.evaluate(() => closeFlightPlan());

test('the plan opens inside the chart space, not under the deck', async ({ page }) => {
  await boot(page);
  await openPlan(page);
  const g = await geometry(page);
  expect(g).not.toBeNull();
  expect(g.box.top).toBeGreaterThanOrEqual(g.frame.top - 1);
  expect(g.box.bottom).toBeLessThanOrEqual(g.frame.bottom + 1);
});

test('a remembered position is honoured in the frame it was stored in', async ({ page }) => {
  await boot(page);
  // Stored from a drag: 40 px down from the top of the chart space.
  await page.evaluate(() => {
    const key = typeof navLangPosKey === 'function' ? navLangPosKey('navaid.fpPos') : 'navaid.fpPos';
    localStorage.setItem(key, JSON.stringify({ x: 8, y: 40 }));
  });
  await openPlan(page);
  const g = await geometry(page);
  // 40 in the backdrop's coordinates, not 40 in the window's -- the difference is the strip.
  expect(Math.abs(g.box.top - (g.frame.top + 40))).toBeLessThan(2);
});

test('a panel comes back where it was dragged, not a strip lower', async ({ page }) => {
  await boot(page);
  await openPlan(page);
  const title = page.locator('.modal-back.flight-plan .modal-title');
  const b = await title.boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2 + 30, { steps: 4 });
  await page.mouse.up();
  await page.waitForTimeout(50);
  const dragged = (await geometry(page)).box.top;
  await closePlan(page);
  await openPlan(page);
  const reopened = (await geometry(page)).box.top;
  // The stored position was written in viewport coordinates and read back as frame
  // coordinates, so the panel reappeared one strip-height below where it was left.
  expect(Math.abs(reopened - dragged)).toBeLessThan(2);
});

test('a panel placed before it is filled is re-clamped once it has grown', async ({ page }) => {
  await boot(page);
  await openPlan(page);
  const grew = await page.evaluate(async () => {
    const back = document.querySelector('.modal-back.flight-plan');
    const box = back.querySelector('.modal');
    const frame = back.getBoundingClientRect();
    // Park it near the bottom of the chart space, then make it taller than what is left.
    box.style.top = Math.round(frame.height - 80) + 'px';
    const filler = document.createElement('div');
    filler.style.height = '400px';
    box.appendChild(filler);
    await new Promise(r => setTimeout(r, 200));
    const m = box.getBoundingClientRect();
    return { top: m.top, bottom: m.bottom, frameTop: frame.top, frameBottom: frame.bottom };
  });
  // Either it was pulled up to fit, or -- taller than the space -- it sits at the top of it
  // and scrolls. What it may not do is hang off the bottom with its buttons under the deck.
  expect(grew.top).toBeGreaterThanOrEqual(grew.frameTop - 1);
  expect(grew.bottom - grew.frameBottom).toBeLessThan(2);
});
