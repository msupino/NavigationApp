// @ts-check
// Live ATC radio: Herzliya and Haifa, and Pluto West, One channel at a time. The suite
// never reaches the upstream: _setup aborts the hosts, and play() is stubbed here to record what
// was asked for.
const { test, expect } = require('./_setup');

async function boot(page, opts = {}) {
  await page.addInitScript((fail) => {
    window.__atcPlays = [];
    HTMLMediaElement.prototype.play = function () {
      window.__atcPlays.push(this.src);
      if (fail) return Promise.reject(new Error('blocked'));
      setTimeout(() => this.dispatchEvent(new Event('playing')), 0);
      return Promise.resolve();
    };
    HTMLMediaElement.prototype.pause = function () {};
    HTMLMediaElement.prototype.load = function () {};
  }, !!opts.fail);
  await page.goto('?lang=' + (opts.lang || 'en') + '&nogist');
  await page.waitForFunction(() => !!(window.atcRadio && document.getElementById('tool-atc-radio')));
  // Ships on (featureAtcRadio, as the gist has it); set explicitly so these tests do not hang on
  // the default. The withdrawal tests set it back to false themselves.
  await page.evaluate(() => {
    if (window.NavAid && NavAid.tuning) NavAid.tuning.featureAtcRadio = true;
    if (typeof window.refreshAtcRadioFeature === 'function') window.refreshAtcRadioFeature();
  });
}

const row = (page, id) => page.locator('[data-atc="' + id + '"]');

test('the five channels, each played through its own link with a fresh timestamp', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => document.getElementById('tool-atc-radio').click());
  await expect(page.locator('#atc-modal')).not.toHaveClass(/hidden/);
  await expect(page.locator('.atc-row')).toHaveCount(5);
  await expect(row(page, 'herzliya-twr').locator('.atc-name')).toHaveText('LLHZ · Tower');
  // No frequencies in the list: the airfield window shows each field's own, and a copy here would
  // go stale when one changes -- the provider updates the channel (asked).
  await expect(page.locator('#atc-list .atc-freq')).toHaveCount(0);
  await expect(page.locator('#atc-list')).not.toContainText(/\d{3}\.\d{2}/);
  await expect(row(page, 'pluto-west').locator('.atc-name')).toHaveText('Pluto West');   // no airfield

  await row(page, 'herzliya-twr').locator('button').click();
  await expect(row(page, 'herzliya-twr').locator('.atc-state')).toHaveText('Live');
  await page.waitForTimeout(5);
  await row(page, 'herzliya-twr').locator('button').click();            // stop
  await row(page, 'herzliya-twr').locator('button').click();            // again
  const plays = await page.evaluate(() => window.__atcPlays);
  expect(plays).toHaveLength(2);
  for (const u of plays) expect(u).toMatch(/^https:\/\/navaid-atc\.marco-956\.workers\.dev\/herzliya-twr\?ts=\d{13}$/);
  expect(plays[0]).not.toBe(plays[1]);                                     // a new request each time
});

test('one channel at a time: a second Listen stops the first', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => window.atcRadio.open());
  await row(page, 'haifa-twr').locator('button').click();
  await expect(row(page, 'haifa-twr').locator('button')).toHaveAttribute('aria-pressed', 'true');
  await row(page, 'pluto-west').locator('button').click();
  await expect(row(page, 'haifa-twr').locator('button')).toHaveAttribute('aria-pressed', 'false');
  await expect(row(page, 'pluto-west').locator('button')).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(() => window.atcRadio.current)).toBe('pluto-west');
});

test('closing the window keeps the audio, and the opener stays lit until Stop', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => window.atcRadio.open());
  await row(page, 'haifa-atis').locator('button').click();
  await page.locator('#atc-modal-close').click();
  await expect(page.locator('#atc-modal')).toHaveClass(/hidden/);
  expect(await page.evaluate(() => [window.atcRadio.current,
    document.getElementById('tool-atc-radio').getAttribute('aria-pressed')])).toEqual(['haifa-atis', 'true']);
  await page.evaluate(() => window.atcRadio.stop());
  expect(await page.evaluate(() => document.getElementById('tool-atc-radio').getAttribute('aria-pressed'))).toBe('false');
});

