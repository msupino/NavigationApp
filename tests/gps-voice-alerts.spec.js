// @ts-check
// Spoken in-flight alerts (APK only). See
// docs/superpowers/specs/2026-08-13-voice-alerts-design.md
const { test, expect } = require('./_setup');

test.describe('gpsSpokenDigits', () => {
  test('splits a padded heading into spoken digits, in both languages', async ({ page }) => {
    await page.goto('?lang=en&nogist');
    await page.waitForFunction(() => typeof gpsSpokenDigits === 'function');
    const out = await page.evaluate(() => ({
      en004: gpsSpokenDigits('004', 'en'),
      en270: gpsSpokenDigits('270', 'en'),
      he004: gpsSpokenDigits('004', 'he'),
      numeric: gpsSpokenDigits(90, 'en'),
      // A stray degree sign must not become a spoken word.
      symbols: gpsSpokenDigits('090°', 'en'),
      empty: gpsSpokenDigits('', 'en'),
      nullish: gpsSpokenDigits(null, 'en'),
    }));
    expect(out.en004).toBe('zero zero four');
    expect(out.en270).toBe('two seven zero');
    expect(out.he004).toBe('אפס אפס ארבע');
    expect(out.numeric).toBe('nine zero');
    expect(out.symbols).toBe('zero nine zero');
    expect(out.empty).toBe('');
    expect(out.nullish).toBe('');
  });
});

// Installs a fake native Capacitor with a TTS plugin that records every speak() call.
async function stubTts(page, opts) {
  const o = opts || {};
  await page.addInitScript(([langs, native]) => {
    window.__spoken = [];
    window.Capacitor = {
      isNativePlatform: () => native,
      Plugins: {
        TextToSpeech: {
          speak: (o2) => { window.__spoken.push(o2); return Promise.resolve(); },
          getSupportedLanguages: () => Promise.resolve({ languages: langs }),
        },
        LocalNotifications: {
          requestPermissions: () => Promise.resolve({ display: 'granted' }),
          schedule: () => Promise.resolve(),
        },
      },
    };
  }, [o.languages || ['en-US', 'he-IL'], o.native !== false]);
}

