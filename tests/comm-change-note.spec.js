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
const { stubGraph } = require('./_layerData');
const { hideToolbarMenus } = require('./_toolbar');

const TYONA = { lat: 32.00472, lng: 34.72722, name: 'TYONA' };
const LLHZ = { lat: 32.17944, lng: 34.83444, name: 'LLHZ' };
const DEROR = { lat: 32.25722, lng: 34.89111, name: 'DEROR' };
const DAROM = { lat: 32.79611, lng: 34.94333, name: 'DAROM' };
const LLHA = { lat: 32.80833, lng: 35.04278, name: 'LLHA' };
const CLORE = { lat: 32.05306, lng: 34.73583, name: 'CLORE' };
const NTAIM = { lat: 31.94361, lng: 34.78083, name: 'NTAIM' };
const NAGID = { lat: 31.88972, lng: 34.75583, name: 'NAGID' };
const NOTE_LAT_OFFSET = 0;      // keep in sync with commChangeNoteLatOffset
const NOTE_LNG_OFFSET = 0.09;   // keep in sync with commChangeNoteLngOffset

const FIXTURE = {
  version: 1,
  source: 'test fixture',
  callSigns: {
    PLUTO: { label: 'Pluto', he: 'פלוטו', primary: '118.40', secondary: '119.25' },
    HAGAV: { label: 'Hagav', he: 'חגב', primary: '132.70', secondary: '133.45' },
    HERZLIYA: { label: 'Herzliya', he: 'הרצליה', primary: '122.20', secondary: '129.40' },
    PLUTO_WEST: { label: 'Pluto West', he: 'פלוטו מערב', primary: '118.40', secondary: '119.15' },
    HAIFA: { label: 'Haifa', he: 'חיפה', primary: '133.00', secondary: '134.35' },
    BEN_GURION: { label: 'Ben Gurion', he: 'בן גוריון', primary: '118.30', secondary: '132.10' },
    PALMACHIM: { label: 'Palmachim', he: 'פלמחים', primary: '135.55', secondary: '118.25' },
    TEL_NOF: { label: 'Tel Nof', he: 'תל-נוף', primary: '129.05' },
  },
  points: [
    { name: 'TYONA', commChange: true, callSigns: ['PLUTO', 'HAGAV'], to: 'Pluto 118.40' },
    { name: 'DEROR', commChange: true, callSigns: ['HERZLIYA', 'PLUTO_WEST'] },
    { name: 'DAROM', commChange: true, callSigns: ['HAIFA', 'PLUTO_WEST'] },
    { name: 'NTAIM', commChange: true, callSigns: ['BEN_GURION', 'PALMACHIM', 'TEL_NOF'] },
    { name: 'SORES', commChange: true },
  ],
};

async function installCommChangeFixture(page, fixture = FIXTURE) {
  await stubGraph(page, { commChange: fixture.points, callSigns: fixture.callSigns });
}

