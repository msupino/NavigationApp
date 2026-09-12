// @ts-check
// Option B, first slice: a data strip along the top and a deck of five targets along the
// bottom, on narrow screens only, behind `featureMobileDeck` (off) with `?deck=1` to look at
// it on a phone without waiting for a config push.
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
  await page.goto('?lang=en&nogist' + (o.deck === false ? '' : '&deck=1'));
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

test('off by default: nothing changes for anyone until the gist says so', async ({ page }) => {
  await boot(page, { deck: false });
  await expect(page.locator('#deck-bar')).toHaveCount(0);
  await expect(page.locator('#deck-strip')).toHaveCount(0);
  expect(await page.evaluate(() => document.body.classList.contains('deck-on'))).toBe(false);
});

test('a phone gets the strip and the deck', async ({ page }) => {
  await boot(page);
  await expect(page.locator('#deck-bar')).toBeVisible();
  const labels = await page.locator('.deck-btn-label').allTextContents();
  expect(labels).toEqual(['Map', 'Layers', 'Plan', 'Record', 'Here']);
  // The deck replaces the closed menu card in its corner: everything it held is on the deck
  // or one tap inside it, and two menus for one app is how the corner got crowded.
  expect(await page.evaluate(() => getComputedStyle(document.getElementById('toolbar')).display)).toBe('none');
});

test('a desktop is not given a phone deck', async ({ page }) => {
  await boot(page, { size: { width: 1280, height: 900 } });
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

test('Layers opens the menu at the section it names', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => document.querySelector('.deck-btn-layers').click());
  const got = await page.evaluate(() => ({
    open: !document.getElementById('toolbar').classList.contains('collapsed'),
    section: document.querySelector('.tb-section[data-sec="weather"]').classList.contains('open'),
  }));
  expect(got).toEqual({ open: true, section: true });
});

test('Map puts everything away again', async ({ page }) => {
  await boot(page);
  await route(page);
  await page.evaluate(() => {
    state.selected = { type: 'leg', index: 0 };
    showInspector();
    document.querySelector('.deck-btn-layers').click();
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
  await page.evaluate(() => document.querySelector('.deck-btn-layers').click());
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
  await page.goto('?lang=he&nogist&deck=1');
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

test('Layers opens the menu inside the sheet, at the working height', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => document.querySelector('.deck-btn-layers').click());
  const box = await sheetBox(page);
  expect(box.hidden).toBe(false);
  expect(box.detent).toBe('half');
  const got = await page.evaluate(() => ({
    // The menu itself, not a copy of it: every handler and every stored state is the one
    // that already works.
    hosted: !!document.getElementById('toolbar').closest('#deck-sheet'),
    weather: document.querySelector('.tb-section[data-sec="weather"]').classList.contains('open'),
    pressed: document.querySelector('.deck-btn-layers').getAttribute('aria-pressed'),
    // ...minus the two controls that belonged to the floating card.
    handle: document.getElementById('toolbar-handle').getClientRects().length,
    burger: document.getElementById('toolbar-toggle').getClientRects().length,
  }));
  expect(got).toEqual({ hosted: true, weather: true, pressed: 'true', handle: 0, burger: 0 });
});

test('the grip cycles the three heights', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => document.querySelector('.deck-btn-layers').click());
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
    document.querySelector('.deck-btn-layers').click();
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
  await page.evaluate(() => document.querySelector('.deck-btn-layers').click());
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
  await page.evaluate(() => document.querySelector('.deck-btn-layers').click());
  const grip = await page.locator('.deck-sheet-grip').boundingBox();
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(grip.x + grip.width / 2, grip.y - 150, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => (await sheetBox(page)).detent).toBe('full');
});

test('Map closes the menu, and leaves the flight plan alone', async ({ page }) => {
  await boot(page);
  await route(page);
  await page.evaluate(() => document.querySelector('.deck-btn-plan').click());
  await page.waitForSelector('.modal-back.flight-plan');
  await page.evaluate(() => {
    document.querySelector('.deck-btn-layers').click();
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
    // The plan is the thing being flown from. Map is "show me the chart", not "throw away
    // the table I am flying".
    plan: !!document.querySelector('.modal-back.flight-plan'),
  }));
  expect(got).toEqual({ sheet: true, menu: true, sections: 0, plan: true });
});

test('Map closes the sheet', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => document.querySelector('.deck-btn-layers').click());
  await page.evaluate(() => document.querySelector('.deck-btn-map').click());
  expect((await sheetBox(page)).hidden).toBe(true);
  expect(await page.evaluate(() =>
    document.querySelector('.deck-btn-layers').getAttribute('aria-pressed'))).toBe('false');
});

test('turning the deck off puts the menu back before it goes', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => document.querySelector('.deck-btn-layers').click());
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
  await page.evaluate(() => document.querySelector('.deck-btn-layers').click());
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
  await page.evaluate(() => document.querySelector('.deck-btn-layers').click());
  await page.evaluate(() => {
    const cb = document.querySelector('.tb-section[data-sec="weather"] input[type="checkbox"]');
    if (cb) cb.click();
  });
  // Switching layers on and off is a run of taps in one place; the sheet is the place.
  expect(await page.evaluate(() => document.getElementById('deck-sheet').hidden)).toBe(false);
});
