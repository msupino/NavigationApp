// @ts-check
// Issue #487 — auto-seed a real note near route waypoints that sit on a
// comm-change reporting point.
//
// `seedCommChangeNotes()` (draw.js) is the single unit every placement/snap
// hook calls (drop, drag-end, touch-end, search route-build). It pushes a
// normal `state.notes` entry tagged `cc: <ICAO>` so it is movable / editable /
// deletable and never duplicates (the tag is the idempotency key, and it
// survives reload / export / import). Crucially it is NOT wired into draw() /
// load / import / undo, so a note the user deletes is not resurrected on the
// next repaint.
//
// Reuses the comm-change fixture pattern (page.route stub) so the tests don't
// depend on the shipped dataset's contents.
const { test, expect } = require('./_setup');

const TYONA = { lat: 32.00472, lng: 34.72722, name: 'TYONA' };
const NOTE_LAT_OFFSET = 0;      // keep in sync with commChangeNoteLatOffset
const NOTE_LNG_OFFSET = 0.09;   // keep in sync with commChangeNoteLngOffset

const FIXTURE = {
  version: 1,
  source: 'test fixture',
  callSigns: {
    PLUTO: { label: 'Pluto', he: 'פלוטו', primary: '118.40', secondary: '119.25' },
    HAGAV: { label: 'Hagav', he: 'חגב', primary: '132.70', secondary: '133.45' },
  },
  points: [
    { name: 'TYONA', commChange: true, callSigns: ['PLUTO', 'HAGAV'], to: 'Pluto 118.40' },
    { name: 'SORES', commChange: true },
  ],
};

async function installCommChangeFixture(page, fixture = FIXTURE) {
  await page.route('**/comm-change.json*', route => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify(fixture),
  }));
}

async function boot(page, lang = 'en') {
  await page.addInitScript(() => {
    try {
      for (const k of Object.keys(localStorage)) localStorage.removeItem(k);
      sessionStorage.clear();
      for (const s of ['build', 'view', 'display', 'charts', 'export', 'print'])
        localStorage.setItem('navaid.sec.' + s, '1');
    } catch (e) {}
  });
  await page.goto('?lang=' + lang);
  await page.waitForFunction(() => typeof state !== 'undefined' &&
    typeof window.seedCommChangeNotes === 'function');
  await page.evaluate(() => loadNavWaypoints());
  await page.waitForFunction(() => Array.isArray(window.navWP) && window.navWP.length > 0);
  await page.evaluate(() => loadCommChange());
  await page.waitForFunction(() => window.commChangeMap && window.commChangeMap.TYONA);
  await page.evaluate(() => { window.showCommChange = true; });
  await page.evaluate(t => map.setView([t.lat, t.lng], 11), TYONA);
  await page.evaluate(() => { state.waypoints = []; state.legs = []; state.notes = []; });
}

