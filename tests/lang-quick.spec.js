// @ts-check
// The language picker lives in Settings, a word written in the current language: someone who
// opens the Hebrew default and reads no Hebrew could not find their way to English. So a
// switch stays in sight -- a globe and the OTHER language's own name ("English" while the app
// is Hebrew), named in that language for a screen reader too.
const { test, expect } = require('./_setup');

test('phone: the strip carries a globe switch named in the other language, and it switches', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('?lang=he&nogist');
  const btn = page.locator('#deck-strip .deck-strip-lang');
  await expect(btn).toBeVisible();
  await expect(btn).toHaveText('English');
  await expect(btn).toHaveAttribute('aria-label', 'Switch to English');
  expect(await btn.locator('svg').count()).toBe(1);
  expect((await btn.boundingBox()).height).toBeGreaterThanOrEqual(44);
  await Promise.all([page.waitForURL(/lang=en/), btn.click()]);
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.locator('#deck-strip .deck-strip-lang')).toHaveText('עברית');
});

test('desktop: the menubar keeps a globe switch in sight, and stays one row', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('?lang=he&nogist');
  const btn = page.locator('#lang-quick');
  await expect(btn).toBeVisible();
  await expect(btn).toHaveAttribute('title', 'Switch to English');
  expect(await btn.locator('svg').count()).toBe(1);
  const h = await page.evaluate(() => document.getElementById('toolbar').getBoundingClientRect().height);
  expect(h).toBeLessThan(45);
  await Promise.all([page.waitForURL(/lang=en/), btn.click()]);
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
});

test('phone: in flight the switch steps aside, and the readout fits its own line', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('?lang=he&nogist');
  await page.waitForSelector('#deck-strip .deck-strip-lang');
  const got = await page.evaluate(() => {
    // A live position and the readout a pilot saw in flight: speed, altitude, subscale,
    // heading, point count and the elapsed clock.
    window.gpsPositionLive = () => true;
    const ro = document.getElementById('gps-readout');
    ro.hidden = false;
    ro.textContent = '105 kt \u00b7 402 ft \u00b7 29.35\u2033 \u00b7 322\u00b0 \u00b7 12 pts \u00b7 00:14';
    NavAid.refreshMobileDeck();
    const strip = document.getElementById('deck-strip');
    const line = strip.querySelector('.deck-strip-top');
    const vals = strip.querySelector('.deck-strip-vals').textContent;
    return { live: strip.classList.contains('deck-strip-live'),
      lang: getComputedStyle(strip.querySelector('.deck-strip-lang')).display,
      fits: line.scrollWidth <= line.clientWidth + 1, vals };
  });
  expect(got.live).toBe(true);
  expect(got.lang).toBe('none');                 // the instruments get the room
  expect(got.fits).toBe(true);                   // nothing runs under Comm fail
  for (const kept of ['105 kt', '402 ft', '322\u00b0']) expect(got.vals).toContain(kept);   // never dropped
});

// Reported with a screenshot from a phone with the system text size up: the Hebrew names
// outgrew a fixed name column, the controls stepped out of line, and Magnetic variation
// wrapped. Each row is one line; the controls line up at the row's end.
for (const lang of ['he', 'en']) test(`settings rows stay one line with the controls aligned, larger text (${lang})`, async ({ page }) => {
  await page.setViewportSize({ width: 300, height: 700 });        // ~390px at 1.3x text
  await page.goto('?lang=' + lang + '&nogist');
  await page.evaluate(() => document.querySelector('.deck-btn-menu').click());
  await page.locator('.tb-section[data-sec="settings"] .tb-section-head').click();
  const rows = await page.evaluate(() => [...document.querySelectorAll('.tb-section[data-sec="settings"] .tb-section-body > .navtoggle')]
    .filter(r => r.getClientRects().length).map(r => {
      const kids = [...r.children].filter(k => k.getClientRects().length);
      const mids = kids.map(k => { const b = k.getBoundingClientRect(); return b.top + b.height / 2; });
      const ctrls = kids.slice(1).map(k => k.getBoundingClientRect());
      const rtl = document.documentElement.dir === 'rtl';
      return { spread: Math.max(...mids) - Math.min(...mids),
        edge: rtl ? Math.min(...ctrls.map(b => b.left)) : Math.max(...ctrls.map(b => b.right)) };
    }));
  expect(rows.length).toBe(6);                   // the settings rows: pressure unit, altitude from, brightness among them
  for (const r of rows) expect(r.spread).toBeLessThan(8);         // one line
  expect(Math.max(...rows.map(r => r.edge)) - Math.min(...rows.map(r => r.edge))).toBeLessThan(2);   // aligned
});
