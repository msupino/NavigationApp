// @ts-check
// Option B, first slice: a data strip along the top and a deck of five targets along the
// bottom, on narrow screens only. On by default (`featureMobileDeck`); `?deck=0` puts the
// floating menu back without waiting for a config push.
//
// The point is where the furniture sits, not what it does: every deck button drives a control
// that already exists by clicking it, so the state, the persistence and the existing tests of
// those controls all still hold. What changes is that Record and Location are at the bottom
// edge under a thumb instead of in the top-left corner, and the numbers are readable with
// every panel shut.
const { test, expect } = require('./_setup');

const PHONE = { width: 390, height: 844 };

async function boot(page, opts) {
  const o = opts || {};
  await page.setViewportSize(o.size || PHONE);
  await page.goto('?lang=en&nogist' + (o.deck === false ? '&deck=0' : ''));
  await page.waitForFunction(() => typeof draw === 'function' && window.NavAid
    && typeof NavAid.refreshMobileDeck === 'function');
  await page.evaluate(() => {
    const b = document.getElementById('boot-loading');
    if (b) b.remove();
    document.documentElement.classList.remove('app-booting');
  });
}

const route = (page) => page.evaluate(() => {
  state.waypoints = [{ lat: 32.0, lng: 34.9, name: 'HRTZ' }, { lat: 32.3, lng: 35.1, name: 'LLEV' }];
  syncLegs();
  draw();
});

test('the gist can put the floating menu back', async ({ page }) => {
  await boot(page, { deck: false });
  await expect(page.locator('#deck-bar')).toHaveCount(0);
  await expect(page.locator('#deck-strip')).toHaveCount(0);
  expect(await page.evaluate(() => document.body.classList.contains('deck-on'))).toBe(false);
});

test('a phone gets the strip and the deck', async ({ page }) => {
  await boot(page);
  await expect(page.locator('#deck-bar')).toBeVisible();
  const labels = await page.locator('.deck-btn-label').allTextContents();
  expect(labels).toEqual(['Map', 'Menu', 'Plan', 'Record', 'Location']);
  // The deck replaces the closed menu card in its corner: everything it held is on the deck
  // or one tap inside it, and two menus for one app is how the corner got crowded.
  expect(await page.evaluate(() => getComputedStyle(document.getElementById('toolbar')).display)).toBe('none');
});

test('a desktop is not given a phone deck', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof draw === 'function');
  await expect(page.locator('#deck-bar')).toHaveCount(0);
});

test('the strip names the flight, and follows an edit', async ({ page }) => {
  await boot(page);
  await expect(page.locator('.deck-strip-leg')).toHaveText('No route');
  await route(page);
  await expect(page.locator('.deck-strip-leg')).toHaveText('HRTZ → LLEV');
  await page.evaluate(() => {
    state.waypoints.push({ lat: 32.6, lng: 35.3, name: 'MEGID' });
    syncLegs();
    draw();
  });
  await expect(page.locator('.deck-strip-leg')).toHaveText('HRTZ → MEGID');
});

test('the numbers on the strip are the live readout, not a second copy of it', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => {
    window.gpsLiveOn = true;
    window.gpsLastGS = 104;
    window.gpsLastAlt = 2450;
    window.gpsAltIsGeometric = false;
    window.gpsOwn = { lat: 32, lng: 34.9, hdg: 75, t: Date.now() };
    window.gpsQnh = null;
    gpsUpdateReadout();
  });
  const vals = page.locator('.deck-strip-vals');
  await expect(vals).toContainText('104 kt');
  await expect(vals).toContainText('2450 ft');
  // The readout fits itself to the width it is given; the strip shows whatever survived that,
  // rather than re-deciding it here and disagreeing with the panel.
  expect(await vals.textContent()).toBe(
    (await page.locator('#gps-readout').textContent() || '').trim());
});

test('Record and Here press the buttons that already exist', async ({ page }) => {
  await boot(page);
  const got = await page.evaluate(() => {
    const hits = [];
    for (const id of ['gps-record', 'gps-live', 'plan']) {
      document.getElementById(id).addEventListener('click', () => hits.push(id), true);
    }
    document.querySelector('.deck-btn-record').click();
    document.querySelector('.deck-btn-here').click();
    document.querySelector('.deck-btn-plan').click();
    return hits;
  });
  expect(got).toEqual(['gps-record', 'gps-live', 'plan']);
});

test('Record and Here light while they are running, not when they were last tapped', async ({ page }) => {
  await boot(page);
  const pressed = (k) => page.evaluate((key) =>
    document.querySelector('.deck-btn-' + key).getAttribute('aria-pressed'), k);
  expect(await pressed('record')).toBe('false');
  await page.evaluate(() => {
    window.gpsRecording = true;
    window.gpsLiveOn = true;
    NavAid.refreshMobileDeck();
  });
  expect(await pressed('record')).toBe('true');
  expect(await pressed('here')).toBe('true');
});