async function boot(page, lang = 'en') {
  await page.addInitScript(() => {
    try {
      if (localStorage.getItem('__test_comm_init_v1') !== '1') {
        for (const k of Object.keys(localStorage)) localStorage.removeItem(k);
        sessionStorage.clear();
        for (const s of ['build', 'view', 'display', 'charts', 'export', 'print'])
          localStorage.setItem('navaid.sec.' + s, '1');
        localStorage.setItem('__test_comm_init_v1', '1');
      }
    } catch (e) {}
  });
  await page.goto('?lang=' + lang);
  await page.waitForFunction(() => typeof state !== 'undefined' &&
    typeof window.seedCommChangeNotes === 'function');
  await page.evaluate(() => loadNavWaypoints());
  await page.waitForFunction(() => Array.isArray(window.navWP) && window.navWP.length > 0);
  await page.evaluate(() => loadAirfields());
  await page.waitForFunction(() => Array.isArray(window.airfields) && window.airfields.length > 0);
  await page.evaluate(() => loadCommChange());
  await page.waitForFunction(() => window.commChangeMap && window.commChangeMap.TYONA);
  await page.evaluate(() => { window.showCommChange = true; });
  await page.evaluate(t => map.setView([t.lat, t.lng], 11), TYONA);
  await page.evaluate(() => {
    state.waypoints = [];
    state.legs = [];
    state.notes = [];
    state.commChangeSuppressions = [];
  });
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

  test('infers frequency callouts from the route direction graph', async ({ page }) => {
    await installCommChangeFixture(page);
    await boot(page);
    const out = await page.evaluate(({ llhz, deror, darom, llha }) => {
      state.waypoints = [llhz, deror, darom, llha];
      state.notes = [];
      syncLegs();
      seedCommChangeNotes();
      return state.notes
        .filter(n => n.cc)
        .map(n => ({
          cc: n.cc,
          freqName: n.freqName,
          freq: n.freq,
          lines: noteLines(n),
          freqAuto: n.freqAuto,
        }));
    }, { llhz: LLHZ, deror: DEROR, darom: DAROM, llha: LLHA });
    expect(out).toEqual([
      { cc: 'DEROR', freqName: 'PLUTO_WEST', freq: '118.40', lines: ['PLUTO WEST', '118.40'], freqAuto: true },
      { cc: 'DAROM', freqName: 'HAIFA', freq: '133.00', lines: ['HAIFA', '133.00'], freqAuto: true },
    ]);
  });

  test('reversing the route reverses the inferred frequency callouts', async ({ page }) => {
    await installCommChangeFixture(page);
    await boot(page);
    const out = await page.evaluate(({ llhz, deror, darom, llha }) => {
      state.waypoints = [llha, darom, deror, llhz];
      state.notes = [];
      syncLegs();
      seedCommChangeNotes();
      return state.notes
        .filter(n => n.cc)
        .map(n => ({
          cc: n.cc,
          freqName: n.freqName,
          freq: n.freq,
          lines: noteLines(n),
        }));
    }, { llhz: LLHZ, deror: DEROR, darom: DAROM, llha: LLHA });
    expect(out).toEqual([
      { cc: 'DAROM', freqName: 'PLUTO_WEST', freq: '118.40', lines: ['PLUTO WEST', '118.40'] },
      { cc: 'DEROR', freqName: 'HERZLIYA', freq: '122.20', lines: ['HERZLIYA', '122.20'] },
    ]);
  });

  test('uses route context to hint the matching comm-change call sign', async ({ page }) => {
    const routeFixture = {
      ...FIXTURE,
      points: [
        {
          name: 'TYONA',
          commChange: true,
          callSigns: ['PALMACHIM', 'PLUTO_WEST'],
          routeHints: [{ after: 'CLORE', callSign: 'PLUTO_WEST' }],
        },
        { name: 'PWREF', commChange: true, callSigns: ['PLUTO_WEST'], lat: 32.8, lng: 34.73 },
      ],
    };
    await installCommChangeFixture(page, routeFixture);
    await boot(page);
    const note = await page.evaluate(({ tyona, clore }) => {
      state.waypoints = [tyona, clore];
      state.notes = [];
      syncLegs();
      seedCommChangeNotes();
      return state.notes.find(n => n.cc === 'TYONA');
    }, { tyona: TYONA, clore: CLORE });
    expect(note).toMatchObject({
      cc: 'TYONA',
      freqName: 'PLUTO_WEST',
      freq: '118.40',
      freqAuto: true,
    });
  });

  test('ignores route-context hints when the adjacent leg does not match', async ({ page }) => {
    const routeFixture = {
      ...FIXTURE,
      points: [
        {
          name: 'TYONA',
          commChange: true,
          callSigns: ['PALMACHIM', 'PLUTO_WEST'],
          routeHints: [{ after: 'CLORE', callSign: 'PLUTO_WEST' }],
        },
        { name: 'PWREF', commChange: true, callSigns: ['PLUTO_WEST'], lat: 32.8, lng: 34.73 },
      ],
    };
    await installCommChangeFixture(page, routeFixture);
    await boot(page);
    const note = await page.evaluate(({ tyona, ntaim }) => {
      state.waypoints = [tyona, ntaim];
      state.notes = [];
      syncLegs();
      seedCommChangeNotes();
      return state.notes.find(n => n.cc === 'TYONA');
    }, { tyona: TYONA, ntaim: NTAIM });
    expect(note).toMatchObject({
      cc: 'TYONA',
      freqName: 'PALMACHIM',
      freq: '135.55',
      freqAuto: true,
    });
  });

  test('reverse route updates existing auto callout from route-context hints', async ({ page }) => {
    const routeFixture = {
      ...FIXTURE,
      points: [
        {
          name: 'TYONA',
          commChange: true,
          callSigns: ['PALMACHIM', 'PLUTO_WEST'],
          routeHints: [
            { before: 'NTAIM', after: 'CLORE', callSign: 'PLUTO_WEST' },
            { before: 'CLORE', after: 'NTAIM', callSign: 'PALMACHIM' },
          ],
        },
      ],
    };
    await installCommChangeFixture(page, routeFixture);
    await boot(page);
    const before = await page.evaluate(({ ntaim, tyona, clore }) => {
      state.waypoints = [ntaim, tyona, clore];
      state.notes = [];
      syncLegs();
      seedCommChangeNotes();
      draw();
      return state.notes
        .filter(n => n.cc)
        .map(n => ({ cc: n.cc, freqName: n.freqName, freq: n.freq, freqAuto: n.freqAuto }));
    }, { ntaim: NTAIM, tyona: TYONA, clore: CLORE });
    expect(before).toEqual([
      { cc: 'TYONA', freqName: 'PLUTO_WEST', freq: '118.40', freqAuto: true },
    ]);

    await page.locator('#reverse').click();
    const after = await page.evaluate(() => ({
      waypoints: state.waypoints.map(w => w.name),
      notes: state.notes
        .filter(n => n.cc)
        .map(n => ({
          cc: n.cc,
          freqName: n.freqName,
          freq: n.freq,
          freqAuto: n.freqAuto,
          lines: noteLines(n),
        })),
    }));
    expect(after).toEqual({
      waypoints: ['CLORE', 'TYONA', 'NTAIM'],
      notes: [{
        cc: 'TYONA',
        freqName: 'PALMACHIM',
        freq: '135.55',
        freqAuto: true,
        lines: ['PALMACHIM', '135.55'],
      }],
    });
  });

  test('Auto reset returns a manual comm-change callout to route updates', async ({ page }) => {
    const routeFixture = {
      ...FIXTURE,
      points: [
        {
          name: 'TYONA',
          commChange: true,
          callSigns: ['PALMACHIM', 'PLUTO_WEST', 'HAGAV'],
          routeHints: [
            { before: 'NTAIM', after: 'CLORE', callSign: 'PLUTO_WEST' },
            { before: 'CLORE', after: 'NTAIM', callSign: 'PALMACHIM' },
          ],
        },
      ],
    };
    await installCommChangeFixture(page, routeFixture);
    await boot(page);
    await page.evaluate(({ ntaim, tyona, clore }) => {
      state.waypoints = [ntaim, tyona, clore];
      state.notes = [];
      syncLegs();
      seedCommChangeNotes();
      state.selected = { type: 'note', index: 0 };
      draw();
      showInspector();
    }, { ntaim: NTAIM, tyona: TYONA, clore: CLORE });

    const sel = page.locator('#insp-body .commchange-name-row select').first();
    const field = page.locator('#insp-body .freq-input').first();
    const auto = page.locator('#insp-body .commchange-name-row .commchange-auto-checkbox');
    await expect(page.locator('#insp-body .commchange-auto-row')).toHaveCount(0);
    await expect(auto).toBeChecked();
    await expect(sel).toHaveValue('PLUTO_WEST');
    await expect(sel.locator('option:checked')).toHaveText('Pluto West');
    await expect(sel.locator('option').first()).toHaveText('Palmachim');
    await expect(field).toHaveValue('118.40');

    await sel.selectOption('HAGAV');
    await expect(field).toHaveValue('132.70');
    await expect(sel).toHaveValue('HAGAV');
    await expect(auto).not.toBeChecked();
    expect(await page.evaluate(() => ({
      freqName: state.notes[0].freqName,
      freq: state.notes[0].freq,
      freqAuto: state.notes[0].freqAuto,
      lines: noteLines(state.notes[0]),
    }))).toEqual({
      freqName: 'HAGAV',
      freq: '132.70',
      freqAuto: false,
      lines: ['HAGAV', '132.70'],
    });

    await page.locator('#reverse').click();
    expect(await page.evaluate(() => ({
      waypoints: state.waypoints.map(w => w.name),
      note: {
        freqName: state.notes[0].freqName,
        freq: state.notes[0].freq,
        freqAuto: state.notes[0].freqAuto,
        lines: noteLines(state.notes[0]),
      },
    }))).toEqual({
      waypoints: ['CLORE', 'TYONA', 'NTAIM'],
      note: {
        freqName: 'HAGAV',
        freq: '132.70',
        freqAuto: false,
        lines: ['HAGAV', '132.70'],
      },
    });

    await page.evaluate(() => {
      state.selected = { type: 'note', index: 0 };
      showInspector();
    });
    await expect(sel).toHaveValue('HAGAV');
    await expect(auto).not.toBeChecked();
    await auto.check();
    await expect(auto).toBeChecked();
    await expect(sel).toHaveValue('PALMACHIM');
    await expect(sel.locator('option:checked')).toHaveText('Palmachim');
    await expect(field).toHaveValue('135.55');
    expect(await page.evaluate(() => ({
      freqName: state.notes[0].freqName,
      freq: state.notes[0].freq,
      freqAuto: state.notes[0].freqAuto,
      lines: noteLines(state.notes[0]),
    }))).toEqual({
      freqName: 'PALMACHIM',
      freq: '135.55',
      freqAuto: true,
      lines: ['PALMACHIM', '135.55'],
    });

    await page.locator('#reverse').click();
    expect(await page.evaluate(() => ({
      waypoints: state.waypoints.map(w => w.name),
      note: {
        freqName: state.notes[0].freqName,
        freq: state.notes[0].freq,
        freqAuto: state.notes[0].freqAuto,
        lines: noteLines(state.notes[0]),
      },
    }))).toEqual({
      waypoints: ['NTAIM', 'TYONA', 'CLORE'],
      note: {
        freqName: 'PLUTO_WEST',
        freq: '118.40',
        freqAuto: true,
        lines: ['PLUTO WEST', '118.40'],
      },
    });
  });

  test('Reverse route updates existing auto frequency callouts', async ({ page }) => {
    await installCommChangeFixture(page);
    await boot(page);
    await page.evaluate(({ llhz, deror, darom, llha }) => {
      state.waypoints = [llhz, deror, darom, llha];
      state.notes = [];
      syncLegs();
      seedCommChangeNotes();
      draw();
    }, { llhz: LLHZ, deror: DEROR, darom: DAROM, llha: LLHA });
    await page.locator('#reverse').click();
    const out = await page.evaluate(() => ({
      waypoints: state.waypoints.map(w => w.name),
      notes: Object.fromEntries(state.notes
        .filter(n => n.cc)
        .map(n => [n.cc, { freqName: n.freqName, freq: n.freq, lines: noteLines(n) }])),
    }));
    expect(out.waypoints).toEqual(['LLHA', 'DAROM', 'DEROR', 'LLHZ']);
    expect(out.notes).toEqual({
      DEROR: { freqName: 'HERZLIYA', freq: '122.20', lines: ['HERZLIYA', '122.20'] },
      DAROM: { freqName: 'PLUTO_WEST', freq: '118.40', lines: ['PLUTO WEST', '118.40'] },
    });
  });

  test('auto frequency guesses are reconsidered when later route points are added', async ({ page }) => {
    await installCommChangeFixture(page);
    await boot(page);
    const out = await page.evaluate(({ deror, darom, llha }) => {
      state.waypoints = [deror];
      state.notes = [];
      syncLegs();
      seedCommChangeNotes();
      const firstGuess = state.notes.map(n => ({
        cc: n.cc,
        freqName: n.freqName,
        freq: n.freq,
        freqAuto: n.freqAuto,
      }));

      state.waypoints = [deror, darom, llha];
      syncLegs();
      seedCommChangeNotes();
      const afterNextPoints = state.notes
        .filter(n => n.cc)
        .map(n => ({
          cc: n.cc,
          freqName: n.freqName,
          freq: n.freq,
          lines: noteLines(n),
          freqAuto: n.freqAuto,
        }));
      return { firstGuess, afterNextPoints };
    }, { deror: DEROR, darom: DAROM, llha: LLHA });
    expect(out.firstGuess).toEqual([
      { cc: 'DEROR', freqName: 'HERZLIYA', freq: '122.20', freqAuto: true },
    ]);
    expect(out.afterNextPoints).toEqual([
      { cc: 'DEROR', freqName: 'PLUTO_WEST', freq: '118.40', lines: ['PLUTO WEST', '118.40'], freqAuto: true },
      { cc: 'DAROM', freqName: 'HAIFA', freq: '133.00', lines: ['HAIFA', '133.00'], freqAuto: true },
    ]);
  });

  test('route context hints reconsider a prior ATC guess when a route grows', async ({ page }) => {
    const routeFixture = {
      ...FIXTURE,
      points: [
        { name: 'TYONA', commChange: true, callSigns: ['PLUTO_WEST', 'PALMACHIM'] },
        { name: 'NTAIM', commChange: true, callSigns: ['BEN_GURION', 'PALMACHIM', 'TEL_NOF'] },
      ],
    };
    await installCommChangeFixture(page, routeFixture);
    await boot(page);
    // A made-up name AND a small coordinate nudge off NAGID's own, not NAGID's exact spot:
    // NTAIM is a real graph node, and the fixture merge (see _layerData.js) leaves the REAL
    // node's routeHints in place whenever the fixture's own NTAIM entry doesn't specify any
    // -- the real graph now has an explicit after:NAGID hint (this session's data fix). A
    // fake NAME alone isn't enough to dodge that any more: commRouteAfterNames now folds in
    // the published corridor between drawn waypoints (this session's other fix, for a route
    // that SKIPS a named stop entirely), and fplGraphPointAt resolves a waypoint to a graph
    // node by close COORDINATES too, not just by name -- sitting exactly on NAGID's own
    // coordinates resolved straight back to the real 'NAGID' node regardless of the fake
    // name, defeating the isolation this test needs. Nudged just past
    // fplGraphPointAt's own coordinate-fallback epsilon (SAME_REFERENCE_POINT_DEG*2,
    // ~0.1 nm) -- small enough that the general SOLVER's own distance-based guess (the
    // mechanism this test is actually about) still lands on PALMACHIM same as before, large
    // enough that it no longer resolves to a real graph node at all.
    const thirdPoint = { lat: NAGID.lat + 0.003, lng: NAGID.lng + 0.003, name: 'ZZZTESTPT' };
    const out = await page.evaluate(({ tyona, ntaim, third }) => {
      state.waypoints = [tyona, ntaim];
      state.notes = [];
      syncLegs();
      seedCommChangeNotes();
      const beforeThird = state.notes
        .filter(n => n.cc)
        .map(n => ({
          cc: n.cc,
          freqName: n.freqName,
          freq: n.freq,
          freqAuto: n.freqAuto,
        }));

      state.waypoints.push(third);
      syncLegs();
      seedCommChangeNotes();
      const afterThird = state.notes
        .filter(n => n.cc)
        .map(n => ({
          cc: n.cc,
          freqName: n.freqName,
          freq: n.freq,
          lines: noteLines(n),
          freqAuto: n.freqAuto,
        }));
      return { beforeThird, afterThird };
    }, { tyona: TYONA, ntaim: NTAIM, third: thirdPoint });
    expect(out.beforeThird).toEqual([
      { cc: 'TYONA', freqName: 'PALMACHIM', freq: '135.55', freqAuto: true },
      { cc: 'NTAIM', freqName: 'BEN_GURION', freq: '118.30', freqAuto: true },
    ]);
    expect(out.afterThird).toEqual([
      { cc: 'TYONA', freqName: 'PALMACHIM', freq: '135.55', lines: ['PALMACHIM', '135.55'], freqAuto: true },
      { cc: 'NTAIM', freqName: 'PALMACHIM', freq: '135.55', lines: ['PALMACHIM', '135.55'], freqAuto: true },
    ]);
  });

  test('route graph updates auto callouts but leaves manual edits alone', async ({ page }) => {
    await installCommChangeFixture(page);
    await boot(page);
    const out = await page.evaluate(({ llhz, deror, darom, llha }) => {
      state.waypoints = [llhz, deror, darom, llha];
      state.notes = [{
        lat: deror.lat,
        lng: deror.lng + 0.09,
        text: 'Freq change',
        color: '#fff6aa',
        shape: 'rect',
        cc: 'DEROR',
        freqName: 'HERZLIYA',
        freq: '122.20',
      }, {
        lat: darom.lat,
        lng: darom.lng + 0.09,
        text: 'Freq change',
        color: '#fff6aa',
        shape: 'rect',
        cc: 'DAROM',
        freqName: 'PLUTO_WEST',
        freq: '118.40',
        freqAuto: true,
      }];
      syncLegs();
      const changed = seedCommChangeNotes();
      return {
        changed,
        notes: state.notes.map(n => ({
          cc: n.cc,
          freqName: n.freqName,
          freq: n.freq,
          freqAuto: n.freqAuto || false,
        })),
      };
    }, { llhz: LLHZ, deror: DEROR, darom: DAROM, llha: LLHA });
    expect(out).toEqual({
      changed: true,
      notes: [
        { cc: 'DEROR', freqName: 'HERZLIYA', freq: '122.20', freqAuto: false },
        { cc: 'DAROM', freqName: 'HAIFA', freq: '133.00', freqAuto: true },
      ],
    });
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
        arrowStartClearPx: Math.hypot(g.target.x - target.x, g.target.y - target.y),
        expectedStartClearPx: waypointGeom(0).r + tune('waypointStrokeWidthPx') / 2 +
          tune('commChangeArrowStartGapPx'),
        arrowStartGap: tune('commChangeArrowStartGapPx'),
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
    expect(out.arrowStartClearPx).toBeCloseTo(out.expectedStartClearPx, 0);
    expect(out.arrowStartGap).toBe(3);
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

  test('waypoint center, frequency arrow, and tail open the waypoint inspector', async ({ page }) => {
    await installCommChangeFixture(page);
    await boot(page);
    await hideToolbarMenus(page);   // clear the map so real-mouse clicks land
    const pts = await page.evaluate(t => {
      state.waypoints = [{ lat: t.lat, lng: t.lng, name: t.name }];
      syncLegs();
      map.setView([t.lat, t.lng], 11, { animate: false });   // centre the target so the click lands on-screen
      seedCommChangeNotes();
      draw();
      const center = proj(state.waypoints[0]);
      const g = commCalloutGeom(state.notes[0]);
      const arrow = {
        x: (g.bend2.x + g.tail.x) / 2,
        y: (g.bend2.y + g.tail.y) / 2,
      };
      const r = mapEl.getBoundingClientRect();
      return {
        center: { x: r.left + center.x, y: r.top + center.y },
        arrow: { x: r.left + arrow.x, y: r.top + arrow.y },
        tail: { x: r.left + g.tail.x, y: r.top + g.tail.y },
        hitNoteAtCenter: hitNote(center.x, center.y),
        hitNoteAtArrow: hitNote(arrow.x, arrow.y),
        hitWaypointAtCenter: hitWaypoint(center.x, center.y),
        hitNoteAtTail: hitNote(g.tail.x, g.tail.y),
      };
    }, TYONA);
    expect(pts.hitNoteAtCenter).toBe(-1);
    expect(pts.hitWaypointAtCenter).toBe(0);
    expect(pts.hitNoteAtArrow).toBe(0);
    expect(pts.hitNoteAtTail).toBe(0);

    await page.mouse.click(pts.center.x, pts.center.y);
    await expect.poll(() => page.evaluate(() => state.selected)).toEqual({ type: 'wp', index: 0 });
    await page.mouse.click(pts.arrow.x, pts.arrow.y);
    await expect.poll(() => page.evaluate(() => state.selected))
      .toEqual({ type: 'wp', index: 0, freqNoteIndex: 0 });
    await page.mouse.click(pts.tail.x, pts.tail.y);
    await expect.poll(() => page.evaluate(() => state.selected))
      .toEqual({ type: 'wp', index: 0, freqNoteIndex: 0 });
    await expect(page.locator('#insp-title')).toHaveValue(/TYONA/);
    await expect(page.locator('#insp-body .commchange-name-row select')).toHaveCount(1);
    await expect(page.locator('#insp-body .freq-input')).toHaveValue('118.40');

    const widths = await page.evaluate(() => {
      state.selected = { type: 'wp', index: 0, freqNoteIndex: 0 };
      const seen = [];
      const realStroke = octx.stroke.bind(octx);
      octx.stroke = function () {
        seen.push(octx.lineWidth);
        return realStroke();
      };
      drawNotes();
      octx.stroke = realStroke;
      return {
        seen,
        selectedWidth: tune('commChangeArrowWidthPx') + tune('commChangeSelectedWidthAddPx'),
      };
    });
    expect(widths.seen).toContain(widths.selectedWidth);
  });

  test('linked comm-change callout and its route waypoint collapse to one choice', async ({ page }) => {
    await installCommChangeFixture(page);
    await boot(page);
    const out = await page.evaluate(t => {
      state.waypoints = [{ lat: t.lat, lng: t.lng, name: t.name }];
      syncLegs();
      seedCommChangeNotes();
      draw();
      state.selected = null;
      const navIndex = navWP.findIndex(w => w.name === t.name);
      const shown = showPointChoice([
        { type: 'commcallout', index: 0 },
        { type: 'wp', index: 0 },
        { type: 'navwp', index: navIndex },
      ]);
      return {
        shown,
        selected: state.selected,
        modalCount: document.querySelectorAll('.point-choice-modal').length,
      };
    }, TYONA);

    expect(out.shown).toBe(true);
    expect(out.modalCount).toBe(0);
    expect(out.selected).toEqual({ type: 'wp', index: 0, freqNoteIndex: 0 });
    await expect(page.locator('#insp-title')).toHaveValue(/TYONA/);
    await expect(page.locator('#insp-body .commchange-name-row select')).toHaveCount(1);
  });

  test('linked comm-change callout and unnamed route waypoint collapse to one choice', async ({ page }) => {
    await installCommChangeFixture(page);
    await boot(page);
    const out = await page.evaluate(t => {
      state.waypoints = [{ lat: t.lat, lng: t.lng }];
      syncLegs();
      seedCommChangeNotes();
      draw();
      state.selected = null;
      const navIndex = navWP.findIndex(w => w.name === t.name);
      const shown = showPointChoice([
        { type: 'commcallout', index: 0 },
        { type: 'wp', index: 0 },
        { type: 'navwp', index: navIndex },
      ]);
      return {
        shown,
        selected: state.selected,
        modalCount: document.querySelectorAll('.point-choice-modal').length,
        title: document.querySelector('#insp-title').value,
        storedName: state.waypoints[0].name || '',
      };
    }, TYONA);

    expect(out.shown).toBe(true);
    expect(out.modalCount).toBe(0);
    expect(out.selected).toEqual({ type: 'wp', index: 0, freqNoteIndex: 0 });
    expect(out.storedName).toBe('');
    expect(out.title).toContain('TYONA');
    await expect(page.locator('#insp-body .commchange-name-row select')).toHaveCount(1);
  });

  test('comm-change arrow overlapping a route waypoint opens the point chooser', async ({ page }) => {
    await installCommChangeFixture(page);
    await boot(page);
    await hideToolbarMenus(page);   // clear the map so real-mouse clicks land
    const pts = await page.evaluate(t => {
      state.waypoints = [{ lat: t.lat, lng: t.lng, name: t.name }];
      syncLegs();
      map.setView([t.lat, t.lng], 11, { animate: false });   // centre the target so the click lands on-screen
      seedCommChangeNotes();
      draw();
      const g = commCalloutGeom(state.notes[0]);
      const arrow = {
        x: (g.bend2.x + g.tail.x) / 2,
        y: (g.bend2.y + g.tail.y) / 2,
      };
      const ll = map.containerPointToLatLng([arrow.x, arrow.y]);
      state.waypoints.push({ lat: r5(ll.lat), lng: r5(ll.lng), name: 'HIDDEN' });
      syncLegs();
      draw();
      const r = mapEl.getBoundingClientRect();
      return {
        arrow: { x: r.left + arrow.x, y: r.top + arrow.y },
        commHits: hitCommCalloutCandidates(arrow.x, arrow.y),
        wpHits: hitWaypointCandidates(arrow.x, arrow.y),
      };
    }, TYONA);
    expect(pts.commHits).toEqual([{ type: 'commcallout', index: 0 }]);
    expect(pts.wpHits).toEqual([{ type: 'wp', index: 1 }]);

    await page.mouse.click(pts.arrow.x, pts.arrow.y);
    await expect(page.locator('.point-choice-modal')).toBeVisible();
    await expect(page.locator('.point-choice-option')).toHaveCount(2);
    await expect(page.locator('.point-choice-option').filter({ hasText: 'Freq-change arrow' })).toBeVisible();
    await expect(page.locator('.point-choice-option').filter({ hasText: 'HIDDEN' })).toBeVisible();

    await page.locator('.point-choice-option').filter({ hasText: 'HIDDEN' }).click();
    expect(await page.evaluate(() => state.selected)).toEqual({ type: 'wp', index: 1 });
    await expect(page.locator('#insp-title')).toHaveValue('HIDDEN');

    await page.mouse.click(pts.arrow.x, pts.arrow.y);
    await expect(page.locator('.point-choice-modal')).toBeVisible();
    await page.locator('.point-choice-option').filter({ hasText: 'Freq-change arrow' }).click();
    expect(await page.evaluate(() => state.selected)).toEqual({ type: 'wp', index: 0, freqNoteIndex: 0 });
    await expect(page.locator('#insp-title')).toHaveValue(/TYONA/);
  });

  test('comm-change arrow overlapping a comm-change ring opens the point chooser', async ({ page }) => {
    await installCommChangeFixture(page);
    await boot(page);
    await hideToolbarMenus(page);   // clear the map so real-mouse clicks land
    const pts = await page.evaluate(t => {
      window.showNavWP = false;
      window.showCommChange = true;
      const target = navWP.find(w => w.name === t.name);
      const tail = commCalloutDefaultTail(target);
      state.waypoints = [];
      state.legs = [];
      state.notes = [{
        lat: tail.lat,
        lng: tail.lng,
        text: 'Freq change',
        color: NOTE_DEFAULT_COLOR,
        shape: 'rect',
        cc: t.name,
        freqName: 'PLUTO_WEST',
        freq: '118.40',
      }];
      map.setView([target.lat, target.lng], 12);
      draw();
      const g = commCalloutGeom(state.notes[0]);
      const p = g.target;
      const r = mapEl.getBoundingClientRect();
      return {
        point: { x: r.left + p.x, y: r.top + p.y },
        commHits: hitCommCalloutCandidates(p.x, p.y),
        ringHits: hitCommChangeMarkerCandidates(p.x, p.y),
        navHits: hitNavWpMarkerCandidates(p.x, p.y),
      };
    }, DEROR);
    expect(pts.commHits).toEqual([{ type: 'commcallout', index: 0 }]);
    expect(pts.ringHits).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'navwp' })]));
    expect(pts.navHits).toEqual([]);

    await page.mouse.click(pts.point.x, pts.point.y);
    await expect(page.locator('.point-choice-modal')).toBeVisible();
    await expect(page.locator('.point-choice-option')).toHaveCount(2);
    await expect(page.locator('.point-choice-option').filter({ hasText: 'Freq-change arrow' })).toBeVisible();
    await expect(page.locator('.point-choice-option').filter({ hasText: 'Navigation waypoint' })).toBeVisible();

    await page.locator('.point-choice-option').filter({ hasText: 'Navigation waypoint' }).click();
    expect(await page.evaluate(() => {
      const sel = state.selected;
      const nw = sel && sel.type === 'navwp' ? navWP[sel.index] : null;
      return nw && nw.name;
    })).toBe('DEROR');
    await expect(page.locator('#insp-title')).toHaveValue(/DEROR/);

    await page.mouse.click(pts.point.x, pts.point.y);
    await expect(page.locator('.point-choice-modal')).toBeVisible();
    await page.locator('.point-choice-option').filter({ hasText: 'Freq-change arrow' }).click();
    expect(await page.evaluate(() => state.selected)).toEqual({ type: 'note', index: 0 });
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
        localStorage.setItem('navaid.showFreqChanges', '1');
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
    expect(after.selected).toEqual({ type: 'wp', index: 0, freqNoteIndex: 0 });
    expect(after.waypoint).toEqual(before.waypoint);
    expect(Math.abs(after.note.lng - before.note.lng)).toBeGreaterThan(0.005);
  });

  test('snapping a selected waypoint onto a comm-change point refreshes the freq editor', async ({ page }) => {
    await installCommChangeFixture(page);
    await boot(page);
    await hideToolbarMenus(page);   // clear the map so real-mouse clicks land
    const pts = await page.evaluate(t => {
      window.showNavWP = true;
      const center = map.latLngToContainerPoint([t.lat, t.lng]);
      const startLl = map.containerPointToLatLng([center.x + 80, center.y + 60]);
      state.waypoints = [{ lat: r5(startLl.lat), lng: r5(startLl.lng), name: '' }];
      state.notes = [];
      syncLegs();
      state.selected = { type: 'wp', index: 0 };
      showInspector();
      draw();
      const start = proj(state.waypoints[0]);
      const target = proj(t);
      const r = mapEl.getBoundingClientRect();
      return {
        beforeHasFreqInput: !!document.querySelector('#insp-body .freq-input'),
        start: { x: r.left + start.x, y: r.top + start.y },
        target: { x: r.left + target.x, y: r.top + target.y },
      };
    }, TYONA);
    expect(pts.beforeHasFreqInput).toBe(false);

    await page.mouse.move(pts.start.x, pts.start.y);
    await page.mouse.down();
    await page.mouse.move(pts.target.x, pts.target.y);
    await page.mouse.up();

    await expect.poll(() => page.evaluate(() => ({
      selected: state.selected,
      waypoint: state.waypoints[0].name,
      noteCount: state.notes.filter(n => n && n.cc).length,
      hasFreqInput: !!document.querySelector('#insp-body .freq-input'),
      freq: document.querySelector('#insp-body .freq-input')?.value || '',
    }))).toEqual({
      selected: { type: 'wp', index: 0 },
      waypoint: 'TYONA',
      noteCount: 1,
      hasFreqInput: true,
      freq: '118.40',
    });
  });

  test('comm-change callouts require the waypoint to stay within the 18px snap range', async ({ page }) => {
    await installCommChangeFixture(page);
    await boot(page);
    const out = await page.evaluate(t => {
      const center = map.latLngToContainerPoint([t.lat, t.lng]);
      const near = map.containerPointToLatLng([center.x + 10, center.y]);
      const far = map.containerPointToLatLng([center.x + 30, center.y]);
      state.waypoints = [{ lat: r5(near.lat), lng: r5(near.lng), name: t.name }];
      state.notes = [];
      syncLegs();
      const seededNear = seedCommChangeNotes();
      state.selected = { type: 'note', index: 0 };
      const nearState = {
        changed: seededNear,
        notes: state.notes.map(n => n.cc || ''),
      };
      state.waypoints[0].lat = r5(far.lat);
      state.waypoints[0].lng = r5(far.lng);
      state.waypoints[0].name = t.name;
      const prunedFar = seedCommChangeNotes();
      return {
        nearState,
        prunedFar,
        notes: state.notes.map(n => n.cc || ''),
        selected: state.selected,
      };
    }, TYONA);
    expect(out.nearState).toEqual({ changed: true, notes: ['TYONA'] });
    expect(out.prunedFar).toBe(true);
    expect(out.notes).toEqual([]);
    expect(out.selected).toBeNull();
  });

  test('dragging a comm-change waypoint away deletes its frequency-change callout', async ({ page }) => {
    await installCommChangeFixture(page);
    await boot(page);
    await hideToolbarMenus(page);   // clear the map so real-mouse clicks land
    const center = await page.evaluate(t => {
      state.waypoints = [{ lat: t.lat, lng: t.lng, name: t.name }];
      state.notes = [];
      syncLegs();
      map.setView([t.lat, t.lng], 11, { animate: false });   // centre the target so the drag starts on-screen
      seedCommChangeNotes();
      draw();
      const p = proj(state.waypoints[0]);
      const r = mapEl.getBoundingClientRect();
      return { x: r.left + p.x, y: r.top + p.y };
    }, TYONA);
    await page.mouse.move(center.x, center.y);
    await page.mouse.down();
    await page.mouse.move(center.x + 100, center.y + 20);
    await page.mouse.up();
    await page.waitForFunction(() =>
      state.waypoints.length === 1 && state.notes.filter(n => n && n.cc).length === 0);
    const out = await page.evaluate(() => ({
      waypoints: state.waypoints.length,
      notes: state.notes.map(n => n.cc || ''),
      selected: state.selected,
    }));
    expect(out).toEqual({ waypoints: 1, notes: [], selected: { type: 'wp', index: 0 } });
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

  test('deleting a frequency-change callout does not delete its waypoint', async ({ page }) => {
    await installCommChangeFixture(page);
    await boot(page);
    const center = await page.evaluate(t => {
      state.waypoints = [{ lat: t.lat, lng: t.lng, name: t.name }];
      state.notes = [];
      syncLegs();
      seedCommChangeNotes();
      state.selected = { type: 'wp', index: 0, freqNoteIndex: 0 };
      showInspector();
      draw();
      const s = proj(state.waypoints[0]);
      const r = mapEl.getBoundingClientRect();
      return { x: r.left + s.x, y: r.top + s.y };
    }, TYONA);
    await page.locator('#insp-body .insp-btn').filter({ hasText: /Delete freq change/ }).click();
    const out = await page.evaluate(() => ({
      waypoints: state.waypoints.map(w => w.name),
      notes: state.notes.map(n => ({ text: n.text, cc: n.cc || '' })),
      suppressions: state.commChangeSuppressions.slice(),
      selected: state.selected,
    }));
    expect(out.waypoints).toEqual(['TYONA']);
    expect(out.notes).toEqual([]);
    expect(out.suppressions).toEqual(['TYONA']);
    expect(out.selected).toEqual({ type: 'wp', index: 0 });
    await expect(page.locator('#insp-body .insp-btn').filter({ hasText: /Add frequency change/ })).toBeVisible();

    await page.mouse.click(center.x, center.y);
    await expect.poll(() => page.evaluate(() => state.notes.filter(n => n && n.cc).length)).toBe(0);

    await page.locator('#insp-body .insp-btn').filter({ hasText: /Add frequency change/ }).click();
    await expect.poll(() => page.evaluate(() => ({
      selected: state.selected,
      suppressions: state.commChangeSuppressions.slice(),
      notes: state.notes.map(n => ({ cc: n.cc || '', freqName: n.freqName || '', freq: n.freq || '' })),
    }))).toEqual({
      selected: { type: 'wp', index: 0, freqNoteIndex: 0 },
      suppressions: [],
      notes: [{ cc: 'TYONA', freqName: 'PLUTO', freq: '118.40' }],
    });
    await expect(page.locator('#insp-body .insp-btn').filter({ hasText: /Delete freq change/ })).toBeVisible();
  });

  test('deleted frequency-change callout stays deleted after refresh', async ({ page }) => {
    await installCommChangeFixture(page);
    await boot(page);
    await page.evaluate(t => {
      state.waypoints = [{ lat: t.lat, lng: t.lng, name: t.name }];
      state.notes = [];
      state.commChangeSuppressions = [];
      syncLegs();
      seedCommChangeNotes();
      state.selected = { type: 'wp', index: 0, freqNoteIndex: 0 };
      showInspector();
      draw();
    }, TYONA);
    await page.locator('#insp-body .insp-btn').filter({ hasText: /Delete freq change/ }).click();
    await page.waitForFunction(() => {
      const raw = localStorage.getItem('navaid.route');
      if (!raw) return false;
      try {
        const d = JSON.parse(raw);
        return d.waypoints.length === 1 &&
          d.notes.length === 0 &&
          Array.isArray(d.commChangeSuppressions) &&
          d.commChangeSuppressions.includes('TYONA');
      } catch (e) {
        return false;
      }
    });

    await page.reload();
    await page.waitForFunction(() => typeof state !== 'undefined' &&
      Array.isArray(state.waypoints) && state.waypoints.length === 1);
    await page.waitForFunction(() => window.commChangeMap && window.commChangeMap.TYONA &&
      Array.isArray(window.navWP) && window.navWP.length > 0);
    const after = await page.evaluate(() => {
      seedCommChangeNotes();
      state.selected = { type: 'wp', index: 0 };
      showInspector();
      return {
        waypoints: state.waypoints.map(w => w.name),
        notes: state.notes.map(n => ({ cc: n.cc || '', freqName: n.freqName || '' })),
        suppressions: state.commChangeSuppressions.slice(),
      };
    });
    expect(after).toEqual({
      waypoints: ['TYONA'],
      notes: [],
      suppressions: ['TYONA'],
    });
    await expect(page.locator('#insp-body .insp-btn').filter({ hasText: /Add frequency change/ })).toBeVisible();

    await page.locator('#insp-body .insp-btn').filter({ hasText: /Add frequency change/ }).click();
    await expect.poll(() => page.evaluate(() => ({
      notes: state.notes.map(n => ({
        cc: n.cc || '',
        hasFreqName: !!(n.freqName || '').trim(),
        hasFreq: !!(n.freq || '').trim(),
      })),
      suppressions: state.commChangeSuppressions.slice(),
    }))).toEqual({
      notes: [{ cc: 'TYONA', hasFreqName: true, hasFreq: true }],
      suppressions: [],
    });
  });

  test('waypoint inspector adds a manual frequency-change callout to non-dataset points', async ({ page }) => {
    await installCommChangeFixture(page);
    await boot(page);
    await page.evaluate(t => {
      state.waypoints = [{ lat: t.lat + 0.5, lng: t.lng + 0.5, name: 'NOPEX' }];
      state.notes = [];
      syncLegs();
      state.selected = { type: 'wp', index: 0 };
      showInspector();
      draw();
    }, TYONA);

    await expect(page.locator('#insp-body .insp-btn').filter({ hasText: /Add frequency change/ })).toBeVisible();
    await page.locator('#insp-body .insp-btn').filter({ hasText: /Add frequency change/ }).click();
    await expect(page.locator('#insp-body .commchange-name-row input')).toHaveValue('NOPEX');
    await expect(page.locator('#insp-body .commchange-freq-edit input')).toHaveValue('');

    await page.locator('#insp-body .commchange-name-row input').fill('Manual Control');
    await page.locator('#insp-body .commchange-freq-edit input').fill('123.45');
    await expect.poll(() => page.evaluate(() => state.notes.map(n => ({
      cc: n.cc || '',
      freqName: n.freqName || '',
      freq: n.freq || '',
    })))).toEqual([{ cc: 'NOPEX', freqName: 'Manual Control', freq: '123.45' }]);
    await expect(page.locator('#insp-body .insp-btn').filter({ hasText: /Delete freq change/ })).toBeVisible();
  });

  test('comm-change note inspector edits frequency without a free-text call-sign field', async ({ page }) => {
    await installCommChangeFixture(page);
    await boot(page);
    await page.evaluate(t => {
      state.waypoints = [{ lat: t.lat, lng: t.lng, name: t.name }];
      syncLegs();
      seedCommChangeNotes();
      state.selected = { type: 'note', index: 0 };
      showInspector();
    }, TYONA);
    const fields = page.locator('#insp-body .freq-input');
    await expect(fields).toHaveCount(1);
    await fields.nth(0).fill('119.20');
    const out = await page.evaluate(() => ({
      freqName: state.notes[0].freqName,
      freq: state.notes[0].freq,
      lines: noteLines(state.notes[0]),
    }));
    expect(out.freqName).toBe('PLUTO');
    expect(out.freq).toBe('119.20');
    expect(out.lines).toEqual(['PLUTO', '119.20']);
  });

  test('comm-change frequency input normalizes valid values and shows MHz', async ({ page }) => {
    await installCommChangeFixture(page);
    await boot(page);
    await page.evaluate(t => {
      state.waypoints = [{ lat: t.lat, lng: t.lng, name: t.name }];
      syncLegs();
      seedCommChangeNotes();
      state.selected = { type: 'note', index: 0 };
      showInspector();
    }, TYONA);
    const field = page.locator('#insp-body .freq-input').first();
    await expect(page.locator('#insp-body .freq-unit')).toHaveText('MHz');
    await expect(field).toHaveAttribute('type', 'number');
    await expect(field).toHaveAttribute('min', '118');
    await expect(field).toHaveAttribute('max', '136.975');
    await expect(field).toHaveAttribute('step', '0.005');
    await field.fill('118.4');
    await field.blur();
    await expect(field).toHaveValue('118.40');
    await expect(field).toHaveAttribute('aria-invalid', 'false');
    await expect(page.locator('#insp-body input.invalid')).toHaveCount(0);
    expect(await page.evaluate(() => state.notes[0].freq)).toBe('118.40');

    await field.fill('136.975');
    await field.blur();
    await expect(field).toHaveValue('136.975');
    expect(await page.evaluate(() => state.notes[0].freq)).toBe('136.975');
  });

  test('comm-change frequency input keeps MHz controls ordered in Hebrew RTL', async ({ page }) => {
    await installCommChangeFixture(page);
    await boot(page, 'he');
    await page.evaluate(t => {
      state.waypoints = [{ lat: t.lat, lng: t.lng, name: t.name }];
      syncLegs();
      seedCommChangeNotes();
      state.selected = { type: 'note', index: 0 };
      showInspector();
    }, TYONA);
    const row = page.locator('#insp-body .commchange-freq-edit').first();
    const label = row.locator('label');
    const control = row.locator('.commchange-freq-controls');
    const field = control.locator('.freq-input');
    const unit = control.locator('.freq-unit');
    const resetFreq = control.locator('.commchange-freq-reset');
    await expect(label).toHaveText('תדר');
    await expect(control).toHaveCSS('direction', 'ltr');
    const boxes = await Promise.all([
      label.boundingBox(),
      control.boundingBox(),
      field.boundingBox(),
      unit.boundingBox(),
      resetFreq.boundingBox(),
    ]);
    const [labelBox, controlBox, fieldBox, unitBox, resetBox] = boxes;
    expect(labelBox && controlBox && fieldBox && unitBox && resetBox).toBeTruthy();
    expect(labelBox.x).toBeGreaterThan(controlBox.x);
    expect(fieldBox.x).toBeLessThan(unitBox.x);
    expect(unitBox.x).toBeLessThan(resetBox.x);
  });

  test('comm-change frequency input rejects out-of-range values without storing them', async ({ page }) => {
    await installCommChangeFixture(page);
    await boot(page);
    await page.evaluate(t => {
      state.waypoints = [{ lat: t.lat, lng: t.lng, name: t.name }];
      syncLegs();
      seedCommChangeNotes();
      state.selected = { type: 'note', index: 0 };
      showInspector();
    }, TYONA);
    const field = page.locator('#insp-body .freq-input').first();
    const resetFreq = page.locator('#insp-body .commchange-freq-reset');
    await expect(resetFreq).toBeDisabled();
    await field.fill('137.00');
    await expect(field).toHaveAttribute('aria-invalid', 'true');
    await expect(resetFreq).toBeEnabled();
    expect(await page.evaluate(() => state.notes[0].freq)).toBe('118.40');
    await expect(resetFreq).toBeEnabled();
    await resetFreq.click();
    await expect(field).toHaveValue('118.40');
    await expect(field).toHaveAttribute('aria-invalid', 'false');
    await expect(resetFreq).toBeDisabled();
    const out = await page.evaluate(() => ({
      freq: state.notes[0].freq,
      stored: localStorage.getItem('navaid.route') || '',
    }));
    expect(out.freq).toBe('118.40');
    expect(out.stored).not.toContain('137.00');
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
    const sel = page.locator('#insp-body .commchange-name-row select').first();
    const labels = page.locator('#insp-body .row label');
    const values = page.locator('#insp-body .row .val');
    const auto = page.locator('#insp-body .commchange-name-row .commchange-auto-checkbox');
    const autoInline = page.locator('#insp-body .commchange-name-row .commchange-auto-inline');
    await expect(labels.nth(0)).toHaveText('Waypoint');
    await expect(labels.nth(1)).toHaveText('Call sign');
    await expect(labels.nth(2)).toHaveText('Frequency');
    await expect(values.nth(0)).toHaveText('Tel Yona');
    await expect(autoInline).toHaveText('Auto');
    expect(await page.evaluate(() => {
      const autoRect = document.querySelector('#insp-body .commchange-auto-inline').getBoundingClientRect();
      const selectRect = document.querySelector('#insp-body .commchange-name-row select').getBoundingClientRect();
      return autoRect.right <= selectRect.left;
    })).toBe(true);
    await expect(auto).toBeChecked();
    await expect(sel).toHaveValue('PLUTO');
    await expect(sel.locator('option:checked')).toHaveText('Pluto');
    await sel.selectOption('HAGAV');
    await expect(auto).not.toBeChecked();
    await expect(sel).toHaveValue('HAGAV');
    const fields = page.locator('#insp-body .freq-input');
    await expect(fields).toHaveCount(1);
    await expect(fields.nth(0)).toHaveValue('132.70');
    await expect(fields.nth(0)).toHaveClass(/is-default/);
    await fields.nth(0).fill('133.45');
    await expect(fields.nth(0)).not.toHaveClass(/is-default/);
    const out = await page.evaluate(() => ({
      freqName: state.notes[0].freqName,
      freq: state.notes[0].freq,
      lines: noteLines(state.notes[0]),
    }));
    expect(out.freqName).toBe('HAGAV');
    expect(out.freq).toBe('133.45');
    expect(out.lines).toEqual(['HAGAV', '133.45']);
  });

  test('edited call-sign frequency persists locally and applies to matching callouts', async ({ page }) => {
    const fixture = JSON.parse(JSON.stringify(FIXTURE));
    fixture.points = [
      { name: 'TYONA', commChange: true, callSigns: ['PLUTO', 'HAGAV'], to: 'Pluto 118.40' },
      { name: 'DEROR', commChange: true, callSigns: ['HERZLIYA'] },
      { name: 'DAROM', commChange: true, callSigns: ['HERZLIYA'] },
    ];
    await installCommChangeFixture(page, fixture);
    await boot(page);
    await page.evaluate(({ deror, darom }) => {
      localStorage.removeItem('navaid.commFreqOverrides');
      state.waypoints = [deror, darom];
      state.notes = [];
      syncLegs();
      seedCommChangeNotes();
      state.selected = { type: 'note', index: 0 };
      showInspector();
    }, { deror: DEROR, darom: DAROM });

    const fields = page.locator('#insp-body .freq-input');
    const resetFreq = page.locator('#insp-body .commchange-freq-reset');
    await expect(fields).toHaveCount(1);
    await expect(fields.first()).toHaveValue('122.20');
    await expect(fields.first()).toHaveClass(/is-default/);
    await expect(resetFreq).toHaveText('↻');
    await expect(resetFreq).toBeDisabled();
    await expect(resetFreq).toHaveAttribute('title', 'Reset frequency to default');
    await expect(page.locator('#insp-body .commchange-template')).toBeHidden();

    await fields.first().fill('125.60');
    await expect(fields.first()).not.toHaveClass(/is-default/);
    await expect(resetFreq).toBeEnabled();
    await expect(page.locator('#insp-body .commchange-template')).toBeVisible();
    await expect(page.locator('#insp-body .commchange-template label')).toHaveText('Default');
    await expect(page.locator('#insp-body .commchange-template .val')).toHaveText('122.20');

    const edited = await page.evaluate(() => ({
      overrides: JSON.parse(localStorage.getItem('navaid.commFreqOverrides') || '{}'),
      notes: state.notes.map(n => ({
        cc: n.cc,
        freqName: n.freqName,
        freq: n.freq,
        lines: noteLines(n),
      })),
    }));
    expect(edited.overrides).toEqual({ HERZLIYA: '125.60' });
    expect(edited.notes).toEqual([
      { cc: 'DEROR', freqName: 'HERZLIYA', freq: '125.60', lines: ['HERZLIYA', '125.60'] },
      { cc: 'DAROM', freqName: 'HERZLIYA', freq: '125.60', lines: ['HERZLIYA', '125.60'] },
    ]);

    await resetFreq.click();
    await expect(fields.first()).toHaveValue('122.20');
    await expect(fields.first()).toHaveClass(/is-default/);
    await expect(resetFreq).toBeDisabled();
    await expect(page.locator('#insp-body .commchange-template')).toBeHidden();
    const reverted = await page.evaluate(() => ({
      rawOverrides: localStorage.getItem('navaid.commFreqOverrides'),
      notes: state.notes.map(n => ({
        cc: n.cc,
        freqName: n.freqName,
        freq: n.freq,
        lines: noteLines(n),
      })),
    }));
    expect(reverted.rawOverrides).toBeNull();
    expect(reverted.notes).toEqual([
      { cc: 'DEROR', freqName: 'HERZLIYA', freq: '122.20', lines: ['HERZLIYA', '122.20'] },
      { cc: 'DAROM', freqName: 'HERZLIYA', freq: '122.20', lines: ['HERZLIYA', '122.20'] },
    ]);

    await fields.first().fill('125.60');
    const reseeded = await page.evaluate(() => {
      state.notes = [];
      seedCommChangeNotes();
      return state.notes.map(n => ({ cc: n.cc, freqName: n.freqName, freq: n.freq }));
    });
    expect(reseeded).toEqual([
      { cc: 'DEROR', freqName: 'HERZLIYA', freq: '125.60' },
      { cc: 'DAROM', freqName: 'HERZLIYA', freq: '125.60' },
    ]);
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
    const fields = page.locator('#insp-body .freq-input');
    const labels = page.locator('#insp-body .row label');
    const values = page.locator('#insp-body .row .val');
    const sel = page.locator('#insp-body .commchange-name-row select').first();
    const auto = page.locator('#insp-body .commchange-name-row .commchange-auto-checkbox');
    const autoInline = page.locator('#insp-body .commchange-name-row .commchange-auto-inline');
    await expect(labels.nth(0)).toHaveText('נקודת דיווח');
    await expect(labels.nth(1)).toHaveText('אות קריאה');
    await expect(labels.nth(2)).toHaveText('תדר');
    await expect(values.nth(0)).toHaveText('תל יונה');
    await expect(autoInline).toHaveText('אוט׳');
    expect(await page.evaluate(() => {
      const autoRect = document.querySelector('#insp-body .commchange-auto-inline').getBoundingClientRect();
      const selectRect = document.querySelector('#insp-body .commchange-name-row select').getBoundingClientRect();
      return autoRect.left >= selectRect.right;
    })).toBe(true);
    await expect(fields).toHaveCount(1);
    await expect(fields.nth(0)).toHaveValue('118.40');
    await expect(auto).toBeChecked();
    await expect(sel).toHaveValue('PLUTO');
    await expect(sel.locator('option:checked')).toHaveText('פלוטו');
    await sel.selectOption('HAGAV');
    await expect(auto).not.toBeChecked();
    await expect(sel.locator('option:checked')).toHaveText('חגב');
    await expect(fields.nth(0)).toHaveValue('132.70');
    const out = await page.evaluate(() => ({
      freqName: state.notes[0].freqName,
      freq: state.notes[0].freq,
      lines: noteLines(state.notes[0]),
    }));
    expect(out.freqName).toBe('HAGAV');
    expect(out.freq).toBe('132.70');
    expect(out.lines).toEqual(['חגב', '132.70']);
  });

  test('Hebrew stored call sign selects the matching dropdown option and default frequency', async ({ page }) => {
    await installCommChangeFixture(page);
    await boot(page, 'he');
    const out = await page.evaluate(t => {
      state.waypoints = [{ lat: t.lat, lng: t.lng, name: t.name }];
      state.notes = [{
        lat: t.lat + 0.012,
        lng: t.lng,
        text: 'שינוי תדר',
        color: '#fff6aa',
        shape: 'rect',
        cc: 'TYONA',
        freqName: 'חגב',
        freq: '',
      }];
      syncLegs();
      state.selected = { type: 'note', index: 0 };
      showInspector();
      return {
        freqName: state.notes[0].freqName,
        freq: state.notes[0].freq,
        lines: noteLines(state.notes[0]),
      };
    }, TYONA);
    const fields = page.locator('#insp-body .freq-input');
    const sel = page.locator('#insp-body .commchange-name-row select').first();
    await expect(fields).toHaveCount(1);
    await expect(fields.nth(0)).toHaveValue('132.70');
    await expect(sel).toHaveValue('HAGAV');
    await expect(sel.locator('option:checked')).toHaveText('חגב');
    expect(out.freqName).toBe('חגב');
    expect(out.freq).toBe('132.70');
    expect(out.lines).toEqual(['חגב', '132.70']);
  });

  test('comm-change frequencies are formatted with two decimals in callouts and inspector', async ({ page }) => {
    await installCommChangeFixture(page);
    await boot(page);
    const out = await page.evaluate(t => {
      state.waypoints = [{ lat: t.lat, lng: t.lng, name: t.name }];
      state.notes = [{
        lat: t.lat + 0.012,
        lng: t.lng,
        text: 'Freq change',
        color: '#fff6aa',
        shape: 'rect',
        cc: 'TYONA',
        freqName: 'PLUTO',
        freq: '118.4',
      }];
      syncLegs();
      state.selected = { type: 'note', index: 0 };
      showInspector();
      return {
        split: splitCommCalloutText('Haifa 133'),
        lines: noteLines(state.notes[0]),
      };
    }, TYONA);
    expect(out.split).toEqual({ name: 'Haifa', freq: '133.00' });
    expect(out.lines).toEqual(['PLUTO', '118.40']);
    const fields = page.locator('#insp-body .freq-input');
    await expect(fields).toHaveCount(1);
    await expect(fields.nth(0)).toHaveValue('118.40');
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

  test('search route-build seeds notes for comm-change airfield destinations', async ({ page }) => {
    await boot(page);
    const out = await page.evaluate(async () => {
      window.showCommChange = true;
      const ok = await buildRouteFromQuery('LLBS LLMZ');
      return {
        ok,
        waypoints: state.waypoints.map(w => w.name),
        notes: state.notes
          .filter(n => n.cc)
          .map(n => ({
            cc: n.cc,
            freqName: n.freqName,
            freq: n.freq,
            lines: noteLines(n),
          }))
          .sort((a, b) => a.cc.localeCompare(b.cc)),
      };
    });
    expect(out.ok).toBe(true);
    expect(out.waypoints).toEqual(['LLBS', 'LLMZ']);
    expect(out.notes).toEqual([
      { cc: 'LLBS', freqName: 'TEYMAN', freq: '122.50', lines: ['TEYMAN', '122.50'] },
      { cc: 'LLMZ', freqName: 'MASADA', freq: '122.55', lines: ['MASADA', '122.55'] },
    ]);
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

test.describe('airfield freq change auto-seeds the main frequency', () => {
  test('adding a freq change at an airfield picks its primary call-sign freq', async ({ page }) => {
    await installCommChangeFixture(page);
    await boot(page);
    const note = await page.evaluate(() => {
      // LLBG is an airfield (AIRFIELD_CALL_SIGN_IDS.LLBG = BEN_GURION, primary
      // 118.30 in the fixture) but not a route comm-change point.
      const wp = { lat: 32.0, lng: 34.88, name: 'LLBG' };
      state.waypoints = [wp];
      syncLegs();
      window.showCommChange = true;
      const idx = addCommChangeNoteForWaypoint(wp, waypointFreqChangeKey(wp));
      return state.notes[idx];
    });
    expect(note.cc).toBe('LLBG');
    expect(note.freq).toBe('118.30');       // Ben Gurion primary, auto-seeded
    expect(note.freqName).toBe('Ben Gurion');
    expect(note.freqAuto).toBe(true);
  });

  test('a non-airfield waypoint with no catalog freq is left blank', async ({ page }) => {
    await installCommChangeFixture(page);
    await boot(page);
    const note = await page.evaluate(() => {
      const wp = { lat: 32.4, lng: 35.2, name: 'ZZZZ' };   // not an airfield, not a comm point
      state.waypoints = [wp];
      syncLegs();
      window.showCommChange = true;
      const idx = addCommChangeNoteForWaypoint(wp, waypointFreqChangeKey(wp));
      return state.notes[idx];
    });
    expect(note.freq).toBe('');              // nothing to seed
  });
});

// Same-frequency suppression: crossing a SECOND comm-change point that publishes the same
// frequency as the one already in effect is not a change to make on the radio, so no note
// is worth seeding for it. Gated on confidence (see draw.js, seedCommChangeNotes): only
// suppresses when the SECOND point's callout came from an explicit routeHint, never from
// the general solver's tie-broken guess -- a real production bug (NTAIM/TYONA/SUPER, this
// session) showed the solver can coincidentally repeat a preceding frequency when the real
// answer differed, and suppressing on that would have hidden the note instead of just
// showing the wrong one.
const SUPPRESSION_FIXTURE = {
  version: 1,
  source: 'test fixture',
  callSigns: {
    X: { label: 'Xray', he: 'איקס', primary: '121.10' },
    Y: { label: 'Yankee', he: 'וואי', primary: '128.20' },
  },
  points: [
    // ALPHA has one call sign, X -- no ambiguity, no hint needed.
    { name: 'ALPHA', commChange: true, callSigns: ['X'] },
    // BETA has two, but a hint pins it to X specifically when heading to GAMMA --
    // high confidence: the maintainer says X applies on this leg.
    { name: 'BETA', commChange: true, callSigns: ['X', 'Y'],
      routeHints: [{ after: 'GAMMA', callSign: 'X' }] },
    // DELTA has the SAME two options as BETA but NO hint at all -- whatever it resolves
    // to is the general solver's guess, not a verified rule.
    { name: 'DELTA', commChange: true, callSigns: ['X', 'Y'] },
  ],
};
const ALPHA = { lat: 31.50, lng: 34.90, name: 'ALPHA' };
const BETA = { lat: 31.51, lng: 34.90, name: 'BETA' };
const GAMMA = { lat: 31.52, lng: 34.90, name: 'GAMMA' };
const DELTA = { lat: 31.51, lng: 34.90, name: 'DELTA' };   // same slot as BETA, different case

// Generic boot for a STANDALONE fixture: installCommChangeFixture's stubGraph
// concatenates onto whatever fixture came before it (no default is installed for these
// tests), so the shared boot()'s hard-wait on TYONA would hang forever here -- wait on
// whichever point NAME the fixture actually carries instead.
async function bootFixture(page, waitName, center, lang = 'en') {
  await page.addInitScript(() => {
    try {
      if (localStorage.getItem('__test_comm_init_v1') !== '1') {
        for (const k of Object.keys(localStorage)) localStorage.removeItem(k);
        sessionStorage.clear();
        for (const s of ['build', 'view', 'display', 'charts', 'export', 'print'])
          localStorage.setItem('navaid.sec.' + s, '1');
        localStorage.setItem('__test_comm_init_v1', '1');
      }
    } catch (e) {}
  });
  await page.goto('?lang=' + lang);
  await page.waitForFunction(() => typeof state !== 'undefined' &&
    typeof window.seedCommChangeNotes === 'function');
  await page.evaluate(() => loadNavWaypoints());
  await page.waitForFunction(() => Array.isArray(window.navWP) && window.navWP.length > 0);
  await page.evaluate(() => loadAirfields());
  await page.waitForFunction(() => Array.isArray(window.airfields) && window.airfields.length > 0);
  await page.evaluate(() => loadCommChange());
  await page.waitForFunction(n => window.commChangeMap && window.commChangeMap[n], waitName);
  await page.evaluate(() => { window.showCommChange = true; });
  await page.evaluate(t => map.setView([t.lat, t.lng], 12), center);
  await page.evaluate(() => {
    state.waypoints = [];
    state.legs = [];
    state.notes = [];
    state.commChangeSuppressions = [];
  });
}
async function bootSuppression(page, lang = 'en') {
  await bootFixture(page, 'ALPHA', ALPHA, lang);
}

test.describe('same-frequency suppression', () => {
  test('a HINTED point matching the frequency already in effect gets no note', async ({ page }) => {
    await installCommChangeFixture(page, SUPPRESSION_FIXTURE);
    await bootSuppression(page);
    const out = await page.evaluate(({ a, b, c }) => {
      state.waypoints = [a, b, c];
      syncLegs();
      seedCommChangeNotes();
      return state.notes.filter(n => n.cc).map(n => n.cc);
    }, { a: ALPHA, b: BETA, c: GAMMA });
    // ALPHA gets a note (nothing came before it). BETA's hinted callout (X, heading to
    // GAMMA) matches what ALPHA already put in effect -- no note for it.
    expect(out).toEqual(['ALPHA']);
  });

  test('an UNHINTED point is never suppressed, even if its guessed frequency happens to match', async ({ page }) => {
    await installCommChangeFixture(page, SUPPRESSION_FIXTURE);
    await bootSuppression(page);
    const out = await page.evaluate(({ a, d }) => {
      state.waypoints = [a, d];
      syncLegs();
      seedCommChangeNotes();
      const notes = state.notes.filter(n => n.cc);
      return { ccs: notes.map(n => n.cc), delta: notes.find(n => n.cc === 'DELTA') };
    }, { a: ALPHA, d: DELTA });
    // DELTA has no routeHint, so whatever the general solver picked for it is a GUESS, not
    // a verified rule -- even if that guess happens to equal ALPHA's X/121.10, DELTA still
    // gets its own note. Silently hiding it would be worse than showing a possibly-wrong one.
    expect(out.ccs).toContain('DELTA');
    expect(out.delta).toBeTruthy();
  });

  test('a genuine frequency change is never suppressed', async ({ page }) => {
    await installCommChangeFixture(page, SUPPRESSION_FIXTURE);
    await bootSuppression(page);
    // BETA heading to SORES (not GAMMA) doesn't match its routeHint's `after`, so it falls
    // to the solver -- but even so, a DIFFERENT resulting frequency must always show.
    const out = await page.evaluate(({ a, b }) => {
      state.waypoints = [a, b, { lat: 31.90917, lng: 34.89167, name: 'SORES' }];
      syncLegs();
      seedCommChangeNotes();
      return state.notes.filter(n => n.cc).map(n => n.cc);
    }, { a: ALPHA, b: BETA });
    expect(out).toContain('BETA');
  });

  test('a note seeded BEFORE the route matches its hint is retroactively removed once it does', async ({ page }) => {
    // The incremental-build case, as opposed to the all-at-once tests above: a route built
    // one waypoint at a time (manually, not via auto-route) seeds BETA's note while GAMMA
    // doesn't exist yet -- BETA's hint can't match (nothing to check `after` against), so
    // it falls to the guessed/static default and gets its own note (matches "an UNHINTED
    // point is never suppressed" above). ADDING GAMMA afterward makes BETA's hint fire for
    // real -- now genuinely redundant with ALPHA's already-active X -- but the note from
    // the first pass used to just sit there with an updated frequency, never actually
    // removed. Reported live: "when i set manually, it starts NTAIM with TEL_NOF, after
    // adding BOVED or NAGID, it changes, but doesn't suppress".
    await installCommChangeFixture(page, SUPPRESSION_FIXTURE);
    await bootSuppression(page);
    const out = await page.evaluate(({ a, b, c }) => {
      state.waypoints = [a, b];
      syncLegs();
      seedCommChangeNotes();
      const beforeGamma = state.notes.filter(n => n.cc).map(n => n.cc);
      state.waypoints = [a, b, c];
      syncLegs();
      seedCommChangeNotes();
      const afterGamma = state.notes.filter(n => n.cc).map(n => n.cc);
      return { beforeGamma, afterGamma };
    }, { a: ALPHA, b: BETA, c: GAMMA });
    expect(out.beforeGamma).toEqual(['ALPHA', 'BETA']);   // BETA unhinted yet -- not suppressed
    expect(out.afterGamma).toEqual(['ALPHA']);             // BETA's now-hinted note is gone
  });

  test('a note the pilot hand-edited is never retroactively removed, even if it becomes redundant', async ({ page }) => {
    await installCommChangeFixture(page, SUPPRESSION_FIXTURE);
    await bootSuppression(page);
    const out = await page.evaluate(({ a, b, c }) => {
      state.waypoints = [a, b];
      syncLegs();
      seedCommChangeNotes();
      const note = state.notes.find(n => n.cc === 'BETA');
      note.freqAuto = false;   // the pilot touched this note
      state.waypoints = [a, b, c];
      syncLegs();
      seedCommChangeNotes();
      return state.notes.filter(n => n.cc).map(n => n.cc);
    }, { a: ALPHA, b: BETA, c: GAMMA });
    expect(out).toEqual(['ALPHA', 'BETA']);   // still there -- hand-edited notes are never removed
  });
});

// A hint's `after` sometimes misses the immediate next drawn waypoint because an extra
// point got spliced in right after the comm-change point -- auto-route inserting a real
// corridor stop the hint was never written to expect. The tolerance isn't a fixed hop
// count: the hint's target can be any waypoint up to the NEXT comm-change point, however
// many stops away that is -- past that boundary the frequency has already changed again.
const LOOKAHEAD_FIXTURE = {
  version: 1,
  source: 'test fixture',
  callSigns: { X: { label: 'Xray', he: 'איקס', primary: '121.10' },
    Y: { label: 'Yankee', he: 'וואי', primary: '128.20' },
    Z: { label: 'Zulu', he: 'זד', primary: '119.90' } },
  points: [
    // ECHO's hint says "after: GOLF" -- written assuming GOLF is the immediate next point.
    // Y listed FIRST so the no-hint-match fallback (array-order tie-break, same mechanism
    // documented earlier this session) defaults to Y -- distinguishing "the hint fired and
    // gave X" from "the hint did not fire and the fallback happened to also say X".
    { name: 'ECHO', commChange: true, callSigns: ['Y', 'X'],
      routeHints: [{ after: 'GOLF', callSign: 'X' }] },
    // A second comm-change point: once the route passes HOTEL, ECHO's frequency is no
    // longer in force, so ECHO's hint must not reach past it.
    { name: 'HOTEL', commChange: true, callSigns: ['Z'] },
  ],
};
const ECHO = { lat: 31.60, lng: 34.90, name: 'ECHO' };
const FOXTROT = { lat: 31.61, lng: 34.90, name: 'FOXTROT' };   // an inserted point -- not comm-change
const GOLF = { lat: 31.62, lng: 34.90, name: 'GOLF' };
const HOTEL = { lat: 31.63, lng: 34.90, name: 'HOTEL' };

test.describe('a hint\'s after-target reached across the whole corridor to the next comm-change point', () => {
  test('still matches when an extra point is spliced in right after the comm-change point', async ({ page }) => {
    await installCommChangeFixture(page, LOOKAHEAD_FIXTURE);
    await bootFixture(page, 'ECHO', ECHO);
    const out = await page.evaluate(({ e, f, g }) => {
      // ECHO -> FOXTROT -> GOLF: FOXTROT sits where the hint expected GOLF directly.
      state.waypoints = [e, f, g];
      syncLegs();
      seedCommChangeNotes();
      const note = state.notes.find(n => n.cc === 'ECHO');
      return note ? { freqName: note.freqName, freq: note.freq } : null;
    }, { e: ECHO, f: FOXTROT, g: GOLF });
    expect(out).toEqual({ freqName: 'X', freq: '121.10' });
  });

  test('still matches many hops out, as long as no comm-change point comes first', async ({ page }) => {
    await installCommChangeFixture(page, LOOKAHEAD_FIXTURE);
    await bootFixture(page, 'ECHO', ECHO);
    const out = await page.evaluate(({ e, g }) => {
      // ECHO -> 4 plain waypoints -> GOLF: no fixed hop count, so this still fires.
      const filler = [1, 2, 3, 4].map(n => ({ lat: 31.60 + n * 0.001, lng: 34.90, name: 'FILL' + n }));
      state.waypoints = [e, ...filler, g];
      syncLegs();
      seedCommChangeNotes();
      const note = state.notes.find(n => n.cc === 'ECHO');
      return note ? { freqName: note.freqName, freq: note.freq } : null;
    }, { e: ECHO, g: GOLF });
    expect(out).toEqual({ freqName: 'X', freq: '121.10' });
  });

  test('does not reach past an intervening comm-change point -- that ends the corridor', async ({ page }) => {
    await installCommChangeFixture(page, LOOKAHEAD_FIXTURE);
    await bootFixture(page, 'ECHO', ECHO);
    const out = await page.evaluate(({ e, h, g }) => {
      // ECHO -> HOTEL -> GOLF: HOTEL is itself a comm-change point, so ECHO's frequency
      // is no longer in force by the time GOLF shows up -- the hint must not fire.
      state.waypoints = [e, h, g];
      syncLegs();
      seedCommChangeNotes();
      const note = state.notes.find(n => n.cc === 'ECHO');
      return note ? note.freqName : null;
    }, { e: ECHO, h: HOTEL, g: GOLF });
    expect(out).not.toBe('X');
  });
});

// A comm-change point can carry several routeHints, each written for a DIFFERENT possible
// next leg -- and the lookahead corridor above (commRouteAfterNames) can put more than one
// of their targets in range at once, if none of the intervening waypoints are themselves a
// comm-change point. Only the NEARER target is the leg actually being flown right now.
const RANKING_FIXTURE = {
  version: 1,
  source: 'test fixture',
  callSigns: {
    X: { label: 'Xray', he: 'איקס', primary: '121.10' },
    Y: { label: 'Yankee', he: 'וואי', primary: '128.20' },
    Z: { label: 'Zulu', he: 'זד', primary: '119.90' },
  },
  points: [
    { name: 'INDIA', commChange: true, callSigns: ['X'] },
    // KILO is reachable BEFORE LIMA on a route that visits both -- "after: KILO" must win
    // over "after: LIMA" whenever both are technically within lookahead range, not just
    // whichever happens to be listed first or produce a set with one element.
    { name: 'JULIET', commChange: true, callSigns: ['X', 'Y'],
      routeHints: [{ after: 'KILO', callSign: 'X' }, { after: 'LIMA', callSign: 'Y' }] },
    { name: 'LIMA', commChange: true, callSigns: ['Z'] },
  ],
};
const INDIA = { lat: 31.70, lng: 34.90, name: 'INDIA' };
const JULIET = { lat: 31.71, lng: 34.90, name: 'JULIET' };
const KILO = { lat: 31.72, lng: 34.90, name: 'KILO' };     // not itself comm-change
const LIMA = { lat: 31.73, lng: 34.90, name: 'LIMA' };

test.describe('a comm-change point with several routeHints picks the NEARER after-target', () => {
  test('JULIET -> KILO -> LIMA: KILO (closer) wins over LIMA, even though LIMA also matches', async ({ page }) => {
    await installCommChangeFixture(page, RANKING_FIXTURE);
    await bootFixture(page, 'INDIA', INDIA);
    const out = await page.evaluate(({ i, j, k, l }) => {
      state.waypoints = [i, j, k, l];
      syncLegs();
      seedCommChangeNotes();
      return state.notes.filter(n => n.cc).map(n => ({ cc: n.cc, freqName: n.freqName }));
    }, { i: INDIA, j: JULIET, k: KILO, l: LIMA });
    // INDIA (X) -- JULIET matches KILO (nearer, X) not LIMA (farther, Y): same X already in
    // effect, hinted, so JULIET is suppressed entirely. LIMA is a genuine change (Z), kept.
    expect(out).toEqual([{ cc: 'INDIA', freqName: 'X' }, { cc: 'LIMA', freqName: 'Z' }]);
  });

  test('regression: adding LIMA to an already-suppressed JULIET must not un-suppress it', async ({ page }) => {
    // The exact incremental sequence reported live: JULIET's note correctly suppresses once
    // KILO is added (matches INDIA's X), but adding LIMA afterward -- a real comm-change
    // point further down the corridor, with ITS OWN unrelated routeHint on JULIET -- used to
    // put both KILO and LIMA in range simultaneously, make the two hints disagree (X vs Y),
    // give up (ambiguous -> null), and fall through to an unrelated solver guess instead of
    // staying suppressed.
    await installCommChangeFixture(page, RANKING_FIXTURE);
    await bootFixture(page, 'INDIA', INDIA);
    const out = await page.evaluate(({ i, j, k, l }) => {
      const steps = [];
      state.waypoints = [i]; state.notes = []; syncLegs(); seedCommChangeNotes();
      steps.push(state.notes.filter(n => n.cc).map(n => n.cc));
      state.waypoints = [i, j]; syncLegs(); seedCommChangeNotes();
      steps.push(state.notes.filter(n => n.cc).map(n => n.cc));
      state.waypoints = [i, j, k]; syncLegs(); seedCommChangeNotes();
      steps.push(state.notes.filter(n => n.cc).map(n => n.cc));
      state.waypoints = [i, j, k, l]; syncLegs(); seedCommChangeNotes();
      steps.push(state.notes.filter(n => n.cc).map(n => n.cc));
      return steps;
    }, { i: INDIA, j: JULIET, k: KILO, l: LIMA });
    expect(out[2]).toEqual(['INDIA']);                // JULIET suppressed once KILO is added
    expect(out[3]).toEqual(['INDIA', 'LIMA']);         // still suppressed after LIMA joins too
  });
});

// A pilot's drawn route can SKIP a published corridor stop entirely, not just have an extra
// one spliced in -- NTAIM's own "after: BOVED" hint never matched a route drawn straight
// NTAIM -> YAVNE, even though the real published corridor between them passes through BOVED
// (same as fplExpandRoute already fills in for the filed ICAO plan). Uses the REAL shipped
// route graph (routeGraphDataSync), not a synthetic fixture -- the whole point is the real
// published corridor, which no fixture can stand in for.
test.describe('commRouteAfterNames folds in the published corridor, not just drawn waypoints', () => {
  test('CLORE -> TYONA -> NTAIM -> YAVNE -> ZASHD: NTAIM suppresses via BOVED on the real corridor', async ({ page }) => {
    await page.addInitScript(() => {
      try { for (const k of Object.keys(localStorage)) localStorage.removeItem(k); } catch (e) {}
    });
    await page.goto('?lang=en');
    await page.waitForFunction(() => typeof seedCommChangeNotes === 'function' &&
      typeof routeGraphData === 'function');
    await page.evaluate(() => loadCommChange());
    await page.waitForFunction(() => window.commChangeMap && window.commChangeMap.NTAIM);
    await page.evaluate(async () => {
      window.showCommChange = true;
      await routeGraphData('cvfr');   // resolved before seeding -- routeGraphDataSync needs it cached
    });
    const out = await page.evaluate(() => {
      state.waypoints = [
        { lat: 32.05306, lng: 34.73583, name: 'CLORE' },
        { lat: 32.00472, lng: 34.72722, name: 'TYONA' },
        { lat: 31.94361, lng: 34.78083, name: 'NTAIM' },
        { lat: 31.87194, lng: 34.75694, name: 'YAVNE' },
        { lat: 31.82611, lng: 34.70833, name: 'ZASHD' },
      ];
      state.notes = [];
      syncLegs();
      seedCommChangeNotes();
      return state.notes.filter(n => n.cc).map(n => ({ cc: n.cc, freqName: n.freqName }));
    });
    // NTAIM's PALMACHIM (via BOVED) matches TYONA's already-active PALMACHIM -- suppressed.
    // ZASHD keeps its own note: single-option static default, never a verified hint, so
    // never suppressed even though it also happens to be PALMACHIM (same policy as the
    // "an UNHINTED point is never suppressed" rule above).
    expect(out).toEqual([
      { cc: 'TYONA', freqName: 'PALMACHIM' },
      { cc: 'ZASHD', freqName: 'PALMACHIM' },
    ]);
  });
});
