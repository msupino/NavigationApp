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
    map.fire('click', { latlng: L.latLng(32.10, 34.80) });   // default type = on-request
    // switch type then add another
    document.querySelector('input[name=ed-t][value=mandatory]').click();
    map.fire('click', { latlng: L.latLng(32.20, 34.95) });
    const json = JSON.parse(document.getElementById('ed-json').value);
    const stored = JSON.parse(localStorage.getItem('navaid.editor.points') || '[]');
    return { json, count: document.getElementById('ed-count').textContent, stored: stored.length };
  });
  expect(out.json.length).toBe(2);
  expect(out.json[0]).toMatchObject({ lat: 32.1, lng: 34.8, report: 'onRequest' });
  expect(out.json[1]).toMatchObject({ lat: 32.2, lng: 34.95, report: 'mandatory' });
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

test('clicking a point marker names it (applied to JSON)', async ({ page }) => {
  await page.addInitScript(() => { try { localStorage.clear(); } catch (e) {} });
  await page.goto('?lang=en&editor=1');
  await page.waitForSelector('#editor-panel');
  await page.waitForFunction(() => typeof map !== 'undefined');
  page.on('dialog', d => d.accept('SFAIM'));     // prompt → enter a name
  const r = await page.evaluate(async () => {
    map.setView([32.0, 34.9], 11);
    map.fire('click', { latlng: L.latLng(32.0, 34.8) });
    let mk = null;
    map.eachLayer(l => { if (l instanceof L.Marker && l.options.draggable) mk = l; });
    mk.fire('click', {});
    await new Promise(r => setTimeout(r, 30));
    return JSON.parse(document.getElementById('ed-json').value)[0];
  });
  expect(r.name).toBe('SFAIM');
});

test('unnamed point markers flash; naming stops the flash', async ({ page }) => {
  await page.addInitScript(() => { try { localStorage.clear(); } catch (e) {} });
  await page.goto('?lang=en&editor=1');
  await page.waitForSelector('#editor-panel');
  await page.waitForFunction(() => typeof map !== 'undefined');
  await page.evaluate(() => { map.setView([32.0, 34.9], 11); map.fire('click', { latlng: L.latLng(32.0, 34.8) }); });
  await expect(page.locator('.editor-flash')).toHaveCount(1);     // unnamed → flashing
  page.on('dialog', d => d.accept('NAMED'));
  await page.evaluate(async () => {
    let mk = null; map.eachLayer(l => { if (l instanceof L.Marker && l.options.draggable) mk = l; });
    mk.fire('click', {}); await new Promise(r => setTimeout(r, 30));
  });
  await expect(page.locator('.editor-flash')).toHaveCount(0);     // named → static
});

test('Load known (polygon mode) imports the shipped LSA bubbles for naming', async ({ page }) => {
  await page.addInitScript(() => { try { localStorage.clear(); } catch (e) {} });
  await page.goto('?lang=en&editor=1');
  await page.waitForSelector('#editor-panel');
  await page.waitForFunction(() => typeof layers !== 'undefined');
  page.on('dialog', d => d.accept());
  await page.evaluate(() => {
    for (const n in layers) if (map.hasLayer(layers[n])) map.removeLayer(layers[n]);
    map.addLayer(layers['Low Alt']);
    document.querySelector('input[name=ed-m][value=polygon]').click();   // polygon mode → Load known = areas
  });
  await page.click('#ed-load');
  await page.waitForFunction(() => JSON.parse(document.getElementById('ed-json').value).length >= 26);
  const out = await page.evaluate(() => {
    const j = JSON.parse(document.getElementById('ed-json').value);
    const stored = JSON.parse(localStorage.getItem('navaid.editor.polys') || '[]');
    const lsa = stored.filter(p => (p.layer || '') === 'Low Alt');
    return { n: j.length, type: j[0].type, coords: j[0].coords.length,
      storedLsa: lsa.length, fields: ('name' in lsa[0]) && ('en' in lsa[0]) && ('he' in lsa[0]) };
  });
  expect(out.n).toBeGreaterThanOrEqual(26);     // all shipped bubbles imported
  expect(out.type).toBe('polygon');
  expect(out.coords).toBeGreaterThanOrEqual(3);
  expect(out.storedLsa).toBeGreaterThanOrEqual(26);
  expect(out.fields).toBe(true);                // name/en/he present → clickable to set
});

test('polygon naming sets active type — weekend exported, always omitted', async ({ page }) => {
  await page.addInitScript(() => { try { localStorage.clear(); } catch (e) {} });
  await page.goto('?lang=en&editor=1');
  await page.waitForSelector('#editor-panel');
  await page.waitForFunction(() => typeof layers !== 'undefined');
  const answers = ['WK', 'WkEn', 'WkHe', 'weekend'];   // name, en, he, active prompts (in order)
  let di = 0;
  page.on('dialog', d => { d.accept(answers[Math.min(di, answers.length - 1)]); di++; });
  await page.evaluate(() => {
    for (const n in layers) if (map.hasLayer(layers[n])) map.removeLayer(layers[n]);
    map.addLayer(layers['Low Alt']);
    document.querySelector('input[name=ed-m][value=polygon]').click();
  });
  await page.click('#ed-load');
  await page.waitForFunction(() => JSON.parse(document.getElementById('ed-json').value).length >= 26);
  // loaded bubbles default to 'always' → the field is omitted from the export.
  expect(await page.evaluate(() => JSON.parse(document.getElementById('ed-json').value).some(o => 'active' in o))).toBe(false);
  // click one polygon (editor polys use fillOpacity 0.12) → the 4 prompts set it weekend.
  await page.evaluate(async () => {
    let poly = null; map.eachLayer(l => { if (!poly && l instanceof L.Polygon && l.options.fillOpacity === 0.12) poly = l; });
    poly.fire('click', {});
    await new Promise(r => setTimeout(r, 60));
  });
  const out = await page.evaluate(() => JSON.parse(document.getElementById('ed-json').value));
  expect(out.some(o => o.active === 'weekend')).toBe(true);     // named one is weekend
  expect(out.filter(o => o.active === 'weekend').length).toBe(1);
});

