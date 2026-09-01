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

test('the speak button reads the decoded METAR and TAF aloud', async ({ page }) => {
  await stubTts(page);
  await mockWx(page);
  await openLLBG(page);

  const btn = page.locator('.wx-speak');
  await expect(btn).toBeEnabled();
  await btn.click();

  const said = (await spoken(page)).join(' ');
  expect(said).toContain('LLBG');
  expect(said).toContain('Wind 270° 12 kt gust 20');   // decoded METAR
  expect(said).toContain('TAF');                        // TAF section is read too
  expect(said).not.toContain('27012G20KT');             // NOT the raw METAR code while decoded
  expect(said).not.toContain('1406/1506');              // NOT the raw TAF code while decoded
  await expect(btn).toHaveText('⏹');                    // now in the speaking state

  await btn.click();                                    // second press stops
  expect(await page.evaluate(() => window.__stopped)).toBeGreaterThan(0);
  await expect(btn).toHaveText('🔊');
});

test('with the raw toggle on, it speaks the raw code', async ({ page }) => {
  await stubTts(page);
  await mockWx(page);
  await openLLBG(page);

  await page.locator('.wx-toggle').click();             // switch to raw
  await expect(page.locator('#insp-body .wx-section')).toContainText('27012G20KT');
  await page.locator('.wx-speak').click();

  const said = (await spoken(page)).join(' ');
  expect(said).toContain('27012G20KT');                 // raw METAR token
  expect(said).toContain('1406/1506');                  // raw TAF token
});

test('the speak button is dimmed, not hidden, when no speech engine exists', async ({ page }) => {
  await page.addInitScript(() => {
    try { Object.defineProperty(window, 'speechSynthesis', { value: undefined, configurable: true }); } catch (e) {}
    // no window.Capacitor -> _nativeTts() is null, so ttsAvailable() is false
  });
  await mockWx(page);
  await openLLBG(page);
  const btn = page.locator('.wx-speak');
  await expect(btn).toBeVisible();       // present (dim-never-hide)
  await expect(btn).toBeDisabled();      // but dimmed: nothing can speak
});