// Asked: "when playing atc, pressing the green button on map should stop playing".
test('the green map button stops the channel playing; idle, it opens the list', async ({ page }) => {
  await boot(page);
  const fab = page.locator('#tool-atc-radio');
  const idle = await page.evaluate(() => S.atcRadioTitle);
  await expect(fab).toHaveAttribute('aria-label', idle);
  await page.evaluate(() => window.atcRadio.play('pluto-west'));
  await expect(fab).toHaveClass(/active/);
  await expect(fab).toHaveAttribute('aria-label', 'Stop Pluto West');
  await fab.click();
  expect(await page.evaluate(() => window.atcRadio.current)).toBe(null);
  await expect(fab).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#atc-modal')).toHaveClass(/hidden/);     // stopped, not opened
  await expect(fab).toHaveAttribute('aria-label', idle);             // and says what it does again
  await fab.click();
  await expect(page.locator('#atc-modal')).not.toHaveClass(/hidden/); // idle: opens the list
});

// Asked: "can the green player show some indication to whats currently played?"
test('the green map button names the channel playing, without moving the column', async ({ page }) => {
  await boot(page);
  const now = page.locator('.atc-fab-control .atc-fab-now');
  await expect(now).toBeHidden();
  const column = () => page.evaluate(() => [...document.querySelector('.leaflet-bottom.leaflet-right').children]
    .map(c => { const r = c.getBoundingClientRect(); return [Math.round(r.top), Math.round(r.left)]; }));
  const before = await column();
  await page.evaluate(() => window.atcRadio.play('haifa-atis'));
  await expect(now).toBeVisible();
  await expect(now).toHaveText('LLHA \u00b7 ATIS');
  expect(await column()).toEqual(before);
  // Beside the button, to its left.
  const [n, f] = await page.evaluate(() => [document.querySelector('.atc-fab-now').getBoundingClientRect().right,
    document.getElementById('tool-atc-radio').getBoundingClientRect().left]);
  expect(n).toBeLessThanOrEqual(f);
  await page.evaluate(() => window.atcRadio.play('pluto-west'));
  await expect(now).toHaveText('Pluto West');
  await page.evaluate(() => window.atcRadio.stop());
  await expect(now).toBeHidden();
});

test('a stream that does not start says so and releases the button', async ({ page }) => {
  await boot(page, { fail: true });
  await page.evaluate(() => window.atcRadio.open());
  await row(page, 'herzliya-clr').locator('button').click();
  await expect(row(page, 'herzliya-clr').locator('.atc-state')).toHaveText('Not on the air right now');
  await expect(row(page, 'herzliya-clr').locator('button')).toHaveAttribute('aria-pressed', 'false');
});

test('Hebrew labels', async ({ page }) => {
  await boot(page, { lang: 'he' });
  await page.evaluate(() => window.atcRadio.open());
  await expect(page.locator('#atc-modal-title')).toHaveText('רדיו בקרה');
  await expect(row(page, 'haifa-twr').locator('.atc-name')).toHaveText('LLHA · מגדל');
  await expect(row(page, 'haifa-twr').locator('button')).toHaveText('האזנה');
});

test('the gist can withdraw it: the button goes and the audio stops', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => window.atcRadio.play('haifa-twr'));
  await page.evaluate(() => { NavAid.tuning.featureAtcRadio = false; window.refreshAtcRadioFeature(); });
  expect(await page.evaluate(() => [document.getElementById('tool-atc-radio').hidden, window.atcRadio.current]))
    .toEqual([true, null]);
  // Hidden as drawn, not only as a property (display:flex once beat [hidden]).
  await expect(page.locator('#tool-atc-radio')).toBeHidden();
});

// Asked: "each play to each airfield which has it", then "a small play button near the freq of
// the airfield". Each channel's button sits in its own frequency row of the airfield window;
// a field without a live channel carries none.
async function openField(page, icao) {
  await page.waitForFunction(() => typeof showInspector === 'function'
    && Array.isArray(window.airfields) && airfields.length > 0);
  await page.evaluate((code) => {
    state.selected = { type: 'airfield', index: airfields.findIndex(a => a.name === code) };
    showInspector();
  }, icao);
}
const comm = page => page.locator('#inspector .comm-section');