test('Menu puts the flight plan away before it opens', async ({ page }) => {
  await boot(page);
  await route(page);
  await page.evaluate(() => document.querySelector('.deck-btn-plan').click());
  await page.waitForSelector('.modal-back.flight-plan');
  await page.evaluate(() => document.querySelector('.deck-btn-menu').click());
  const got = await page.evaluate(() => ({
    // A menu drawn on top of the plan is two documents fighting for one screen.
    overlays: document.querySelectorAll('.modal-back:not(.hidden)').length,
    fpOpen: typeof fpOpen !== 'undefined' ? fpOpen : null,
    sheet: document.getElementById('deck-sheet').hidden,
    hosted: !!document.getElementById('toolbar').closest('#deck-sheet'),
  }));
  expect(got).toEqual({ overlays: 0, fpOpen: false, sheet: false, hosted: true });
});

test('Map puts everything away again', async ({ page }) => {
  await boot(page);
  await route(page);
  await page.evaluate(() => {
    state.selected = { type: 'leg', index: 0 };
    showInspector();
    document.querySelector('.deck-btn-menu').click();
  });
  await page.evaluate(() => document.querySelector('.deck-btn-map').click());
  const got = await page.evaluate(() => ({
    menu: document.getElementById('toolbar').classList.contains('collapsed'),
    panel: document.getElementById('inspector').classList.contains('hidden'),
    selected: state.selected,
  }));
  expect(got).toEqual({ menu: true, panel: true, selected: null });
});

test('the chart furniture moves up out of the deck', async ({ page }) => {
  await boot(page);
  const clear = await page.evaluate(() => {
    const deck = document.getElementById('deck-bar').getBoundingClientRect();
    const names = ['.leaflet-control-zoom', '#coord-readout', '.leaflet-control-attribution'];
    return names.map(sel => {
      const el = document.querySelector(sel);
      if (!el || !el.getClientRects().length) return { sel, ok: true };
      return { sel, ok: el.getBoundingClientRect().bottom <= deck.top + 1 };
    }).filter(r => !r.ok);
  });
  expect(clear).toEqual([]);
});

// Reported from the phone, with a screenshot: the strip was drawn over the top of the open
// menu, so the language picker and the hamburger -- the row that closes the menu again --
// were behind an opaque bar.
test('the menu opens below the strip, not behind it', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => document.querySelector('.deck-btn-menu').click());
  const got = await page.evaluate(() => {
    const strip = document.getElementById('deck-strip').getBoundingClientRect();
    const sheet = document.getElementById('deck-sheet').getBoundingClientRect();
    const deck = document.getElementById('deck-bar').getBoundingClientRect();
    return { clearOfStrip: sheet.top >= strip.bottom, clearOfDeck: sheet.bottom <= deck.top + 1 };
  });
  expect(got).toEqual({ clearOfStrip: true, clearOfDeck: true });
});

// The same screenshot: the second line read "+209:00 · שZ". The Zulu clock is Latin and the
// Hebrew look-ahead readout is not ("+2ש 09:00Z"), and pouring both into one left-to-right
// text node let the bidi algorithm interleave them into something that is not a time.
test('the Hebrew clock line keeps its pieces apart', async ({ page }) => {
  await page.setViewportSize(PHONE);
  await page.goto('?lang=he&nogist');
  await page.waitForFunction(() => document.getElementById('deck-strip'));
  await page.evaluate(() => {
    const m = document.getElementById('lookahead-time');
    m.value = '2';
    m.dispatchEvent(new Event('input'));
  });
  const got = await page.evaluate(() => {
    const sub = document.querySelector('.deck-strip-sub');
    return {
      pieces: Array.from(sub.querySelectorAll('bdi')).map(b => b.textContent),
      zulu: (document.getElementById('zulu-clock').textContent || '').trim(),
      read: (document.getElementById('map-time-read').textContent || '').trim(),
    };
  });
  // Each source lands in one isolate, intact -- not merged into a single run.
  expect(got.pieces).toEqual([got.zulu, got.read]);
  expect(got.pieces[1]).toContain('+2');
});

