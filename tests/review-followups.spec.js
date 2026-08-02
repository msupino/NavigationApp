// Follow-ups from the code review of main.
const { test, expect } = require('./_setup');

test('a position saved before the per-language split is adopted, not discarded', async ({ page }) => {
  // Pre-split blobs live under the bare key. Every panel used to snap back to its
  // default because only navaid.<key>.<lang> was read.
  await page.addInitScript(() => {
    try {
      localStorage.setItem('navaid.legendPos', JSON.stringify({ x: 240, y: 300 }));
      localStorage.setItem('navaid.inspPos', JSON.stringify({ x: 120, y: 160 }));
    } catch (e) {}
  });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof navLangPosRead === 'function');
  const legend = await page.evaluate(() => {
    const r = document.getElementById('map-legend').getBoundingClientRect();
    return { left: Math.round(r.left), top: Math.round(r.top) };
  });
  expect(legend.left).toBe(240);
  // Adopted into this language's key, with the legacy key left for the other one.
  expect(await page.evaluate(() => localStorage.getItem('navaid.legendPos.en'))).toBeTruthy();
  expect(await page.evaluate(() => localStorage.getItem('navaid.legendPos'))).toBeTruthy();
  // The scoped value wins once it exists.
  await page.evaluate(() => localStorage.setItem('navaid.legendPos.en', JSON.stringify({ x: 400, y: 320 })));
  await page.reload();
  await page.waitForFunction(() => typeof navLangPosRead === 'function');
  const after = await page.evaluate(() => Math.round(document.getElementById('map-legend').getBoundingClientRect().left));
  expect(after).toBe(400);
});

test('each language still adopts the legacy spot independently', async ({ page }) => {
  await page.addInitScript(() => {
    try { localStorage.setItem('navaid.clockPos', JSON.stringify({ x: 300, y: 200 })); } catch (e) {}
  });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof navLangPosRead === 'function');
  expect(await page.evaluate(() => localStorage.getItem('navaid.clockPos.en'))).toBeTruthy();
  await page.goto('?lang=he&nogist');
  await page.waitForFunction(() => typeof navLangPosRead === 'function');
  expect(await page.evaluate(() => localStorage.getItem('navaid.clockPos.he'))).toBeTruthy();
});

test('an exported GPS track imports back into the library', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof downloadGpsTrackJson === 'function');
  const out = await page.evaluate(async () => {
    localStorage.removeItem('navaid.routes');
    const entry = { id: 't1', name: 'Flown 12 Jan', kind: 'gps', savedAt: new Date().toISOString(),
      track: [{ lat: 32.1, lng: 34.9, t: 1 }, { lat: 32.2, lng: 34.95, t: 2 }] };
    let text = null;
    const realCreate = URL.createObjectURL, realClick = HTMLAnchorElement.prototype.click;
    URL.createObjectURL = b => { window.__b = b; return 'blob:stub'; };
    HTMLAnchorElement.prototype.click = function () {};
    try { downloadGpsTrackJson(entry); text = await window.__b.text(); }
    finally { URL.createObjectURL = realCreate; HTMLAnchorElement.prototype.click = realClick; }
    let alerted = null;
    const realAlert = window.alert;
    window.alert = m => { alerted = m; };
    try {
      load(new File([text], 'track.json', { type: 'application/json' }));
      await new Promise(r => setTimeout(r, 300));
    } finally { window.alert = realAlert; }
    const stored = JSON.parse(localStorage.getItem('navaid.routes') || '[]');
    return { isArray: Array.isArray(JSON.parse(text)), alerted, n: stored.length,
             kind: stored[0] && stored[0].kind, pts: stored[0] && stored[0].track.length };
  });
  expect(out.isArray).toBe(true);
  expect(out.alerted).toBeNull();          // no "root.waypoints: missing"
  expect(out.n).toBe(1);
  expect(out.kind).toBe('gps');
  expect(out.pts).toBe(2);
});

test('the track export says so instead of silently doing nothing', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof loadRouteLibrary === 'function');
  const out = await page.evaluate(() => {
    // A track is shown but the library cannot produce it.
    window.shownTracks = [{ id: 'gone', name: 'Ghost', points: [], color: '#fff' }];
    localStorage.removeItem('navaid.routes');
    let alerted = null, downloaded = false;
    const realAlert = window.alert, realCreate = URL.createObjectURL;
    window.alert = m => { alerted = m; };
    URL.createObjectURL = () => { downloaded = true; return 'blob:stub'; };
    try {
      const sel = document.getElementById('export-select');
      sel.value = 'json-track';
      sel.onchange({ target: sel });
    } finally { window.alert = realAlert; URL.createObjectURL = realCreate; }
    return { alerted, downloaded };
  });
  expect(out.downloaded).toBe(false);
  expect(out.alerted).toBeTruthy();
});

test('with several tracks shown the export names the one it writes', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof loadRouteLibrary === 'function');
  const out = await page.evaluate(() => {
    const mk = (id, name) => ({ id, name, kind: 'gps', savedAt: new Date().toISOString(),
      track: [{ lat: 32, lng: 34.9, t: 1 }, { lat: 32.1, lng: 34.95, t: 2 }] });
    localStorage.setItem('navaid.routes', JSON.stringify([mk('a', 'First'), mk('b', 'Second')]));
    window.shownTracks = [{ id: 'a', name: 'First' }, { id: 'b', name: 'Second' }];
    let asked = null, downloaded = false;
    const realConfirm = window.confirm, realCreate = URL.createObjectURL;
    const realClick = HTMLAnchorElement.prototype.click;
    window.confirm = m => { asked = m; return true; };
    URL.createObjectURL = () => { downloaded = true; return 'blob:stub'; };
    HTMLAnchorElement.prototype.click = function () {};
    try {
      const sel = document.getElementById('export-select');
      sel.value = 'json-track';
      sel.onchange({ target: sel });
    } finally {
      window.confirm = realConfirm; URL.createObjectURL = realCreate;
      HTMLAnchorElement.prototype.click = realClick;
    }
    return { asked, downloaded };
  });
  expect(out.asked).toContain('Second');   // the track actually written is named
  expect(out.downloaded).toBe(true);
});

test('the search panel position is read once, not on every toolbar resize', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof searchDocked === 'function');
  const reads = await page.evaluate(async () => {
    let n = 0;
    const real = Storage.prototype.getItem;
    Storage.prototype.getItem = function (k) { if (/searchPos/.test(k)) n++; return real.call(this, k); };
    try {
      // Force several toolbar resizes.
      const tb = document.getElementById('toolbar');
      for (const w of ['300px', '320px', '340px', '360px']) { tb.style.width = w; await new Promise(r => setTimeout(r, 40)); }
      tb.style.width = '';
      await new Promise(r => setTimeout(r, 80));
    } finally { Storage.prototype.getItem = real; }
    return n;
  });
  expect(reads).toBe(0);
});
