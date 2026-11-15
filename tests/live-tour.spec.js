// @ts-check
// Asked: "when recording, there are few more icons on map, add tutorial for them". The
// in-flight tour walks round the controls that only appear while a fix drives the map, the
// first time the position is live, once.
const { test, expect } = require('./_setup');

async function goLive(page, record) {
  await page.evaluate((record) => {
    window.gpsLiveOn = true;
    window.gpsOwn = { lat: 32.1, lng: 34.9, hdg: 40, t: Date.now(), acc: 8 };
    window.gpsPositionLive = () => true;
    if (record) window.gpsRecording = true;
    if (typeof updateGpsRecIndicator === 'function') updateGpsRecIndicator();
  }, record);
}

test('the in-flight controls each get a step, the heading line last', async ({ page }) => {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => window.NavAid && NavAid.tour && typeof updateGpsRecIndicator === 'function');
  await goLive(page, true);
  const keys = await page.evaluate(() => NavAid.tour.liveSteps().map(s => s.k));
  expect(keys).toEqual(expect.arrayContaining(['LiveRec', 'LiveFollow', 'LiveOrient', 'LiveVoice', 'LiveLine']));
  expect(keys.at(-1)).toBe('LiveLine');
  // Played: every bubble has its own title and text, in English and (below) Hebrew.
  await page.evaluate(() => NavAid.tour.start('live'));
  // Click through to the end (the tour counts its steps when it starts, so step until it closes).
  const seen = [];
  for (let n = 0; n < 12 && await page.locator('#map-tour').count(); n++) {
    seen.push(await page.locator('#map-tour .tour-title').textContent());
    expect((await page.locator('#map-tour .tour-text').textContent()).length).toBeGreaterThan(20);
    await page.locator('#map-tour .tour-next').click();
  }
  expect(seen).toContain('Recording');
  expect(seen).toContain('Follow');
  expect(seen.at(-1)).toBe('The heading line');
  await expect(page.locator('#map-tour')).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('navaid.liveTourSeen'))).toBe('1');
});

test('it starts by itself the first time the position is live, and only once', async ({ page }) => {
  // The suite turns the tours off (tests/_setup.js); this one opts back in, like map-tour.spec.js,
  // with the map tour already seen so only the in-flight one can start.
  await page.addInitScript(() => {
    window.__navaidNoTour = false;
    try { localStorage.setItem('navaid.tourSeen', '1'); } catch (e) { /* */ }
  });
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => window.NavAid && NavAid.tour && typeof updateGpsRecIndicator === 'function');
  await goLive(page, false);
  await expect(page.locator('#map-tour')).toBeVisible({ timeout: 10000 });
  // Its first step is whichever in-flight control is on screen first (a faked fix may leave the
  // readout empty) -- never one of the map tour's.
  await expect(page.locator('#map-tour .tour-title')).toHaveText(/^(Speed, altitude, track|GPS quality|Follow)$/);
  await page.locator('#map-tour .tour-skip').click();
  expect(await page.evaluate(() => localStorage.getItem('navaid.liveTourSeen'))).toBe('1');
});

test('Hebrew has every in-flight step', async ({ page }) => {
  await page.goto('?lang=he&nogist');
  await page.waitForFunction(() => typeof S === 'object' && S.tourHoldTitle);
  const missing = await page.evaluate(() => ['LiveRec', 'LiveRead', 'LiveStatus', 'LiveFollow', 'LiveOrient', 'LiveVoice', 'LiveShare', 'LiveLine']
    .flatMap(k => ['tour' + k + 'Title', 'tour' + k + 'Text']).filter(k => !S[k] || /[A-Za-z]{4,}/.test(S[k].replace(/GPS|TOP/g, ''))));
  expect(missing).toEqual([]);
});

// Asked: "show the tutorial button should also show the tracking tutorial next time its
// pressed". Settings -> Show the tour plays the map tour and then the in-flight one, also with
// no live position: the in-flight buttons are shown for the tour and put away after it.
test('Show the tour plays the in-flight steps too, with Location off', async ({ page }) => {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => window.NavAid && NavAid.tour && document.getElementById('tour-replay'));
  // Always there now (dim, never hide): dimmed with no position.
  const before = await page.evaluate(() => [getComputedStyle(document.querySelector('.follow-ctrl')).display,
    document.getElementById('follow-lock').getAttribute('aria-disabled')]);
  expect(before[0]).not.toBe('none');
  expect(before[1]).toBe('true');
  await page.evaluate(() => document.getElementById('tour-replay').click());
  await expect(page.locator('#map-tour')).toBeVisible();
  const titles = [];
  for (let n = 0; n < 30 && await page.locator('#map-tour').count(); n++) {
    titles.push(await page.locator('#map-tour .tour-title').textContent());
    await page.locator('#map-tour .tour-next').click();
  }
  expect(titles).toEqual(expect.arrayContaining(['Recording', 'Follow', 'North up or heading up', 'Spoken alerts', 'The heading line']));
  expect(titles.at(-1)).toBe('The heading line');
  // The preview ends with the tour: the REC sign goes, the follow switch is dimmed again.
  expect(await page.evaluate(() => [document.body.classList.contains('tour-live-preview'),
    getComputedStyle(document.querySelector('.follow-ctrl')).display,
    getComputedStyle(document.getElementById('gps-rec-indicator')).display]).then(([p, f, r]) => [p, f !== 'none', r])).toEqual([false, true, 'none']);
});