// Reported from the phone: the flight plan is a bit hidden by the top bar. A modal centres
// itself in `inset: 0` -- the whole window -- which with a fixed strip and a fixed deck over
// it means its heading sits under one and its buttons under the other.
test('a modal opens between the strip and the deck', async ({ page }) => {
  await boot(page);
  await route(page);
  await page.evaluate(() => document.querySelector('.deck-btn-plan').click());
  await page.waitForSelector('.modal-back:not(.hidden)');
  const got = await page.evaluate(() => {
    const strip = document.getElementById('deck-strip').getBoundingClientRect();
    const deck = document.getElementById('deck-bar').getBoundingClientRect();
    const back = document.querySelector('.modal-back:not(.hidden)');
    const box = back.querySelector('.modal') || back.firstElementChild;
    const r = box.getBoundingClientRect();
    return { underStrip: r.top < strip.bottom - 1, underDeck: r.bottom > deck.top + 1,
             scrolls: getComputedStyle(box).overflowY };
  });
  expect(got.underStrip, 'the heading is behind the strip').toBe(false);
  expect(got.underDeck, 'the buttons are behind the deck').toBe(false);
  // ...and a sheet taller than that gap scrolls inside itself rather than under either.
  expect(got.scrolls).toBe('auto');
});

// ---- the sheet ----------------------------------------------------------------------
// A phone has one screen. A panel that is all-or-nothing makes the pilot choose between the
// chart and the thing they are reading about it, so the sheet has three heights: a peek that
// leaves the aeroplane and the leg ahead visible, a working half, and a full height for
// reading. Dragged by its grip, tapped to cycle, dismissed downward.
const sheetBox = (page) => page.evaluate(() => {
  const s = document.getElementById('deck-sheet');
  const r = s.getBoundingClientRect();
  return { hidden: s.hidden, detent: s.dataset.detent, h: Math.round(r.height), top: Math.round(r.top) };
});

test('Menu opens the menu inside the sheet, at the working height', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => document.querySelector('.deck-btn-menu').click());
  const box = await sheetBox(page);
  expect(box.hidden).toBe(false);
  expect(box.detent).toBe('half');
  const got = await page.evaluate(() => ({
    // The menu itself, not a copy of it: every handler and every stored state is the one
    // that already works.
    hosted: !!document.getElementById('toolbar').closest('#deck-sheet'),
    // The whole menu, from the top. It used to jump to Extra layers -- one section of eight,
    // and not the one most taps are for.
    forced: document.querySelectorAll('.tb-section.open').length,
    pressed: document.querySelector('.deck-btn-menu').getAttribute('aria-pressed'),
    // ...minus the two controls that belonged to the floating card.
    handle: document.getElementById('toolbar-handle').getClientRects().length,
    burger: document.getElementById('toolbar-toggle').getClientRects().length,
  }));
  expect(got).toEqual({ hosted: true, forced: 0, pressed: 'true', handle: 0, burger: 0 });
});

test('the grip cycles the three heights', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => document.querySelector('.deck-btn-menu').click());
  const seen = [(await sheetBox(page)).detent];
  for (let i = 0; i < 3; i++) {
    await page.evaluate(() => document.querySelector('.deck-sheet-grip').click());
    seen.push((await sheetBox(page)).detent);
  }
  expect(seen).toEqual(['half', 'full', 'peek', 'half']);
});

test('the peek height leaves the chart worth looking at', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => {
    document.querySelector('.deck-btn-menu').click();
    document.querySelector('.deck-sheet-grip').click();   // full
    document.querySelector('.deck-sheet-grip').click();   // peek
  });
  const strip = await page.evaluate(() =>
    Math.round(document.getElementById('deck-strip').getBoundingClientRect().bottom));
  // The heights animate, so this is the height it settles at, not the frame it passes
  // through. Two thirds of the space between the strip and the deck is still chart.
  await expect.poll(async () => (await sheetBox(page)).top - strip)
    .toBeGreaterThan((844 - strip - 52) * 0.6);
  expect((await sheetBox(page)).detent).toBe('peek');
});

test('dragging it down dismisses it, and the menu goes back where it came from', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => document.querySelector('.deck-btn-menu').click());
  const grip = await page.locator('.deck-sheet-grip').boundingBox();
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(grip.x + grip.width / 2, grip.y + 420, { steps: 8 });
  await page.mouse.up();
  expect((await sheetBox(page)).hidden).toBe(true);
  const got = await page.evaluate(() => {
    const bar = document.getElementById('toolbar');
    return { parent: bar.parentNode.tagName, hosted: bar.classList.contains('deck-hosted'),
             collapsed: bar.classList.contains('collapsed') };
  });
  // Back in the body, closed, and no longer wearing the sheet's layout.
  expect(got).toEqual({ parent: 'BODY', hosted: false, collapsed: true });
});

test('dragging it up snaps to the next height rather than wherever the finger stopped', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => document.querySelector('.deck-btn-menu').click());
  const grip = await page.locator('.deck-sheet-grip').boundingBox();
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(grip.x + grip.width / 2, grip.y - 150, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => (await sheetBox(page)).detent).toBe('full');
});

