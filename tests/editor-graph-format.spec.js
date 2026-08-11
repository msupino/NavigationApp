// @ts-check
// The ?editor=1 point export must match the file it is pasted into. Reporting points live
// in <prefix>-route-graph.json under `nodes`, keyed by name — not in the flat array the
// retired *-nav-waypoints.json files used, which is what this exported until now.
//
// Every test here drives the REAL panel (map.fire, marker.fire, #ed-load, #ed-json) rather
// than reimplementing json()'s merge logic inline. A hand-copied reimplementation cannot
// catch a regression in the code it claims to guard -- it only proves the copy still agrees
// with itself.
const { test, expect } = require('./_setup');

async function boot(page) {
  await page.addInitScript(() => { try { localStorage.clear(); } catch (e) {} });
  await page.goto('?lang=en&editor=1');
  await page.waitForSelector('#editor-panel');
  await page.waitForFunction(() => typeof map !== 'undefined' && typeof layers !== 'undefined');
}

test('Load known + drag: the real export is a nodes map with fields riding through', async ({ page }) => {
  await boot(page);
  page.on('dialog', d => d.accept());
  await page.evaluate(() => {
    for (const n in layers) if (map.hasLayer(layers[n])) map.removeLayer(layers[n]);
    map.addLayer(layers['CVFR']);
  });
  await page.click('#ed-load');
  await page.waitForFunction(() => Object.keys(JSON.parse(document.getElementById('ed-json').value).nodes || {}).length > 100);

  const out = await page.evaluate(async () => {
    const g = await routeGraphData('cvfr');
    const src = g.nodes.SFAIM;
    // Drag SFAIM's loaded marker -- exercises the exact path the review flagged: a loaded
    // point's `_node` riding through json() while only position is edited.
    let mk = null;
    map.eachLayer(l => {
      if (l instanceof L.Marker && l.options.draggable && l.getTooltip &&
          l.getTooltip() && l.getTooltip().getContent() === 'SFAIM') mk = l;
    });
    mk.setLatLng(L.latLng(src.lat + 0.001, src.lng));
    mk.fire('dragend', { target: mk });
    const nodes = JSON.parse(document.getElementById('ed-json').value).nodes;
    return { emitted: nodes, source: src };
  });

  // Shape: a `nodes` object keyed by name, not the retired flat array.
  expect(Array.isArray(out.emitted)).toBe(false);
  const n = out.emitted.SFAIM;
  expect(n).toBeTruthy();

  // Ride-through: every field the editor does not edit survives. Dropping these on
  // paste-back would have silently removed comm-change points and layer membership.
  for (const k of ['code', 'en', 'he', 'kind', 'layers', 'report']) {
    expect(n[k], k + ' must ride through the export').toEqual(out.source[k]);
  }
  if (out.source.commChange !== undefined) expect(n.commChange).toEqual(out.source.commChange);
  if (out.source.callSigns !== undefined) expect(n.callSigns).toEqual(out.source.callSigns);

  // ...and the edit itself landed.
  expect(n.lat).toBeCloseTo(out.source.lat + 0.001, 4);
});

test('a node built by the editor satisfies the graph validator', async ({ page }) => {
  await boot(page);
  page.on('dialog', d => d.accept('TESTX'));
  const n = await page.evaluate(async () => {
    map.setView([32.1, 34.9], 11);
    map.fire('click', { latlng: L.latLng(32.1, 34.9) });
    let mk = null;
    map.eachLayer(l => { if (l instanceof L.Marker && l.options.draggable) mk = l; });
    mk.fire('click', {});
    await new Promise(r => setTimeout(r, 30));
    return Object.values(JSON.parse(document.getElementById('ed-json').value).nodes || {})[0];
  });
  // route-graph.spec.js requires he, and en or code -- a brand-new point (no _node to ride
  // through) has to synthesise a record the validator accepts.
  expect(n.he).toBeFalsy();          // the editor does not prompt for Hebrew -- absent, not invented
  expect(n.en || n.code).toBeTruthy();
  expect(n.layers).toContain('cvfr');
  expect(n.kind).toBe('waypoint');
  expect(n.name).toBe('TESTX');
});

test('two points named alike are refused at the rename prompt, not silently merged', async ({ page }) => {
  await boot(page);
  // First point: named SFAIM without incident.
  page.once('dialog', d => d.accept('SFAIM'));
  await page.evaluate(() => {
    map.setView([32.0, 34.9], 11);
    map.fire('click', { latlng: L.latLng(32.00, 34.80) });
  });
  await page.evaluate(async () => {
    let mk = null;
    map.eachLayer(l => { if (l instanceof L.Marker && l.options.draggable) mk = l; });
    mk.fire('click', {});
    await new Promise(r => setTimeout(r, 30));
  });

  // Second point: try to name it SFAIM too. The rename prompt must refuse via alert(),
  // not silently let the export collapse two records into one.
  const dialogs = [];
  page.on('dialog', d => { dialogs.push(d.type()); d.accept(d.type() === 'prompt' ? 'SFAIM' : undefined); });
  await page.evaluate(() => { map.fire('click', { latlng: L.latLng(32.10, 34.90) }); });
  const out = await page.evaluate(async () => {
    let mk = null;
    map.eachLayer(l => {
      if (l instanceof L.Marker && l.options.draggable &&
          (!l.getTooltip || !l.getTooltip())) mk = l;   // the still-unnamed second marker
    });
    mk.fire('click', {});
    await new Promise(r => setTimeout(r, 30));
    return JSON.parse(document.getElementById('ed-json').value).nodes;
  });

  expect(dialogs).toContain('alert');                 // the collision was refused, audibly
  expect(Object.keys(out)).not.toContain('SFAIM__DUP2');  // refused at the prompt: no
                                                           // collision ever reached the export
  const names = Object.values(out).map(n => n.name).filter(Boolean);
  expect(names.filter(x => x === 'SFAIM').length).toBe(1);   // exactly one SFAIM, not merged, not doubled
});

test('a dragged point survives reload even though the write is debounced', async ({ page }) => {
  // Clear once (first nav only) so the reload below keeps what beforeunload just flushed --
  // boot()'s plain addInitScript would otherwise wipe localStorage on the reload too.
  await page.addInitScript(() => {
    try { if (!sessionStorage.getItem('_edInit')) { localStorage.clear(); sessionStorage.setItem('_edInit', '1'); } } catch (e) {}
  });
  await page.goto('?lang=en&editor=1');
  await page.waitForSelector('#editor-panel');
  await page.waitForFunction(() => typeof map !== 'undefined');
  await page.evaluate(() => {
    map.setView([32.0, 34.9], 11);
    map.fire('click', { latlng: L.latLng(32.10, 34.80) });
    let mk = null;
    map.eachLayer(l => { if (l instanceof L.Marker && l.options.draggable) mk = l; });
    mk.setLatLng(L.latLng(32.15, 34.85));
    mk.fire('dragend', { target: mk });
  });
  // Reload immediately -- inside the 400ms debounce window, before the timer would have
  // fired on its own. The beforeunload flush is what must save it.
  await page.reload();
  await page.waitForSelector('#editor-panel');
  const p = await page.evaluate(() =>
    Object.values(JSON.parse(document.getElementById('ed-json').value).nodes || {})[0]);
  expect(p).toMatchObject({ lat: 32.15, lng: 34.85 });
});
