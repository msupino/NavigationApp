// @ts-check
// A full localStorage silently dropped an edited frequency (the override write was swallowed).
// Now a critical write evicts the reclaimable gist cache and retries; if it still will not fit,
// it warns instead of losing the edit in silence.
const { test, expect } = require('./_setup');

test('on quota, evicts the gist cache and the override still saves', async ({ page }) => {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof setAirfieldFreqOverride === 'function');
  const r = await page.evaluate(() => {
    const real = localStorage.setItem.bind(localStorage);
    localStorage.setItem('navaid.gistCache', JSON.stringify({ big: 'x'.repeat(1000) }));
    let threw = 0;
    localStorage.setItem = function (k, v) {
      // fail the override write until the gist cache has been dropped (simulating "just enough room")
      if (k === 'navaid.airfieldFreqOverrides' && localStorage.getItem('navaid.gistCache') !== null) {
        threw++; const e = new Error('QuotaExceededError'); e.name = 'QuotaExceededError'; throw e;
      }
      return real(k, v);
    };
    const ok = setAirfieldFreqOverride('LLHZ|cat:secondary', '128.25');
    localStorage.setItem = real;
    return { ok, threw, stored: JSON.parse(localStorage.getItem('navaid.airfieldFreqOverrides') || '{}')['LLHZ|cat:secondary'],
             gistGone: localStorage.getItem('navaid.gistCache') === null };
  });
  expect(r.threw).toBeGreaterThan(0);     // it really hit quota once
  expect(r.gistGone).toBe(true);          // evicted the reclaimable cache
  expect(r.ok).toBe(true);                // and the retry saved it
  expect(r.stored).toBe('128.25');
});

test('when it still will not fit, it warns instead of losing the edit silently', async ({ page }) => {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof setAirfieldFreqOverride === 'function');
  const r = await page.evaluate(() => {
    const real = localStorage.setItem.bind(localStorage);
    let toast = '';
    const realToast = window.showToast;
    window.showToast = (m) => { toast = m; };
    localStorage.setItem = function (k, v) {
      if (k === 'navaid.airfieldFreqOverrides') { const e = new Error('full'); e.name = 'QuotaExceededError'; throw e; }
      return real(k, v);
    };
    const ok = setAirfieldFreqOverride('LLHZ|cat:secondary', '128.25');
    localStorage.setItem = real; window.showToast = realToast;
    return { ok, toast };
  });
  expect(r.ok).toBe(false);
  expect(r.toast).toMatch(/storage is full/i);
});