test('Map clears the chart: the plan, the charts, the menu and the panel', async ({ page }) => {
  await boot(page);
  await route(page);
  await page.evaluate(() => document.querySelector('.deck-btn-plan').click());
  await page.waitForSelector('.modal-back.flight-plan');
  await page.evaluate(() => {
    document.querySelector('.deck-btn-menu').click();
    const sec = document.querySelector('.tb-section[data-sec="charts"] .tb-section-head');
    if (sec) sec.click();
    document.getElementById('route-templates').click();
  });
  // A chart viewer is a NON-BLOCKING modal, which wears the same `flight-plan` class as the
  // plan itself (that class is the transparent-backdrop variant, not the plan's identity).
  await page.waitForSelector('.route-template-modal');
  await page.evaluate(() => document.querySelector('.deck-btn-map').click());
  const got = await page.evaluate(() => ({
    overlays: document.querySelectorAll('.modal-back:not(.hidden), .sim-overlay:not(.hidden)').length,
    // Closed through its own door: fpOpen and the stored session flag go with it, not just
    // the element.
    fpOpen: typeof fpOpen !== 'undefined' ? fpOpen : null,
    stored: sessionStorage.getItem('navaid.fpOpen'),
    sheet: document.getElementById('deck-sheet').hidden,
    menu: document.getElementById('toolbar').classList.contains('collapsed'),
    sections: document.querySelectorAll('.tb-section.open').length,
  }));
  expect(got).toEqual({ overlays: 0, fpOpen: false, stored: null, sheet: true, menu: true, sections: 0 });
});

test('Map closes the menu', async ({ page }) => {
  await boot(page);
  await route(page);
  await page.evaluate(() => document.querySelector('.deck-btn-plan').click());
  await page.waitForSelector('.modal-back.flight-plan');
  await page.evaluate(() => {
    document.querySelector('.deck-btn-menu').click();
    const sec = document.querySelector('.tb-section[data-sec="charts"] .tb-section-head');
    if (sec) sec.click();
  });
  await page.evaluate(() => document.querySelector('.deck-btn-map').click());
  const got = await page.evaluate(() => ({
    sheet: document.getElementById('deck-sheet').hidden,
    menu: document.getElementById('toolbar').classList.contains('collapsed'),
    // No section left open behind the closed menu: reopening it should show the menu, not
    // whatever was being read last time.
    sections: document.querySelectorAll('.tb-section.open').length,
    plan: !!document.querySelector('.modal-back.flight-plan'),
  }));
  expect(got).toEqual({ sheet: true, menu: true, sections: 0, plan: false });
});

test('Map closes the sheet', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => document.querySelector('.deck-btn-menu').click());
  await page.evaluate(() => document.querySelector('.deck-btn-map').click());
  expect((await sheetBox(page)).hidden).toBe(true);
  expect(await page.evaluate(() =>
    document.querySelector('.deck-btn-menu').getAttribute('aria-pressed'))).toBe('false');
});

test('turning the deck off puts the menu back before it goes', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => document.querySelector('.deck-btn-menu').click());
  await page.evaluate(() => {
    NavAid.tuningDefaults.featureMobileDeck.value = false;
    // The URL override is what is on in this test; drop it the way a config push would.
    history.replaceState(null, '', '?lang=en&nogist');
    NavAid.refreshMobileDeck();
  });
  const got = await page.evaluate(() => {
    const bar = document.getElementById('toolbar');
    return { sheet: !!document.getElementById('deck-sheet'), deck: !!document.getElementById('deck-bar'),
             parent: bar.parentNode.tagName, hosted: bar.classList.contains('deck-hosted') };
  });
  expect(got).toEqual({ sheet: false, deck: false, parent: 'BODY', hosted: false });
});

// ---- press and hold on the chart ----------------------------------------------------
// The last step of the layout: the chart answers a question. This is the one part of the
// deck that changes how a route is BUILT rather than where a button sits.
const press = async (page, x, y, ms) => {
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.waitForTimeout(ms === undefined ? 620 : ms);
  await page.mouse.up();
};

test('press and hold says what is under the finger', async ({ page }) => {
  await boot(page);
  await press(page, 200, 420);
  await page.waitForSelector('.deck-here');
  const got = await page.evaluate(() => ({
    title: document.querySelector('.deck-sheet-title').textContent,
    rows: Array.from(document.querySelectorAll('.deck-here-row span:first-child')).map(s => s.textContent),
    coords: document.querySelector('.deck-here-value').textContent,
    actions: Array.from(document.querySelectorAll('.deck-here-btn')).map(b => b.textContent),
  }));
  expect(got.title).toBe('What is here');
  expect(got.rows[0]).toBe('Position');
  expect(got.coords).toMatch(/\d+°/);
  expect(got.rows).toContain('Nearest field');
  expect(got.actions).toEqual(['Direct to', 'Add waypoint']);
});

