// @ts-check
// Asked: "above route check icon, add quick layer selector". A Layers button heads the edit
// column; it opens a popover with the base map (one of them) and the overlays switched most,
// each row pressing the menu's own control.
const { test, expect } = require('./_setup');

async function boot(page, lang = 'en', size = { width: 390, height: 844 }) {
  await page.setViewportSize(size);
  await page.goto('?lang=' + lang + '&nogist');
  await page.waitForFunction(() => typeof toggleQuickLayers === 'function' && document.getElementById('edit-col-layers'));
}

test('the Layers button sits above Route check, and opens beside the column', async ({ page }) => {
  await boot(page);
  const ids = await page.evaluate(() => [...document.querySelectorAll('.edit-col-ctrl button')].map(b => b.id));
  expect(ids.slice(0, 2)).toEqual(['edit-col-layers', 'edit-col-check']);
  await page.locator('#edit-col-layers').click();
  const pop = page.locator('#quick-layers');
  await expect(pop).toBeVisible();
  await expect(page.locator('#edit-col-layers')).toHaveAttribute('aria-expanded', 'true');
  const g = await page.evaluate(() => ({ b: document.getElementById('edit-col-layers').getBoundingClientRect().toJSON(),
    p: document.getElementById('quick-layers').getBoundingClientRect().toJSON(), w: innerWidth }));
  expect(g.p.left).toBeGreaterThanOrEqual(g.b.right);              // on the map side of the column
  expect(g.p.right).toBeLessThanOrEqual(g.w);
  // Every row is a full touch target.
  const hs = await pop.locator('.ql-row').evaluateAll(rs => rs.map(r => r.getBoundingClientRect().height));
  for (const h of hs) expect(h).toBeGreaterThanOrEqual(44);
});

test('base map: one of them, the select\'s own; choosing one switches it', async ({ page }) => {
  await boot(page);
  await page.locator('#edit-col-layers').click();
  const radios = page.locator('#quick-layers .ql-radio');
  const opts = await page.evaluate(() => [...document.getElementById('layer-select').options].filter(o => !o.hidden && !o.disabled && o.value !== '---').map(o => o.textContent));
  await expect(radios).toHaveText(opts);
  await expect(page.locator('#quick-layers .ql-radio[aria-checked="true"]')).toHaveCount(1);
  const target = await page.evaluate(() => { const s = document.getElementById('layer-select');
    const o = [...s.options].find(x => x.value !== s.value && !x.hidden && !x.disabled && x.value !== '---'); return o && [o.value, o.textContent]; });
  await radios.filter({ hasText: target[1] }).first().click();
  expect(await page.evaluate(() => document.getElementById('layer-select').value)).toBe(target[0]);
  await expect(page.locator('#quick-layers')).toHaveCount(0);           // a chart chosen: closed
  await page.locator('#edit-col-layers').click();
  await expect(page.locator('#quick-layers .ql-radio[aria-checked="true"]')).toHaveText(target[1]);
  // And the map shows it: the chosen chart is the layer on the map.
  expect(await page.evaluate(() => currentLayerName())).toBe(target[0]);
});

test('an overlay switch presses the layer\'s own checkbox; one the browser cannot show is dimmed', async ({ page }) => {
  await boot(page);
  await page.locator('#edit-col-layers').click();
  const wind = page.locator('#quick-layers .ql-switch[data-for="show-wind-cb"]');
  await expect(wind).toHaveText(/^Per-leg wind effect/);              // the menu's name, without "Show"
  const was = await page.evaluate(() => document.getElementById('show-wind-cb').checked);
  await wind.click();
  expect(await page.evaluate(() => document.getElementById('show-wind-cb').checked)).toBe(!was);
  await expect(page.locator('#quick-layers .ql-switch[data-for="show-wind-cb"]')).toHaveAttribute('aria-checked', String(!was));
  await expect(page.locator('#quick-layers')).toHaveCount(1);           // an overlay switch: stays open
  // Traffic needs the app: dimmed, saying why, and pressing it does not switch it.
  const traffic = page.locator('#quick-layers .ql-switch[data-for="traffic-cb"]');
  if (await traffic.count()) {
    await expect(traffic).toHaveClass(/is-dim/);
    await expect(traffic).toHaveAttribute('data-why', /.+/);
  }
});

