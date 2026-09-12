// @ts-check
// Reported: the mobile UI does not look expert; the desktop one is fine.
//
// Measured at 390x844, the chart carried six floating islands -- the menu card, the Zulu
// clock, the look-ahead strip, the coordinate readout, the zoom column and a full-width row
// of 11px attribution links -- each with its own radius (2, 3, 4, 5, 999), its own shadow
// and its own white. On a wide screen that reads as variety. On a phone it reads as six
// widgets from six different apps, and half of them were under the 44px touch minimum.
//
// This is the tightening pass: one chrome language, one touch minimum, and the two panels
// that used to sit over the map at the same time.
const { test, expect } = require('./_setup');

const PHONE = { width: 390, height: 844 };

async function boot(page, size) {
  await page.setViewportSize(size || PHONE);
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof draw === 'function' && typeof showInspector === 'function');
  await page.evaluate(() => {
    const b = document.getElementById('boot-loading');
    if (b) b.remove();
    document.documentElement.classList.remove('app-booting');
  });
}

// Computed style resolves for hidden elements too, which is what makes this checkable
// without driving every control into view first.
const style = (page, sel) => page.evaluate((s) => {
  const el = document.querySelector(s);
  if (!el) return null;
  const cs = getComputedStyle(el);
  return { radius: cs.borderTopLeftRadius, shadow: cs.boxShadow };
}, sel);

test('every floating control speaks one chrome language', async ({ page }) => {
  await boot(page);
  const surfaces = ['.coord-readout', '.zoom-readout', '.leaflet-control-zoom',
    '.orient-ctrl button', '.editlock-ctrl button', '.map-time-now', '.map-time-read'];
  const got = [];
  for (const sel of surfaces) got.push([sel, await style(page, sel)]);
  const radii = new Set(got.map(([, s]) => s && s.radius));
  expect([...radii], 'the corners disagree: ' + JSON.stringify(got)).toHaveLength(1);
  // ...and one shadow. The chips inside the clock card are the exception and are checked
  // below: a card does not cast a shadow onto itself.
  const shadows = new Set(got.filter(([sel]) => sel !== '.map-time-read').map(([, s]) => s.shadow));
  expect([...shadows], 'the shadows disagree: ' + JSON.stringify(got)).toHaveLength(1);
});

test('nothing on the chart is smaller than a thumb', async ({ page }) => {
  await boot(page);
  const small = await page.evaluate(() => {
    const sels = ['#map-time-now', '#toolbar-handle', '#toolbar-toggle', '.attrib-toggle',
      '.leaflet-control-zoom a', '#rotate-hdg'];
    const out = [];
    for (const sel of sels) {
      for (const el of document.querySelectorAll(sel)) {
        if (!el.getClientRects().length) continue;
        const r = el.getBoundingClientRect();
        // 44px in the direction that matters: the attribution fold is a wide, short strip
        // at the very bottom edge, where a 44px-tall button would cover the chart.
        const min = sel === '.attrib-toggle' ? 30 : 44;
        if (r.width < 44 || r.height < min) out.push({ sel, w: Math.round(r.width), h: Math.round(r.height) });
      }
    }
    return out;
  });
  expect(small).toEqual([]);
});

test('the required credits fold behind one button, and still say everything', async ({ page }) => {
  await boot(page);
  const el = page.locator('.leaflet-control-attribution');
  const body = page.locator('.attrib-body');
  const btn = page.locator('.attrib-toggle');
  await expect(btn).toBeVisible();
  await expect(body, 'the credits row was still spread across the bottom').toBeHidden();
  // Hidden, never gone: the notice is a licence condition, and it is one tap away.
  expect(await body.textContent()).toMatch(/OpenStreetMap/);
  expect(await btn.getAttribute('aria-expanded')).toBe('false');
  await btn.click();
  await expect(body).toBeVisible();
  expect(await btn.getAttribute('aria-expanded')).toBe('true');
  await expect(el).toHaveClass(/attrib-open/);
});

test('on a desktop the credits are simply there, as before', async ({ page }) => {
  await boot(page, { width: 1280, height: 900 });
  await expect(page.locator('.attrib-body')).toBeVisible();
  await expect(page.locator('.attrib-toggle')).toBeHidden();
});

test('the look-ahead clock is one card on a phone, not four loose pieces', async ({ page }) => {
  await boot(page);
  const got = await page.evaluate(() => {
    const solid = (el) => getComputedStyle(el).backgroundColor !== 'rgba(0, 0, 0, 0)';
    return {
      card: solid(document.getElementById('map-time')),
      chip: solid(document.getElementById('map-time-read')),
    };
  });
  expect(got.card, 'the strip has no ground of its own').toBe(true);
  expect(got.chip, 'a chip inside the card still carries its own').toBe(false);
});

test('opening the inspector puts the phone menu away', async ({ page }) => {
  await boot(page);
  const bar = page.locator('#toolbar');
  await page.evaluate(() => {
    document.getElementById('toolbar').classList.remove('collapsed');
    try { localStorage.setItem('navaid.toolbarCollapsed', '0'); } catch (e) { /* */ }
  });
  await page.evaluate(() => {
    state.waypoints = [{ lat: 32.0, lng: 34.9, name: 'A' }, { lat: 32.3, lng: 35.1, name: 'B' }];
    syncLegs();
    state.selected = { type: 'leg', index: 0 };
    showInspector();
  });
  await expect(bar).toHaveClass(/collapsed/);
  // Not persisted: the menu is where it was left the next time it is opened deliberately.
  expect(await page.evaluate(() => localStorage.getItem('navaid.toolbarCollapsed'))).toBe('0');
});

test('a desktop keeps both, because both fit', async ({ page }) => {
  await boot(page, { width: 1280, height: 900 });
  const before = await page.evaluate(() => document.getElementById('toolbar').classList.contains('collapsed'));
  await page.evaluate(() => {
    state.waypoints = [{ lat: 32.0, lng: 34.9, name: 'A' }, { lat: 32.3, lng: 35.1, name: 'B' }];
    syncLegs();
    state.selected = { type: 'leg', index: 0 };
    showInspector();
  });
  expect(await page.evaluate(() => document.getElementById('toolbar').classList.contains('collapsed'))).toBe(before);
});