test('a tap is not a press, and neither is a drag', async ({ page }) => {
  await boot(page);
  await press(page, 200, 420, 80);                 // a tap
  expect(await page.evaluate(() => document.getElementById('deck-sheet').hidden)).toBe(true);
  // A pan holds the finger down for as long as it likes; it is not asking about a point.
  await page.mouse.move(200, 420);
  await page.mouse.down();
  await page.mouse.move(260, 470, { steps: 6 });
  await page.waitForTimeout(620);
  await page.mouse.up();
  expect(await page.evaluate(() => document.getElementById('deck-sheet').hidden)).toBe(true);
});

test('Add waypoint puts the held point on the end of the plan', async ({ page }) => {
  await boot(page);
  await route(page);
  await press(page, 200, 420);
  await page.waitForSelector('.deck-here');
  const before = await page.evaluate(() => state.waypoints.length);
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('.deck-here-btn'))
      .find(b => b.textContent === 'Add waypoint');
    btn.click();
  });
  const got = await page.evaluate(() => ({
    count: state.waypoints.length,
    sheet: document.getElementById('deck-sheet').hidden,
    legs: state.legs.length,
  }));
  expect(got.count).toBe(before + 1);
  expect(got.legs).toBe(got.count - 1);            // the plan, not just a list of points
  expect(got.sheet).toBe(true);
});

test('Direct to waits for a position rather than inventing one', async ({ page }) => {
  await boot(page);
  await press(page, 200, 420);
  await page.waitForSelector('.deck-here');
  const off = await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll('.deck-here-btn')).find(x => x.textContent === 'Direct to');
    return { disabled: b.disabled, why: b.title };
  });
  // Dim, never hide -- and it says why.
  expect(off.disabled).toBe(true);
  expect(off.why).toMatch(/Location/);

  await page.evaluate(() => {
    window.gpsLiveOn = true;
    window.gpsOwn = { lat: 32.05, lng: 34.85, hdg: 90, t: Date.now() };
  });
  // Above the open sheet: the sheet is not the chart, so a press on it is a press on it.
  await press(page, 200, 200);
  await page.waitForFunction(() => {
    const b = Array.from(document.querySelectorAll('.deck-here-btn')).find(x => x.textContent === 'Direct to');
    return b && !b.disabled;
  });
  await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll('.deck-here-btn')).find(x => x.textContent === 'Direct to');
    b.click();
  });
  const got = await page.evaluate(() => ({
    count: state.waypoints.length,
    from: state.waypoints[0],
  }));
  // Two points: where the aeroplane actually is, and where the finger was.
  expect(got.count).toBe(2);
  expect(got.from.lat).toBeCloseTo(32.05, 3);
});

test('Direct to asks before it throws a plan away', async ({ page }) => {
  await boot(page);
  await route(page);
  await page.evaluate(() => {
    window.gpsLiveOn = true;
    window.gpsOwn = { lat: 32.05, lng: 34.85, hdg: 90, t: Date.now() };
  });
  await press(page, 200, 200);
  await page.waitForSelector('.deck-here');
  page.once('dialog', d => d.dismiss());
  await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll('.deck-here-btn')).find(x => x.textContent === 'Direct to');
    b.click();
  });
  // Declined: the route is exactly as it was.
  expect(await page.evaluate(() => state.waypoints.map(w => w.name))).toEqual(['HRTZ', 'LLEV']);
});

test('a locked route refuses both, and says so', async ({ page }) => {
  await boot(page);
  await route(page);
  await page.evaluate(() => {
    window.editUnlockOverride = false;
    window.editLocked = true;
    if (typeof refreshEditLockControl === 'function') refreshEditLockControl();
  });
  await press(page, 200, 420);
  await page.waitForSelector('.deck-here');
  const got = await page.evaluate(() => Array.from(document.querySelectorAll('.deck-here-btn'))
    .map(b => ({ text: b.textContent, disabled: b.disabled })));
  expect(got.every(b => b.disabled), JSON.stringify(got)).toBe(true);
});

// Reported from the phone, with a screenshot: the menu sheet stayed open on top of the
// route-templates picker it had just opened, so the chart -- and the thing being chosen --
// were behind the menu that asked for them.
test('a menu item that opens something puts the menu away', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => document.querySelector('.deck-btn-menu').click());
  expect(await page.evaluate(() => document.getElementById('deck-sheet').hidden)).toBe(false);
  await page.evaluate(() => {
    const sec = document.querySelector('.tb-section[data-sec="charts"] .tb-section-head');
    if (sec) sec.click();
    document.getElementById('route-templates').click();
  });
  await page.waitForSelector('.modal-back');
  const got = await page.evaluate(() => ({
    sheet: document.getElementById('deck-sheet').hidden,
    modal: !!document.querySelector('.modal-back'),
    // ...and the menu went back where it came from on the way out, as on every other exit.
    parent: document.getElementById('toolbar').parentNode.tagName,
    hosted: document.getElementById('toolbar').classList.contains('deck-hosted'),
  }));
  expect(got).toEqual({ sheet: true, modal: true, parent: 'BODY', hosted: false });
});

