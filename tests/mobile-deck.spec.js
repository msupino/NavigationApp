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
    const bar = document.getElementById('toolbar').getBoundingClientRect();
    const deck = document.getElementById('deck-bar').getBoundingClientRect();
    return { clearOfStrip: bar.top >= strip.bottom, clearOfDeck: bar.bottom <= deck.top + 1 };
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
