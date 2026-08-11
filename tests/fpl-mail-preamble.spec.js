// @ts-check
// The filed mail carries a plain-language preamble above the ICAO block. The preamble
// follows the UI language; the (FPL-...) block is never translated — its contents are
// codes, and a localized field 15 would not be a flight plan.
const { test, expect } = require('./_setup');

async function boot(page, lang) {
  await page.goto('?lang=' + lang + '&nogist');
  await page.waitForFunction(() => typeof fplMailPreamble === 'function');
}

const RES = {
  dep: 'LLHZ', dest: 'LLHZ', eetMinutes: 30,
  expandedPoints: ['SFAIM', 'APOLN', 'ARENA'],
  text: '(FPL-4XDAZ-VG\n-C172/L-S/C\n-LLHZ0805)',
};

test('English session: preamble in English, plan block untouched', async ({ page }) => {
  await boot(page, 'en');
  const body = await page.evaluate((r) => fplMailPreamble(r, { depTimeLocal: '11:05' }) + r.text, RES);
  expect(body).toContain('Flight plan on the low-level transit routes');
  expect(body).toContain('at 11:05 local time');
  expect(body).toContain('Route: ');
  expect(body).toContain('at 11:35');          // 11:05 + 30 min EET
  expect(body).toContain('(FPL-4XDAZ-VG');     // the ICAO block survives verbatim
  expect(body.indexOf('Flight plan')).toBeLessThan(body.indexOf('(FPL-'));
});

test('Hebrew session: preamble in Hebrew, plan block still English', async ({ page }) => {
  await boot(page, 'he');
  const body = await page.evaluate((r) => fplMailPreamble(r, { depTimeLocal: '11:05' }) + r.text, RES);
  expect(body).toContain('תכנית טיסה בנתיבי התובלה הנמוכים');
  expect(body).toContain('זמן מקומי');
  expect(body).toContain('נתיב: ');
  expect(body).toContain('11:35');
  // The plan itself is not translated: codes only, exactly as ICAO defines it.
  expect(body).toContain('(FPL-4XDAZ-VG');
  expect(body).toContain('-C172/L-S/C');
  expect(body).not.toMatch(/\(FPL-[^)]*[֐-׿]/);   // no Hebrew inside the block
});

test('arrival is departure plus EET, and wraps past midnight', async ({ page }) => {
  await boot(page, 'en');
  const out = await page.evaluate(() => ({
    plain: fplArrivalLocal('11:05', 30),
    wrap: fplArrivalLocal('23:50', 30),
    noTime: fplArrivalLocal('', 30),
    noEet: fplArrivalLocal('11:05', NaN),
  }));
  expect(out.plain).toBe('11:35');
  expect(out.wrap).toBe('00:20');
  // Missing input yields nothing rather than an invented time — the preamble drops the
  // line instead of stating a landing time it cannot compute.
  expect(out.noTime).toBe('');
  expect(out.noEet).toBe('');
});