test('a layer toggle is not "opening something" and leaves the menu up', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => document.querySelector('.deck-btn-menu').click());
  await page.evaluate(() => {
    const cb = document.querySelector('.tb-section[data-sec="weather"] input[type="checkbox"]');
    if (cb) cb.click();
  });
  // Switching layers on and off is a run of taps in one place; the sheet is the place.
  expect(await page.evaluate(() => document.getElementById('deck-sheet').hidden)).toBe(false);
});

test('Plan puts the menu away before it opens the table', async ({ page }) => {
  await boot(page);
  await route(page);
  await page.evaluate(() => document.querySelector('.deck-btn-menu').click());
  await page.evaluate(() => document.querySelector('.deck-btn-plan').click());
  await page.waitForSelector('.modal-back.flight-plan');
  const got = await page.evaluate(() => ({
    sheet: document.getElementById('deck-sheet').hidden,
    // ...and the menu is back where it came from, not stranded inside a hidden sheet.
    parent: document.getElementById('toolbar').parentNode.tagName,
    hosted: document.getElementById('toolbar').classList.contains('deck-hosted'),
    plan: !!document.querySelector('.modal-back.flight-plan'),
  }));
  expect(got).toEqual({ sheet: true, parent: 'BODY', hosted: false, plan: true });
});

test('Map takes the search panel and the assistant with it', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => {
    NavAid.tuningDefaults.featureAssistant.value = true;
    if (typeof refreshAssistantFeature === 'function') refreshAssistantFeature();
    const fab = document.querySelector('.assistant-fab, #assistant-fab');
    if (fab) fab.click();
    const search = document.getElementById('search-trigger');
    if (search) search.click();
  });
  await page.evaluate(() => document.querySelector('.deck-btn-map').click());
  const got = await page.evaluate(() => ({
    assistant: document.querySelectorAll('.assistant-panel:not(.hidden)').length,
    search: document.querySelectorAll('#search-overlay:not(.hidden)').length,
  }));
  // Map means the chart and nothing over it, whatever put it there.
  expect(got).toEqual({ assistant: 0, search: 0 });
});

test('the strip fits: the numbers keep their space, the flight name gives way', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => document.getElementById('deck-strip'));
  await page.evaluate(() => {
    state.waypoints = [{ lat: 32.0, lng: 34.9, name: 'HERZLIYA NORTH' },
                       { lat: 32.6, lng: 35.3, name: 'MEGIDDO SOUTH' }];
    syncLegs();
    draw();
    window.gpsLiveOn = true;
    window.gpsLastGS = 104;
    window.gpsLastAlt = 12450;
    window.gpsAltIsGeometric = false;
    window.gpsQnh = { inHg: 29.83, hPa: 1010, at: Date.now(), lat: 32, lng: 34.9 };
    window.gpsOwn = { lat: 32, lng: 34.9, hdg: 75, t: Date.now() };
    gpsUpdateReadout();
    NavAid.refreshMobileDeck();
  });
  const got = await page.evaluate(() => {
    const strip = document.getElementById('deck-strip');
    const vals = document.querySelector('.deck-strip-vals').getBoundingClientRect();
    return { overflow: strip.scrollWidth > strip.clientWidth + 1,
             valsInside: vals.right <= strip.getBoundingClientRect().right + 1,
             text: document.querySelector('.deck-strip-vals').textContent };
  });
  expect(got.overflow, 'the strip runs off the screen').toBe(false);
  expect(got.valsInside, 'the instrument is off the edge').toBe(true);
  expect(got.text).toContain('kt');
});

// Reported: Location active is not visible enough. A tinted label was all that said it was
// on, and on a sunlit screen at arm's length that is a shade, not a state.
test('a running button lights its whole cell', async ({ page }) => {
  await boot(page);
  const look = (key) => page.evaluate((k) => {
    const el = document.querySelector('.deck-btn-' + k);
    const cs = getComputedStyle(el);
    return { bg: cs.backgroundColor, shadow: cs.boxShadow, weight: cs.fontWeight, color: cs.color };
  }, key);

  const off = await look('here');
  await page.evaluate(() => { window.gpsLiveOn = true; NavAid.refreshMobileDeck(); });
  const on = await look('here');
  expect(on.bg, 'no ground').not.toBe(off.bg);
  expect(on.bg).not.toBe('rgba(0, 0, 0, 0)');
  expect(on.shadow, 'no bar along the top edge').not.toBe(off.shadow);
  expect(on.shadow).toMatch(/inset/);
  expect(on.color).not.toBe(off.color);
  expect(Number(on.weight)).toBeGreaterThanOrEqual(Number(off.weight));

  // Three different answers to "what is running", each the colour it is elsewhere in the app.
  await page.evaluate(() => { window.gpsRecording = true; NavAid.refreshMobileDeck(); });
  const rec = await look('record');
  expect(rec.bg).not.toBe(on.bg);
});

