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
  await page.evaluate(() => {
    const cb = document.getElementById('notam-cb');
    cb.checked = true;
    cb.dispatchEvent(new Event('change', { bubbles: true }));
  });
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
