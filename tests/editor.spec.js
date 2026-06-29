// @ts-check
// Hidden capture tool (?editor=1): click map to drop typed points, export JSON.
const { test, expect } = require('./_setup');

test('capture panel appears only with ?editor=1', async ({ page }) => {
  await page.addInitScript(() => { try { localStorage.clear(); } catch (e) {} });
  await page.goto('?lang=en');
  await page.waitForFunction(() => typeof map !== 'undefined');
  await expect(page.locator('#editor-panel')).toHaveCount(0);
});

test('clicking the map adds typed points and exports JSON', async ({ page }) => {
  // Clear once (first nav only) so the reload below keeps captured points.
  await page.addInitScript(() => {
    try { if (!sessionStorage.getItem('_edInit')) { localStorage.clear(); sessionStorage.setItem('_edInit', '1'); } } catch (e) {}
  });
  await page.goto('?lang=en&editor=1');
  await page.waitForSelector('#editor-panel');
  await page.waitForFunction(() => typeof map !== 'undefined');
  const out = await page.evaluate(() => {
    map.setView([32.0, 34.9], 11);
    map.fire('click', { latlng: L.latLng(32.10, 34.80) });
    // switch type then add another
    document.querySelector('input[name=ed-t][value=onRequest]').click();
    map.fire('click', { latlng: L.latLng(32.20, 34.95) });
    const json = JSON.parse(document.getElementById('ed-json').value);
    const stored = JSON.parse(localStorage.getItem('navaid.editor.points') || '[]');
    return { json, count: document.getElementById('ed-count').textContent, stored: stored.length };
  });
  expect(out.json.length).toBe(2);
  expect(out.json[0]).toMatchObject({ lat: 32.1, lng: 34.8, report: 'mandatory' });
  expect(out.json[1]).toMatchObject({ lat: 32.2, lng: 34.95, report: 'onRequest' });
  expect(out.count).toContain('2');
  expect(out.stored).toBe(2);
  // persists across reload
  await page.reload();
  await page.waitForSelector('#editor-panel');
  expect(await page.evaluate(() => JSON.parse(document.getElementById('ed-json').value).length)).toBe(2);
});