// Both themes, because a lit cell is a colour on a colour and the ground moves underneath it.
for (const theme of ['light', 'dark']) {
  test('the running state reads in ' + theme + ' mode', async ({ page }) => {
    await boot(page);
    await page.evaluate((th) => {
      document.body.classList.remove('theme-light', 'theme-dark');
      document.body.classList.add('theme-' + th);
      window.gpsLiveOn = true;
      window.gpsRecording = true;
      NavAid.refreshMobileDeck();
    }, theme);
    const got = await page.evaluate(() => {
      const rgb = (c) => c.match(/[\d.]+/g).slice(0, 3).map(Number);
      const lum = (c) => { const [r, g, b] = rgb(c); return 0.299 * r + 0.587 * g + 0.114 * b; };
      const apart = (a, b) => {
        const [x, y, z] = rgb(a);
        const [p, q, r] = rgb(b);
        return Math.hypot(x - p, y - q, z - r);      // colour, not just brightness
      };
      const read = (sel) => {
        const cs = getComputedStyle(document.querySelector(sel));
        return { color: cs.color, bar: cs.boxShadow, ground: cs.backgroundColor,
                 contrast: Math.abs(lum(cs.color) - lum(getComputedStyle(document.getElementById('deck-bar')).backgroundColor)) };
      };
      const idle = getComputedStyle(document.querySelector('.deck-btn-plan')).color;
      const here = read('.deck-btn-here');
      const rec = read('.deck-btn-record');
      return { here, rec, fromIdle: apart(here.color, idle), recFromHere: apart(rec.color, here.color) };
    });
    // The lit label stands off the bar it sits on...
    expect(got.here.contrast, 'Location does not stand out').toBeGreaterThan(40);
    expect(got.rec.contrast, 'Record does not stand out').toBeGreaterThan(40);
    // ...it is a different colour from a button that is merely sitting there...
    expect(got.fromIdle, 'lit and idle are the same colour').toBeGreaterThan(40);
    // ...Record and Location are not the same answer...
    expect(got.recFromHere, 'the two running states look alike').toBeGreaterThan(40);
    // ...and each carries the ground and the bar, not only a coloured word.
    expect(got.here.ground).not.toBe('rgba(0, 0, 0, 0)');
    expect(got.rec.ground).not.toBe('rgba(0, 0, 0, 0)');
    expect(got.here.bar).toMatch(/inset/);
    expect(got.rec.bar).toMatch(/inset/);
  });
}

// Reported from the phone: pressing Plan or Menu again should close them. A deck button is a
// switch, not a way in -- and pressing Menu twice used to cycle the sheet's height, which is
// the grip's job, leaving Map as the only way back to the chart.
test('Menu closes what Menu opened', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => document.querySelector('.deck-btn-menu').click());
  expect(await page.evaluate(() => document.getElementById('deck-sheet').hidden)).toBe(false);
  await page.evaluate(() => document.querySelector('.deck-btn-menu').click());
  const got = await page.evaluate(() => ({
    sheet: document.getElementById('deck-sheet').hidden,
    pressed: document.querySelector('.deck-btn-menu').getAttribute('aria-pressed'),
    // ...and the menu is back in the body, as on every other way out.
    parent: document.getElementById('toolbar').parentNode.tagName,
    hosted: document.getElementById('toolbar').classList.contains('deck-hosted'),
  }));
  expect(got).toEqual({ sheet: true, pressed: 'false', parent: 'BODY', hosted: false });
});

test('Plan closes what Plan opened', async ({ page }) => {
  await boot(page);
  await route(page);
  await page.evaluate(() => document.querySelector('.deck-btn-plan').click());
  await page.waitForSelector('.modal-back.flight-plan');
  await page.evaluate(() => document.querySelector('.deck-btn-plan').click());
  const got = await page.evaluate(() => ({
    plan: !!document.querySelector('.modal-back.flight-plan'),
    // Through its own door: the flag and the session note go with the window.
    fpOpen: typeof fpOpen !== 'undefined' ? fpOpen : null,
    stored: sessionStorage.getItem('navaid.fpOpen'),
    pressed: document.querySelector('.deck-btn-plan').getAttribute('aria-pressed'),
  }));
  expect(got).toEqual({ plan: false, fpOpen: false, stored: null, pressed: 'false' });
});

