// @ts-check
// The leg inspector gives the leg's length, beside its direction: the two read-only facts of the
// line itself, in the flight plan's own form (one decimal, NM).
const { test, expect } = require('./_setup');

for (const lang of ['en', 'he']) {
  test('the leg inspector shows the leg length (' + lang + ')', async ({ page }) => {
    await page.goto('?lang=' + lang + '&nogist');
    await page.waitForFunction(() => typeof showInspector === 'function' && typeof syncLegs === 'function');
    const want = await page.evaluate(() => {
      state.waypoints = [{ lat: 32.18, lng: 34.83, name: 'A' }, { lat: 32.5, lng: 35.0, name: 'B' }, { lat: 32.81, lng: 35.04, name: 'C' }];
      syncLegs(); draw();
      state.selected = { type: 'leg', index: 1 }; showInspector();
      return geo(state.waypoints[1], state.waypoints[2]).dist.toFixed(1) + ' NM';
    });
    const labels = await page.locator('#insp-body .row > label').allTextContents();
    const label = lang === 'he' ? 'אורך קטע' : 'Leg length';
    const dirLabel = lang === 'he' ? 'כיוון' : 'Direction';
    // Direction (magnetic), True track, then the length.
    const trueLabel = lang === 'he' ? 'כיוון אמיתי' : 'True track';
    expect(labels.indexOf(trueLabel)).toBe(labels.indexOf(dirLabel) + 1);
    expect(labels.indexOf(label)).toBe(labels.indexOf(dirLabel) + 2);
    const rowOf = (l) => page.locator('#insp-body .row', { has: page.locator('label', { hasText: new RegExp('^' + l + '$') }) });
    const g = await page.evaluate(() => { const b = geo(state.waypoints[1], state.waypoints[2]).brg;
      return { m: String(toMagnetic(b)).padStart(3, '0') + '°M', t: String(((Math.round(b) % 360) + 360) % 360).padStart(3, '0') + '°T' }; });
    await expect(rowOf(dirLabel)).toContainText(g.m);
    await expect(rowOf(trueLabel)).toContainText(g.t);
    const row = page.locator('#insp-body .row', { has: page.locator('label', { hasText: new RegExp('^' + label + '$') }) });
    await expect(row).toContainText(want);
  });
}

test('a button with a plus glyph shows one plus: the icon, not the glyph too', async ({ page }) => {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof showInspector === 'function' && typeof syncLegs === 'function');
  await page.evaluate(() => {
    state.waypoints = [{ lat: 32.18, lng: 34.83, name: 'A' }, { lat: 32.5, lng: 35.0, name: 'B' }];
    syncLegs(); draw(); state.selected = { type: 'leg', index: 0 }; showInspector();
  });
  const btn = page.locator('#insp-body button', { hasText: 'identification-point' });
  await expect(btn.locator('.mi-icon')).toHaveCount(1);
  expect((await btn.innerText()).trim()).toMatch(/^Add identification-point marker$/);
});

test('time and fuel for the leg match the flight plan, and follow a speed edit', async ({ page }) => {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof showInspector === 'function' && typeof syncLegs === 'function');
  await page.evaluate(() => {
    state.waypoints = [{ lat: 32.18, lng: 34.83, name: 'A' }, { lat: 32.5, lng: 35.0, name: 'B' }, { lat: 32.81, lng: 35.04, name: 'C' }];
    syncLegs(); draw(); state.selected = { type: 'leg', index: 1 }; showInspector();
  });
  const row = page.locator('#insp-body .row.leg-time-fuel');
  const ac = () => 'aircraft || { gph: Number(tune("defaultGph")), taxiGal: Number(tune("defaultTaxiGal")) }';
  const planTime = () => page.evaluate((a) => {
    const prof = routeProfile(eval('(' + a + ')')); const pl = prof.legs[1];
    return toHMS(pl.timeH) + ' · ' + (pl.fuel).toFixed(1) + ' gal';
  }, ac());
  // The figures carry invisible direction isolates (for Hebrew); compare without them.
  const shown = () => row.locator('.val').evaluate(e => e.textContent.replace(/[\u2066-\u2069]/g, ''));
  expect(await shown()).toBe(await planTime());
  // Faster: shorter.
  const speed = page.locator('#insp-body .row input[type=number]').first();
  await speed.fill('120');
  await speed.press('Enter');
  await expect.poll(shown).toBe(await planTime());
  expect(await shown()).not.toContain('--');
});
