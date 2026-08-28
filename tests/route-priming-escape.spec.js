// @ts-check
// A fresh session primes the map: the route is empty, the hint is up, and a plain click drops
// the first waypoint. Reported: "it enters edit mode, ESC doesn't exit from it, button is not
// marked in edit mode under edit" — the map behaved like a mode nobody had entered, so there
// was nothing lit to explain the crosshair and nothing to press to leave.
const { test, expect } = require('./_setup');

async function fresh(page) {
  await page.addInitScript(() => {
    try { localStorage.removeItem('navaid.emptyHintSeen'); } catch (e) { /* */ }
  });
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof routePrimingArmed === 'function'
    && !!document.getElementById('empty-route-hint'));
}

const primed = (page) => page.evaluate(() => ({
  armed: routePrimingArmed(),
  hint: !!document.getElementById('empty-route-hint'),
  cursor: document.getElementById('map').classList.contains('priming'),
  addActive: document.getElementById('tool-add').classList.contains('active'),
  pressed: document.getElementById('tool-add').getAttribute('aria-pressed'),
  mode: state.mode,
}));

test('a primed map lights the Add button, so the crosshair has an explanation', async ({ page }) => {
  await fresh(page);
  const s = await primed(page);
  expect(s.armed).toBe(true);
  expect(s.cursor).toBe(true);
  expect(s.addActive).toBe(true);
  expect(s.pressed).toBe('true');
});

test('Escape leaves it, like it leaves any other mode', async ({ page }) => {
  await fresh(page);
  await page.keyboard.press('Escape');
  const s = await primed(page);
  expect(s.hint).toBe(false);
  expect(s.armed).toBe(false);
  expect(s.cursor).toBe(false);
  expect(s.addActive).toBe(false);
  expect(s.pressed).toBe('false');
});

test('after Escape a map click adds nothing', async ({ page }) => {
  await fresh(page);
  await page.keyboard.press('Escape');
  const before = await page.evaluate(() => state.waypoints.length);
  await page.evaluate(() => {
    const p = L.point(240, 260);
    map.fire('click', { containerPoint: p, latlng: map.containerPointToLatLng(p) });
  });
  expect(await page.evaluate(() => state.waypoints.length)).toBe(before);
});

test('opening a desktop menu section cancels route onboarding', async ({ page }) => {
  await fresh(page);
  await page.locator('.tb-section[data-sec="build"] .tb-section-head').click();
  const s = await primed(page);
  expect(s.hint).toBe(false);
  expect(s.armed).toBe(false);
  expect(s.cursor).toBe(false);
});

test('opening a desktop menu section from the keyboard cancels route onboarding', async ({ page }) => {
  await fresh(page);
  const head = page.locator('.tb-section[data-sec="build"] .tb-section-head');
  await head.focus();
  await page.keyboard.press('ArrowDown');
  const s = await primed(page);
  expect(s.hint).toBe(false);
  expect(s.armed).toBe(false);
  expect(s.cursor).toBe(false);
});

test.describe('mobile menu', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test('expanding the main menu cancels route onboarding', async ({ page }) => {
    await fresh(page);
    await page.locator('#toolbar-toggle').click();
    const s = await primed(page);
    expect(s.hint).toBe(false);
    expect(s.armed).toBe(false);
    expect(s.cursor).toBe(false);
  });
});

// The other half: while it IS primed, the click still starts the route — that is the whole
// point of the intro, and Escape must not be the only way to find out what a click does.
test('while primed, a click still drops the first waypoint and enters add mode', async ({ page }) => {
  await fresh(page);
  await page.evaluate(() => {
    const p = L.point(240, 260);
    map.fire('click', { containerPoint: p, latlng: map.containerPointToLatLng(p) });
  });
  const out = await page.evaluate(() => ({
    n: state.waypoints.length, mode: state.mode,
    addActive: document.getElementById('tool-add').classList.contains('active'),
  }));
  expect(out.n).toBe(1);
  expect(out.mode).toBe('add');       // and now it is a real mode, with the button lit
  expect(out.addActive).toBe(true);
});
