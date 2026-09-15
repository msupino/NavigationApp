// @ts-check
// The nav log on screen: the window, what it opens filled in with, and what the sheet says.
// The arithmetic behind it is navlog-golden.spec.js; this is the part a pilot touches.
const { test, expect } = require('./_setup');

async function boot(page) {
  await page.goto('?lang=en&nogist');
  // The airfield dataset arrives async, and the sheet fills its field elevations from it.
  await page.waitForFunction(() => !!(window.NavAid && NavAid.navLog) && typeof draw === 'function'
    && Array.isArray(window.airfields) && window.airfields.length > 0);
  await page.evaluate(() => {
    state.waypoints = [
      { name: 'LLHZ', lat: 32.17944, lng: 34.83444 },
      { name: 'א', lat: 32.5, lng: 35.0 },
      { name: 'LLIB', lat: 32.98111, lng: 35.57194 },
    ];
    syncLegs();
    draw();
  });
}

const openLog = async (page) => {
  await page.evaluate(() => NavAid.navLog.show());
  await page.waitForSelector('.navlog-table');
};

test('the toolbar offers it, and it opens a sheet', async ({ page }) => {
  await boot(page);
  await expect(page.locator('#nav-log')).toHaveText('Nav table');
  await page.evaluate(() => document.getElementById('nav-log').click());
  await expect(page.locator('.navlog-modal .navlog-table')).toBeVisible();
  // 23 columns, the exercise's own set.
  expect(await page.locator('.navlog-table tr').first().locator('th').count()).toBe(23);
});

test('it opens filled in from what the app already knows', async ({ page }) => {
  await boot(page);
  const cfg = await page.evaluate(() => NavAid.navLog.config());
  // LLHZ is 121 ft in the airfield dataset, LLIB 922 -- nobody should type those again.
  expect(cfg.depElevFt).toBe(121);
  expect(cfg.destElevFt).toBeGreaterThan(500);
  // The app's variation is signed the other way (magnetic = true + variation); the sheet's
  // convention is degrees EAST, so -5 there is 5E here.
  expect(cfg.variationDeg).toBe(5);
  expect(cfg.cas.cruise).toBeGreaterThan(0);
  expect(cfg.deviation).toHaveLength(12);
  expect(cfg.met).toEqual([]);          // nothing invented: a met table is handed to you
});

test('the rows come out climb, cruise, descent', async ({ page }) => {
  await boot(page);
  await openLog(page);
  const kinds = await page.evaluate(() =>
    [...document.querySelectorAll('.navlog-table tr.navlog-row')].map(tr => tr.className));
  expect(kinds[0]).toContain('navlog-climb');
  expect(kinds[kinds.length - 1]).toContain('navlog-descent');
  expect(kinds.length).toBeGreaterThanOrEqual(3);
});

test('a typed met level reaches the sheet, and the cell says where it came from', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => {
    const cfg = NavAid.navLog.config();
    cfg.cruiseAltFt = 6000;
    cfg.met = [{ alt: 6000, dir: 320, kt: 25, tempC: 2 }];
    NavAid.navLog.save(cfg);
  });
  await openLog(page);
  const row = await page.evaluate(() => {
    const tr = [...document.querySelectorAll('.navlog-table tr.navlog-cruise')][0];
    const tds = [...tr.querySelectorAll('td')].map(td => td.textContent);
    return { temp: tds[5], windDir: tds[7], windKt: tds[8], title: tr.querySelectorAll('td')[7].title };
  });
  expect(row.temp).toBe('+2');
  expect(row.windDir).toBe('320');
  expect(row.windKt).toBe('25');
  expect(row.title).toMatch(/met table/i);
});

// Nothing typed and nothing fetched is a legitimate state -- it must produce a sheet and say
// what air it assumed, rather than an empty table or a silent guess.
test('with no met table at all the sheet still comes out, marked standard', async ({ page }) => {
  await boot(page);
  await openLog(page);
  const title = await page.evaluate(() =>
    document.querySelector('.navlog-table tr.navlog-row td:nth-child(6)').title);
  expect(title).toMatch(/standard atmosphere/i);
});

test('what is typed is remembered, and stays on this device', async ({ page }) => {
  await boot(page);
  await openLog(page);
  await page.evaluate(() => {
    const input = document.querySelector('.navlog-setup input');
    input.value = '7500';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const after = await page.evaluate(() => ({
    stored: JSON.parse(localStorage.getItem('navaid.navlog')).cruiseAltFt,
    shown: document.querySelector('.navlog-table tr.navlog-cruise td:nth-child(5)').textContent,
  }));
  expect(after.stored).toBe(7500);
  expect(after.shown).toBe('7500');
});

test('the compass card is typed once and read everywhere', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => {
    const cfg = NavAid.navLog.config();
    cfg.deviation = cfg.deviation.map(e => ({ mh: e.mh, ch: (e.mh + 2) % 360 }));
    NavAid.navLog.save(cfg);
  });
  await openLog(page);
  const devs = await page.evaluate(() =>
    [...document.querySelectorAll('.navlog-table tr.navlog-row')]
      .map(tr => tr.querySelectorAll('td')[14].textContent));
  for (const d of devs) expect(d).toBe('+2');
});

test('CSV carries the same numbers the table shows', async ({ page }) => {
  await boot(page);
  const csv = await page.evaluate(() => {
    const text = [];
    const cfg = NavAid.navLog.config();
    const rows = NavAid.navLog.rows(cfg);
    text.push(NavAid.navLog.headers().join(','));
    rows.forEach((row, i) => text.push(NavAid.navLog.cells(row, i, cfg).join(',')));
    return text.join('\n');
  });
  const lines = csv.split('\n');
  expect(lines[0].split(',')).toHaveLength(23);
  expect(lines.length).toBeGreaterThan(3);
  expect(lines[1]).toContain('LLHZ');
});

test('an empty map says what to do instead of showing an empty grid', async ({ page }) => {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => !!(window.NavAid && NavAid.navLog));
  await page.evaluate(() => NavAid.navLog.show());
  await expect(page.locator('.navlog-note')).toContainText(/draw a route/i);
});

test('the gist can withdraw it', async ({ page }) => {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof setTune === 'function');
  await page.evaluate(() => setTune('featureNavLog', false));
  expect(await page.evaluate(() => NavAid.navLog.show())).toBeNull();
});

test('the Hebrew sheet is Hebrew, with the numbers left to right', async ({ page }) => {
  await page.goto('?lang=he&nogist');
  await page.waitForFunction(() => !!(window.NavAid && NavAid.navLog) && typeof draw === 'function');
  await page.evaluate(() => {
    state.waypoints = [{ name: 'LLHZ', lat: 32.17944, lng: 34.83444 },
                       { name: 'LLIB', lat: 32.98111, lng: 35.57194 }];
    syncLegs(); draw();
    NavAid.navLog.show();
  });
  await page.waitForSelector('.navlog-table');
  const seen = await page.evaluate(() => ({
    title: document.querySelector('.navlog-modal .modal-title').textContent,
    firstHeader: document.querySelector('.navlog-table th').textContent,
    valueDir: document.querySelector('.navlog-table tr.navlog-row td:nth-child(4) bdi').dir,
  }));
  expect(seen.title).toBe('טבלת ניווט');
  expect(seen.firstHeader).toBe('קטע');
  expect(seen.valueDir).toBe('ltr');
});
