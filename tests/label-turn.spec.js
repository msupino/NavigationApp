// @ts-check
// Asked: on a route that turns -- Haifa south to Hadera, then east to Rosh Pina -- NavAid's labels
// read upright only where the route runs north: "select area and rotate all text inside that
// area", our labels, not the chart's printed text. Edit -> Turn labels: drag a box, pick the angle.
const { test, expect } = require('./_setup');

// Every piece of text drawn on the canvas, with the angle it was drawn at.
async function boot(page, lang) {
  await page.addInitScript(() => {
    window.__texts = [];
    const orig = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function (text, x, y, w) {
      if (window.__logTexts) {
        const m = this.getTransform();
        window.__texts.push({ text: String(text), deg: Math.round(Math.atan2(m.b, m.a) * 180 / Math.PI) });
      }
      return w === undefined ? orig.call(this, text, x, y) : orig.call(this, text, x, y, w);
    };
    try { localStorage.setItem('navaid.tourSeen', '1'); } catch (e) {}
  });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`?lang=${lang || 'en'}&nogist`);
  await page.waitForFunction(() => typeof draw === 'function' && typeof window.labelTurnPick === 'function');
  await page.evaluate(() => {
    document.getElementById('boot-loading')?.remove();
    // Haifa -> Hadera (south), Hadera -> Rosh Pina (north-east, mostly east).
    state.waypoints = [{ lat: 32.81, lng: 35.04, name: 'HAIFAX' }, { lat: 32.44, lng: 34.92, name: 'HADERX' },
                       { lat: 32.98, lng: 35.57, name: 'ROSHPX' }];
    syncLegs(); map.setView([32.7, 35.2], 9, { animate: false }); draw();
  });
}
// The angle each name was drawn at in the last draw.
const angles = (page) => page.evaluate(() => {
  window.__texts = []; window.__logTexts = true; draw(); window.__logTexts = false;
  const out = {};
  for (const t of window.__texts) if (/^(HAIFAX|HADERX|ROSHPX)$/.test(t.text)) out[t.text] = ((t.deg % 360) + 360) % 360;
  return out;
});
// A box of the given screen size around a waypoint.
const boxAround = (page, i, deg) => page.evaluate(([i, deg]) => {
  const p = map.latLngToContainerPoint([state.waypoints[i].lat, state.waypoints[i].lng]);
  const pts = [[p.x - 70, p.y - 40], [p.x + 70, p.y - 40], [p.x + 70, p.y + 40], [p.x - 70, p.y + 40]]
    .map(([x, y]) => { const ll = map.containerPointToLatLng([x, y]); return [ll.lat, ll.lng]; });
  state.labelTurns = [{ pts, deg }]; draw();
}, [i, deg]);

test('text inside a box turns by its angle; text outside stays upright', async ({ page }) => {
  await boot(page);
  const before = await angles(page);
  expect(before.HADERX).toBe(0);
  await boxAround(page, 1, 180);
  const a = await angles(page);
  expect(a.HADERX).toBe(180);
  expect(a.HAIFAX).toBe(0);
  expect(a.ROSHPX).toBe(0);
  await boxAround(page, 1, 270);
  expect((await angles(page)).HADERX).toBe(270);
});

test('"along the leg" faces the leg that runs through the box', async ({ page }) => {
  await boot(page);
  // A box on the middle of the second leg (Hadera -> Rosh Pina): a waypoint name is put there
  // to read, so the box is around a point on that leg.
  const deg = await page.evaluate(() => {
    const a = map.latLngToContainerPoint([32.44, 34.92]), b = map.latLngToContainerPoint([32.98, 35.57]);
    const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const poly = [[m.x - 40, m.y - 40], [m.x + 40, m.y - 40], [m.x + 40, m.y + 40], [m.x - 40, m.y + 40]].map(([x, y]) => ({ x, y }));
    return { got: labelTurnLegDeg(poly), want: Math.round(Math.atan2(b.x - a.x, a.y - b.y) * 180 / Math.PI) };
  });
  expect(deg.got).toBe(deg.want);
  expect(deg.got).toBeGreaterThan(20);       // north-east, not north
  expect(deg.got).toBeLessThan(80);
});

