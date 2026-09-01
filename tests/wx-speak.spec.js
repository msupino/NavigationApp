// @ts-check
// The airfield inspector's Weather box can read the METAR/TAF aloud (a 🔊 button beside
// the refresh ↻). It speaks on demand — independent of the in-flight voice-alerts setting —
// and reads what the panel shows: the decoded plain language, or the raw code when the raw
// toggle is on. Here we stub the native Capacitor TTS plugin to capture what gets spoken.
const { test, expect } = require('./_setup');

const METAR = {
  icaoId: 'LLBG', rawOb: 'LLBG 140650Z 27012G20KT 9999 FEW030 SCT100 24/18 Q1013',
  wdir: 270, wspd: 12, wgst: 20, visib: '6+', temp: 24, dewp: 18, altim: 1013,
  clouds: [{ cover: 'FEW', base: 3000 }, { cover: 'SCT', base: 10000 }],
};
const TAF = {
  icaoId: 'LLBG', rawTAF: 'TAF LLBG 140500Z 1406/1506 28010KT 9999 SCT035',
  fcsts: [{ timeFrom: 1781503200, wdir: 280, wspd: 10, visib: '6+', clouds: [{ cover: 'SCT', base: 3500 }] }],
};

async function mockWx(page) {
  await page.route('**wx-data/wx.json**', r => r.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ generatedAt: '2026-06-14T06:00:00Z', stations: { LLBG: { metar: METAR, taf: TAF } } }),
  }));
}

// Stub the native TTS plugin. speak() records the text and returns a promise that only
// resolves when stop() is called, so the button stays in its "speaking" (⏹) state until stop.
async function stubTts(page) {
  await page.addInitScript(() => {
    window.__spoken = []; window.__stopped = 0;
    let resolveSpeak = null;
    window.Capacitor = {
      isNativePlatform: () => true,
      Plugins: {
        TextToSpeech: {
          speak: (o) => { window.__spoken.push(o.text); return new Promise(res => { resolveSpeak = res; }); },
          stop: () => { window.__stopped++; if (resolveSpeak) { resolveSpeak(); resolveSpeak = null; } return Promise.resolve(); },
          getSupportedLanguages: () => Promise.resolve({ languages: ['en-US', 'he-IL'] }),
        },
      },
    };
  });
}

async function openLLBG(page) {
  await page.goto('?lang=en');
  await page.waitForFunction(() => typeof showInspector === 'function' &&
    typeof fetchAirfieldWx === 'function' && typeof window.speakOnDemand === 'function');
  await page.evaluate(async () => {
    if (airfields === null) await loadAirfields();
    const i = airfields.findIndex(a => a.name === 'LLBG');
    if (i < 0) throw new Error('LLBG missing');
    state.selected = { type: 'airfield', index: i };
    showInspector();
  });
  await expect(page.locator('#insp-body .wx-section')).toContainText('METAR');
}

const spoken = page => page.evaluate(() => window.__spoken.slice());
const metarBtn = page => page.locator('.wx-block', { hasText: 'METAR' }).locator('.wx-speak');
const tafBtn = page => page.locator('.wx-block', { hasText: 'TAF' }).locator('.wx-speak');

test('METAR and TAF have separate buttons; each reads only its own section (decoded)', async ({ page }) => {
  await stubTts(page);
  await mockWx(page);
  await openLLBG(page);

  await expect(metarBtn(page)).toBeEnabled();
  await expect(tafBtn(page)).toBeEnabled();

  // METAR button → only the METAR, decoded.
  await metarBtn(page).click();
  let said = (await spoken(page)).join(' ');
  expect(said).toContain('Wind 270° 12 kt gust 20');   // decoded METAR wind
  expect(said).not.toContain('280');                    // NOT the TAF's 280° wind
  expect(said).not.toContain('27012G20KT');             // decoded, not raw
  await expect(metarBtn(page)).toHaveText('⏹');
  await expect(tafBtn(page)).toHaveText('🔊');           // the other stays idle

  // TAF button → stops the METAR read (one at a time) and reads only the TAF.
  await tafBtn(page).click();
  said = (await spoken(page)).join(' ');
  expect(said).toContain('280');                         // decoded TAF wind
  await expect(tafBtn(page)).toHaveText('⏹');
  await expect(metarBtn(page)).toHaveText('🔊');
  expect(await page.evaluate(() => window.__stopped)).toBeGreaterThan(0);

  // Pressing the speaking button again stops it.
  await tafBtn(page).click();
  await expect(tafBtn(page)).toHaveText('🔊');
});

test('with the raw toggle on, each button speaks its own raw code', async ({ page }) => {
  await stubTts(page);
  await mockWx(page);
  await openLLBG(page);

  await page.locator('.wx-toggle').click();             // switch to raw
  await expect(page.locator('#insp-body .wx-section')).toContainText('27012G20KT');

  await metarBtn(page).click();
  expect((await spoken(page)).join(' ')).toContain('27012G20KT');   // raw METAR token
  expect((await spoken(page)).join(' ')).not.toContain('1406/1506'); // not the TAF's

  await tafBtn(page).click();
  expect((await spoken(page)).join(' ')).toContain('1406/1506');    // raw TAF token
});

test('the speak buttons are dimmed, not hidden, when no speech engine exists', async ({ page }) => {
  await page.addInitScript(() => {
    try { Object.defineProperty(window, 'speechSynthesis', { value: undefined, configurable: true }); } catch (e) {}
    // no window.Capacitor -> _nativeTts() is null, so ttsAvailable() is false
  });
  await mockWx(page);
  await openLLBG(page);
  await expect(metarBtn(page)).toBeVisible();       // present (dim-never-hide)
  await expect(metarBtn(page)).toBeDisabled();      // but dimmed: nothing can speak
  await expect(tafBtn(page)).toBeDisabled();
});