test('Escape, a tap outside, and Back each close it', async ({ page }) => {
  await boot(page);
  const btn = page.locator('#edit-col-layers');
  await btn.click(); await page.keyboard.press('Escape');
  await expect(page.locator('#quick-layers')).toHaveCount(0);
  await btn.click(); await page.mouse.click(380, 300);   // the map, right of the popover
  await expect(page.locator('#quick-layers')).toHaveCount(0);
  await btn.click();
  expect(await page.evaluate(() => backButtonStep())).toBe(true);
  await expect(page.locator('#quick-layers')).toHaveCount(0);
  await btn.click(); await page.setViewportSize({ width: 844, height: 390 });   // the phone turned
  await expect(page.locator('#quick-layers')).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await btn.click(); await btn.click();                       // the button closes it too
  await expect(page.locator('#quick-layers')).toHaveCount(0);
});

test('Hebrew: the menu\'s own Hebrew names, laid out right to left', async ({ page }) => {
  await boot(page, 'he');
  await page.locator('#edit-col-layers').click();
  await expect(page.locator('#quick-layers .ql-head').first()).toHaveText('מפה');
  expect(await page.evaluate(() => getComputedStyle(document.querySelector('#quick-layers .ql-row')).direction)).toBe('rtl');
  const g = await page.evaluate(() => ({ b: document.getElementById('edit-col-layers').getBoundingClientRect().toJSON(),
    p: document.getElementById('quick-layers').getBoundingClientRect().toJSON(), w: innerWidth }));
  expect(g.p.right).toBeLessThanOrEqual(g.w);
  expect(g.p.left >= g.b.right || g.p.right <= g.b.left).toBe(true);   // beside the column, not over it
});

test('on a phone the list stops above the bottom bar and scrolls inside', async ({ page }) => {
  await boot(page, 'en', { width: 390, height: 640 });
  await page.locator('#edit-col-layers').click();
  const g = await page.evaluate(() => {
    const p = document.getElementById('quick-layers').getBoundingClientRect();
    const bar = document.querySelector('.deck-bar, #deck-bar, .mobile-deck-bar');
    const el = document.getElementById('quick-layers');
    return { bottom: p.bottom, barTop: bar ? bar.getBoundingClientRect().top : innerHeight, scrolls: el.scrollHeight > el.clientHeight };
  });
  expect(g.bottom).toBeLessThanOrEqual(g.barTop);
  expect(g.scrolls).toBe(true);
});

test('a layer with nothing in force (AIRMET, SIGMET) is listed, dimmed, with the menu\'s reason', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => { setLayerIdle('airmet-cb', true, 'No AIRMET in force'); setLayerIdle('sigmet-cb', true, 'No SIGMET in force'); });
  await page.locator('#edit-col-layers').click();
  for (const id of ['airmet-cb', 'sigmet-cb']) {
    const row = page.locator(`#quick-layers .ql-switch[data-for="${id}"]`);
    await expect(row).toHaveCount(1);
    await expect(row).toHaveClass(/is-dim/);
    // The menu's own reason, whichever set it last: the app re-checks AIRMET / SIGMET itself.
    const why = await page.evaluate((id) => document.getElementById(id).dataset.why, id);
    expect(why).toMatch(/AIRMET|SIGMET/);
    await expect(row).toHaveAttribute('data-why', why);
  }
  const was = await page.evaluate(() => document.getElementById('airmet-cb').checked);
  await page.evaluate(() => document.querySelector('#quick-layers .ql-switch[data-for="airmet-cb"]').click());
  expect(await page.evaluate(() => document.getElementById('airmet-cb').checked)).toBe(was);   // says why, does not switch
});

test('a layer the gist withdrew row by row (surface weather) is not offered', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => { NavAid.tuning.featureSurfaceWx = false; NavAid.refreshSurfaceWxFeature(); });
  await page.locator('#edit-col-layers').click();
  await expect(page.locator('#quick-layers .ql-switch[data-for="surface-wx-cb"]')).toHaveCount(0);
});
