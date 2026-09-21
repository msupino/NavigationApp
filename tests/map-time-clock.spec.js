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
  // No real weather manifests. These tests hand-build #wx-time to put a known set of sheets
  // in it; a live ims-data response landing mid-test adds its own times and lets an overlay
  // claim one of them, which is a race against the network, not a behaviour worth asserting.
  await page.route(/ims-data\/ims\/(sigwx|pwx)\.json/, r => r.fulfill({ status: 404, body: '' }));
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

// Publish sheets at chosen offsets from now, as the feeds do, and turn a chart overlay on.
// The offsets matter: "nearest to now" (how the dropdown seeds itself) and "newest issued
// by now" (how the clock pulls it) are NOT the same sheet for half of every interval, and
// that gap is the whole subject here.
async function seedSheets(page, offsetsH) {
  return page.evaluate((hh) => {
    const sel = document.getElementById('wx-time');
    const pad = n => String(n).padStart(2, '0');
    sel.innerHTML = '';
    for (const h of hh) {
      const d = new Date(Date.now() + h * 3600e3);
      const day = pad(d.getUTCDate()) + '/' + pad(d.getUTCMonth() + 1) + '/' + d.getUTCFullYear();
      const valid = pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes());
      const o = document.createElement('option');
      o.value = day + '|' + valid;
      o.textContent = day + ' ' + valid + 'Z';
      sel.appendChild(o);
    }
    const cb = document.getElementById('sigwx-ov-cb');
    cb.checked = true; cb.dispatchEvent(new Event('change', { bubbles: true }));
    NavWxTime.ensure([]);          // seed it the way a feed arriving would
    return Array.from(sel.options, o => o.value);
  }, offsetsH);
}
const wxValue = page => page.evaluate(() => document.getElementById('wx-time').value);
// A re-seed of the kind a feed arriving (or the ten-minute re-poll) performs. It moves the
// selection only while the dropdown is unpinned, so it is also how a test asks "is it pinned?"
const reseed = page => page.evaluate(() => NavWxTime.ensure([]));

// PAST is two hours old, SOON is an hour out, LATER is ten. "Nearest to now" is SOON;
// "newest issued by now" is PAST. Pressing Now must give the first, which is what the other
// layers show -- it used to give the second, and pin it there.
const PAST = 0, SOON = 1, LATER = 2;
const OFFSETS = [-2, 1, 10];

test('Now releases the charts back to the sheet valid right now', async ({ page }) => {
  await boot(page);
  const sheet = await seedSheets(page, OFFSETS);
  expect(await wxValue(page), 'the unpinned dropdown seeds to the nearest sheet')
    .toBe(sheet[SOON]);

  await scrub(page, 12);
  expect(await wxValue(page), 'scrubbing forward moves the chart with the clock')
    .toBe(sheet[LATER]);

  // Back to live. The chart that is valid now is the one an hour out, not the two-hour-old
  // sheet that was merely the newest ISSUED by now -- the clock's rule for a scrubbed hour
  // is not the rule for live.
  await page.evaluate(() => document.getElementById('map-time-now').click());
  expect(await wxValue(page)).toBe(sheet[SOON]);
  expect(await wxValue(page)).not.toBe(sheet[PAST]);
});

test('Now leaves the dropdown unpinned, so it can keep advancing on its own', async ({ page }) => {
  await boot(page);
  const sheet = await seedSheets(page, OFFSETS);
  await scrub(page, 12);
  await page.evaluate(() => document.getElementById('map-time-now').click());

  // A sheet published six minutes out is now the nearest. Only an unpinned dropdown takes
  // it; a pin left behind by the scrub would strand the map on the old one until a reload.
  const fresh = await page.evaluate(() => {
    const sel = document.getElementById('wx-time');
    const d = new Date(Date.now() + 6 * 60e3);
    const pad = n => String(n).padStart(2, '0');
    const o = document.createElement('option');
    o.value = pad(d.getUTCDate()) + '/' + pad(d.getUTCMonth() + 1) + '/' + d.getUTCFullYear()
      + '|' + pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes());
    o.textContent = o.value;
    sel.appendChild(o);
    return o.value;
  });
  await reseed(page);
  expect(await wxValue(page)).toBe(fresh);
  expect(fresh).not.toBe(sheet[SOON]);        // the re-seed really did have somewhere to move
});

test('dragging the slider back to live releases the charts too', async ({ page }) => {
  await boot(page);
  const sheet = await seedSheets(page, OFFSETS);
  await scrub(page, 12);
  expect(await wxValue(page)).toBe(sheet[LATER]);
  // The button is only one way back to live; the slider itself is the other, and it means
  // exactly the same thing.
  await scrub(page, 0);
  expect(await wxValue(page)).toBe(sheet[SOON]);
});

test('a chart time still ahead of live is left alone by a re-seed', async ({ page }) => {
  await boot(page);
  const sheet = await seedSheets(page, OFFSETS);
  await scrub(page, 12);
  // The pin is what says "the clock chose this hour". A feed arriving must not drag the
  // scrubbed pilot back to now; only returning to live releases it.
  await reseed(page);
  expect(await wxValue(page)).toBe(sheet[LATER]);
});

