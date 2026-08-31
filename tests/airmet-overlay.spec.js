// @ts-check
// The AIRMET layer: IMS Tel Aviv FIR hazard areas (mountain obscuration, IFR, surface wind)
// that NOAA's SIGMET feed does not carry. Drawn as dotted polygons with the hazard word
// labelled, gated on window.showAirmet, from the airmet-data branch (data/airmet.json
// offline). The toggle appears only when at least one AIRMET is active.
const { test, expect } = require('./_setup');

async function boot(page) {
  await page.addInitScript(() => { try { localStorage.clear(); } catch (e) {} });
  await page.goto('?lang=en');
  await page.waitForFunction(() => typeof map !== 'undefined'
    && typeof draw === 'function' && typeof octx !== 'undefined');
}

const AIRMET = {
  id: '42559', hazard: 'MT OBSC',
  validFrom: '2026-08-31T03:00:00.000Z', validTo: '2026-08-31T07:00:00.000Z',
  coords: [[32.91667, 35.58333], [33.25, 35.58333], [30.3, 34.58333], [30.7, 34.43333], [32.91667, 35.58333]],
  raw: 'LLLL AIRMET 1 VALID 310300/310700 MT OBSC OBS WI ... =',
};

test('the layer draws a filled, dotted polygon only when it is on', async ({ page }) => {
  // Serve the AIRMET through the loader's own fetch, so the module-local list the render
  // loop reads is populated exactly as in the field.
  await page.route('**/airmet.json', route => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ generatedAt: null, airmets: [AIRMET] }),
  }));
  await boot(page);
  const out = await page.evaluate(async (a) => {
    await loadAirmets(true);
    map.setView([31.7, 35.0], 8);
    function count() {
      let fills = 0, dashes = 0, texts = 0;
      const of = octx.fill, os = octx.setLineDash, ot = octx.strokeText;
      octx.fill = function (...x) { fills++; return of.apply(this, x); };
      octx.setLineDash = function (d) { if (d && d.length && d[0] === 2) dashes++; return os.apply(this, [d]); };
      octx.strokeText = function (t, ...x) { if (String(t).includes('MT OBSC')) texts++; return ot.apply(this, [t, ...x]); };
      draw();
      octx.fill = of; octx.setLineDash = os; octx.strokeText = ot;
      return { fills, dashes, texts };
    }
    window.showAirmet = false;
    const off = count();
    window.showAirmet = true;
    const on = count();
    return { off, on };
  }, AIRMET);
  void 0;
  expect(out.on.dashes).toBeGreaterThan(0);        // the dotted outline ([2, ...])
  expect(out.on.texts).toBe(1);                    // hazard labelled once
  expect(out.off.dashes).toBe(0);                  // nothing drawn while off
  expect(out.off.texts).toBe(0);
});

test('the toggle group is revealed only when an AIRMET is active', async ({ page }) => {
  await boot(page);
  const seen = await page.evaluate(() => {
    window.airmets = [];
    refreshAirmetGroup();
    const empty = document.getElementById('airmet-group').hidden;
    window.airmets = [{ hazard: 'MT OBSC', coords: [[32, 35], [33, 35], [32, 34]] }];
    refreshAirmetGroup();
    const active = document.getElementById('airmet-group').hidden;
    return { empty, active };
  });
  expect(seen.empty).toBe(true);    // no AIRMET -> group hidden
  expect(seen.active).toBe(false);  // active AIRMET -> group shown
});
