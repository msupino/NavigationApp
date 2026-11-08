// @ts-check
// Asked: "add the play button in waypoints which have pluto west, llha or llhz". A frequency change
// point's call-sign list (the map waypoint window) carries the same small play button as the
// airfield window, beside any listed station NavAid plays live: Pluto West, Haifa (its tower),
// Herzliya (its tower). The suite never reaches the receivers: play() is stubbed.
const { test, expect } = require('./_setup');

async function boot(page) {
  await page.addInitScript(() => {
    window.__atcPlays = [];
    HTMLMediaElement.prototype.play = function () {
      window.__atcPlays.push(this.src);
      setTimeout(() => this.dispatchEvent(new Event('playing')), 0);
      return Promise.resolve();
    };
    HTMLMediaElement.prototype.pause = function () {};
    HTMLMediaElement.prototype.load = function () {};
  });
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof state !== 'undefined' && !!window.atcRadio);
  await page.evaluate(() => { NavAid.tuning.featureAtcRadio = true; refreshAtcRadioFeature(); });   // ships off
  await page.evaluate(() => loadNavWaypoints());
  await page.waitForFunction(() => Array.isArray(window.navWP) && window.navWP.length > 0);
  await page.evaluate(() => loadCommChange());
  await page.waitForFunction(() => window.commChangeMap && Object.keys(window.commChangeMap).length > 0);
}

// The waypoint's call signs, each with the channel its play button plays (or null).
const openWaypoint = (page, name) => page.evaluate((n) => {
  window.showCommChange = true;
  state.selected = { type: 'navwp', index: navWP.findIndex(w => w.name === n) };
  showInspector();
  return Array.from(document.querySelectorAll('#inspector .commchange-option')).map(el => {
    const b = el.querySelector('[data-atc]');
    return [el.dataset.callSign, b ? b.dataset.atc : null];
  });
}, name);

test('Megiddo junction: Pluto West plays, Pluto East and Megiddo do not', async ({ page }) => {
  await boot(page);
  expect(await openWaypoint(page, 'ZMGID')).toEqual([
    ['PLUTO_EAST', null], ['PLUTO_WEST', 'pluto-west'], ['MEGIDDO', null],
  ]);
  const btn = page.locator('#inspector [data-call-sign="PLUTO_WEST"] [data-atc="pluto-west"] button');
  await expect(btn).toHaveAttribute('aria-label', 'Listen Pluto West');
  await btn.click();
  await expect(page.locator('#inspector [data-atc="pluto-west"]')).toHaveClass(/is-live/);
  expect(await page.evaluate(() => window.__atcPlays.pop())).toMatch(/\/pluto-west\?ts=\d+$/);
  // The ATC radio list shows the same channel playing.
  await page.evaluate(() => window.atcRadio.open());
  await expect(page.locator('#atc-list [data-atc="pluto-west"] button')).toHaveAttribute('aria-pressed', 'true');
});

test('Herzliya and Haifa call signs play their towers', async ({ page }) => {
  await boot(page);
  expect(await openWaypoint(page, 'DEROR')).toEqual([['HERZLIYA', 'herzliya-twr'], ['PLUTO_WEST', 'pluto-west']]);
  expect(await openWaypoint(page, 'DAROM')).toEqual([['HAIFA', 'haifa-twr'], ['PLUTO_WEST', 'pluto-west']]);
});

test('withdrawn by the gist, the call-sign list carries no buttons', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => { NavAid.tuning.featureAtcRadio = false; refreshAtcRadioFeature(); });
  expect(await openWaypoint(page, 'ZMGID')).toEqual([['PLUTO_EAST', null], ['PLUTO_WEST', null], ['MEGIDDO', null]]);
});

// Asked: "match styling between waypoint types". A route waypoint on a frequency change point shows
// the same frame as the map waypoint -- the call signs and their play buttons -- not just the badge.
test('a route waypoint on the change point shows the same call signs and play buttons', async ({ page }) => {
  await boot(page);
  const got = await page.evaluate(() => {
    window.showCommChange = true;
    const z = navWP.find(w => w.name === 'ZMGID'), d = navWP.find(w => w.name === 'DEROR');
    state.waypoints = [{ lat: d.lat, lng: d.lng, name: 'DEROR' }, { lat: z.lat, lng: z.lng, name: 'ZMGID' }];
    state.selected = { type: 'wp', index: 1 };
    showInspector();
    return Array.from(document.querySelectorAll('#inspector .commchange-option')).map(el => {
      const b = el.querySelector('[data-atc]');
      return [el.dataset.callSign, b ? b.dataset.atc : null];
    });
  });
  expect(got).toEqual([['PLUTO_EAST', null], ['PLUTO_WEST', 'pluto-west'], ['MEGIDDO', null]]);
});

test('the play button sits between the name and the frequency, as in the airfield rows', async ({ page }) => {
  await boot(page);
  await openWaypoint(page, 'ZMGID');
  const [name, play, freq] = await page.evaluate(() => {
    const item = document.querySelector('#inspector [data-call-sign="PLUTO_WEST"]');
    return ['.commchange-option-name', '.atc-play', '.commchange-option-freq']
      .map(s => { const r = item.querySelector(s).getBoundingClientRect(); return [r.left, r.right]; });
  });
  expect(play[0]).toBeGreaterThan(name[1]);     // English: name, then the button, then the frequency
  expect(freq[0]).toBeGreaterThan(play[1]);
});