test('a chart time the pilot picked lights Now, and Now takes it back', async ({ page }) => {
  await boot(page);
  const sheet = await seedSheets(page, OFFSETS);
  // Nothing has been scrubbed: the slider is at live, so Now is dead.
  await expect(page.locator('#map-time-now')).toBeDisabled();

  // The dropdown is its own control, in the toolbar. Moving it to a future sheet is a move
  // off live even though no slider has been touched -- and there is now something for Now
  // to reset, so it has to be available.
  await page.evaluate((v) => {
    const sel = document.getElementById('wx-time');
    sel.value = v;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  }, sheet[LATER]);
  await expect(page.locator('#map-time-now')).toBeEnabled();

  await page.evaluate(() => document.getElementById('map-time-now').click());
  expect(await wxValue(page)).toBe(sheet[SOON]);
  await expect(page.locator('#map-time-now')).toBeDisabled();
});

test('a chart time that IS the live sheet leaves Now dead', async ({ page }) => {
  await boot(page);
  const sheet = await seedSheets(page, OFFSETS);
  // Choosing the sheet the dropdown had already seeded is not a move off live, whatever the
  // pin says -- Now would have nothing to do.
  await page.evaluate((v) => {
    const sel = document.getElementById('wx-time');
    sel.value = v;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  }, sheet[SOON]);
  await expect(page.locator('#map-time-now')).toBeDisabled();
});

test('with no chart layer on, the dropdown does not light Now', async ({ page }) => {
  await boot(page);
  const sheet = await seedSheets(page, OFFSETS);
  await page.evaluate((v) => {
    const cb = document.getElementById('sigwx-ov-cb');
    cb.checked = false; cb.dispatchEvent(new Event('change', { bubbles: true }));
    const sel = document.getElementById('wx-time');
    sel.value = v;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  }, sheet[LATER]);
  // No chart is on the map, so the selected sheet changes nothing a pilot can see and Now
  // has nothing to bring back.
  await expect(page.locator('#map-time-now')).toBeDisabled();
});

test('the density-altitude slider lights Now, and Now resets it', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 780 });
  await boot(page);
  await page.evaluate(() => {
    const af = (window.airfields || []).find(a => Number.isFinite(Number(a.elev_ft)));
    state.selected = { type: 'airfield', af: af, index: 0 };
    showInspector();
  });
  await page.waitForSelector('#inspector input.da-time', { state: 'attached' });
  await expect(page.locator('#map-time-now')).toBeDisabled();

  // The panel's own slider. It does not drive the shared hour, so nothing else on the map
  // moves -- but the density altitude on screen is now for an hour four ahead, and that is
  // exactly the state Now exists to leave.
  await page.evaluate(() => {
    const s1 = document.querySelector('#inspector input.da-time');
    s1.value = '4';
    s1.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await expect(page.locator('#map-time-now')).toBeEnabled();

  await page.evaluate(() => document.getElementById('map-time-now').click());
  expect(await page.evaluate(() =>
    document.querySelector('#inspector input.da-time').value)).toBe('0');
  await expect(page.locator('#map-time-now')).toBeDisabled();
});

test('the Hebrew readout is not run together by the bidi algorithm', async ({ page }) => {
  // Reported garbled: "+14ש · 21:00Z" rendered as "+1421:00 · שZ" -- digits merged, Z adrift
  // -- and "מפות 09/09/2026 18:00Z" as "Zמפות 09/09/2026 18:00". Both came from forcing
  // dir="ltr" on a span holding a Hebrew word AND a clock. Each run is isolated instead.
  await page.route(/ims-data\/ims\/(sigwx|pwx)\.json/, r => r.fulfill({ status: 404, body: '' }));
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
  // A panel with something timed on screen. The wind-effect toggle, because it does not fetch
  // on enable: NOTAM and the wind grids switch themselves back off when their feed cannot be
  // reached, which in a test looks exactly like the strip ignoring the toggle.
  const openPanel = (page) => page.evaluate(() => {
    const cb = document.getElementById('show-wind-cb');
    cb.checked = true;
    cb.dispatchEvent(new Event('change', { bubbles: true }));
    state.waypoints = [{ lat: 32.0, lng: 34.9, name: 'A' }];
    syncLegs();
    state.selected = { type: 'wp', index: 0 };
    showInspector();
  });

  // A panel with nothing timed in it, and nothing timed on the map either.
  const openBarePanel = (page) => page.evaluate(() => {
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

  test('a panel with nothing timed in it is offered no clock', async ({ page }) => {
    // Reported: why is there a time slider on a waypoint, or on an ADS-B aircraft? Nothing in
    // either answers to time, and a slider there offers to change something the pilot cannot
    // see. It appears when there IS something for a clock to move -- a timed layer on the map,
    // or a density altitude in the panel -- and not otherwise.
    await page.setViewportSize({ width: 390, height: 780 });
    await boot(page);
    await openBarePanel(page);
    await expect(page.locator('#insp-time')).toBeHidden();

    await page.evaluate(() => {
      const cb = document.getElementById('show-wind-cb');
      cb.checked = true;
      cb.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await expect(page.locator('#insp-time')).toBeVisible();

    // ...and goes again when the last timed thing does.
    await page.evaluate(() => {
      const cb = document.getElementById('show-wind-cb');
      cb.checked = false;
      cb.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await expect(page.locator('#insp-time')).toBeHidden();
  });

  test('an airfield panel brings its own reason for one', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 780 });
    await boot(page);
    // No timed layer on the map at all -- but a density altitude on screen answers to the
    // clock, so the panel that shows it gets the control.
    await page.evaluate(() => {
      const af = (window.airfields || []).find(a => Number.isFinite(Number(a.elev_ft)));
      state.selected = { type: 'airfield', af: af, index: 0 };
      showInspector();
    });
    await page.waitForSelector('#inspector input.da-time', { state: 'attached' });
    await expect(page.locator('#insp-time')).toBeVisible();
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