test('captured points are scoped to the base layer they were made on', async ({ page }) => {
  await page.addInitScript(() => { try { localStorage.clear(); } catch (e) {} });
  await page.goto('?lang=en&editor=1');
  await page.waitForSelector('#editor-panel');
  await page.waitForFunction(() => typeof layers !== 'undefined');
  const r = await page.evaluate(() => {
    const setLayer = k => { for (const n in layers) if (map.hasLayer(layers[n])) map.removeLayer(layers[n]); map.addLayer(layers[k]); };
    const exported = () => JSON.parse(document.getElementById('ed-json').value).length;
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
  await page.goto('?lang=en&editor=1');
  await page.waitForSelector('#editor-panel');
  await page.waitForFunction(() => typeof map !== 'undefined');
  const p = await page.evaluate(() => {
    map.setView([32.0, 34.9], 11);
    map.fire('click', { latlng: L.latLng(32.10, 34.80) });
    let mk = null;
    map.eachLayer(l => { if (l instanceof L.Marker && l.options.draggable) mk = l; });
    mk.setLatLng(L.latLng(32.15, 34.85));
    mk.fire('dragend', { target: mk });
    return JSON.parse(document.getElementById('ed-json').value)[0];
  });
  expect(p).toMatchObject({ lat: 32.15, lng: 34.85 });
});

test('Load known fills the editor with the selected layer dataset', async ({ page }) => {
  await page.addInitScript(() => { try { localStorage.clear(); } catch (e) {} });
  await page.goto('?lang=en&editor=1');
  await page.waitForSelector('#editor-panel');
  await page.waitForFunction(() => typeof layers !== 'undefined');
  page.on('dialog', d => d.accept());
  await page.evaluate(() => { for (const n in layers) if (map.hasLayer(layers[n])) map.removeLayer(layers[n]); map.addLayer(layers['CVFR']); });
  await page.click('#ed-load');
  await page.waitForFunction(() => JSON.parse(document.getElementById('ed-json').value).length > 100);
  const out = await page.evaluate(() => {
    const j = JSON.parse(document.getElementById('ed-json').value);
    return { n: j.length, hasName: !!j[0].name, hasReport: !!j[0].report };
  });
  expect(out.n).toBeGreaterThan(150);    // ~172 CVFR nav-waypoints
  expect(out.hasName).toBe(true);
  expect(out.hasReport).toBe(true);
});

test('undo and clear work', async ({ page }) => {
  await page.addInitScript(() => { try { localStorage.clear(); } catch (e) {} });
  await page.goto('?lang=en&editor=1');
  await page.waitForSelector('#editor-panel');
  page.on('dialog', d => d.accept());
  const r = await page.evaluate(() => {
    map.fire('click', { latlng: L.latLng(32.1, 34.8) });
    map.fire('click', { latlng: L.latLng(32.2, 34.9) });
    document.getElementById('ed-undo').click();
    const afterUndo = JSON.parse(document.getElementById('ed-json').value).length;
    document.getElementById('ed-clear').click();
    const afterClear = JSON.parse(document.getElementById('ed-json').value).length;
    return { afterUndo, afterClear };
  });
  expect(r.afterUndo).toBe(1);
  expect(r.afterClear).toBe(0);
});

test('polygon mode: draw vertices, finish, export ring', async ({ page }) => {
  await page.addInitScript(() => { try { localStorage.clear(); } catch (e) {} });
  await page.goto('?lang=en&editor=1');
  await page.waitForSelector('#editor-panel');
  await page.waitForFunction(() => typeof map !== 'undefined');
  const r = await page.evaluate(async () => {
    map.setView([32.0, 34.9], 11);
    document.querySelector('input[name=ed-m][value=polygon]').click();
    map.fire('click', { latlng: L.latLng(32.0, 34.8) });
    map.fire('click', { latlng: L.latLng(32.1, 34.8) });
    map.fire('click', { latlng: L.latLng(32.1, 34.9) });
    const beforeFinish = JSON.parse(document.getElementById('ed-json').value).length;
    document.getElementById('ed-finish').click();
    const out = JSON.parse(document.getElementById('ed-json').value);
    const stored = JSON.parse(localStorage.getItem('navaid.editor.polys') || '[]');
    return { beforeFinish, out, stored: stored.length };
  });
  expect(r.beforeFinish).toBe(0);            // not exported until finished
  expect(r.out.length).toBe(1);
  expect(r.out[0].type).toBe('polygon');
  expect(r.out[0].coords.length).toBe(3);
  expect(r.stored).toBe(1);
});

test('polygon undo removes the last vertex, then the last polygon', async ({ page }) => {
  await page.addInitScript(() => { try { localStorage.clear(); } catch (e) {} });
  await page.goto('?lang=en&editor=1');
  await page.waitForSelector('#editor-panel');
  await page.waitForFunction(() => typeof map !== 'undefined');
  page.on('dialog', d => d.accept());
  const r = await page.evaluate(async () => {
    map.setView([32.0, 34.9], 11);
    document.querySelector('input[name=ed-m][value=polygon]').click();
    [[32, 34.8], [32.1, 34.8], [32.1, 34.9], [32.0, 34.9]].forEach(c => map.fire('click', { latlng: L.latLng(c[0], c[1]) }));
    document.getElementById('ed-finish').click();
    const after = JSON.parse(document.getElementById('ed-json').value).length;   // 1 polygon
    document.getElementById('ed-undo').click();                                  // removes the polygon
    const afterUndo = JSON.parse(document.getElementById('ed-json').value).length;
    return { after, afterUndo };
  });
  expect(r.after).toBe(1);
  expect(r.afterUndo).toBe(0);
});