test('the grip still owns the height', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => document.querySelector('.deck-btn-menu').click());
  await page.evaluate(() => document.querySelector('.deck-sheet-grip').click());
  // Tapping the grip cycles; tapping the button closes. Two controls, two jobs.
  await expect.poll(async () => page.evaluate(() =>
    document.getElementById('deck-sheet').dataset.detent)).toBe('full');
  expect(await page.evaluate(() => document.getElementById('deck-sheet').hidden)).toBe(false);
});

// Reported from the phone, with a screenshot: the opened menu showed speed and course again,
// and the strip could not fit its own line -- the flight name had been squeezed to "... LLHZ".
const flying = (page) => page.evaluate(() => {
  state.waypoints = [{ lat: 32.18, lng: 34.83, name: 'HERZLIYA' },
                     { lat: 32.78, lng: 35.02, name: 'HAIFA' }];
  syncLegs();
  draw();
  window.gpsLiveOn = true;
  window.gpsLastGS = 0;
  window.gpsLastAlt = 217;
  window.gpsAltIsGeometric = false;
  window.gpsQnh = { inHg: 29.85, hPa: 1011, at: Date.now(), lat: 32, lng: 34.9 };
  window.gpsOwn = { lat: 32, lng: 34.9, hdg: 241, t: Date.now(), hdgCompass: true };
  gpsUpdateReadout();
  NavAid.refreshMobileDeck();
});

test('the strip fits its own line, dropping the setting before the instrument', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => document.getElementById('deck-strip'));
  await flying(page);
  const got = await page.evaluate(() => {
    const strip = document.getElementById('deck-strip');
    return { overflow: strip.scrollWidth > strip.clientWidth + 1,
             vals: document.querySelector('.deck-strip-vals').textContent,
             leg: document.querySelector('.deck-strip-leg').textContent };
  });
  expect(got.overflow, 'the strip runs off the screen').toBe(false);
  // What is being flown survives whatever had to go...
  expect(got.vals).toMatch(/kt/);
  expect(got.vals).toMatch(/ft/);
  expect(got.vals).toMatch(/°/);
  // ...and the flight is still named, even if the CSS had to trim it.
  expect(got.leg).toBe('HERZLIYA → HAIFA');
});

test('the menu does not repeat what the deck and the strip already say', async ({ page }) => {
  await boot(page);
  await flying(page);
  await page.evaluate(() => document.querySelector('.deck-btn-menu').click());
  const got = await page.evaluate(() => {
    const shown = (sel) => { const el = document.querySelector(sel);
      return !!el && el.getClientRects().length > 0; };
    return { readout: shown('#deck-sheet #gps-readout'),
             gpsRow: shown('#deck-sheet .footer-gps-group'),
             // The links the card carried are still there -- only the duplicates went.
             links: shown('#deck-sheet #footer-links') };
  });
  expect(got).toEqual({ readout: false, gpsRow: false, links: true });
});

// Reported from an iPad: the top bar is hidden by the status bar -- the clock, the wifi and
// the battery sit on it in a standalone window. The safe-area inset was being applied to the
// strip's BOTTOM (a three-value padding shorthand puts the third value there), so the far edge
// was padded and the first line stayed under the wifi indicator.
test('the strip keeps clear of the status bar, not of its own bottom edge', async ({ page }) => {
  await boot(page);
  const got = await page.evaluate(() => {
    const strip = document.getElementById('deck-strip');
    // Stand in for a standalone window with a status bar over the page.
    strip.style.setProperty('padding-top', 'calc(6px + 24px)');
    const cs = getComputedStyle(strip);
    const line = document.querySelector('.deck-strip-top').getBoundingClientRect();
    return { top: cs.paddingTop, bottom: cs.paddingBottom, lineTop: Math.round(line.top) };
  });
  // The content starts below the inset...
  expect(got.lineTop).toBeGreaterThanOrEqual(30);
  // ...and the bottom padding is the plain one: nothing is reserved at the edge the status
  // bar is nowhere near.
  expect(got.bottom).toBe('6px');
});

test('the deck and the strip reserve the side insets too', async ({ page }) => {
  await boot(page);
  const got = await page.evaluate(() => {
    const read = (sel) => {
      const cs = getComputedStyle(document.querySelector(sel));
      return { left: cs.paddingLeft, right: cs.paddingRight };
    };
    return { strip: read('#deck-strip'), deck: read('#deck-bar') };
  });
  // Zero on a screen with no cut-out, but declared -- landscape on a notched device eats the
  // start of the flight name and the first deck button otherwise.
  expect(got.strip.left).toBeTruthy();
  expect(got.deck.left).toBeTruthy();
});
