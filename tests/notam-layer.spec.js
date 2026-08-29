// @ts-check
// NOTAM overlay + list. A scheduled Action publishes notam.json to the
// notam-data branch; the app draws areas on the canvas (toggle) and lists the
// full texts in a modal. Hidden/empty until data loads.
const { test, expect } = require('./_setup');

const NOTAM_RE = /notam-data\/notam\.json/;

const DATA = {
  generatedAt: '2026-06-23T09:00:00Z',
  source: 'FAA NOTAM API', fir: 'LLLL',
  notams: [
    { id: 'A0483/26', text: 'A0483/26 LLLL E) ATS RTE J14 CLSD BTN ZACCI-MEGID.', end: '2035-12-31T23:59:00Z',
      geom: { type: 'polygon', coords: [[32.0, 34.8], [32.2, 34.9], [31.9, 35.1]] } },
    { id: 'C1337/26', text: 'C1337/26 LLLL E) AREA AT RISHON LE-ZION CLSD DUE FIREFIGHTING.', end: '2035-07-01T00:00:00Z',
      geom: { type: 'circle', lat: 31.96, lng: 34.8, radiusNm: 3 } },
    { id: 'C1333/26', text: 'C1333/26 LLLL E) PJE AIRSPACE METZADA ACT FM 8000FT AMSL.', end: '', geom: null },
  ],
};

async function boot(page, body) {
  await page.route(NOTAM_RE, r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body || DATA) }));
  await page.addInitScript(() => { try { localStorage.setItem('navaid.sec.weather', '1'); localStorage.setItem('navaid.sec.charts', '1'); } catch (e) {} });
  await page.goto('?lang=en');
  await page.waitForFunction(() => typeof draw === 'function' && document.getElementById('notam-cb'));
}

test('airfield inspector links to its NOTAMs, or shows N/A when none', async ({ page }) => {
  await boot(page, { generatedAt: '2026-06-23T09:00:00Z', notams: [
    { id: 'B1/26', icao: 'LLBG', end: '', geom: null, text: 'B1 LLBG one.' },
    { id: 'B2/26', icao: 'LLBG', end: '', geom: null, text: 'B2 LLBG two.' },
  ] });
  await page.evaluate(() => loadAirfields && loadAirfields());
  await page.waitForFunction(() => Array.isArray(window.airfields) && airfields.length > 0);
  // LLBG has NOTAMs → a link with the count.
  await page.evaluate(() => {
    const i = airfields.findIndex(a => a.name === 'LLBG');
    state.selected = { type: 'airfield', index: i };
    showInspector();
  });
  const link = page.locator('#insp-body .insp-notam-link');
  await expect(link).toBeVisible();          // loads NOTAMs on demand, then renders
  await expect(link).toContainText('2');
  await link.click();
  await expect(page.locator('.notam-modal .notam-item')).toHaveCount(2);
  await page.locator('.notam-modal .modal-close-x').click();
  // An airfield with no NOTAMs → N/A.
  await page.evaluate(() => {
    const i = airfields.findIndex(a => a.name === 'LLHA');
    state.selected = { type: 'airfield', index: i };
    showInspector();
  });
  await expect(page.locator('#insp-body .notam-insp-row')).toContainText('N/A');
  await expect(page.locator('#insp-body .insp-notam-link')).toHaveCount(0);
});

