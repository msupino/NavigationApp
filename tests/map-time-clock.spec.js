// @ts-check
// One clock, on the map. Every time-dependent layer used to answer to a control inside a
// menu -- and to two different ones: a look-ahead slider for NOTAM and the winds, a
// valid-time dropdown for the weather charts. A pilot scrubbing forward is looking at the
// chart, so the clock belongs on it, and there should be one.
//
// The hard part is that the two feeds cannot agree exactly: NOTAM and wind are hourly, the
// weather charts are published at 00/03/06/12/18Z. The clock therefore pulls the charts to
// the newest sheet issued by the chosen hour and SAYS which one that is, rather than leaving
// two layers quietly disagreeing about what "+3h" means.
const { test, expect } = require('./_setup');

async function boot(page) {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => document.getElementById('map-time-slider')
    && document.getElementById('lookahead-time'));
}
const scrub = (page, h) => page.evaluate((v) => {
  const s = document.getElementById('map-time-slider');
  s.value = String(v);
  s.dispatchEvent(new Event('input'));
}, h);

test('the clock is on the map, not in a menu', async ({ page }) => {
  await boot(page);
  const where = await page.evaluate(() => {
    const el = document.getElementById('map-time');
    return { onMap: !el.closest('#toolbar'), hidden: el.hidden,
             bottom: getComputedStyle(el).position };
  });
  expect(where.onMap).toBe(true);
  expect(where.hidden).toBe(false);
  expect(where.bottom).toBe('absolute');
});

test('scrubbing moves the shared look-ahead every timed layer already follows', async ({ page }) => {
  await boot(page);
  await scrub(page, 5);
  // The master is what NOTAM, wind effect, wind field and airfield wind are wired to; the
  // map clock is its face, not a second mechanism.
  expect(await page.evaluate(() => document.getElementById('lookahead-time').value)).toBe('5');
  expect(await page.evaluate(() => document.getElementById('notam-time').value)).toBe('5');
  expect(await page.evaluate(() => document.getElementById('airfield-wind-time').value)).toBe('5');
  expect(await page.evaluate(() => Math.round((window.lookaheadTarget - Date.now()) / 3600e3))).toBeGreaterThanOrEqual(4);
});

test('the readout names the hour, and Now brings it back to live', async ({ page }) => {
  await boot(page);
  await scrub(page, 3);
  await expect(page.locator('#map-time-read')).toContainText('+3');
  await expect(page.locator('#map-time-read')).toContainText('Z');
  await expect(page.locator('#map-time-now')).toBeEnabled();
  await page.evaluate(() => document.getElementById('map-time-now').click());
  expect(await page.evaluate(() => document.getElementById('lookahead-time').value)).toBe('0');
  // At live there is nothing to go back to, so the button says so by being unavailable
  // rather than disappearing.
  await expect(page.locator('#map-time-now')).toBeDisabled();
});

test('forward only, and no further than the tunable allows', async ({ page }) => {
  await boot(page);
  const range = await page.evaluate(() => {
    const s = document.getElementById('map-time-slider');
    return { min: s.min, max: s.max };
  });
  expect(range.min).toBe('0');            // no scrubbing into the past
  expect(range.max).toBe('24');
  await page.evaluate(() => { NavAid.tuningDefaults.mapClockHoursAhead.value = 12; });
  // The range is read at wiring time; the tunable is what a gist would move.
  expect(await page.evaluate(() => NavAid.tuningDefaults.mapClockHoursAhead.value)).toBe(12);
});