test.describe('comm-change auto-note (#487)', () => {
  test('seeds one tagged note near a comm-change waypoint', async ({ page }) => {
    await installCommChangeFixture(page);
    await boot(page);
    const notes = await page.evaluate(t => {
      state.waypoints = [{ lat: t.lat, lng: t.lng, name: t.name }];
      syncLegs();
      seedCommChangeNotes();
      return state.notes;
    }, TYONA);
    expect(notes).toHaveLength(1);
    expect(notes[0].cc).toBe('TYONA');
    expect(notes[0].text).toBe('Freq change');
    expect(notes[0].freqName).toBe('PLUTO');
    expect(notes[0].freq).toBe('118.40');
    expect(notes[0].shape).toBe('rect');
    expect(notes[0].color).toBeTruthy();
    // Placed east / right of the dot so the default starts on the right side
    // of the waypoint.
    expect(notes[0].lat).toBeCloseTo(TYONA.lat + NOTE_LAT_OFFSET, 4);
    expect(notes[0].lng).toBeCloseTo(TYONA.lng + NOTE_LNG_OFFSET, 4);
  });

  test('is idempotent — a second seed call adds no duplicate', async ({ page }) => {
    await installCommChangeFixture(page);
    await boot(page);
    const count = await page.evaluate(t => {
      state.waypoints = [{ lat: t.lat, lng: t.lng, name: t.name }];
      syncLegs();
      seedCommChangeNotes();
      seedCommChangeNotes();   // re-snap / re-draw simulation
      return state.notes.length;
    }, TYONA);
    expect(count).toBe(1);
  });

  test('a non-comm-change waypoint seeds nothing', async ({ page }) => {
    await installCommChangeFixture(page);
    await boot(page);
    const count = await page.evaluate(() => {
      state.waypoints = [{ lat: 32.1, lng: 34.9, name: 'NOPEX' }];
      syncLegs();
      seedCommChangeNotes();
      return state.notes.length;
    });
    expect(count).toBe(0);
  });

  test('the seeded note is a real, deletable note that draw() does not resurrect', async ({ page }) => {
    await installCommChangeFixture(page);
    await boot(page);
    const after = await page.evaluate(t => {
      state.waypoints = [{ lat: t.lat, lng: t.lng, name: t.name }];
      syncLegs();
      seedCommChangeNotes();
      const seeded = state.notes.length;
      // User deletes it like any manual note.
      state.notes.splice(0, 1);
      // Repaint — must NOT re-seed (seeding is not wired into draw()).
      draw();
      return { seeded, afterDelete: state.notes.length };
    }, TYONA);
    expect(after.seeded).toBe(1);
    expect(after.afterDelete).toBe(0);
  });

  test('renders a frequency callout with an arrow to the comm-change point', async ({ page }) => {
    await installCommChangeFixture(page);
    await boot(page);
    const out = await page.evaluate(t => {
      state.waypoints = [{ lat: t.lat, lng: t.lng, name: t.name }];
      syncLegs();
      seedCommChangeNotes();
      const g = commCalloutGeom(state.notes[0]);
      const target = proj(state.waypoints[0]);
      const tail = proj(state.notes[0]);
      const lines = noteLines(state.notes[0]);
      const strokeWidths = [];
      const fillTexts = [];
      const fillRects = [];
      const rotations = [];
      let fillCount = 0;
      const axisX = g.tail.x - g.target.x;
      const axisY = g.tail.y - g.target.y;
      const axisLen2 = axisX * axisX + axisY * axisY;
      const along = p => ((p.x - g.target.x) * axisX + (p.y - g.target.y) * axisY) / axisLen2;
      const signedOffset = p => {
        const f = along(p);
        const baseX = g.target.x + axisX * f;
        const baseY = g.target.y + axisY * f;
        return (p.x - baseX) * g.nx + (p.y - baseY) * g.ny;
      };
      const expectedTextRotation = g.textAngle;
      const realStroke = octx.stroke.bind(octx);
      const realFillText = octx.fillText.bind(octx);
      const realFillRect = octx.fillRect.bind(octx);
      const realRotate = octx.rotate.bind(octx);
      const realFill = octx.fill.bind(octx);
      octx.stroke = function () {
        strokeWidths.push(octx.lineWidth);
        return realStroke();
      };
      octx.fillText = function (text, x, y) {
        fillTexts.push(String(text));
        return realFillText(text, x, y);
      };
      octx.fillRect = function (x, y, w, h) {
        fillRects.push({ x, y, w, h });
        return realFillRect(x, y, w, h);
      };
      octx.rotate = function (angle) {
        rotations.push(angle);
        return realRotate(angle);
      };
      octx.fill = function () {
        fillCount += 1;
        return realFill();
      };
      drawNotes();
      octx.stroke = realStroke;
      octx.fillText = realFillText;
      octx.fillRect = realFillRect;
      octx.rotate = realRotate;
      octx.fill = realFill;
      return {
        lines,
        tailDistancePx: Math.hypot(target.x - tail.x, target.y - tail.y),
        tailIsEast: state.notes[0].lng > t.lng,
        arrowWidth: tune('commChangeArrowWidthPx'),
        arrowColor: tune('commChangeArrowColor'),
        arrowLineCap: tune('commChangeArrowLineCap'),
        arrowLineJoin: tune('commChangeArrowLineJoin'),
        arrowMiterLimit: tune('commChangeArrowMiterLimit'),
        arrowHalo: tune('commChangeArrowHaloPx'),
        arrowHaloColor: tune('commChangeArrowHaloColor'),
        arrowHaloAlpha: tune('commChangeArrowHaloAlpha'),
        selectedColor: tune('commChangeSelectedColor'),
        selectedAlpha: tune('commChangeSelectedAlpha'),
        selectedWidthAdd: tune('commChangeSelectedWidthAddPx'),
        arrowBolt: tune('commChangeArrowBoltPx'),
        arrowBoltAngle: tune('commChangeArrowBoltAngleDeg'),
        textColor: tune('commChangeTextColor'),
        textHaloColor: tune('commChangeTextHaloColor'),
        textHaloAlpha: tune('commChangeTextHaloAlpha'),
        textAlong: tune('commChangeTextAlong'),
        textGap: tune('commChangeTextGapPx'),
        nameHaloWidth: tune('commChangeNameHaloWidthPx'),
        freqHaloWidth: tune('commChangeFreqHaloWidthPx'),
        bendFractions: g.bends.map(along),
        bendOffsets: g.bends.map(signedOffset),
        breakSpanPx: Math.hypot(g.bend1.x - g.bend2.x, g.bend1.y - g.bend2.y),
        textRotation: rotations[0],
        expectedTextRotation,
        strokeWidths,
        fillTexts,
        fillRects,
        fillCount,
      };
    }, TYONA);
    expect(out.lines).toEqual(['PLUTO', '118.40']);
    expect(out.tailDistancePx).toBeGreaterThan(60);
    expect(out.tailIsEast).toBe(true);
    expect(out.arrowWidth).toBe(4);
    expect(out.arrowColor).toBe('#000000');
    expect(out.arrowLineCap).toBe('square');
    expect(out.arrowLineJoin).toBe('miter');
    expect(out.arrowMiterLimit).toBe(1);
    expect(out.arrowHalo).toBe(0);
    expect(out.arrowHaloColor).toBe('#fff9d6');
    expect(out.arrowHaloAlpha).toBe(0.92);
    expect(out.selectedColor).toBe('#ffcc33');
    expect(out.selectedAlpha).toBe(0.35);
    expect(out.selectedWidthAdd).toBe(5);
    expect(out.arrowBolt).toBe(15);
    expect(out.arrowBoltAngle).toBe(30);
    expect(out.textColor).toBe('#161412');
    expect(out.textHaloColor).toBe('#fff9d6');
    expect(out.textHaloAlpha).toBe(0.6);
    expect(out.textAlong).toBe(0.88);
    expect(out.textGap).toBe(10);
    expect(out.nameHaloWidth).toBe(0);
    expect(out.freqHaloWidth).toBe(0);
    expect(out.strokeWidths).toContain(4);
    expect(out.bendFractions).toHaveLength(2);
    expect(out.bendFractions[0]).toBeGreaterThan(0.52);
    expect(out.bendFractions[1]).toBeLessThan(0.38);
    expect(out.bendOffsets[0]).toBeCloseTo(7.5, 0);
    expect(out.bendOffsets[1]).toBeCloseTo(-7.5, 0);
    expect(out.breakSpanPx).toBeGreaterThan(30);
    expect(out.textRotation).toBeCloseTo(out.expectedTextRotation, 6);
    expect(out.fillTexts).toContain('PLUTO');
    expect(out.fillTexts).toContain('118.40');
    expect(out.fillRects).toHaveLength(0);
    expect(out.fillCount).toBe(0);
  });

  test('comm-change lightning rotation turns the bend vector around the arrow axis', async ({ page }) => {
    await installCommChangeFixture(page);
    await boot(page);
    const out = await page.evaluate(t => {
      state.waypoints = [{ lat: t.lat, lng: t.lng, name: t.name }];
      syncLegs();
      seedCommChangeNotes();
      const components = angle => {
        setTune('commChangeArrowBoltAngleDeg', angle);
        const g = commCalloutGeom(state.notes[0]);
        const base = {
          x: g.target.x + (g.tail.x - g.target.x) * tune('commChangeArrowBend1Along'),
          y: g.target.y + (g.tail.y - g.target.y) * tune('commChangeArrowBend1Along'),
        };
        const vx = g.bend1.x - base.x;
        const vy = g.bend1.y - base.y;
        return {
          along: vx * g.ux + vy * g.uy,
          perp: vx * g.nx + vy * g.ny,
        };
      };
      return {
        defaultVector: components(90),
        rotatedVector: components(45),
      };
    }, TYONA);
    expect(out.defaultVector.along).toBeCloseTo(0, 1);
    expect(out.defaultVector.perp).toBeCloseTo(15, 0);
    expect(out.rotatedVector.along).toBeCloseTo(15 * Math.SQRT1_2, 0);
    expect(out.rotatedVector.perp).toBeCloseTo(15 * Math.SQRT1_2, 0);
  });

  test('old auto-seeded callouts are moved far enough for a visible arrow', async ({ page }) => {
    await installCommChangeFixture(page);
    await boot(page);
    const out = await page.evaluate(t => {
      state.waypoints = [{ lat: t.lat, lng: t.lng, name: t.name }];
      state.notes = [{
        lat: r5(t.lat + 0.012),
        lng: r5(t.lng),
        text: 'Freq change',
        color: '#fff6aa',
        shape: 'rect',
        cc: 'TYONA',
      }];
      syncLegs();
      const changed = seedCommChangeNotes();
      const target = proj(state.waypoints[0]);
      const tail = proj(state.notes[0]);
      return {
        changed,
        lat: state.notes[0].lat,
        lng: state.notes[0].lng,
        freqName: state.notes[0].freqName,
        freq: state.notes[0].freq,
        tailDistancePx: Math.hypot(target.x - tail.x, target.y - tail.y),
      };
    }, TYONA);
    expect(out.changed).toBe(true);
    expect(out.lat).toBeCloseTo(TYONA.lat + NOTE_LAT_OFFSET, 4);
    expect(out.lng).toBeCloseTo(TYONA.lng + NOTE_LNG_OFFSET, 4);
    expect(out.freqName).toBe('PLUTO');
    expect(out.freq).toBe('118.40');
    expect(out.tailDistancePx).toBeGreaterThan(90);
  });

  test('turning Show/Add Freq Changes on seeds callouts for an existing route', async ({ page }) => {
    await installCommChangeFixture(page);
    await boot(page);
    const out = await page.evaluate(t => {
      window.showCommChange = false;
      document.getElementById('commchange-cb').checked = false;
      state.waypoints = [{ lat: t.lat, lng: t.lng, name: t.name }];
      state.notes = [];
      syncLegs();
      return state.notes.length;
    }, TYONA);
    expect(out).toBe(0);
    await page.locator('#commchange-cb').check();
    await page.waitForFunction(() =>
      state.notes.length === 1 && state.notes[0].cc === 'TYONA' &&
      state.notes[0].freq === '118.40');
    const note = await page.evaluate(() => state.notes[0]);
    expect(note.freqName).toBe('PLUTO');
    expect(note.lat).toBeCloseTo(TYONA.lat + NOTE_LAT_OFFSET, 4);
    expect(note.lng).toBeCloseTo(TYONA.lng + NOTE_LNG_OFFSET, 4);
  });

  test('turning Show/Add Freq Changes off hides existing callout arrows', async ({ page }) => {
    await installCommChangeFixture(page);
    await boot(page);
    const before = await page.evaluate(t => {
      state.waypoints = [{ lat: t.lat, lng: t.lng, name: t.name }];
      state.notes = [];
      syncLegs();
      seedCommChangeNotes();
      state.selected = { type: 'note', index: 0 };
      draw();
      const g = commCalloutGeom(state.notes[0]);
      const painted = [];
      const realStroke = octx.stroke.bind(octx);
      octx.stroke = function () {
        painted.push(octx.lineWidth);
        return realStroke();
      };
      drawNotes();
      octx.stroke = realStroke;
      return {
        noteCount: state.notes.length,
        hit: hitNote(Math.round(g.tail.x), Math.round(g.tail.y)),
        strokes: painted.length,
      };
    }, TYONA);
    expect(before.noteCount).toBe(1);
    expect(before.hit).toBe(0);
    expect(before.strokes).toBeGreaterThan(0);

    await page.evaluate(() => { document.getElementById('commchange-cb').checked = true; });
    await expect(page.locator('#commchange-cb')).toBeChecked();
    await page.locator('#commchange-cb').uncheck();
    await page.waitForFunction(() => window.showCommChange === false);
    const hidden = await page.evaluate(() => {
      const g = commCalloutGeom(state.notes[0]);
      const painted = [];
      const realStroke = octx.stroke.bind(octx);
      octx.stroke = function () {
        painted.push(octx.lineWidth);
        return realStroke();
      };
      drawNotes();
      octx.stroke = realStroke;
      return {
        noteCount: state.notes.length,
        selected: state.selected,
        hit: hitNote(Math.round(g.tail.x), Math.round(g.tail.y)),
        strokes: painted.length,
      };
    });
    expect(hidden.noteCount).toBe(1);
    expect(hidden.selected).toBeNull();
    expect(hidden.hit).toBe(-1);
    expect(hidden.strokes).toBe(0);

    await page.locator('#commchange-cb').check();
    await page.waitForFunction(() => window.showCommChange === true);
    const shownAgain = await page.evaluate(() => {
      const g = commCalloutGeom(state.notes[0]);
      const painted = [];
      const realStroke = octx.stroke.bind(octx);
      octx.stroke = function () {
        painted.push(octx.lineWidth);
        return realStroke();
      };
      drawNotes();
      octx.stroke = realStroke;
      return {
        noteCount: state.notes.length,
        hit: hitNote(Math.round(g.tail.x), Math.round(g.tail.y)),
        strokes: painted.length,
      };
    });
    expect(shownAgain.noteCount).toBe(1);
    expect(shownAgain.hit).toBe(0);
    expect(shownAgain.strokes).toBeGreaterThan(0);
  });

  test('persisted Show/Add Freq Changes seeds callouts after a saved route boots', async ({ page }) => {
    await installCommChangeFixture(page);
    await page.addInitScript(t => {
      try {
        for (const k of Object.keys(localStorage)) localStorage.removeItem(k);
        sessionStorage.clear();
        for (const s of ['build', 'view', 'display', 'charts', 'export', 'print'])
          localStorage.setItem('navaid.sec.' + s, '1');
        localStorage.setItem('navaid.showCommChange', '1');
        localStorage.setItem('navaid.route', JSON.stringify({
          waypoints: [{ lat: t.lat, lng: t.lng, name: t.name }],
          legs: [],
          notes: [],
        }));
      } catch (e) {}
    }, TYONA);
    await page.goto('?lang=en');
    await page.waitForFunction(() =>
      window.commChangeMap && window.commChangeMap.TYONA &&
      state.notes.length === 1 && state.notes[0].cc === 'TYONA' &&
      state.notes[0].freq === '118.40');
    const note = await page.evaluate(() => state.notes[0]);
    expect(note.freqName).toBe('PLUTO');
    expect(note.lat).toBeCloseTo(TYONA.lat + NOTE_LAT_OFFSET, 4);
    expect(note.lng).toBeCloseTo(TYONA.lng + NOTE_LNG_OFFSET, 4);
  });

  test('Hebrew-stored waypoint names still seed canonical comm-change callouts', async ({ page }) => {
    await installCommChangeFixture(page);
    await boot(page, 'he');
    const out = await page.evaluate(t => {
      const he = navWP.find(w => w.name === t.name).he;
      state.waypoints = [{ lat: t.lat, lng: t.lng, name: he }];
      syncLegs();
      seedCommChangeNotes();
      return {
        wpName: state.waypoints[0].name,
        note: state.notes[0],
        display: navName(state.waypoints[0].name),
      };
    }, TYONA);
    expect(out.wpName).not.toBe('TYONA');
    expect(out.display).toBe(out.wpName);
    expect(out.note.cc).toBe('TYONA');
    expect(out.note.freqName).toBe('PLUTO');
    expect(out.note.freq).toBe('118.40');
  });

  test('comm-change arrow far tail is draggable around the waypoint', async ({ page }) => {
    await installCommChangeFixture(page);
    await boot(page);
    const before = await page.evaluate(t => {
      state.waypoints = [{ lat: t.lat, lng: t.lng, name: t.name }];
      syncLegs();
      seedCommChangeNotes();
      draw();
      const g = commCalloutGeom(state.notes[0]);
      const r = mapEl.getBoundingClientRect();
      return {
        tail: { x: r.left + g.tail.x, y: r.top + g.tail.y },
        note: { lat: state.notes[0].lat, lng: state.notes[0].lng },
        waypoint: { lat: state.waypoints[0].lat, lng: state.waypoints[0].lng },
      };
    }, TYONA);
    await page.mouse.move(before.tail.x, before.tail.y);
    await page.mouse.down();
    await page.mouse.move(before.tail.x + 90, before.tail.y + 25);
    await page.mouse.up();
    const after = await page.evaluate(() => ({
      note: { lat: state.notes[0].lat, lng: state.notes[0].lng },
      waypoint: { lat: state.waypoints[0].lat, lng: state.waypoints[0].lng },
      selected: state.selected,
    }));
    expect(after.selected).toEqual({ type: 'note', index: 0 });
    expect(after.waypoint).toEqual(before.waypoint);
    expect(Math.abs(after.note.lng - before.note.lng)).toBeGreaterThan(0.005);
  });

  test('deleting a waypoint also deletes its frequency-change callout', async ({ page }) => {
    await installCommChangeFixture(page);
    await boot(page);
    const out = await page.evaluate(t => {
      state.waypoints = [{ lat: t.lat, lng: t.lng, name: t.name }];
      state.notes = [{
        lat: 31.9,
        lng: 34.8,
        text: 'Manual note',
        color: '#fff6aa',
        shape: 'rect',
      }];
      syncLegs();
      seedCommChangeNotes();
      const before = state.notes.map(n => ({ text: n.text, cc: n.cc || '' }));
      deleteWaypoint(0);
      return {
        before,
        waypoints: state.waypoints.length,
        notes: state.notes.map(n => ({ text: n.text, cc: n.cc || '' })),
      };
    }, TYONA);
    expect(out.before).toEqual([
      { text: 'Manual note', cc: '' },
      { text: 'Freq change', cc: 'TYONA' },
    ]);
    expect(out.waypoints).toBe(0);
    expect(out.notes).toEqual([{ text: 'Manual note', cc: '' }]);
  });

  test('comm-change note inspector edits name and frequency', async ({ page }) => {
    await installCommChangeFixture(page);
    await boot(page);
    await page.evaluate(t => {
      state.waypoints = [{ lat: t.lat, lng: t.lng, name: t.name }];
      syncLegs();
      seedCommChangeNotes();
      state.selected = { type: 'note', index: 0 };
      showInspector();
    }, TYONA);
    const fields = page.locator('#insp-body input[type="text"]');
    await expect(fields).toHaveCount(2);
    await fields.nth(0).fill('PLUTO EAST');
    await fields.nth(1).fill('119.20');
    const out = await page.evaluate(() => ({
      freqName: state.notes[0].freqName,
      freq: state.notes[0].freq,
      lines: noteLines(state.notes[0]),
    }));
    expect(out.freqName).toBe('PLUTO EAST');
    expect(out.freq).toBe('119.20');
    expect(out.lines).toEqual(['PLUTO EAST', '119.20']);
  });

  test('comm-change note inspector selects a call sign default while frequency stays editable', async ({ page }) => {
    await installCommChangeFixture(page);
    await boot(page);
    await page.evaluate(t => {
      state.waypoints = [{ lat: t.lat, lng: t.lng, name: t.name }];
      syncLegs();
      seedCommChangeNotes();
      state.selected = { type: 'note', index: 0 };
      showInspector();
    }, TYONA);
    const sel = page.locator('#insp-body select').first();
    const labels = page.locator('#insp-body .row label');
    const values = page.locator('#insp-body .row .val');
    await expect(labels.nth(0)).toHaveText('Waypoint');
    await expect(labels.nth(1)).toHaveText('Call sign');
    await expect(labels.nth(2)).toHaveText('Frequency');
    await expect(values.nth(0)).toHaveText('TYONA');
    await expect(sel).toHaveValue('PLUTO');
    await sel.selectOption('HAGAV');
    const fields = page.locator('#insp-body input[type="text"]');
    await expect(fields.nth(0)).toHaveValue('Hagav');
    await expect(fields.nth(1)).toHaveValue('132.70');
    await fields.nth(1).fill('133.45');
    const out = await page.evaluate(() => ({
      freqName: state.notes[0].freqName,
      freq: state.notes[0].freq,
      lines: noteLines(state.notes[0]),
    }));
    expect(out.freqName).toBe('HAGAV');
    expect(out.freq).toBe('133.45');
    expect(out.lines).toEqual(['HAGAV', '133.45']);
  });

  test('Hebrew locale shows translated call-sign names in the callout and inspector', async ({ page }) => {
    await installCommChangeFixture(page);
    await boot(page, 'he');
    await page.evaluate(t => {
      state.waypoints = [{ lat: t.lat, lng: t.lng, name: t.name }];
      syncLegs();
      seedCommChangeNotes();
      state.selected = { type: 'note', index: 0 };
      showInspector();
    }, TYONA);
    const fields = page.locator('#insp-body input[type="text"]');
    const labels = page.locator('#insp-body .row label');
    const values = page.locator('#insp-body .row .val');
    await expect(labels.nth(0)).toHaveText('נקודת דיווח');
    await expect(labels.nth(1)).toHaveText('אות קריאה');
    await expect(labels.nth(2)).toHaveText('תדר');
    await expect(values.nth(0)).toHaveText('תל יונה');
    await expect(fields.nth(0)).toHaveValue('פלוטו');
    await expect(fields.nth(1)).toHaveValue('118.40');
    const sel = page.locator('#insp-body select').first();
    await expect(sel).toHaveValue('PLUTO');
    await sel.selectOption('HAGAV');
    await expect(fields.nth(0)).toHaveValue('חגב');
    await expect(fields.nth(1)).toHaveValue('132.70');
    const out = await page.evaluate(() => ({
      freqName: state.notes[0].freqName,
      freq: state.notes[0].freq,
      lines: noteLines(state.notes[0]),
    }));
    expect(out.freqName).toBe('HAGAV');
    expect(out.freq).toBe('132.70');
    expect(out.lines).toEqual(['חגב', '132.70']);
  });

  test('Hebrew call-sign edits look up the default frequency', async ({ page }) => {
    await installCommChangeFixture(page);
    await boot(page, 'he');
    await page.evaluate(t => {
      state.waypoints = [{ lat: t.lat, lng: t.lng, name: t.name }];
      syncLegs();
      seedCommChangeNotes();
      state.selected = { type: 'note', index: 0 };
      showInspector();
    }, TYONA);
    const fields = page.locator('#insp-body input[type="text"]');
    await fields.nth(0).fill('חגב');
    await expect(fields.nth(1)).toHaveValue('132.70');
    const out = await page.evaluate(() => ({
      freqName: state.notes[0].freqName,
      freq: state.notes[0].freq,
      lines: noteLines(state.notes[0]),
    }));
    expect(out.freqName).toBe('HAGAV');
    expect(out.freq).toBe('132.70');
    expect(out.lines).toEqual(['חגב', '132.70']);
  });

  test('load preserves comm-change callout name and frequency fields', async ({ page }) => {
    await installCommChangeFixture(page);
    await boot(page);
    await page.evaluate(t => {
      const doc = {
        waypoints: [],
        legs: [],
        notes: [{
          lat: t.lat + 0.012,
          lng: t.lng,
          text: 'Freq change',
          color: '#fff6aa',
          shape: 'rect',
          cc: 'TYONA',
          freqName: 'PLUTO',
          freq: '118.40',
        }],
      };
      load(new File([JSON.stringify(doc)], 'r.json', { type: 'application/json' }));
    }, TYONA);
    await page.waitForFunction(() => state.notes[0] && state.notes[0].freq === '118.40');
    const note = await page.evaluate(() => state.notes[0]);
    expect(note.freqName).toBe('PLUTO');
    expect(note.freq).toBe('118.40');
    expect(note.cc).toBe('TYONA');
  });

  test('search route-build seeds notes for its comm-change waypoints', async ({ page }) => {
    await installCommChangeFixture(page);
    await boot(page);
    // TYONA and SORES are both real nav waypoints AND comm-change points in
    // the fixture, so a two-token route-build must seed a note for each.
    const tagged = await page.evaluate(async () => {
      await buildRouteFromQuery('TYONA SORES');
      return state.notes.map(n => n.cc).filter(Boolean).sort();
    });
    expect(tagged).toEqual(['SORES', 'TYONA']);
  });

  test('Hebrew locale seeds the translated note label', async ({ page }) => {
    await installCommChangeFixture(page);
    await boot(page, 'he');
    const out = await page.evaluate(t => {
      state.waypoints = [{ lat: t.lat, lng: t.lng, name: t.name }];
      syncLegs();
      seedCommChangeNotes();
      return {
        text: state.notes[0].text,
        freqName: state.notes[0].freqName,
        lines: noteLines(state.notes[0]),
      };
    }, TYONA);
    expect(out.text).toBe('שינוי תדר');
    expect(out.freqName).toBe('PLUTO');
    expect(out.lines).toEqual(['פלוטו', '118.40']);
  });
});
