// @ts-check
// The two IMS chart VIEWERS (significant weather, wind/temp) each carry their own valid-time
// dropdown, and both used to be frozen at page load: the manifest was fetched once in the
// IIFE and never again, and the list opened on options[0] — the OLDEST sheet the run had
// published. A tab left open through the day therefore kept offering this morning's times and
// kept opening on the first of them, however far Zulu had moved on. (The shared #wx-time
// dropdown that drives the map OVERLAYS already re-polls — see wx-time-dynamic.spec.js.)
// Now each viewer seeds to the chart valid NOW and re-reads its manifest when it opens.
const { test, expect } = require('./_setup');

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMCAYAAAB7P3qAAAAAAElFTkSuQmCC',
  'base64');

// 12:00Z on 21/06/2026, so "nearest to now" is one unambiguous option.
async function freezeNoon(page) {
  await page.addInitScript(() => {
    const fixed = Date.UTC(2026, 5, 21, 12, 0);
    const RealDate = Date;
    // eslint-disable-next-line no-global-assign
    Date = class extends RealDate {
      constructor(...a) { super(...(a.length ? a : [fixed])); }
      static now() { return fixed; }
    };
  });
}

// Both manifests come from a mutable holder, so a test can publish a new run between opens.
async function serve(page, holder) {
  await page.route(/ims-data\/ims\/(sigwx|pwx)\/.*\.png/, r =>
    r.fulfill({ status: 200, contentType: 'image/png', body: PNG }));
  await page.route(/ims-data\/ims\/sigwx\.json/, r => r.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify(holder.sigwx),
  }));
  await page.route(/ims-data\/ims\/pwx\.json/, r => r.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify(holder.pwx),
  }));
  await page.addInitScript(() => {
    try { localStorage.setItem('navaid.sec.charts', '1'); } catch (e) {}
  });
  await freezeNoon(page);
  await page.goto('?lang=en&nogist');
}

const sigwxTime = (valid, png) => ({ valid, day: '21/06/2026', png: 'ims/sigwx/' + png + '.png' });
const pwxTime = (valid, png) => ({ valid, day: '21/06/2026', png: 'ims/pwx/' + png + '.png' });

const sigwxRun = times => ({ generatedAt: '2026-06-21T' + times[0].valid + ':00Z', times });
const pwxRun = times => ({
  generatedAt: '2026-06-21T06:00:00Z',
  bounds: { n: 34, s: 29, w: 34, e: 36 },
  levels: [{ level: '950', label: 'FL020', times }],
});

const modal = page => page.locator('.modal-back .sigwx-modal');
// Opening a chart closes the toolbar menus, so a second open has to reopen the section.
async function openChart(page, id) {
  const btn = page.locator('#' + id);
  if (!await btn.isVisible()) await page.locator('.tb-section[data-sec="charts"] .tb-section-head').click();
  await btn.click();
}

test('the SIGWX viewer opens on the chart valid now, not the first one published', async ({ page }) => {
  const holder = {
    sigwx: sigwxRun([sigwxTime('00:00', '0000'), sigwxTime('06:00', '0600'), sigwxTime('12:00', '1200')]),
    pwx: pwxRun([pwxTime('12:00', '950_1200')]),
  };
  await serve(page, holder);
  await openChart(page, 'sigwx-btn');
  const sel = modal(page).locator('select.sigwx-time');
  await expect(sel.locator('option')).toHaveCount(3);
  // 12:00Z is the sheet valid at the frozen clock; 00:00Z is the one options[0] used to give.
  await expect(sel).toHaveValue('2');
  await expect(modal(page).locator('img.sigwx-img')).toHaveAttribute('src', /sigwx\/1200\.png/);
});

test('reopening the SIGWX viewer picks up a run published since the page loaded', async ({ page }) => {
  const holder = {
    sigwx: sigwxRun([sigwxTime('00:00', '0000'), sigwxTime('06:00', '0600')]),
    pwx: pwxRun([pwxTime('12:00', '950_1200')]),
  };
  await serve(page, holder);
  await expect(page.locator('#sigwx-btn')).toBeVisible();     // the first manifest has landed
  await openChart(page, 'sigwx-btn');
  await expect(modal(page).locator('select.sigwx-time option')).toHaveCount(2);
  await page.keyboard.press('Escape');
  await expect(modal(page)).toHaveCount(0);

  // The 12:00 run is published while the tab stays open. No reload.
  holder.sigwx = sigwxRun([sigwxTime('00:00', '0000'), sigwxTime('06:00', '0600'), sigwxTime('12:00', '1200')]);
  await openChart(page, 'sigwx-btn');
  const sel = modal(page).locator('select.sigwx-time');
  await expect(sel.locator('option')).toHaveCount(3);
  await expect(sel.locator('option').nth(2)).toHaveText('21/06/2026 12:00Z');
  await expect(modal(page).locator('img.sigwx-img')).toHaveAttribute('src', /sigwx\/1200\.png/);
});

