// @ts-check
// Hidden capture tool (?capture=1): click map to drop typed points, export JSON.
const { test, expect } = require('./_setup');

test('capture panel appears only with ?capture=1', async ({ page }) => {
  await page.addInitScript(() => { try { localStorage.clear(); } catch (e) {} });
  await page.goto('?lang=en');
  await page.waitForFunction(() => typeof map !== 'undefined');
  await expect(page.locator('#capture-panel')).toHaveCount(0);
});

test('clicking the map adds typed points and exports JSON', async ({ page }) => {
  // Clear once (first nav only) so the reload below keeps captured points.
  await page.addInitScript(() => {
    try { if (!sessionStorage.getItem('_capInit')) { localStorage.clear(); sessionStorage.setItem('_capInit', '1'); } } catch (e) {}
  });
  await page.goto('?lang=en&capture=1');
  await page.waitForSelector('#capture-panel');
  await page.waitForFunction(() => typeof map !== 'undefined');
  const out = await page.evaluate(() => {
    map.setView([32.0, 34.9], 11);
    map.fire('click', { latlng: L.latLng(32.10, 34.80) });
    // switch type then add another
    document.querySelector('input[name=cap-t][value=onRequest]').click();
    map.fire('click', { latlng: L.latLng(32.20, 34.95) });
    const json = JSON.parse(document.getElementById('cap-json').value);
    const stored = JSON.parse(localStorage.getItem('navaid.capture.points') || '[]');
    return { json, count: document.getElementById('cap-count').textContent, stored: stored.length };
  });
  expect(out.json.length).toBe(2);
  expect(out.json[0]).toMatchObject({ lat: 32.1, lng: 34.8, report: 'mandatory' });
  expect(out.json[1]).toMatchObject({ lat: 32.2, lng: 34.95, report: 'onRequest' });
  expect(out.count).toContain('2');
  expect(out.stored).toBe(2);
  // persists across reload
  await page.reload();
  await page.waitForSelector('#capture-panel');
  expect(await page.evaluate(() => JSON.parse(document.getElementById('cap-json').value).length)).toBe(2);
});

test('captured points are scoped to the base layer they were made on', async ({ page }) => {
  await page.addInitScript(() => { try { localStorage.clear(); } catch (e) {} });
  await page.goto('?lang=en&capture=1');
  await page.waitForSelector('#capture-panel');
  await page.waitForFunction(() => typeof layers !== 'undefined');
  const r = await page.evaluate(() => {
    const setLayer = k => { for (const n in layers) if (map.hasLayer(layers[n])) map.removeLayer(layers[n]); map.addLayer(layers[k]); };
    const exported = () => JSON.parse(document.getElementById('cap-json').value).length;
    setLayer('CVFR');
    map.fire('click', { latlng: L.latLng(32.1, 34.8) });
    map.fire('click', { latlng: L.latLng(32.2, 34.9) });
    const cvfr = exported();
    setLayer('Low Alt');
    const lowAltEmpty = exported();
    map.fire('click', { latlng: L.latLng(31.5, 34.7) });
    const lowAlt = exported();
    setLayer('CVFR');
    const cvfrBack = exported();
    return { cvfr, lowAltEmpty, lowAlt, cvfrBack };
  });
  expect(r.cvfr).toBe(2);          // two captured on CVFR
  expect(r.lowAltEmpty).toBe(0);   // none shown on Low Alt
  expect(r.lowAlt).toBe(1);        // one captured on Low Alt
  expect(r.cvfrBack).toBe(2);      // CVFR still has its two
});

test('dragging a captured triangle updates its coordinates', async ({ page }) => {
  await page.addInitScript(() => { try { localStorage.clear(); } catch (e) {} });
  await page.goto('?lang=en&capture=1');
  await page.waitForSelector('#capture-panel');
  await page.waitForFunction(() => typeof map !== 'undefined');
  const p = await page.evaluate(() => {
    map.setView([32.0, 34.9], 11);
    map.fire('click', { latlng: L.latLng(32.10, 34.80) });
    let mk = null;
    map.eachLayer(l => { if (l instanceof L.Marker && l.options.draggable) mk = l; });
    mk.setLatLng(L.latLng(32.15, 34.85));
    mk.fire('dragend', { target: mk });
    return JSON.parse(document.getElementById('cap-json').value)[0];
  });
  expect(p).toMatchObject({ lat: 32.15, lng: 34.85 });
});

test('Load known fills the editor with the selected layer dataset', async ({ page }) => {
  await page.addInitScript(() => { try { localStorage.clear(); } catch (e) {} });
  await page.goto('?lang=en&capture=1');
  await page.waitForSelector('#capture-panel');
  await page.waitForFunction(() => typeof layers !== 'undefined');
  page.on('dialog', d => d.accept());
  await page.evaluate(() => { for (const n in layers) if (map.hasLayer(layers[n])) map.removeLayer(layers[n]); map.addLayer(layers['CVFR']); });
  await page.click('#cap-load');
  await page.waitForFunction(() => JSON.parse(document.getElementById('cap-json').value).length > 100);
  const out = await page.evaluate(() => {
    const j = JSON.parse(document.getElementById('cap-json').value);
    return { n: j.length, hasName: !!j[0].name, hasReport: !!j[0].report };
  });
  expect(out.n).toBeGreaterThan(150);    // ~172 CVFR nav-waypoints
  expect(out.hasName).toBe(true);
  expect(out.hasReport).toBe(true);
});

test('undo and clear work', async ({ page }) => {
  await page.addInitScript(() => { try { localStorage.clear(); } catch (e) {} });
  await page.goto('?lang=en&capture=1');
  await page.waitForSelector('#capture-panel');
  page.on('dialog', d => d.accept());
  const r = await page.evaluate(() => {
    map.fire('click', { latlng: L.latLng(32.1, 34.8) });
    map.fire('click', { latlng: L.latLng(32.2, 34.9) });
    document.getElementById('cap-undo').click();
    const afterUndo = JSON.parse(document.getElementById('cap-json').value).length;
    document.getElementById('cap-clear').click();
    const afterClear = JSON.parse(document.getElementById('cap-json').value).length;
    return { afterUndo, afterClear };
  });
  expect(r.afterUndo).toBe(1);
  expect(r.afterClear).toBe(0);
});
