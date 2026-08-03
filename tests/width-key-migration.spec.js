// A slider whose RANGE changes needs a new key, or an out-of-range saved value is
// silently clamped and the pilot flies a width they never chose. legLineWidth2 was
// introduced for a 0.1–2.0 range and the range was later narrowed to 0.1–0.9 with no
// bump (so 1.5 became 0.9); driftLineWidth went 0.5–6 -> 0.2–1.8 on its original key.
const { test, expect } = require('./_setup');

const read = (page, key) => page.evaluate(k => localStorage.getItem(k), key);

async function bootWith(page, seed) {
  await page.addInitScript(s => {
    try { for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v); } catch (e) {}
  }, seed);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof adoptRangedNumber === 'function');
}

test('an in-range value from the old key is adopted, not lost', async ({ page }) => {
  await bootWith(page, { 'navaid.legLineWidth2': '0.7', 'navaid.driftLineWidth': '1.2' });
  expect(await page.evaluate(() => window.legLineWidth)).toBeCloseTo(0.7, 5);
  expect(await page.evaluate(() => window.driftLineWidth)).toBeCloseTo(1.2, 5);
  // Adopted into the versioned key so it is only migrated once.
  expect(await read(page, 'navaid.legLineWidth3')).toBe('0.7');
  expect(await read(page, 'navaid.driftLineWidth2')).toBe('1.2');
});

test('an out-of-range value is NOT clamped — it falls back to the shipped default', async ({ page }) => {
  // 1.5 under the old 0.1–2.0 range, and 3 under the old 0.5–6 range.
  await bootWith(page, { 'navaid.legLineWidth2': '1.5', 'navaid.driftLineWidth': '3' });
  const out = await page.evaluate(() => ({
    leg: window.legLineWidth, drift: window.driftLineWidth,
    legMax: LEGLINEWIDTH_MAX, driftMax: DRIFTLINEWIDTH_MAX,
  }));
  expect(out.leg).not.toBeCloseTo(out.legMax, 5);     // not silently pinned to 0.9
  expect(out.drift).not.toBeCloseTo(out.driftMax, 5); // not silently pinned to 1.8
  expect(out.leg).toBeCloseTo(0.5, 5);                // the shipped default
  expect(out.drift).toBeCloseTo(1, 5);
  // And nothing out of range is written to the new key.
  expect(await read(page, 'navaid.legLineWidth3')).toBeNull();
});

test('the versioned key wins over any legacy value', async ({ page }) => {
  await bootWith(page, { 'navaid.legLineWidth3': '0.3', 'navaid.legLineWidth2': '0.8' });
  expect(await page.evaluate(() => window.legLineWidth)).toBeCloseTo(0.3, 5);
});

test('the oldest key is still honoured when it fits', async ({ page }) => {
  await bootWith(page, { 'navaid.legLineWidth': '0.4' });   // pre-v2
  expect(await page.evaluate(() => window.legLineWidth)).toBeCloseTo(0.4, 5);
  expect(await read(page, 'navaid.legLineWidth3')).toBe('0.4');
});

test('a fresh install just takes the defaults', async ({ page }) => {
  await bootWith(page, {});
  expect(await page.evaluate(() => window.legLineWidth)).toBeCloseTo(0.5, 5);
  expect(await page.evaluate(() => window.driftLineWidth)).toBeCloseTo(1, 5);
});

test('the colour pickers write keys that are actually synced', async ({ page }) => {
  await bootWith(page, {});
  const out = await page.evaluate(() => {
    const set = (id, v) => { const el = document.getElementById(id); el.value = v; el.oninput(); };
    set('waypoint-color', '#123456');
    set('leg-arrow-color', '#abcdef');
    return { wp: localStorage.getItem('navaid.waypointColor'),
             leg: localStorage.getItem('navaid.legArrowColor'),
             synced: (window.GDRIVE_SETTINGS_KEYS || []) };
  });
  expect(out.wp).toBe('#123456');
  expect(out.leg).toBe('#abcdef');
  // The gap that started this: written, but absent from the sync allowlist.
  expect(out.synced).toContain('navaid.waypointColor');
  expect(out.synced).toContain('navaid.legArrowColor');
});