test('airfield inspector can include future NOTAMs without leaving its ICAO', async ({ page }) => {
  const now = Date.now();
  const iso = value => new Date(value).toISOString();
  await boot(page, { generatedAt: iso(now), notams: [
    { id: 'B1/26', icao: 'LLBG', start: iso(now - 3600000), end: iso(now + 3600000),
      geom: null, text: 'LLBG ACTIVE' },
    { id: 'B2/26', icao: 'LLBG', start: iso(now + 900000), end: iso(now + 7200000),
      geom: null, text: 'LLBG FUTURE' },
    { id: 'H1/26', icao: 'LLHA', start: iso(now + 900000), end: iso(now + 7200000),
      geom: null, text: 'LLHA FUTURE' },
  ] });
  await page.evaluate(() => loadAirfields && loadAirfields());
  await page.waitForFunction(() => Array.isArray(window.airfields) && airfields.length > 0);
  await page.evaluate(() => {
    state.selected = { type: 'airfield', index: airfields.findIndex(a => a.name === 'LLBG') };
    showInspector();
    closeToolbarMenus();
  });

  const future = page.locator('#insp-body .notam-insp-future input');
  const link = page.locator('#insp-body .insp-notam-link');
  await expect(future).toBeVisible();
  await expect(future).not.toBeChecked();
  await expect(link).toContainText('1');
  await future.check();
  await expect(link).toContainText('2');
  await future.uncheck();
  await expect(link).toContainText('1');
  await future.check();
  await link.click();
  await expect(page.locator('.notam-modal .notam-item')).toHaveCount(2);
  await expect(page.locator('.notam-modal')).toContainText('LLBG FUTURE');
  await expect(page.locator('.notam-modal')).not.toContainText('LLHA FUTURE');
  await page.locator('.notam-modal .modal-close-x').click();

  // An airfield with no active entry still exposes the toggle that reveals its future one.
  await page.evaluate(() => {
    state.selected = { type: 'airfield', index: airfields.findIndex(a => a.name === 'LLHA') };
    showInspector();
    closeToolbarMenus();
  });
  const futureOnly = page.locator('#insp-body .notam-insp-future input');
  await expect(page.locator('#insp-body .insp-notam-link')).toHaveCount(0);
  await futureOnly.check();
  await expect(page.locator('#insp-body .insp-notam-link')).toContainText('1');
});

test('NOTAM list button reveals when data loads and lists all NOTAMs', async ({ page }) => {
  await boot(page);
  const btn = page.locator('#notam-list-btn');
  await expect(btn).toBeVisible();
  await btn.click();
  const modal = page.locator('.modal-back .notam-modal');
  await expect(modal).toBeVisible();
  await expect(modal.locator('.notam-item')).toHaveCount(3);
  await expect(modal).toContainText('A0483/26');
  await expect(modal).toContainText('METZADA');
  // Esc closes.
  await page.keyboard.press('Escape');
  await expect(page.locator('.modal-back .notam-modal')).toHaveCount(0);
});

test('toggling the overlay loads NOTAMs and draws without error', async ({ page }) => {
  await boot(page);
  await page.locator('#notam-cb').check();
  const s = await page.evaluate(() => ({ on: window.showNotam, n: Array.isArray(notams) ? notams.length : -1 }));
  expect(s.on).toBe(true);
  expect(s.n).toBe(3);
  // Update-time + timeline slider show in the panel once the overlay is on.
  await expect(page.locator('#notam-controls')).toBeVisible();
  await expect(page.locator('#notam-updated')).toContainText('2026-06-23 09:00Z');
  // Toggle persists across reload.
  await page.reload();
  await page.waitForFunction(() => document.getElementById('notam-cb'));
  await expect(page.locator('#notam-cb')).toBeChecked();
});

test('no NOTAMs → list button stays hidden', async ({ page }) => {
  await boot(page, { generatedAt: null, notams: [] });
  await page.waitForTimeout(400);
  await expect(page.locator('#notam-list-btn')).toBeHidden();
});

test('NOTAMs decode to plain English; Raw toggle shows the source text', async ({ page }) => {
  await boot(page, { generatedAt: '2026-06-23T09:00:00Z', notams: [
    { id: 'C0003/26', type: 'RDCS', end: 'PERM', geom: null, icao: 'LLLL',
      text: 'LLD41 ESTABLISHED BTN 2,000-8,000FT AMSL.\n   OPS WITH PPR FM ATC.\n   CTN ADZ.' },
  ] });
  // decodeNotam: Q-code head + expanded abbreviations.
  const dec = await page.evaluate(() => decodeNotam({
    type: 'RDCS', text: 'LLD41 ESTABLISHED BTN 2,000-8,000FT AMSL.\n   OPS WITH PPR FM ATC.' }));
  expect(dec).toContain('Danger area');             // RD subject
  expect(dec).toContain('installed');               // CS condition
  expect(dec).toContain('above mean sea level');    // AMSL expanded
  expect(dec).toContain('between');                 // BTN expanded
  await page.evaluate(() => document.getElementById('notam-list-btn').click());
  const modal = page.locator('.modal-back .notam-modal');
  await expect(modal.locator('.notam-text')).toContainText('above mean sea level');
  // Raw toggle flips to the original source text.
  await modal.locator('.notam-raw-toggle').click();
  await expect(modal.locator('.notam-text')).toContainText('AMSL');
  await expect(modal.locator('.notam-text')).not.toContainText('above mean sea level');
});