test('a new run that lands while the SIGWX viewer is open is added to the open list', async ({ page }) => {
  const holder = {
    sigwx: sigwxRun([sigwxTime('00:00', '0000'), sigwxTime('06:00', '0600')]),
    pwx: pwxRun([pwxTime('12:00', '950_1200')]),
  };
  await serve(page, holder);
  await expect(page.locator('#sigwx-btn')).toBeVisible();     // the first manifest has landed
  // Publish the newer run, then open: the refresh the open fires is what must find it.
  holder.sigwx = sigwxRun([sigwxTime('00:00', '0000'), sigwxTime('06:00', '0600'), sigwxTime('12:00', '1200')]);
  await openChart(page, 'sigwx-btn');
  await expect(modal(page).locator('select.sigwx-time option')).toHaveCount(3);
  await expect(modal(page).locator('img.sigwx-img')).toHaveAttribute('src', /sigwx\/1200\.png/);
});

test('a time the pilot picked survives a refresh that renumbers the list', async ({ page }) => {
  const holder = {
    sigwx: sigwxRun([sigwxTime('06:00', '0600'), sigwxTime('12:00', '1200')]),
    pwx: pwxRun([pwxTime('12:00', '950_1200')]),
  };
  await serve(page, holder);
  await expect(page.locator('#sigwx-btn')).toBeVisible();     // the first manifest has landed
  // Hold the manifest read the OPEN fires long enough for the pilot to pick a time before it
  // lands -- the window in which a rebuild could move them off their choice. Registered after
  // serve() so it takes precedence over the route serve() installed.
  await page.route(/ims-data\/ims\/sigwx\.json/, async r => {
    await new Promise(res => setTimeout(res, 1200));
    await r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(holder.sigwx) });
  });
  await openChart(page, 'sigwx-btn');
  const sel = modal(page).locator('select.sigwx-time');
  // A run that PREPENDS 00:00 shifts every index by one, and the option value IS the index.
  holder.sigwx = sigwxRun([sigwxTime('00:00', '0000'), sigwxTime('06:00', '0600'), sigwxTime('12:00', '1200')]);
  await sel.selectOption({ label: '21/06/2026 06:00Z' });
  await expect(modal(page).locator('img.sigwx-img')).toHaveAttribute('src', /sigwx\/0600\.png/);
  // The delayed manifest lands and rebuilds the list; the pilot is still on 06:00, not on
  // whatever now sits at the index they happened to have selected.
  await expect(sel.locator('option')).toHaveCount(3);
  await expect(modal(page).locator('img.sigwx-img')).toHaveAttribute('src', /sigwx\/0600\.png/);
});

test('the PWX viewer opens on the chart valid now', async ({ page }) => {
  const holder = {
    sigwx: sigwxRun([sigwxTime('12:00', '1200')]),
    pwx: pwxRun([pwxTime('00:00', '950_0000'), pwxTime('06:00', '950_0600'), pwxTime('12:00', '950_1200')]),
  };
  await serve(page, holder);
  await openChart(page, 'pwx-btn');
  const sel = modal(page).locator('select').nth(1);
  await expect(sel.locator('option')).toHaveCount(3);
  await expect(sel).toHaveValue('2');
  await expect(modal(page).locator('img.sigwx-img')).toHaveAttribute('src', /pwx\/950_1200\.png/);
});

test('reopening the PWX viewer picks up a run published since the page loaded', async ({ page }) => {
  const holder = {
    sigwx: sigwxRun([sigwxTime('12:00', '1200')]),
    pwx: pwxRun([pwxTime('00:00', '950_0000'), pwxTime('06:00', '950_0600')]),
  };
  await serve(page, holder);
  await expect(page.locator('#pwx-btn')).toBeVisible();       // the first manifest has landed
  await openChart(page, 'pwx-btn');
  await expect(modal(page).locator('select').nth(1).locator('option')).toHaveCount(2);
  await page.keyboard.press('Escape');
  await expect(modal(page)).toHaveCount(0);

  holder.pwx = pwxRun([pwxTime('00:00', '950_0000'), pwxTime('06:00', '950_0600'), pwxTime('12:00', '950_1200')]);
  await openChart(page, 'pwx-btn');
  await expect(modal(page).locator('select').nth(1).locator('option')).toHaveCount(3);
  await expect(modal(page).locator('img.sigwx-img')).toHaveAttribute('src', /pwx\/950_1200\.png/);
});
