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
