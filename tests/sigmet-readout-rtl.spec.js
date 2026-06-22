// @ts-check
// The SIGMET status readout forces LTR for the count badge ("⚠ n SIGMET"), but
// the "no SIGMET in effect" message is a full sentence and must follow the page
// direction — otherwise the Hebrew word order is scrambled (it rendered as
// "בתוקף SIGMET אין" instead of reading right-to-left).
const { test, expect } = require('./_setup');

async function boot(page, lang) {
  await page.goto('?lang=' + lang);
  await page.waitForFunction(() =>
    typeof refreshSigmetReadout === 'function' && document.getElementById('sigmet-readout'));
}

test('Hebrew "no SIGMET" message follows page direction (rtl)', async ({ page }) => {
  await boot(page, 'he');
  const r = await page.evaluate(() => {
    window.showSigmet = true;
    window.sigmets = [];
    refreshSigmetReadout();
    const b = document.getElementById('sigmet-readout');
    return { dir: b.dir, text: b.textContent };
  });
  expect(r.text).toContain('אין');           // the "no SIGMET in effect" string
  expect(r.dir).toBe('rtl');
});

test('count badge stays LTR even in Hebrew', async ({ page }) => {
  await boot(page, 'he');
  const dir = await page.evaluate(() => {
    window.showSigmet = true;
    window.sigmets = [{ raw: 'LLLL SIGMET 1 VALID' }];
    refreshSigmetReadout();
    return document.getElementById('sigmet-readout').dir;
  });
  expect(dir).toBe('ltr');
});

test('English "no SIGMET" message stays ltr', async ({ page }) => {
  await boot(page, 'en');
  const dir = await page.evaluate(() => {
    window.showSigmet = true;
    window.sigmets = [];
    refreshSigmetReadout();
    return document.getElementById('sigmet-readout').dir;
  });
  expect(dir).toBe('ltr');
});
