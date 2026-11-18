// @ts-check
// A second reference VOR, like a cockpit's VOR2 receiver: an independent station tuned
// alongside VOR1, shown as its own radial/DME line. Explicit-only -- unlike VOR1 it never
// falls back to the nearest usable station, so it reads only the one tuned.
const { test, expect } = require('./_setup');

async function boot(page, lang) {
  await page.goto('?lang=' + (lang || 'en') + '&nogist');
  await page.waitForFunction(() => typeof vorReadoutText2 === 'function'
    && typeof setReferenceVor2 === 'function' && typeof loadVors === 'function');
  await page.evaluate(async () => { await loadVors(); });
  // Our setters persist to localStorage, which the shared worker carries between tests; start
  // each from a clean slate so one test's tuned station is not another's boot state.
  await page.evaluate(() => {
    try { localStorage.removeItem('navaid.vorRef'); localStorage.removeItem('navaid.vorRef2'); } catch (e) { /* */ }
    window.vorRef = null; window.vorRef2 = null; window.inspectorVorRef = undefined;
  });
}

test('VOR2 is a separate slot: it persists, feeds its own readout, and never clears VOR1', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(() => {
    const v1 = vors.find(v => v.ident === 'BGN') || vors[0];
    const v2 = vors.find(v => v.ident !== v1.ident);
    setReferenceVor(v1.ident);
    setReferenceVor2(v2.ident);
    return {
      vor1: vorRef, vor2: vorRef2,
      stored1: localStorage.getItem('navaid.vorRef'),
      stored2: localStorage.getItem('navaid.vorRef2'),
      tb2: document.getElementById('vor-ref-select-2').value,
      l1: vorReadoutText(v2.lat + 0.1, v2.lng + 0.1),   // VOR1 still answers
      l2: vorReadoutText2(v2.lat + 0.1, v2.lng + 0.1),  // VOR2 answers for its own station
      id1: v1.ident, id2: v2.ident,
    };
  });
  expect(r.vor1).toBe(r.id1);
  expect(r.vor2).toBe(r.id2);
  expect(r.stored2).toBe(r.id2);
  expect(r.tb2).toBe(r.id2);
  expect(r.l2.startsWith(r.id2 + ' ')).toBe(true);
  expect(r.vor1).toBe(r.id1);                           // setting VOR2 left VOR1 alone
});

test('VOR2 is explicit-only: out of range it goes blank, where VOR1 would fall back', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(() => {
    NavAid.tuning.vorReadoutMaxNm = 30;
    const v1 = vors.find(v => v.ident === 'BGN') || vors[0];
    const south = vors.slice().sort((a, b) => a.lat - b.lat)[0];
    setReferenceVor(v1.ident);
    setReferenceVor2(v1.ident);
    // A point near the southern VOR but far from the tuned one (BGN), past the 30 NM cap.
    return {
      vor1: vorReadoutText(south.lat + 0.05, south.lng),   // falls back to the nearest in range
      vor2: vorReadoutText2(south.lat + 0.05, south.lng),  // no fallback -> blank
      south: south.ident, ref: v1.ident,
    };
  });
  // VOR2 shows nothing when its own station is out of range...
  expect(r.vor2).toBe('');
  // ...while VOR1, from the same spot, still names the nearest usable station (when distinct).
  if (r.south !== r.ref) expect(r.vor1.startsWith(r.south + ' ')).toBe(true);
});

test('the on-map readout shows both VOR1 and VOR2 lines', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(() => {
    const v1 = vors.find(v => v.ident === 'BGN') || vors[0];
    const v2 = vors.find(v => v.ident !== v1.ident);
    setReferenceVor(v1.ident);
    setReferenceVor2(v2.ident);
    showVorReadout(v1.lat + 0.05, v1.lng + 0.05);
    const box = document.getElementById('vor-readout');
    const lines = Array.from(box.children).map(c => c.textContent);
    return { count: lines.length, lines, has2: !!box.querySelector('.vor-readout-2'),
      id1: v1.ident, id2: v2.ident, shown: box.classList.contains('show') };
  });
  expect(r.shown).toBe(true);
  expect(r.count).toBe(2);
  expect(r.has2).toBe(true);
  expect(r.lines[0].startsWith(r.id1 + ' ')).toBe(true);
  expect(r.lines[1].startsWith(r.id2 + ' ')).toBe(true);
});

test('a VOR station inspector offers both slots; the VOR2 button toggles vorRef2', async ({ page }) => {
  await boot(page);
  await page.evaluate(async () => {
    window.showVorStations = true;
    if (typeof syncVorUI === 'function') syncVorUI();
    draw();
    const v = vors.find(x => x.ident === 'BGN') || vors[0];
    state.selected = { type: 'vor', index: vors.indexOf(v) };
    showInspector();
  });
  const b1 = page.locator('#insp-vor-use-ref');
  const b2 = page.locator('#insp-vor-use-ref-2');
  await b1.waitFor();
  await b2.waitFor();
  const ident = await page.evaluate(() => (vors.find(x => x.ident === 'BGN') || vors[0]).ident);
  await b2.click();
  expect(await page.evaluate(() => vorRef2)).toBe(ident);
  // The label flipped to the active/clear state, and VOR1 is untouched.
  await expect(b2).toContainText('tap to clear');
  expect(await page.evaluate(() => vorRef)).not.toBe(ident);
  await b2.click();                                   // tap again clears VOR2
  expect(await page.evaluate(() => vorRef2)).toBeNull();
});

test('a point inspector shows a VOR2 row with its own radial/DME', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => {
    const v2 = vors.find(v => v.ident === 'BGN') || vors[0];
    setReferenceVor2(v2.ident);
    state.waypoints = [{ lat: v2.lat + 0.1, lng: v2.lng + 0.1, name: 'A' },
                       { lat: v2.lat + 0.2, lng: v2.lng + 0.2, name: 'B' }];
    syncLegs(); draw(); state.selected = { type: 'wp', index: 0 }; showInspector();
  });
  const row2 = page.locator('#inspector .vor-radial-row-2').first();
  await row2.waitFor();
  const txt = await row2.locator('.vor-radial-val').textContent();
  expect(txt).toMatch(/R-\d+° \/ [\d.]+ NM/);
});