test('decodeNotam covers the extended Israel-FIR abbreviations and the XX condition', async ({ page }) => {
  await boot(page);
  const out = await page.evaluate(() => ({
    // FA subject + XX plain-language condition (e.g. FAXX in the live feed).
    xx: decodeNotam({ type: 'FAXX', text: '' }),
    // Newly added body abbreviations.
    abbr: decodeNotam({ type: '', text: 'TWY A CLSD. HEL FLT TRG WI CTR. LDG PROHIBITED.' }),
    // AIP part identifiers must stay literal (AD/ENR/GEN are NOT expanded).
    aip: decodeNotam({ type: '', text: 'ISRAEL AIP PART ENR 5.1 PAGE AD-2-LLBG PART GEN 3.1.' }),
    // ACT = adjective "active" per ICAO Doc 8400 ("METZADA ACT FM 8000FT" = active from).
    act: decodeNotam({ type: '', text: 'METZADA ACT FM 8000FT AMSL.' }),
  }));
  expect(out.xx).toContain('Aerodrome');            // FA subject
  expect(out.xx).toContain('plain language');       // XX condition
  // Sentence-cased since the plain-word pass: an expansion that starts a sentence
  // gets its capital back, so these match case-insensitively.
  expect(out.abbr).toMatch(/taxiway/i);             // TWY (sentence start → Taxiway)
  expect(out.abbr).toMatch(/helicopter/i);          // HEL
  expect(out.abbr).toContain('flight');             // FLT
  expect(out.abbr).toContain('training');           // TRG
  expect(out.abbr).toContain('control zone');       // CTR
  expect(out.abbr).toMatch(/landing/i);             // LDG
  // AIP citations preserved — no over-expansion of the part identifiers.
  expect(out.aip).toContain('PART ENR 5.1');
  expect(out.aip).toContain('AD-2-LLBG');
  expect(out.aip).toContain('PART GEN 3.1');
  expect(out.aip).not.toMatch(/en-route|aerodrome|general/);
  // ACT expands to the adjective "active", not the noun "activity".
  expect(out.act).toContain('active');
  expect(out.act).not.toContain('activity');
});

test('clicking an airport NOTAM badge opens the (scrollable) list, not the picker', async ({ page }) => {
  const many = [];
  for (let i = 0; i < 17; i++) {
    many.push({ id: 'B' + i + '/26', icao: 'LLBG', end: '', geom: null, text: 'B' + i + ' LLBG notam line.' });
  }
  await boot(page, { generatedAt: '2026-06-23T09:00:00Z', notams: many });
  await page.locator('#notam-cb').check();
  await page.evaluate(() => loadAirfields && loadAirfields());
  await page.waitForFunction(() => Array.isArray(window.airfields) && airfields.length > 0);
  // Close the preset-open toolbar dropdowns — in desktop-menubar mode they
  // overlay the map (the Charts menu now carries the SIGMET button too), so a
  // map click could land on a dropdown instead of the badge.
  await page.evaluate(() => window.closeToolbarMenus && window.closeToolbarMenus());
  // Click the LLBG count badge (disc at proj(field) offset +14px down).
  const box = await page.locator('#map').boundingBox();
  const pt = await page.evaluate(() => {
    const af = airfields.find(a => a.name === 'LLBG');
    const p = proj({ lat: af.lat, lng: af.lng });
    return { x: p.x, y: p.y + 14 };
  });
  await page.mouse.click(box.x + pt.x, box.y + pt.y);
  // Opens the NOTAM list (all 17), not the point-choice picker.
  await expect(page.locator('.notam-modal')).toBeVisible();
  await expect(page.locator('.point-choice-modal')).toHaveCount(0);
  // Title names the airfield, not the generic LLLL.
  await expect(page.locator('.notam-modal h3')).toContainText('LLBG');
  await expect(page.locator('.notam-modal h3')).not.toContainText('LLLL');
  await expect(page.locator('.notam-modal .notam-item')).toHaveCount(17);
  const canScroll = await page.evaluate(() => {
    const l = document.querySelector('.notam-list');
    return l.scrollHeight > l.clientHeight + 2;
  });
  expect(canScroll).toBe(true);
});

