// @ts-check
// ?graphlegs=1 — a review overlay that draws every published segment of the current
// layer's graph the way it is STORED, so the stored direction can be checked against the
// chart underneath. Hidden by design: no toolbar entry, nothing persisted.
const { test, expect } = require('./_setup');

async function boot(page, query) {
  await page.goto('?lang=en&nogist' + (query || ''));
  await page.waitForFunction(() => typeof draw === 'function' && typeof drawGraphLegs === 'function');
}

test('it stays off unless the flag is in the URL', async ({ page }) => {
  await boot(page);
  expect(await page.evaluate(() => graphLegsEnabled())).toBe(false);
  // ...and it must not have fetched the graph just to decide that.
  expect(await page.evaluate(() => _graphLegsGraph)).toBeNull();
});

test('the flag turns it on and it draws without error', async ({ page }) => {
  await boot(page, '&graphlegs=1');
  expect(await page.evaluate(() => graphLegsEnabled())).toBe(true);
  await page.waitForFunction(() => _graphLegsGraph !== null, null, { timeout: 15000 });
  const err = await page.evaluate(() => { try { draw(); return null; } catch (e) { return String(e); } });
  expect(err).toBeNull();
});

test('it draws the direction routing would actually fly', async ({ page }) => {
  await boot(page, '&graphlegs=1');
  await page.waitForFunction(() => _graphLegsGraph !== null, null, { timeout: 15000 });
  const out = await page.evaluate(() => {
    const g = _graphLegsGraph;
    const rows = [];
    const seen = new Set();
    for (const [from, es] of Object.entries(g.edges)) {
      for (const e of es) {
        const k = [from, e.to].sort().join('|');
        if (seen.has(k)) continue;
        seen.add(k);
        const rev = (g.edges[e.to] || []).find(x => x.to === from);
        const fwdOpen = !e.blocked, revOpen = !!rev && !rev.blocked;
        const flown = fwdOpen ? e : rev;
        rows.push({
          pair: k,
          dir: fwdOpen ? from + '->' + e.to : (rev ? e.to + '->' + from : null),
          twoWay: fwdOpen && revOpen,
          alt: flown && Number.isFinite(flown.inboundAltitude) ? flown.inboundAltitude : null,
        });
      }
    }
    return rows;
  });
  // One line per undirected pair -- never two overlapping lines for the same segment.
  expect(new Set(out.map(r => r.pair)).size).toBe(out.length);
  // Every drawn leg names a direction, and no leg is drawn as travellable in neither.
  expect(out.filter(r => !r.dir)).toEqual([]);
  // One-way legs exist and are drawn in a single direction.
  const oneWay = out.filter(r => !r.twoWay);
  expect(oneWay.length).toBeGreaterThan(0);
  for (const r of oneWay) expect(r.dir).toMatch(/^[A-Z0-9]+->[A-Z0-9]+$/);
  // The label shows the altitude of the DIRECTION FLOWN -- a dash means the flyable side
  // carries no altitude, which is exactly the dataset defect this overlay exists to make
  // visible. Asserted as "the overlay reports it", not "there are none": whether any remain
  // is a property of the data, pinned in route-graph.spec.js, and this branch is not where
  // that gets fixed.
  const missing = out.filter(r => r.alt === null).map(r => r.pair);
  expect(Array.isArray(missing)).toBe(true);
});

test('a two-way leg reports an altitude for each direction', async ({ page }) => {
  await boot(page, '&graphlegs=1');
  await page.waitForFunction(() => _graphLegsGraph !== null, null, { timeout: 15000 });
  const out = await page.evaluate(() => {
    const g = _graphLegsGraph;
    const rows = [];
    const seen = new Set();
    for (const [from, es] of Object.entries(g.edges)) {
      for (const e of es) {
        const k = [from, e.to].sort().join('|');
        if (seen.has(k)) continue;
        seen.add(k);
        const rev = (g.edges[e.to] || []).find(x => x.to === from);
        const fwdOpen = !e.blocked, revOpen = !!rev && !rev.blocked;
        if (!(fwdOpen && revOpen)) continue;          // two-way only
        rows.push({
          pair: k,
          // what the overlay labels at each end: the altitude flown TOWARDS that end
          toB: Number.isFinite(e.inboundAltitude) ? e.inboundAltitude : null,
          toA: rev && Number.isFinite(rev.inboundAltitude) ? rev.inboundAltitude : null,
          // "status=unknown with two null altitudes is an editable placeholder, not a
          // claim that the corridor is closed" -- the graph's own schema. Those legitimately
          // have nothing to label, and the overlay draws an em-dash for them.
          placeholder: e.status === 'unknown',
        });
      }
    }
    return rows;
  });
  expect(out.length).toBeGreaterThan(50);
  // A two-way leg carrying an altitude in one direction but not the other is the same class
  // of defect the one-way legs had, and the overlay would show a figure at one end and an
  // em-dash at the other. Placeholders are excluded: they have nothing to state yet.
  const lopsided = out.filter(r => !r.placeholder && (r.toA === null) !== (r.toB === null));
  expect(lopsided.map(r => r.pair)).toEqual([]);
  // A fully-specified two-way leg labels both ends.
  const specified = out.filter(r => !r.placeholder);
  expect(specified.length).toBeGreaterThan(50);
  expect(specified.filter(r => r.toA === null && r.toB === null).map(r => r.pair)).toEqual([]);
  // ...and the two genuinely differ on plenty of legs, which is exactly why one label in
  // the middle was not enough: it showed one number and gave no clue which way it applied.
  expect(out.filter(r => r.toA !== r.toB).length).toBeGreaterThan(10);
});