test.describe('gpsSpeak', () => {
  test('speaks through the native plugin when the setting is on', async ({ page }) => {
    await stubTts(page);
    await page.goto('?lang=en&nogist');
    await page.waitForFunction(() => typeof gpsSpeak === 'function');
    const out = await page.evaluate(async () => {
      window.voiceAlerts = true;
      gpsSpeak('Top.');
      await window.__gpsSpeakChain;
      return window.__spoken.slice();
    });
    expect(out.length).toBe(1);
    expect(out[0].text).toBe('Top.');
    expect(out[0].lang).toBe('en-US');
  });

  test('says nothing when the setting is off', async ({ page }) => {
    await stubTts(page);
    await page.goto('?lang=en&nogist');
    await page.waitForFunction(() => typeof gpsSpeak === 'function');
    const n = await page.evaluate(async () => {
      window.voiceAlerts = false;
      gpsSpeak('Top.');
      await window.__gpsSpeakChain;
      return window.__spoken.length;
    });
    expect(n).toBe(0);
  });

  test('says nothing on a non-native platform, even with the setting on', async ({ page }) => {
    await stubTts(page, { native: false });
    await page.goto('?lang=en&nogist');
    await page.waitForFunction(() => typeof gpsSpeak === 'function');
    const n = await page.evaluate(async () => {
      window.voiceAlerts = true;
      gpsSpeak('Top.');
      await window.__gpsSpeakChain;
      return window.__spoken.length;
    });
    expect(n).toBe(0);
  });

  test('falls back to English when the device has no Hebrew voice', async ({ page }) => {
    await stubTts(page, { languages: ['en-US'] });
    await page.goto('?lang=he&nogist');
    await page.waitForFunction(() => typeof gpsSpeak === 'function');
    const out = await page.evaluate(async () => {
      window.voiceAlerts = true;
      gpsSpeak('שלום');
      await window.__gpsSpeakChain;
      return window.__spoken.slice();
    });
    expect(out.length).toBe(1);
    expect(out[0].lang).toBe('en-US');
  });

  test('uses the Hebrew voice when one is installed', async ({ page }) => {
    await stubTts(page, { languages: ['en-US', 'he-IL'] });
    await page.goto('?lang=he&nogist');
    await page.waitForFunction(() => typeof gpsSpeak === 'function');
    const out = await page.evaluate(async () => {
      window.voiceAlerts = true;
      gpsSpeak('שלום');
      await window.__gpsSpeakChain;
      return window.__spoken.slice();
    });
    expect(out[0].lang).toBe('he-IL');
  });

  test('a plugin rejection is swallowed and does not break the next call', async ({ page }) => {
    await page.addInitScript(() => {
      window.__spoken = [];
      window.__calls = 0;
      window.Capacitor = {
        isNativePlatform: () => true,
        Plugins: {
          TextToSpeech: {
            speak: (o) => {
              window.__calls++;
              if (window.__calls === 1) return Promise.reject(new Error('engine busy'));
              window.__spoken.push(o);
              return Promise.resolve();
            },
            getSupportedLanguages: () => Promise.resolve({ languages: ['en-US'] }),
          },
        },
      };
    });
    await page.goto('?lang=en&nogist');
    await page.waitForFunction(() => typeof gpsSpeak === 'function');
    const out = await page.evaluate(async () => {
      window.voiceAlerts = true;
      gpsSpeak('first');
      await window.__gpsSpeakChain;
      gpsSpeak('second');
      await window.__gpsSpeakChain;
      return { calls: window.__calls, spoken: window.__spoken.map(s => s.text) };
    });
    expect(out.calls).toBe(2);
    expect(out.spoken).toEqual(['second']);
  });

  test('overlapping alerts are queued, not interleaved', async ({ page }) => {
    await page.addInitScript(() => {
      window.__order = [];
      let release = null;
      window.__release = () => release && release();
      window.Capacitor = {
        isNativePlatform: () => true,
        Plugins: {
          TextToSpeech: {
            speak: (o) => {
              window.__order.push('start:' + o.text);
              // First call blocks until released; a queued second must not start early.
              if (o.text === 'first') {
                return new Promise((res) => {
                  release = () => { window.__order.push('end:first'); res(); };
                });
              }
              window.__order.push('end:' + o.text);
              return Promise.resolve();
            },
            getSupportedLanguages: () => Promise.resolve({ languages: ['en-US'] }),
          },
        },
      };
    });
    await page.goto('?lang=en&nogist');
    await page.waitForFunction(() => typeof gpsSpeak === 'function');
    const order = await page.evaluate(async () => {
      window.voiceAlerts = true;
      gpsSpeak('first');
      gpsSpeak('second');
      await new Promise(r => setTimeout(r, 50));
      window.__release();
      await window.__gpsSpeakChain;
      return window.__order.slice();
    });
    expect(order).toEqual(['start:first', 'end:first', 'start:second', 'end:second']);
  });
});