test('a NOTAM badge under a route waypoint stays selectable (drawn on top)', async ({ page }) => {
  await boot(page, { generatedAt: '2026-06-23T09:00:00Z', notams: [
    { id: 'B1/26', icao: 'LLBG', end: '', geom: null, text: 'B1 LLBG one.' },
    { id: 'B2/26', icao: 'LLBG', end: '', geom: null, text: 'B2 LLBG two.' },
  ] });
  await page.locator('#notam-cb').check();
  await page.evaluate(() => loadAirfields && loadAirfields());
  await page.waitForFunction(() => Array.isArray(window.airfields) && airfields.length > 0);
  // Put a route waypoint right on the LLBG field, then click the count badge.
  const pt = await page.evaluate(() => {
    const af = airfields.find(a => a.name === 'LLBG');
    state.waypoints = [{ lat: af.lat, lng: af.lng, name: 'LLBG' }];
    state.selected = null;
    if (typeof syncLegs === 'function') syncLegs();
    draw();
    const p = proj({ lat: af.lat, lng: af.lng });
    return { x: p.x, y: p.y + 14 };
  });
  // Close the preset-open toolbar dropdowns so they don't overlay the badge.
  await page.evaluate(() => window.closeToolbarMenus && window.closeToolbarMenus());
  const box = await page.locator('#map').boundingBox();
  await page.mouse.click(box.x + pt.x, box.y + pt.y);
  // The badge wins over the waypoint: NOTAM list opens, waypoint not selected.
  await expect(page.locator('.notam-modal')).toBeVisible();
  await expect(page.locator('.notam-modal .notam-item')).toHaveCount(2);
  expect(await page.evaluate(() => state.selected)).toBeNull();
});

test('a long single-airfield NOTAM list scrolls within the viewport', async ({ page }) => {
  const many = [];
  for (let i = 0; i < 40; i++) {
    many.push({ id: 'B' + i + '/26', icao: 'LLBG', end: '', geom: null, text: 'B' + i + ' LLBG notam line of text.' });
  }
  many.push({ id: 'A1/26', icao: 'LLLL', end: '', geom: null, text: 'global' });
  await boot(page, { generatedAt: '2026-06-23T09:00:00Z', notams: many });
  await page.evaluate(() => document.getElementById('notam-list-btn').click());
  await page.locator('.notam-modal .notam-filter-sel').selectOption('LLBG');
  const info = await page.evaluate(() => {
    const m = document.querySelector('.notam-modal');
    const l = document.querySelector('.notam-list');
    return {
      modalInView: m.getBoundingClientRect().bottom <= innerHeight + 1,
      canScroll: l.scrollHeight > l.clientHeight + 2,
    };
  });
  expect(info.modalInView).toBe(true);
  expect(info.canScroll).toBe(true);
  // The last item is reachable by scrolling the list.
  await page.locator('.notam-item').last().scrollIntoViewIfNeeded();
  await expect(page.locator('.notam-item').last()).toBeInViewport();
});

test('NOTAM list filters by airfield or global (LLLL)', async ({ page }) => {
  await boot(page, { generatedAt: '2026-06-23T09:00:00Z', notams: [
    { id: 'A0001/26', icao: 'LLLL', end: '', geom: null, text: 'A0001/26 LLLL global one.' },
    { id: 'A0002/26', icao: 'LLLL', end: '', geom: null, text: 'A0002/26 LLLL global two.' },
    { id: 'B0001/26', icao: 'LLBG', end: '', geom: null, text: 'B0001/26 LLBG Ben Gurion RWY.' },
    { id: 'H0001/26', icao: 'LLHA', end: '', geom: null, text: 'H0001/26 LLHA Haifa apron.' },
  ] });
  await page.evaluate(() => document.getElementById('notam-list-btn').click());
  const modal = page.locator('.modal-back .notam-modal');
  await expect(modal.locator('.notam-item')).toHaveCount(4);
  const sel = modal.locator('.notam-filter-sel');
  await expect(sel).toBeVisible();
  // Options: All + Global(FIR) + LLBG + LLHA, global first after All.
  await expect(sel.locator('option')).toHaveCount(4);
  // Modal height is locked so filtering doesn't make it jump (the list scrolls
  // inside it).
  const modalH = await modal.evaluate(el => Math.round(el.getBoundingClientRect().height));
  // Filter to one airfield.
  await sel.selectOption('LLBG');
  await expect(modal.locator('.notam-item')).toHaveCount(1);
  await expect(modal).toContainText('Ben Gurion');
  // Title scope follows the filter (airfield code, not LLLL).
  await expect(modal.locator('h3')).toContainText('(LLBG)');
  expect(await modal.evaluate(el => Math.round(el.getBoundingClientRect().height))).toBe(modalH);
  // Globals only.
  await sel.selectOption('LLLL');
  await expect(modal.locator('.notam-item')).toHaveCount(2);
  // Back to all.
  await sel.selectOption('');
  await expect(modal.locator('.notam-item')).toHaveCount(4);
});