test('the boxes are saved with the route, come back with it, and undo', async ({ page }) => {
  await boot(page);
  await boxAround(page, 1, 180);
  const saved = await page.evaluate(() => { persist(); return serializeRoute(); });
  expect(saved.labelTurns.length).toBe(1);
  expect(saved.labelTurns[0].deg).toBe(180);
  expect(saved.labelTurns[0].pts.length).toBe(4);
  // Loaded back into an empty app: the box with it; junk is dropped, not guessed at.
  const back = await page.evaluate((d) => {
    state.labelTurns = [];
    applyRouteData(Object.assign({}, d, { labelTurns: d.labelTurns.concat([{ pts: [[1, 2]], deg: 180 }, { pts: d.labelTurns[0].pts, deg: 45 }]) }));
    return state.labelTurns;
  }, saved);
  expect(back.length).toBe(1);
  expect(back[0].deg).toBe(180);
  // A new route starts with none.
  expect(await page.evaluate(() => sanitizeLabelTurns('nonsense'))).toEqual([]);
});

test('the tool: drag a box, pick an angle; tap it to change or remove it; it adds no waypoint', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => { state.labelTurns = []; setMode('turn'); });
  const n = await page.evaluate(() => state.waypoints.length);
  const p = await page.evaluate(() => { const q = map.latLngToContainerPoint([32.44, 34.92]); const r = map.getContainer().getBoundingClientRect(); return { x: r.left + q.x, y: r.top + q.y }; });
  await page.mouse.move(p.x - 60, p.y - 40);
  await page.mouse.down();
  await page.mouse.move(p.x + 60, p.y + 40, { steps: 6 });
  await page.mouse.up();
  await expect(page.locator('.label-turn-modal')).toBeVisible();
  await page.locator('.label-turn-choice[data-deg="180"]').click();
  expect(await page.evaluate(() => state.labelTurns.map(t => t.deg))).toEqual([180]);
  expect((await angles(page)).HADERX).toBe(180);
  expect(await page.evaluate(() => state.waypoints.length)).toBe(n);
  // A tap inside it: the same choices, the current one marked, and Remove.
  await page.mouse.click(p.x, p.y);
  await expect(page.locator('.label-turn-choice.is-current')).toHaveAttribute('data-deg', '180');
  await page.locator('.label-turn-remove').click();
  expect(await page.evaluate(() => state.labelTurns.length)).toBe(0);
  expect(await page.evaluate(() => state.waypoints.length)).toBe(n);
  // Escape leaves the tool, like Add and Note.
  await page.keyboard.press('Escape');
  expect(await page.evaluate(() => state.mode)).toBe(null);
});

// The figures in a leg box sit in narrow cells along the leg: turned 90° they spilt across their
// neighbours. Inside a box they only flip -- as drawn or 180° -- never across their cell.
test('a leg box keeps its figures along its cells', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(() => {
    state.waypoints = [{ lat: 32.44, lng: 34.92, name: 'WESTPT' }, { lat: 32.44, lng: 35.40, name: 'EASTPT' }];
    syncLegs(); for (const l of state.legs) { l.flightSpeed = 90; l.inboundAltitude = 2000; }
    map.fitBounds([[32.30, 34.85], [32.58, 35.47]], { animate: false });
    const read = () => { window.__texts = []; window.__logTexts = true; draw(); window.__logTexts = false;
      const t = window.__texts.find(x => x.text === '2000'); return t ? ((t.deg % 360) + 360) % 360 : null; };
    state.labelTurns = []; const before = read();
    const out = { before };
    for (const deg of [90, 180, 270]) {
      state.labelTurns = [{ pts: [[32.6, 34.8], [32.6, 35.5], [32.3, 35.5], [32.3, 34.8]], deg }];
      out[deg] = read();
    }
    return out;
  });
  expect(r.before).not.toBe(null);
  for (const deg of [90, 180, 270]) expect([r.before, (r.before + 180) % 360]).toContain(r[deg]);
  // 90° right and 90° left read opposite ways along the cell.
  expect(r[90]).not.toBe(r[270]);
});