test('each airfield window has a small play button in each live frequency row, and only those', async ({ page }) => {
  await boot(page);
  await openField(page, 'LLHZ');
  await expect(comm(page).locator('.primary-row [data-atc="herzliya-twr"] button')).toBeVisible();
  await expect(comm(page).locator('.clearance-row [data-atc="herzliya-clr"] button')).toBeVisible();
  await expect(comm(page).locator('[data-atc]')).toHaveCount(2);
  await expect(page.locator('#inspector .atc-row')).toHaveCount(0);       // no big Listen block
  const btn = comm(page).locator('[data-atc="herzliya-twr"] button');
  await expect(btn).toHaveAttribute('aria-label', 'Listen LLHZ Tower');
  const box = await btn.boundingBox();
  expect(box.width).toBeLessThanOrEqual(36);                              // small, round

  await openField(page, 'LLHA');
  await expect(comm(page).locator('.primary-row [data-atc="haifa-twr"] button')).toBeVisible();
  await expect(comm(page).locator('.atis-row [data-atc="haifa-atis"] button')).toBeVisible();
  // Pluto is the country-wide control, not Haifa's (reported): in no airfield's window.
  expect(await comm(page).locator('[data-atc]').evaluateAll(rs => rs.map(r => r.dataset.atc)))
    .toEqual(['haifa-twr', 'haifa-atis']);

  await openField(page, 'LLES');                       // no live channel
  await expect(page.locator('#insp-title')).toHaveValue(/LLES/);
  await expect(page.locator('#inspector [data-atc]')).toHaveCount(0);
});

test('the airfield play button plays it, and the ATC list shows the same state', async ({ page }) => {
  await boot(page);
  await openField(page, 'LLHA');
  const inl = page.locator('#inspector [data-atc="haifa-atis"]');
  await inl.locator('button').click();
  await expect(inl).toHaveClass(/is-live/);
  await expect(inl.locator('.atc-state')).toHaveText('Live');
  await expect(inl.locator('button')).toHaveAttribute('aria-label', 'Stop LLHA ATIS');
  expect(await page.evaluate(() => window.__atcPlays.pop())).toMatch(/workers\.dev\/haifa-atis\?ts=\d+$/);
  await page.evaluate(() => window.atcRadio.open());
  await expect(page.locator('#atc-list [data-atc="haifa-atis"] button')).toHaveAttribute('aria-pressed', 'true');
  // Stop from the list: the airfield window's button follows.
  await page.locator('#atc-list [data-atc="haifa-atis"] button').click();
  await expect(inl.locator('button')).toHaveAttribute('aria-pressed', 'false');
});

test('a channel that will not start rings its airfield button red', async ({ page }) => {
  await boot(page, { fail: true });
  await openField(page, 'LLHZ');
  const inl = page.locator('#inspector [data-atc="herzliya-twr"]');
  await inl.locator('button').click();
  await expect(inl).toHaveClass(/is-offline/);
  await expect(inl.locator('button')).toHaveAttribute('title', /Not on the air right now/);
});

test('an airfield window opened before the radio loaded still gets its buttons', async ({ page }) => {
  // Hold phase 2's radio module back, open LLHZ, then let it load.
  let release;
  const gate = new Promise(r => { release = r; });
  await page.route(/app\/atc-radio\.js/, async route => { await gate; await route.continue(); });
  await page.goto('?lang=en&nogist', { waitUntil: 'domcontentloaded' });
  await openField(page, 'LLHZ');
  await expect(comm(page)).toBeVisible();
  expect(await page.evaluate(() => !!window.atcRadio)).toBe(false);
  await page.evaluate(() => { if (window.NavAid && NavAid.tuning) NavAid.tuning.featureAtcRadio = true; });
  release();
  await expect(comm(page).locator('.primary-row [data-atc="herzliya-twr"] button')).toBeVisible();
  await expect(comm(page).locator('.clearance-row [data-atc="herzliya-clr"] button')).toBeVisible();
});

test('withdrawn by the gist, the airfield window carries no channels', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => { NavAid.tuning.featureAtcRadio = false; window.refreshAtcRadioFeature(); });
  await openField(page, 'LLHZ');
  await expect(page.locator('#inspector .comm-section')).toBeVisible();
  await expect(page.locator('#inspector [data-atc]')).toHaveCount(0);
});

// Asked: "why screenshots don't show the ATC listen button? gist enables it and code disables it --
// make default enabled". With no gist at all the feature is on, and the listen button is on the map.
test('the ATC radio is on by default, without a gist', async ({ page }) => {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => !!(window.atcRadio && document.getElementById('tool-atc-radio')));
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => tune('featureAtcRadio'))).toBe(true);
  await expect(page.locator('.atc-fab-control')).toBeVisible();
});