test('with nothing time-dependent on, the clock goes quiet instead of vanishing', async ({ page }) => {
  await boot(page);
  // House rule: dim, never hide. A control that disappears is a control the pilot hunts for.
  expect(await page.evaluate(() => document.getElementById('map-time').classList.contains('idle'))).toBe(true);
  expect(await page.evaluate(() => document.getElementById('map-time').hidden)).toBe(false);
  // The wind-effect toggle, because it does not fetch on enable: NOTAM and the wind grids
  // switch themselves back off when their feed cannot be reached, which in a test looks
  // exactly like the clock ignoring the toggle.
  const on = await page.evaluate(() => {
    const cb = document.getElementById('show-wind-cb');
    cb.checked = true;
    cb.dispatchEvent(new Event('change', { bubbles: true }));
    return cb.checked;
  });
  expect(on, 'the layer stayed on').toBe(true);
  expect(await page.evaluate(() => document.getElementById('map-time').classList.contains('idle'))).toBe(false);
});

test('the weather charts snap to the newest sheet issued by that hour, and say which', async ({ page }) => {
  await boot(page);
  // Two sheets three hours apart, as the feeds publish them.
  const picked = await page.evaluate(() => {
    const sel = document.getElementById('wx-time');
    const now = new Date();
    const dd = String(now.getUTCDate()).padStart(2, '0');
    const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
    const day = dd + '/' + mm + '/' + now.getUTCFullYear();
    sel.innerHTML = '';
    for (const hh of ['00:00', '12:00']) {
      const o = document.createElement('option');
      o.value = day + '|' + hh;
      o.textContent = day + ' ' + hh + 'Z';
      sel.appendChild(o);
    }
    // 13:00Z on the same day: the 12:00 sheet is the newest issued by then.
    const noon = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 13);
    return NavWxTime.followInstant(noon);
  });
  expect(picked).toContain('12:00');
  expect(await page.evaluate(() => document.getElementById('wx-time').value)).toContain('12:00');
});

test('before the first published sheet it shows the earliest rather than nothing', async ({ page }) => {
  await boot(page);
  const picked = await page.evaluate(() => {
    const sel = document.getElementById('wx-time');
    const now = new Date();
    const day = String(now.getUTCDate()).padStart(2, '0') + '/'
      + String(now.getUTCMonth() + 1).padStart(2, '0') + '/' + now.getUTCFullYear();
    sel.innerHTML = '';
    const o = document.createElement('option');
    o.value = day + '|18:00';
    o.textContent = day + ' 18:00Z';
    sel.appendChild(o);
    const early = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 1);
    return NavWxTime.followInstant(early);
  });
  // A blank chart would read as "no weather"; the earliest sheet is what the dropdown would
  // have seeded anyway, and the label still says which hour it is.
  expect(picked).toContain('18:00');
});

test('the Hebrew readout is not run together by the bidi algorithm', async ({ page }) => {
  // Reported garbled: "+14ש · 21:00Z" rendered as "+1421:00 · שZ" -- digits merged, Z adrift
  // -- and "מפות 09/09/2026 18:00Z" as "Zמפות 09/09/2026 18:00". Both came from forcing
  // dir="ltr" on a span holding a Hebrew word AND a clock. Each run is isolated instead.
  await page.goto('?lang=he&nogist');
  await page.waitForFunction(() => document.getElementById('map-time-slider')
    && !document.documentElement.classList.contains('app-booting'));
  const got = await page.evaluate(() => {
    const sel = document.getElementById('wx-time');
    const n = new Date();
    const day = String(n.getUTCDate()).padStart(2, '0') + '/'
      + String(n.getUTCMonth() + 1).padStart(2, '0') + '/' + n.getUTCFullYear();
    sel.innerHTML = '';
    const o = document.createElement('option');
    o.value = day + '|18:00'; o.textContent = day + ' 18:00Z';
    sel.appendChild(o);
    const cb = document.getElementById('sigwx-ov-cb');
    cb.checked = true; cb.dispatchEvent(new Event('change', { bubbles: true }));
    const s = document.getElementById('map-time-slider');
    s.value = '6'; s.dispatchEvent(new Event('input'));
    // Right-to-left order on screen is what a Hebrew reader actually gets; the string alone
    // cannot show the bug.
    const order = (el) => [...el.querySelectorAll('bdi')]
      .map(b => ({ t: b.textContent, x: b.getBoundingClientRect().left }))
      .sort((a, b) => b.x - a.x).map(b => b.t);
    return { read: order(document.getElementById('map-time-read')),
             charts: order(document.getElementById('map-time-charts')) };
  });
  // The offset is read first, then the clock it names.
  expect(got.read.length).toBe(2);
  expect(got.read[0]).toMatch(/^\+6/);
  // A look-ahead that crosses midnight UTC names the day too, and must: "00:00Z" alone on
  // the evening of the 9th is a time the pilot would read as this morning. Caught by CI at
  // 18:xxZ, where +6h is tomorrow.
  expect(got.read[1]).toMatch(/^(?:\d{2}-\d{2} )?\d{2}:\d{2}Z$/);
  // The word, then the timestamp -- with the Z still on the end of the time.
  expect(got.charts.length).toBe(2);
  expect(got.charts[0]).not.toMatch(/\d/);
  expect(got.charts[1]).toMatch(/18:00Z$/);
});