test.describe('alerts speak their own phrasing', () => {
  test('gpsSendWatchAlert speaks the third argument, not the notification body', async ({ page }) => {
    await stubTts(page);
    await page.goto('?lang=en&nogist');
    await page.waitForFunction(() => typeof gpsSendWatchAlert === 'function');
    const out = await page.evaluate(async () => {
      window.voiceAlerts = true;
      gpsSendWatchAlert('Altitude', '1500 ft — planned 2000 ft', 'Altitude 1500 feet, planned 2000.');
      await window.__gpsSpeakChain;
      return window.__spoken.map(s => s.text);
    });
    expect(out).toEqual(['Altitude 1500 feet, planned 2000.']);
  });

  test('an alert with no spoken text stays silent but still notifies', async ({ page }) => {
    await stubTts(page);
    await page.goto('?lang=en&nogist');
    await page.waitForFunction(() => typeof gpsSendWatchAlert === 'function');
    const n = await page.evaluate(async () => {
      window.voiceAlerts = true;
      gpsSendWatchAlert('Title', 'body');           // no third argument
      await window.__gpsSpeakChain;
      return window.__spoken.length;
    });
    expect(n).toBe(0);
  });

  test('the TOP alert speaks', async ({ page }) => {
    await stubTts(page);
    await page.goto('?lang=en&nogist');
    await page.waitForFunction(() => typeof gpsCheckLegAlerts === 'function');
    const out = await page.evaluate(async () => {
      window.voiceAlerts = true;
      state.waypoints = [{ lat: 32.0, lng: 34.0, name: 'ALPHA' },
                         { lat: 32.008, lng: 34.0, name: 'BRAVO' }];
      syncLegs();
      gpsAlertLegIndex = 0;
      window._gpsAlertConfirmed = true;
      // Inside the capture radius of BRAVO -- the overhead-the-waypoint moment.
      gpsOwn = { lat: 32.008, lng: 34.0, t: Date.now() };
      gpsLastAlt = null;
      gpsCheckLegAlerts();
      await window.__gpsSpeakChain;
      return window.__spoken.map(s => s.text);
    });
    expect(out).toContain('Top.');
  });

  test('speaks the Hebrew phrasing when the UI is Hebrew', async ({ page }) => {
    await stubTts(page, { languages: ['en-US', 'he-IL'] });
    await page.goto('?lang=he&nogist');
    await page.waitForFunction(() => typeof gpsSendWatchAlert === 'function');
    const out = await page.evaluate(async () => {
      window.voiceAlerts = true;
      gpsSendWatchAlert('גובה', 'body', S.speakAlertAlt(1500, 2000));
      await window.__gpsSpeakChain;
      return window.__spoken.slice();
    });
    expect(out.length).toBe(1);
    expect(out[0].lang).toBe('he-IL');
    expect(out[0].text).toContain('גובה');
    expect(out[0].text).toContain('1500');
    expect(out[0].text).not.toContain('°');
  });

  // The whole point of speaking FIRST and fire-and-forget: the alert the pilot relies on
  // must not depend on the audio device working.
  test('a TTS failure does not suppress the notification', async ({ page }) => {
    await page.addInitScript(() => {
      window.__scheduled = [];
      window.Capacitor = {
        isNativePlatform: () => true,
        Plugins: {
          TextToSpeech: {
            speak: () => Promise.reject(new Error('no engine')),
            getSupportedLanguages: () => Promise.resolve({ languages: ['en-US'] }),
          },
          LocalNotifications: {
            requestPermissions: () => Promise.resolve({ display: 'granted' }),
            schedule: (o) => { window.__scheduled.push(o); return Promise.resolve(); },
          },
        },
      };
    });
    await page.goto('?lang=en&nogist');
    await page.waitForFunction(() => typeof gpsSendWatchAlert === 'function');
    const out = await page.evaluate(async () => {
      window.voiceAlerts = true;
      gpsSendWatchAlert('Altitude', '1500 ft', 'Altitude 1500 feet, planned 2000.');
      await window.__gpsSpeakChain;
      return window.__scheduled.slice();
    });
    expect(out.length).toBe(1);
    expect(out[0].notifications[0].title).toBe('Altitude');
  });

  test('the drift alert speaks its own phrasing, with no degree symbol', async ({ page }) => {
    await stubTts(page);
    await page.goto('?lang=en&nogist');
    await page.waitForFunction(() => typeof gpsCheckDrift === 'function');
    const out = await page.evaluate(async () => {
      window.voiceAlerts = true;
      state.waypoints = [{ lat: 32.0, lng: 34.0, name: 'ALPHA' },
                         { lat: 32.0, lng: 35.0, name: 'BRAVO' }];
      syncLegs();
      gpsAlertLegIndex = 0;
      window._gpsAlertConfirmed = true;   // testing the drift math itself, not the confirmation gate
      // Well off the leg's own bearing, before the midpoint.
      gpsOwn = { lat: 32.15, lng: 34.2, t: Date.now() };
      gpsCheckDrift();
      await window.__gpsSpeakChain;
      return window.__spoken.map(s => s.text);
    });
    expect(out.length).toBe(1);
    expect(out[0]).toMatch(/degrees off course/);
    expect(out[0]).not.toContain('°');
  });
});
