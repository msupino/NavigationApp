const { test } = require('./_setup');
for (const [lang, theme, w, h] of [['en', 'light', 390, 844], ['he', 'dark', 390, 844], ['en', 'dark', 360, 640], ['he', 'light', 360, 640]]) test('phone legend ' + lang + w, async ({ page }) => {
  await page.setViewportSize({ width: w, height: h });
  await page.addInitScript((t) => { try { localStorage.setItem('navaid.theme', t); } catch (e) {} }, theme);
  await page.goto(`?lang=${lang}&nogist`);
  await page.waitForFunction(() => typeof addRoutePoint === 'function' && Array.isArray(window.airfields) && typeof findNavWpToken === 'function');
  await page.waitForTimeout(2000);
  await page.evaluate(() => { document.getElementById('boot-loading')?.remove(); document.documentElement.classList.remove('app-booting'); });
  const geo = () => page.evaluate(() => {
    const r = (s) => { const e = document.querySelector(s); if (!e || !e.getClientRects().length) return null; const b = e.getBoundingClientRect(); return [b.left, b.top, b.right, b.bottom].map(Math.round); };
    const items = { btn: r('#legend-toggle'), pill: r('#route-summary'), key: r('#map-legend'), coords: r('#coord-readout'), hint: r('#empty-route-hint'), bar: r('#deck-bar'), zoom: r('.leaflet-control-zoom'), edit: r('.edit-col-ctrl') };
    const hit = (a, b) => a && b && a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
    const over = [];
    for (const k of ['btn', 'pill', 'key']) for (const o of ['coords', 'hint', 'bar', 'zoom', 'edit']) if (hit(items[k], items[o])) over.push(k + 'x' + o);
    return { items, over };
  });
  const tag = `${process.env.S}/phone-${lang}-${theme}-${w}`;
  console.log('EMPTY', lang, JSON.stringify(await geo()));
  await page.screenshot({ path: `${tag}-empty.png` });
  await page.evaluate(async () => { await loadNavWaypoints(); window.appConfirm = async () => true; window.askYesNo = async () => true;
    for (const n of ['LLHZ', 'BAZRA', 'DEROR', 'LLHA']) await addRoutePoint(findNavWpToken(n) || airfields.find(a => a.name === n));
    state.selected = null; showInspector(); draw(); });
  await page.waitForTimeout(500);
  console.log('ROUTE', lang, JSON.stringify(await geo()));
  await page.screenshot({ path: `${tag}-route.png` });
  await page.locator('#legend-toggle').click(); await page.waitForTimeout(300);
  console.log('OPEN', lang, JSON.stringify(await geo()));
  await page.screenshot({ path: `${tag}-open.png` });
});