test('NOTAM time-slider label matches the unified look-ahead format', async ({ page }) => {
  await boot(page);
  const labels = await page.evaluate(() => ({
    base: notamTimeLabel(0),
    ahead: notamTimeLabel(5),
  }));
  // Base = a bare Zulu clock; offset = "+Nh · <clock>" (same as the windfield
  // time slider).
  expect(labels.base).toMatch(/^(\d{2}-\d{2} )?\d{2}:\d{2}Z$/);
  expect(labels.ahead).toMatch(/^\+5h · (\d{2}-\d{2} )?\d{2}:\d{2}Z$/);
});

test('prose border NOTAMs are geocoded to buffer polygons', async ({ page }) => {
  // Borders served from the real data/notam-borders.json (not mocked).
  await boot(page, { generatedAt: '2026-06-23T09:00:00Z', notams: [
    { id: 'C1158/26', type: 'AELC', end: 'PERM', geom: null, icao: 'LLLL',
      text: 'AN AREA FM LEBANON BOUNDRAY TO 8KM SB CLSD TO ALL DOM FLT.' },
  ] });
  await page.locator('#notam-cb').check();
  const g = await page.evaluate(async () => {
    // buildNotamBorderAreas silently no-ops until the async notam-borders
    // fetch resolves — await it first or this flakes under CI load.
    if (typeof loadNotamBorders === 'function') await loadNotamBorders();
    if (typeof buildNotamBorderAreas === 'function') buildNotamBorderAreas();
    const n = notams.find(x => x.id === 'C1158/26');
    if (!n.geom || n.geom.type !== 'polygon') return null;
    const lat = n.geom.coords.map(c => c[0]), lng = n.geom.coords.map(c => c[1]);
    return { border: n.geom._border, pts: n.geom.coords.length,
      latMin: Math.min(...lat), latMax: Math.max(...lat),
      lngMin: Math.min(...lng), lngMax: Math.max(...lng) };
  });
  expect(g).not.toBeNull();
  expect(g.border).toBe('LEBANON');
  expect(g.pts).toBeGreaterThan(8);   // simplified arc + its offset, closed
  // Buffer sits along the northern (Lebanon) border, offset ~8km south.
  expect(g.latMin).toBeGreaterThan(32.8);
  expect(g.latMax).toBeLessThan(33.45);
  expect(g.lngMin).toBeGreaterThan(34.9);
  expect(g.lngMax).toBeLessThan(35.95);
});

test('a point within the border buffer is detected as inside the NOTAM', async ({ page }) => {
  await boot(page, { generatedAt: '2026-06-23T09:00:00Z', notams: [
    { id: 'BORDER/26', type: 'AELC', end: 'PERM', geom: null, icao: 'LLLL',
      text: 'AN AREA FM LEBANON BOUNDRAY TO 8KM SB CLSD TO ALL DOM FLT.' },
  ] });
  await page.locator('#notam-cb').check();
  const hits = await page.evaluate(async () => {
    if (typeof loadNotamBorders === 'function') await loadNotamBorders();
    if (typeof buildNotamBorderAreas === 'function') buildNotamBorderAreas();
    map.setView([33.15, 35.55], 10); draw();
    return {
      // A few km inland from the Lebanon border → inside the 8 km buffer.
      near: notamsAtLatLng({ lat: 33.2083, lng: 35.6333 }).map(n => n.id),
      // Well inside Israel, far from any border → outside.
      far: notamsAtLatLng({ lat: 32.20, lng: 34.90 }).map(n => n.id),
    };
  });
  expect(hits.near).toContain('BORDER/26');
  expect(hits.far).not.toContain('BORDER/26');
});

test('border NOTAM outline is solid, ordinary area outline is dashed', async ({ page }) => {
  await boot(page, { generatedAt: '2026-06-23T09:00:00Z', notams: [
    { id: 'BORDER/26', type: 'AELC', end: 'PERM', geom: null, icao: 'LLLL',
      text: 'AN AREA FM LEBANON BOUNDRAY TO 8KM SB CLSD TO ALL DOM FLT.' },
    { id: 'AREA/26', end: 'PERM', icao: 'LLLL', text: 'AREA CLSD.',
      geom: { type: 'polygon', coords: [[32.0, 34.8], [32.2, 34.9], [31.9, 35.1]] } },
  ] });
  await page.locator('#notam-cb').check();
  // Spy on setLineDash during a draw: a border area must stroke with no dash
  // ([] / empty), the ordinary polygon must stroke dashed ([6,4]).
  const dashes = await page.evaluate(async () => {
    if (typeof loadNotamBorders === 'function') await loadNotamBorders();
    if (typeof buildNotamBorderAreas === 'function') buildNotamBorderAreas();
    const seen = [];
    const orig = octx.setLineDash;
    octx.setLineDash = function (d) { seen.push((d || []).join(',')); return orig.call(this, d); };
    draw();
    octx.setLineDash = orig;
    return seen;
  });
  // The dashed-area pattern is set once per ordinary area (here: exactly one).
  expect(dashes.filter(d => d === '6,4').length).toBe(1);
});