for (const [name, w, h] of [['desktop', 1200, 850], ['phone', 390, 780]]) {
  test('the clock does not sit on top of the other map furniture (' + name + ')', async ({ page }) => {
    // Found by looking, not by testing: at first the readout landed underneath the
    // coordinate box and the track ran beneath the zoom keys and the empty-route hint.
    // Overlap is geometry, so it can be asserted rather than eyeballed next time.
    await page.setViewportSize({ width: w, height: h });
    await boot(page);
    await page.waitForFunction(() => !document.documentElement.classList.contains('app-booting'));
    const hits = await page.evaluate(() => {
      const box = (sel) => { const e = document.querySelector(sel); if (!e || e.hidden) return null;
        const r = e.getBoundingClientRect(); return r.width && r.height ? r : null; };
      const overlap = (a, b) => !!a && !!b
        && a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
      const clock = box('#map-time');
      // The toolbar too: putting the clock at the top of a phone screen looked tidy right up
      // until the menu panel dropped over it.
      const others = { coords: '.coord-readout', zoom: '.zoom-readout',
                       hint: '#empty-route-hint', legend: '#legend', toolbar: '#toolbar' };
      const bad = [];
      for (const [k, sel] of Object.entries(others)) {
        if (overlap(clock, box(sel))) bad.push(k);
      }
      return bad;
    });
    expect(hits).toEqual([]);
  });
}

test('the gist can withdraw the clock, and it comes back without a reload', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => {
    NavAid.tuningDefaults.featureMapClock.value = false;
    NavAid.refreshMapClock();
  });
  expect(await page.evaluate(() => document.getElementById('map-time').hidden)).toBe(true);
  await page.evaluate(() => {
    NavAid.tuningDefaults.featureMapClock.value = true;
    NavAid.refreshMapClock();
  });
  expect(await page.evaluate(() => document.getElementById('map-time').hidden)).toBe(false);
});

