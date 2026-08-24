// @ts-check
// Three things that were available when they should not have been, and one that was not
// when it should: a turning point on a one-way route, Fit page to route before a page had
// been chosen by hand, and a page frame that outlived the route it was chosen for.
const { test, expect } = require('./_setup');

async function boot(page) {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof state !== 'undefined' &&
    Array.isArray(window.airfields) && window.airfields.length > 0);
}

// A loop out of LLHZ: comes home, but no leg retraces, so the geometry cannot settle the
// turn and the mark is the only way to name it. Waypoint 1 is selected, ready to mark.
async function loop(page) {
  await page.evaluate(() => {
    const hz = airfields.find(a => a.name === 'LLHZ');
    state.waypoints = [
      { lat: hz.lat, lng: hz.lng, name: 'LLHZ' },
      { lat: hz.lat + 0.30, lng: hz.lng + 0.10, name: 'FAR' },
      { lat: hz.lat + 0.10, lng: hz.lng + 0.30, name: 'SIDE' },
      { lat: hz.lat, lng: hz.lng, name: 'LLHZ' },
    ];
    syncLegs();
    draw();
    state.selected = { type: 'wp', index: 1 };
    showInspector();
  });
}

// A route from airfield codes, so its ends are real fields, with one plain waypoint in the
// middle: the inspector offers the turning point on route waypoints, not on airfields.
async function route(page, codes) {
  await page.evaluate((list) => {
    state.waypoints = list.map((c, i) => {
      const af = airfields.find(a => a.name === c);
      if (!af) return { lat: 32.05 + i / 20, lng: 34.85 + i / 20, name: c };
      return (i === 0 || i === list.length - 1)
        ? { lat: af.lat, lng: af.lng, name: af.name }
        : { lat: af.lat + 0.02, lng: af.lng + 0.02, name: 'MID' };
    });
    syncLegs();
    draw();                      // the fit probe measures the ink the last draw laid down
    state.selected = { type: 'wp', index: 1 };
    showInspector();
  }, codes);
}

const turnBtn = (page) => page.evaluate(() => {
  const b = document.getElementById('insp-turn-btn');
  return b && { disabled: b.disabled, title: b.title, text: b.textContent };
});

// The mark is for a route whose geometry cannot settle the turn. A loop comes home without
// retracing anything, so it is the case the button exists for.
test('a loop that comes home offers the turning point', async ({ page }) => {
  await boot(page);
  await loop(page);
  expect((await turnBtn(page)).disabled).toBe(false);
});

// ...and a route that doubles back settles it on its own: the inspector says so and offers
// no button, because clearing it would leave a visibly retracing route with no turn.
test('a route that doubles back states its turn instead of offering one', async ({ page }) => {
  await boot(page);
  await route(page, ['LLHZ', 'LLIB', 'LLHZ']);
  expect(await turnBtn(page)).toBeNull();
  const stated = await page.evaluate(() => {
    const el = document.getElementById('insp-turn-status');
    return el && el.textContent;
  });
  expect(stated).toMatch(/turning point/i);
});

test('a one-way route dims it, and says why', async ({ page }) => {
  await boot(page);
  await route(page, ['LLHZ', 'LLIB', 'LLBS']);
  const b = await turnBtn(page);
  expect(b.disabled).toBe(true);
  expect(b.title).toMatch(/returns to the airfield it started from/i);
});

// A route edited into a one-way trip must not be left holding a mark nothing can use.
test('an existing turn can still be cleared on a one-way route', async ({ page }) => {
  await boot(page);
  await loop(page);
  await page.evaluate(() => document.getElementById('insp-turn-btn').click());
  await page.evaluate(() => {
    const af = airfields.find(a => a.name === 'LLBS');
    state.waypoints[state.waypoints.length - 1] = { lat: af.lat, lng: af.lng, name: af.name };
    syncLegs();
    state.selected = { type: 'wp', index: 1 };
    showInspector();
  });
  const b = await turnBtn(page);
  expect(b.text).toMatch(/clear/i);
  expect(b.disabled).toBe(false);
});

test('Fit page to route works before any page size is chosen', async ({ page }) => {
  await boot(page);
  // A short circuit, so a page CAN hold it: LLHZ to Rosh Pina and back needs more paper
  // than A3, which is a different (already covered) answer.
  await route(page, ['LLHZ', 'LLHZ', 'LLHZ']);
  await page.evaluate(() => { pageSize = null; refreshPrintFit(); });
  const before = await page.evaluate(() => ({
    size: pageSize,
    disabled: document.getElementById('print-fit').disabled,
  }));
  expect(before).toEqual({ size: null, disabled: false });
  await page.evaluate(() => document.getElementById('print-fit').click());
  // It proposes one: the smallest sheet that holds the route.
  expect(await page.evaluate(() => pageSize)).toMatch(/^A[34]/);
});

test('with no route there is still nothing to fit', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => { state.waypoints = []; syncLegs(); pageSize = null; refreshPrintFit(); });
  expect(await page.evaluate(() => document.getElementById('print-fit').disabled)).toBe(true);
});