test('timeline slider scrubs which NOTAMs are active', async ({ page }) => {
  const started = new Date(Date.now() - 36e5).toISOString();     // -1h (already active)
  const startIn12 = new Date(Date.now() + 12 * 3600e3).toISOString();
  const farEnd = new Date(Date.now() + 30 * 864e5).toISOString();
  await boot(page, { generatedAt: '2026-06-23T09:00:00Z', notams: [
    { id: 'N-NOW/26', text: 'active now', start: started, end: farEnd, geom: null, icao: 'LLBG' },
    { id: 'N-LATER/26', text: 'starts in 12h', start: startIn12, end: farEnd, geom: null, icao: 'LLHA' },
  ] });
  await page.locator('#notam-cb').check();
  // Overlay on → the shared look-ahead slider drives the NOTAM time.
  await expect(page.locator('#notam-controls')).toBeVisible();
  // At "now" only the started NOTAM is active.
  expect(await page.evaluate(() => activeNotams().length)).toBe(1);
  // Scrub the unified look-ahead slider to +18h → the later NOTAM joins.
  await page.locator('#lookahead-time').fill('18');
  await page.locator('#lookahead-time').dispatchEvent('input');
  expect(await page.evaluate(() => activeNotams().map(n => n.id).sort()))
    .toEqual(['N-LATER/26', 'N-NOW/26']);
  // Modal title reflects the scrubbed count.
  await page.evaluate(() => document.getElementById('notam-list-btn').click());
  await expect(page.locator('.modal-back .notam-modal h3')).toContainText('2');
});

test('CVFR route closures resolve named fixes to closed + diverted lines', async ({ page }) => {
  // Fix names are resolved against the real cvfr-nav-waypoints.json (not mocked).
  await boot(page, { generatedAt: '2026-06-23T09:00:00Z', notams: [
    { id: 'C1320/26', type: 'ARLC', end: 'PERM', geom: null, icao: 'LLLL',
      text: 'CVFR RTE CLSD:\n   NEGEV-HOVAV-OHLIM-OMMER-ZGOAL.\n   HOVAV-SOKET.\n'
          + '   TFC WILL BE DIVERTED VIA BKAMA-SOKET-ARRAD-ZOHAR' },
  ] });
  await page.locator('#notam-cb').check();
  const rl = await page.evaluate(() => {
    if (typeof buildNotamRouteLines === 'function') buildNotamRouteLines();
    const n = notams.find(x => x.id === 'C1320/26');
    return (n._routeLines || []).map(l => ({ kind: l.kind, pts: l.coords.length }));
  });
  const closed = rl.filter(l => l.kind === 'closed');
  const diverted = rl.filter(l => l.kind === 'diverted');
  expect(closed.length).toBeGreaterThanOrEqual(2);   // multiple closed segments
  expect(diverted.length).toBe(1);                   // one reroute
  expect(closed.every(l => l.pts >= 2)).toBe(true);
});

test('clicking a NOTAM area on the map opens just that NOTAM', async ({ page }) => {
  await boot(page);
  await page.locator('#notam-cb').check();
  // notamsAtLatLng hit-tests in canvas space via proj(); a point inside the
  // C1337/26 circle (centre 31.96/34.8) should resolve to that NOTAM alone.
  const hit = await page.evaluate(() => {
    const got = notamsAtLatLng({ lat: 31.96, lng: 34.8 });
    return { ids: got.map(n => n.id) };
  });
  expect(hit.ids).toContain('C1337/26');
  // The single-NOTAM modal shows the clicked subset, not the full list.
  await page.evaluate(() => showNotamModal(notamsAtLatLng({ lat: 31.96, lng: 34.8 })));
  const modal = page.locator('.modal-back .notam-modal');
  await expect(modal).toBeVisible();
  await expect(modal.locator('.notam-item')).toHaveCount(1);
  await expect(modal).toContainText('C1337/26');
  await expect(modal).not.toContainText('A0483/26');
});