test('Load known (polygon mode) refuses on a layer with no areas file (CVFR)', async ({ page }) => {
  await page.addInitScript(() => { try { localStorage.clear(); } catch (e) {} });
  await page.goto('?lang=en&editor=1');
  await page.waitForSelector('#editor-panel');
  await page.waitForFunction(() => typeof layers !== 'undefined');
  const alerts = [];
  page.on('dialog', d => { alerts.push(d.message()); d.accept(); });
  await page.evaluate(() => {
    for (const n in layers) if (map.hasLayer(layers[n])) map.removeLayer(layers[n]);
    map.addLayer(layers['CVFR']);
    document.querySelector('input[name=ed-m][value=polygon]').click();
  });
  await page.click('#ed-load');
  await expect.poll(() => alerts.some(m => /No known LSA areas/i.test(m))).toBe(true);
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('navaid.editor.polys') || '[]').length);
  expect(stored).toBe(0);          // nothing imported on a non-area layer
});

test('Load known works on the Helicopters layer', async ({ page }) => {
  await page.addInitScript(() => { try { localStorage.clear(); } catch (e) {} });
  await page.goto('?lang=en&editor=1');
  await page.waitForSelector('#editor-panel');
  await page.waitForFunction(() => typeof layers !== 'undefined');
  let alerted = false;
  page.on('dialog', d => { if (d.type() === 'alert') alerted = true; d.accept(); });
  await page.evaluate(() => { for (const n in layers) if (map.hasLayer(layers[n])) map.removeLayer(layers[n]); map.addLayer(layers['Helicopters']); });
  await page.click('#ed-load');
  await page.waitForFunction(() => JSON.parse(document.getElementById('ed-json').value).length > 100);
  const n = await page.evaluate(() => JSON.parse(document.getElementById('ed-json').value).length);
  expect(n).toBeGreaterThan(150);     // ~205 heli points
  expect(alerted).toBe(false);        // no "no known set" alert
});

test('shift-clicking a point marker deletes it instantly (no prompt)', async ({ page }) => {
  await page.addInitScript(() => { try { localStorage.clear(); } catch (e) {} });
  await page.goto('?lang=en&editor=1');
  await page.waitForSelector('#editor-panel');
  await page.waitForFunction(() => typeof map !== 'undefined');
  let prompted = false;
  page.on('dialog', d => { prompted = true; d.dismiss(); });
  const n = await page.evaluate(async () => {
    map.setView([32.0, 34.9], 11);
    map.fire('click', { latlng: L.latLng(32.0, 34.8) });
    let mk = null;
    map.eachLayer(l => { if (l instanceof L.Marker && l.options.draggable) mk = l; });
    mk.fire('click', { originalEvent: { shiftKey: true } });
    await new Promise(r => setTimeout(r, 30));
    return JSON.parse(document.getElementById('ed-json').value).length;
  });
  expect(n).toBe(0);           // deleted
  expect(prompted).toBe(false); // without any prompt
});

test('Load known refuses to import when the base layer changes mid-fetch', async ({ page }) => {
  await page.addInitScript(() => { try { localStorage.clear(); } catch (e) {} });
  await page.goto('?lang=en&editor=1');
  await page.waitForSelector('#editor-panel');
  await page.waitForFunction(() => typeof layers !== 'undefined' && typeof fetchLayerData === 'function');
  const alerts = [];
  page.on('dialog', d => { alerts.push(d.message()); d.accept(); });
  await page.evaluate(() => {
    for (const k in layers) if (map.hasLayer(layers[k])) map.removeLayer(layers[k]);
    map.addLayer(layers['Low Alt']);
    // Simulate a mid-fetch layer switch: fetchLayerData follows the active
    // layer by design, so it resolves with heli data — the guard must refuse
    // to tag those points as Low Alt.
    window.fetchLayerData = () => {
      for (const k in layers) if (map.hasLayer(layers[k])) map.removeLayer(layers[k]);
      map.addLayer(layers['Helicopters']);
      return Promise.resolve({ data: { points: [{ lat: 32.0, lng: 34.8, name: 'X' }] }, prefix: 'heli' });
    };
  });
  await page.click('#ed-load');
  await expect.poll(() => alerts.some(m => /Layer changed/i.test(m))).toBe(true);
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('navaid.editor.points') || '[]').length);
  expect(stored).toBe(0);      // nothing imported under the wrong layer tag
});