test('Clear map takes the page frame with the route', async ({ page }) => {
  await boot(page);
  await route(page, ['LLHZ', 'LLIB', 'LLHZ']);
  await page.evaluate(() => setPage('A4'));
  expect(await page.evaluate(() => pageSize)).toBe('A4');
  page.on('dialog', d => d.accept());
  await page.evaluate(() => document.getElementById('clear').click());
  const after = await page.evaluate(() => ({
    size: pageSize,
    stored: localStorage.getItem('navaid.pageSize'),
    wps: state.waypoints.length,
  }));
  expect(after).toEqual({ size: null, stored: null, wps: 0 });
});

// Reported: "why is fit page to route dimmed always now?" — with a long cross-country and no
// page chosen, the button dimmed and said nothing. A3 (and A4×2, the same frame) covers
// 56.7 × 40.1 nm of ground at 1:250 000, so Herzliya → Rosh Pina genuinely fits no sheet.
// Dimming for a real reason is fine; dimming silently is not.
test('a route too big for any sheet says so, with or without a page chosen', async ({ page }) => {
  await boot(page);
  await route(page, ['LLHZ', 'LLIB', 'LLHZ']);            // ~78 nm across: bigger than A3
  const noPage = await page.evaluate(() => {
    pageSize = null; refreshPrintFit();
    const b = document.getElementById('print-fit');
    const w = document.getElementById('print-clip-warn');
    return { disabled: b.disabled, title: b.title, warnHidden: w.hidden, warn: w.textContent };
  });
  expect(noPage.disabled).toBe(true);
  expect(noPage.warnHidden).toBe(false);                  // the reason is on screen
  expect(noPage.warn).toMatch(/no page size holds/i);
  expect(noPage.title).toMatch(/no page size holds/i);
});

test('with no route the button says to draw one', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => { state.waypoints = []; syncLegs(); draw(); pageSize = null; refreshPrintFit(); });
  const b = await page.evaluate(() => {
    const el = document.getElementById('print-fit');
    return { disabled: el.disabled, title: el.title };
  });
  expect(b.disabled).toBe(true);
  expect(b.title).toMatch(/draw a route first/i);
});

// Review finding: on a route that does NOT come home but whose geometry retraces, the app
// still applies a turning point (legRetraceTurnIndex finds it, the leg-direction filter uses
// it, the button draws as pressed) -- so disabling the button left a pilot unable to move or
// clear a mark the app was acting on.
test('a proven turn stays in force on a route that does not come home', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => {
    const hz = airfields.find(a => a.name === 'LLHZ'), bs = airfields.find(a => a.name === 'LLBS');
    state.waypoints = [
      { lat: hz.lat, lng: hz.lng, name: 'LLHZ' },
      { lat: hz.lat + 0.3, lng: hz.lng + 0.1, name: 'FAR' },
      { lat: hz.lat, lng: hz.lng, name: 'LLHZ' },      // the leg back retraces the leg out
      { lat: bs.lat, lng: bs.lng, name: 'LLBS' },      // ...then it goes somewhere else
    ];
    syncLegs(); draw();
    state.selected = { type: 'wp', index: 1 }; showInspector();
  });
  const out = await page.evaluate(() => ({
    retrace: legRetraceTurnIndex(),
    home: routeReturnsHome(),
    button: !!document.getElementById('insp-turn-btn'),
    stated: (document.getElementById('insp-turn-status') || {}).textContent || '',
  }));
  expect(out.home).toBe(false);          // it does not come home...
  expect(out.retrace).toBe(1);           // ...but the retraced leg still proves the turn
  expect(out.button).toBe(false);        // which nothing here can move
  expect(out.stated).toMatch(/turning point/i);
});

// The one-way rule still governs the MARK, which is what a route without proof depends on.
test('a hand-set turn stays clearable after the route becomes one-way', async ({ page }) => {
  await boot(page);
  await loop(page);
  await page.evaluate(() => document.getElementById('insp-turn-btn').click());
  await page.evaluate(() => {
    const bs = airfields.find(a => a.name === 'LLBS');
    state.waypoints[state.waypoints.length - 1] = { lat: bs.lat, lng: bs.lng, name: 'LLBS' };
    syncLegs();
    state.selected = { type: 'wp', index: 1 };
    showInspector();
  });
  const b = await turnBtn(page);
  expect(b.disabled).toBe(false);
  expect(b.text).toMatch(/clear/i);
});

// The probe measures every piece of ink the route lays down, and refreshPrintFit runs from
// draw() -- on every pan, zoom and drag. It must be asked only when its answer is used.
test('the fit probe is not run on every draw of a route that fits', async ({ page }) => {
  await boot(page);
  await route(page, ['LLHZ', 'LLHZ', 'LLHZ']);
  const calls = await page.evaluate(() => {
    setPage('A3'); draw();
    const orig = window.fitPageToRoute;
    let n = 0;
    window.fitPageToRoute = function () { n++; return orig.apply(this, arguments); };
    refreshPrintFit();
    window.fitPageToRoute = orig;
    return n;
  });
  expect(calls).toBe(0);
});

test('Clear map forgets where the sheet had been dragged', async ({ page }) => {
  await boot(page);
  await route(page, ['LLHZ', 'LLHZ', 'LLHZ']);
  page.on('dialog', d => d.accept());
  await page.evaluate(() => {
    setPage('A4');
    pageOffset = { x: 120, y: -80 };
    document.getElementById('clear').click();
  });
  expect(await page.evaluate(() => ({ size: pageSize, off: pageOffset })))
    .toEqual({ size: null, off: { x: 0, y: 0 } });
});