test('clicking a NOTAM in the list closes the modal and blinks it on the map', async ({ page }) => {
  await boot(page);
  // Overlay off to start; clicking a list item should also turn it on.
  await page.evaluate(() => document.getElementById('notam-list-btn').click());
  const modal = page.locator('.modal-back .notam-modal');
  await expect(modal).toBeVisible();
  // C1337/26 is a circle area → mappable → clickable.
  const item = modal.locator('.notam-item.notam-item-clickable', { hasText: 'C1337/26' });
  await expect(item).toHaveCount(1);
  await item.click();
  // Modal closes, overlay turns on, and the NOTAM is flashing.
  await expect(page.locator('.modal-back .notam-modal')).toHaveCount(0);
  expect(await page.evaluate(() => window.showNotam)).toBe(true);
  expect(await page.evaluate(() => typeof flashNotam === 'function')).toBe(true);
  expect(await page.evaluate(() => window.notamMappable(
    activeNotams().find(n => n.id === 'C1337/26')))).toBe(true);
  // The view is framed on the NOTAM (circle centred at 31.96/34.8).
  await expect.poll(async () => page.evaluate(() => {
    const c = map.getCenter();
    return Math.abs(c.lat - 31.96) < 0.5 && Math.abs(c.lng - 34.8) < 0.5;
  })).toBe(true);
});

test('NOTAM appears in the multi-select point picker', async ({ page }) => {
  await boot(page);
  await page.locator('#notam-cb').check();
  await page.evaluate(() => loadAirfields && loadAirfields());
  // A spot where a NOTAM overlaps another marker offers both in the picker.
  await page.evaluate(() => {
    const n = activeNotams().find(x => x.id === 'C1337/26');
    showPointChoice([{ type: 'airfield', index: 0 }, { type: 'notam', notam: n }]);
  });
  const picker = page.locator('.point-choice-modal');
  await expect(picker).toBeVisible();
  await expect(picker.locator('.point-choice-option')).toHaveCount(2);
  await expect(picker).toContainText('C1337/26');
  // Choosing the NOTAM option opens its text.
  await picker.locator('.point-choice-option', { hasText: 'C1337/26' }).click();
  await expect(page.locator('.notam-modal')).toBeVisible();
  await expect(page.locator('.notam-modal .notam-item')).toHaveCount(1);
});

test('expired NOTAMs are filtered out; modal shows the active count', async ({ page }) => {
  const past = new Date(Date.now() - 864e5).toISOString();      // yesterday
  const future = new Date(Date.now() + 864e5).toISOString();
  await boot(page, { generatedAt: '2026-06-23T09:00:00Z', notams: [
    { id: 'X1/26', text: 'active', end: future, geom: null, icao: 'LLBG' },
    { id: 'X2/26', text: 'expired', end: past, geom: null, icao: 'LLBG' },
    { id: 'X3/26', text: 'perm', end: 'PERM', geom: null, icao: 'LLHA' },
  ] });
  await page.evaluate(() => document.getElementById('notam-list-btn').click());
  const modal = page.locator('.modal-back .notam-modal');
  await expect(modal.locator('.notam-item')).toHaveCount(2);    // expired dropped
  await expect(modal.locator('h3')).toContainText('2');         // active count in title
  await expect(modal).not.toContainText('X2/26');
});

test('empty NOTAM feed grays out and disables the Show NOTAMs toggle', async ({ page }) => {
  await boot(page, { generatedAt: '2026-06-23T09:00:00Z', notams: [] });
  // Boot loads the (empty) feed, then refreshNotamListBtn disables the toggle.
  const cb = page.locator('#notam-cb');
  await expect(cb).toBeDisabled();
  const label = page.locator('label').filter({ has: cb });
  await expect(label).toHaveClass(/navtoggle-disabled/);
  await expect(page.locator('#notam-list-btn')).toBeHidden();
});

test('empty feed unchecks the NOTAM toggle but preserves the saved on-preference', async ({ page }) => {
  await page.addInitScript(() => { try { localStorage.setItem('navaid.showNotam', '1'); } catch (e) {} });
  await boot(page, { generatedAt: '2026-06-23T09:00:00Z', notams: [] });
  await expect(page.locator('#notam-cb')).not.toBeChecked();      // turned off in-memory
  const pref = await page.evaluate(() => localStorage.getItem('navaid.showNotam'));
  expect(pref).toBe('1');                                          // preference NOT wiped
});