// Reported from the phone: the slider on the map is not visible. It is not -- on a phone the
// inspector is a bottom sheet up to 62dvh tall sitting exactly where the map clock lives, and
// the panel is full of readings that answer to that clock. So the panel carries its own face
// of it, at the top, where the map's copy cannot be reached.
test.describe('the clock on the panel', () => {
  const openPanel = (page) => page.evaluate(() => {
    state.waypoints = [{ lat: 32.0, lng: 34.9, name: 'A' }];
    syncLegs();
    state.selected = { type: 'wp', index: 0 };
    showInspector();
  });

  test('a phone gets it, a desktop does not', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 780 });
    await boot(page);
    await openPanel(page);
    await expect(page.locator('#insp-time')).toBeVisible();

    await page.setViewportSize({ width: 1200, height: 850 });
    // Two controls for one clock is what the map copy already is; on a desktop it is in
    // plain sight, so the panel's copy stands down.
    await expect(page.locator('#insp-time')).toBeHidden();
  });

  test('it is the same clock, not a second one', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 780 });
    await boot(page);
    await openPanel(page);
    await page.evaluate(() => {
      const s = document.getElementById('insp-time-slider');
      s.value = '4';
      s.dispatchEvent(new Event('input'));
    });
    expect(await page.evaluate(() => document.getElementById('lookahead-time').value)).toBe('4');
    expect(await page.evaluate(() => document.getElementById('map-time-slider').value)).toBe('4');
    await expect(page.locator('#insp-time-read')).toContainText('+4');
    // And the other way: the map clock moving carries the panel with it.
    await page.evaluate(() => {
      const s = document.getElementById('map-time-slider');
      s.value = '2';
      s.dispatchEvent(new Event('input'));
    });
    expect(await page.evaluate(() => document.getElementById('insp-time-slider').value)).toBe('2');
    await expect(page.locator('#insp-time-read')).toContainText('+2');
  });

  test('its Now button goes back to live, and is dead at live', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 780 });
    await boot(page);
    await openPanel(page);
    await expect(page.locator('#insp-time-now')).toBeDisabled();
    await page.evaluate(() => {
      const s = document.getElementById('insp-time-slider');
      s.value = '6'; s.dispatchEvent(new Event('input'));
    });
    await expect(page.locator('#insp-time-now')).toBeEnabled();
    await page.evaluate(() => document.getElementById('insp-time-now').click());
    expect(await page.evaluate(() => document.getElementById('lookahead-time').value)).toBe('0');
    await expect(page.locator('#insp-time-now')).toBeDisabled();
  });

  test('the gist withdraws both faces together', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 780 });
    await boot(page);
    await openPanel(page);
    await page.evaluate(() => {
      NavAid.tuningDefaults.featureMapClock.value = false;
      NavAid.refreshMapClock();
    });
    expect(await page.evaluate(() => document.getElementById('insp-time').hidden)).toBe(true);
    await page.evaluate(() => {
      NavAid.tuningDefaults.featureMapClock.value = true;
      NavAid.refreshMapClock();
    });
    expect(await page.evaluate(() => document.getElementById('insp-time').hidden)).toBe(false);
  });

  test('the track keeps its width as the hour it names grows', async ({ page }) => {
    // Reported: the slider in the inspector shrinks because the time text gets longer. It
    // did -- they shared a line, and the readout grows from "18:00Z" to "+24h · 09-11
    // 14:00Z" as the slider moves, so the control being dragged narrowed under the finger
    // dragging it. The same lesson the map clock learned on a phone.
    await page.setViewportSize({ width: 390, height: 780 });
    await boot(page);
    await openPanel(page);
    const at = (h) => page.evaluate((v) => {
      const s = document.getElementById('insp-time-slider');
      s.value = String(v);
      s.dispatchEvent(new Event('input'));
      return { w: Math.round(s.getBoundingClientRect().width),
               label: document.getElementById('insp-time-read').textContent };
    }, h);
    const now = await at(0);
    const mid = await at(9);
    const end = await at(24);
    expect(mid.w).toBe(now.w);
    expect(end.w).toBe(now.w);
    expect(end.label).toMatch(/\+24/);      // the longest label really was on screen
    // And it is worth dragging: a track squeezed to a stub is a control in name only.
    expect(now.w).toBeGreaterThan(200);
  });

  test('the panel repainting itself does not send the clock into a loop', async ({ page }) => {
    // The strip lives inside the inspector, and the clock watches the inspector to know
    // whether a density altitude is on screen. Watching the whole panel meant watching its
    // own readout being rewritten: refresh, mutation, refresh -- the tab hung before the
    // load event ever fired, and every spec in the suite timed out at page.goto.
    await page.setViewportSize({ width: 390, height: 780 });
    await boot(page);
    await openPanel(page);
    await expect(page.locator('#insp-time-read')).not.toBeEmpty();
    // Still answering after a repaint: a hung page cannot run this at all.
    await page.evaluate(() => showInspector());
    expect(await page.evaluate(() => 1 + 1)).toBe(2);
  });
});