test('the decoder keeps MAY the modal and does not capitalize at feed line-wraps', async ({ page }) => {
  await boot(page);
  const out = await page.evaluate(() => ({
    modal: decodeNotam({ type: '', text: 'PILOTS MAY CTC TWR ON 122.5.' }),
    wrap: decodeNotam({ type: '', text: 'AN EXER WILL TAKE\nPLACE IN THE AREA.' }),
    date: decodeNotam({ type: '', text: 'WEF 15 MAY 2027.' }),
  }));
  expect(out.modal).toContain('may contact tower');   // modal verb, lowercase mid-sentence
  expect(out.wrap).toContain('take\nplace');          // hard wrap is not a sentence start
  expect(out.wrap.startsWith('An exercise')).toBe(true);
  expect(out.date).toContain('15 MAY 2027');          // dates keep their month untouched
});

test('MAY next to a runway or frequency number is the modal, not misread as a day', async ({ page }) => {
  // A 1-2 digit number right before MAY looks like a day at a glance, but RWY pairs and
  // frequencies routinely sit there too -- only a day with a clean boundary in front of
  // it (not the tail of "09/27" or "118.3") counts as a date. A single runway number
  // ("RWY 27 MAY BE CLSD") is caught by the facility noun in front of the number.
  await boot(page);
  const out = await page.evaluate(() => ({
    rwy: decodeNotam({ type: '', text: 'RWY 09/27 MAY BE CLOSED DUE WIP.' }),
    rwySingle: decodeNotam({ type: '', text: 'RWY 27 MAY BE CLSD DUE WIP.' }),
    twy: decodeNotam({ type: '', text: 'TWY 3 MAY BE CLSD DUE WIP.' }),
    freq: decodeNotam({ type: '', text: 'FREQ 118.3 MAY CHANGE WITHOUT NOTICE.' }),
    bareMonth: decodeNotam({ type: '', text: 'TRIGGER NOTAM WEF 03 SEP 2026 MAY 2026 UPDATE.' }),
  }));
  expect(out.rwy).toContain('09/27 may BE CLOSED');   // slash keeps 27 from looking like a day
  expect(out.rwySingle).toContain('27 may BE closed'); // "runway" in front → designator, not a day
  expect(out.twy).toContain('3 may BE closed');
  expect(out.freq).toContain('118.3 may CHANGE');
  expect(out.bareMonth).toContain('MAY 2026');        // a bare month+year still reads as a date
});

test('a date keeps its month even when BE or NOT follows it', async ({ page }) => {
  // Round 5 disambiguated "RWY 27 MAY BE CLSD" by looking for BE/NOT AFTER may. Dates take
  // exactly the same predicates ("on the 27th of May it will not be available"), so that
  // lowercased the month on any date phrased that way. The decision belongs BEFORE the
  // number instead: a facility noun makes it a designator, anything else leaves it a day.
  await boot(page);
  const out = await page.evaluate(() => ({
    dateNot: decodeNotam({ type: '', text: 'WEF 27 MAY NOT AVBL.' }),
    dateBe: decodeNotam({ type: '', text: '08 MAY BE CLSD.' }),
    rwyNot: decodeNotam({ type: '', text: 'RWY 27 MAY NOT BE AVBL.' }),
  }));
  expect(out.dateNot).toContain('27 MAY not');        // the 27th of May — month keeps its case
  expect(out.dateBe).toContain('08 MAY BE');
  expect(out.rwyNot).toContain('27 may not');         // runway 27 — still the modal (NOT expands)
});

test('a 2-digit day-of-month with no trailing year still reads as a date', async ({ page }) => {
  // Round 4's fix for RWY/FREQ numbers ("15 MAY" -- prec absorbing the day's own
  // leading digit) misread a genuine 2-digit day with nothing following it as the
  // modal verb.
  await boot(page);
  const out = await page.evaluate(() => ({
    noYear: decodeNotam({ type: '', text: 'CTC ATC 15 MAY FOR DETAILS.' }),
    withTime: decodeNotam({ type: '', text: 'ARR NO LATER THAN 25 MAY 1400LT.' }),
    oneDigit: decodeNotam({ type: '', text: 'CTC ATC 5 MAY FOR DETAILS.' }),
  }));
  expect(out.noYear).toContain('15 MAY for');    // FOR is a plain-word table entry
  expect(out.withTime).toContain('25 MAY 1400LT');
  expect(out.oneDigit).toContain('5 MAY for');
});
