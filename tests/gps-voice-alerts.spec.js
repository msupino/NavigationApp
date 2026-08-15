// @ts-check
// Spoken in-flight alerts. Native TTS in the APK is the reliable in-flight path; a
// window.speechSynthesis fallback lets the feature be heard and tested in a browser too,
// where it is a testing aid only (browsers suspend speech when backgrounded). See
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

  // On the website there is no native plugin -- gpsSpeak falls back to the browser's
  // own speechSynthesis. This is a testing aid, not the reliable in-flight path (see
  // the web-speech-fallback describe below): browsers suspend speechSynthesis when the
  // page is backgrounded, which is exactly the cockpit case.
  test('falls back to window.speechSynthesis on a non-native platform, when the setting is on', async ({ page }) => {
    await stubTts(page, { native: false });
    await stubWebSpeech(page);
    await page.goto('?lang=en&nogist');
    await page.waitForFunction(() => typeof gpsSpeak === 'function');
    const out = await page.evaluate(async () => {
      window.voiceAlerts = true;
      gpsSpeak('Top.');
      await window.__gpsSpeakChain;
      return window.__webSpoken.map(u => ({ text: u.text, lang: u.lang }));
    });
    expect(out.length).toBe(1);
    expect(out[0].text).toBe('Top.');
    expect(out[0].lang).toBe('en-US');
  });

  test('says nothing via the web fallback on a non-native platform when the setting is off', async ({ page }) => {
    await stubTts(page, { native: false });
    await stubWebSpeech(page);
    await page.goto('?lang=en&nogist');
    await page.waitForFunction(() => typeof gpsSpeak === 'function');
    const n = await page.evaluate(async () => {
      window.voiceAlerts = false;
      gpsSpeak('Top.');
      await window.__gpsSpeakChain;
      return window.__webSpoken.length;
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

// The web fallback is a testing aid only (see the comment above gpsSpeak in gps.js):
// browsers suspend speechSynthesis when the tab is backgrounded, so it must never be
// relied on in flight. These tests exercise it in isolation from the native-plugin tests
// above.
// window.speechSynthesis is a getter-only accessor in real Chromium (no setter), so a
// plain `window.speechSynthesis = ...` silently no-ops and the real engine stays in
// place -- Object.defineProperty is required to actually replace it with the stub.
function stubWebSpeech(page) {
  return page.addInitScript(() => {
    window.__webSpoken = [];
    window.SpeechSynthesisUtterance = function (text) {
      this.text = text; this.lang = null; this.onend = null; this.onerror = null;
    };
    Object.defineProperty(window, 'speechSynthesis', {
      configurable: true,
      value: {
        speak: function (u) {
          window.__webSpoken.push(u);
          setTimeout(function () { if (u.onend) u.onend(); }, 0);
        },
      },
    });
  });
}

test.describe('web speech fallback', () => {
  test('speaks Hebrew with he-IL when the UI language is Hebrew', async ({ page }) => {
    await stubTts(page, { native: false });
    await stubWebSpeech(page);
    await page.goto('?lang=he&nogist');
    await page.waitForFunction(() => typeof gpsSpeak === 'function');
    const out = await page.evaluate(async () => {
      window.voiceAlerts = true;
      gpsSpeak('שלום');
      await window.__gpsSpeakChain;
      return window.__webSpoken.map(u => ({ text: u.text, lang: u.lang }));
    });
    expect(out).toEqual([{ text: 'שלום', lang: 'he-IL' }]);
  });

  test('does nothing when speechSynthesis is unavailable', async ({ page }) => {
    await stubTts(page, { native: false });
    // Actually remove both globals (headless Chromium ships a real speechSynthesis) so
    // this exercises the guard-for-absence branch, not the real engine.
    await page.addInitScript(() => {
      delete window.speechSynthesis;
      delete window.SpeechSynthesisUtterance;
    });
    await page.goto('?lang=en&nogist');
    await page.waitForFunction(() => typeof gpsSpeak === 'function');
    const out = await page.evaluate(async () => {
      window.voiceAlerts = true;
      let threw = false;
      try { gpsSpeak('Top.'); } catch (e) { threw = true; }
      await window.__gpsSpeakChain;
      return { threw, hasSS: 'speechSynthesis' in window };
    });
    expect(out.threw).toBe(false);
    expect(out.hasSS).toBe(false);
  });

  test('resolves the speak chain even when the utterance errors instead of ending', async ({ page }) => {
    await stubTts(page, { native: false });
    await page.addInitScript(() => {
      window.__webSpoken = [];
      window.SpeechSynthesisUtterance = function (text) {
        this.text = text; this.lang = null; this.onend = null; this.onerror = null;
      };
      Object.defineProperty(window, 'speechSynthesis', {
        configurable: true,
        value: {
          speak: function (u) {
            window.__webSpoken.push(u);
            // Simulates an engine failure: onend never fires, only onerror.
            setTimeout(function () { if (u.onerror) u.onerror(new Error('synth failed')); }, 0);
          },
        },
      });
    });
    await page.goto('?lang=en&nogist');
    await page.waitForFunction(() => typeof gpsSpeak === 'function');
    const out = await page.evaluate(async () => {
      window.voiceAlerts = true;
      gpsSpeak('first');
      gpsSpeak('second');
      // The chain must not hang forever waiting on the failed utterance's onend.
      await window.__gpsSpeakChain;
      return window.__webSpoken.map(u => u.text);
    });
    expect(out).toEqual(['first', 'second']);
  });

  test('the native plugin takes precedence over the web fallback when both exist', async ({ page }) => {
    await stubTts(page, { native: true });
    await stubWebSpeech(page);
    await page.goto('?lang=en&nogist');
    await page.waitForFunction(() => typeof gpsSpeak === 'function');
    const out = await page.evaluate(async () => {
      window.voiceAlerts = true;
      gpsSpeak('Top.');
      await window.__gpsSpeakChain;
      return { native: window.__spoken.length, web: window.__webSpoken.length };
    });
    expect(out.native).toBe(1);
    expect(out.web).toBe(0);
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
    expect(out[0]).toMatch(/Fly heading (zero|one|two|three|four|five|six|seven|eight|nine)/);
    expect(out[0]).not.toContain('°');
  });
});

// AMENDMENT: the toggle row is always visible, on the website too -- browser speech is a
// testing aid (see the web-speech-fallback describe above), not something hidden away.
test.describe('the voice-alerts toggle', () => {
  test('is visible on the website and defaults to off', async ({ page }) => {
    await page.goto('?lang=en&nogist');
    await page.waitForFunction(() => !!document.getElementById('voice-alerts-cb'));
    const out = await page.evaluate(() => {
      const cb = document.getElementById('voice-alerts-cb');
      const row = cb.closest('label');
      return { checked: cb.checked, on: window.voiceAlerts === true,
               rowShown: getComputedStyle(row).display !== 'none' };
    });
    expect(out.checked).toBe(false);
    expect(out.on).toBe(false);
    expect(out.rowShown).toBe(true);   // visible on the website too -- it's a testing aid, not a dead switch
  });

  test('toggling it persists', async ({ page }) => {
    await stubTts(page);
    await page.goto('?lang=en&nogist');
    await page.waitForFunction(() => !!document.getElementById('voice-alerts-cb'));
    await page.evaluate(() => { document.getElementById('voice-alerts-cb').click(); });
    const after = await page.evaluate(() => ({
      on: window.voiceAlerts, stored: localStorage.getItem('navaid.voiceAlerts'),
    }));
    expect(after.on).toBe(true);
    expect(after.stored).toBe('1');
  });

  // The row was in defaultVisibilityMap but its tune key was never registered, so tune()
  // returned 0 and the gist could only ever push the toggle off.
  test('the gist can turn it on for a pilot who never chose', async ({ page }) => {
    await stubTts(page);
    await page.goto('?lang=en&nogist');
    await page.waitForFunction(() => typeof tune === 'function' &&
      !!document.getElementById('voice-alerts-cb'));
    expect(await page.evaluate(() => tune('defaultVoiceAlerts'))).toBe(false);
    const on = await page.evaluate(() => {
      setTune('defaultVoiceAlerts', true);
      NavAid.applyDefaultVisibility();
      return { checked: document.getElementById('voice-alerts-cb').checked,
               flag: window.voiceAlerts === true,
               // Still gist-controlled next load: nothing was written as a user choice.
               stored: localStorage.getItem('navaid.voiceAlerts') };
    });
    expect(on).toEqual({ checked: true, flag: true, stored: null });
  });

  test('a stored preference is restored on load', async ({ page }) => {
    await stubTts(page);
    await page.addInitScript(() => localStorage.setItem('navaid.voiceAlerts', '1'));
    await page.goto('?lang=en&nogist');
    await page.waitForFunction(() => !!document.getElementById('voice-alerts-cb'));
    const out = await page.evaluate(() => ({
      on: window.voiceAlerts, checked: document.getElementById('voice-alerts-cb').checked,
    }));
    expect(out.on).toBe(true);
    expect(out.checked).toBe(true);
  });
});

// A waypoint that changes frequency is exactly where the pilot is about to make a call, so
// TOP carries it -- hearing it saves looking down at the one moment the eyes are outside.
test.describe('TOP reads out the comm change', () => {
  test('speaks the station and frequency, digit by digit', async ({ page }) => {
    await stubTts(page);
    await page.goto('?lang=en&nogist');
    await page.waitForFunction(() => typeof gpsCheckLegAlerts === 'function');
    const spoken = await page.evaluate(async () => {
      window.voiceAlerts = true;
      state.waypoints = [{ lat: 32.0, lng: 34.0, name: 'ALPHA' },
                         { lat: 32.008, lng: 34.0, name: 'BRAVO' }];
      syncLegs();
      // The route's own note is the source of truth -- it is what is drawn on the map.
      state.notes = [{ lat: 32.008, lng: 34.0, cc: 'BRAVO',
                       freqName: 'PLUTO_EAST', freq: '118.4' }];
      gpsAlertLegIndex = 0;
      window._gpsAlertConfirmed = true;
      gpsOwn = { lat: 32.008, lng: 34.0, t: Date.now() };
      gpsLastAlt = null;
      gpsCheckLegAlerts();
      await window.__gpsSpeakChain;
      return window.__spoken.map(s => s.text);
    });
    const top = spoken.find(t => /^Top\./.test(t));
    expect(top).toBeTruthy();
    expect(top).toContain('PLUTO EAST');            // underscores never spoken
    expect(top).toContain('one one eight decimal four');
    expect(top).not.toContain('118.4');             // never read as a bare number
  });

  test('a waypoint with no comm change still just says Top', async ({ page }) => {
    await stubTts(page);
    await page.goto('?lang=en&nogist');
    await page.waitForFunction(() => typeof gpsCheckLegAlerts === 'function');
    const spoken = await page.evaluate(async () => {
      window.voiceAlerts = true;
      state.waypoints = [{ lat: 32.0, lng: 34.0, name: 'ALPHA' },
                         { lat: 32.008, lng: 34.0, name: 'BRAVO' }];
      syncLegs();
      state.notes = [];
      gpsAlertLegIndex = 0;
      window._gpsAlertConfirmed = true;
      gpsOwn = { lat: 32.008, lng: 34.0, t: Date.now() };
      gpsLastAlt = null;
      gpsCheckLegAlerts();
      await window.__gpsSpeakChain;
      return window.__spoken.map(s => s.text);
    });
    expect(spoken).toContain('Top.');
  });

  test('speaks the Hebrew form when the UI is Hebrew', async ({ page }) => {
    await stubTts(page, { languages: ['en-US', 'he-IL'] });
    await page.goto('?lang=he&nogist');
    await page.waitForFunction(() => typeof gpsCheckLegAlerts === 'function');
    const spoken = await page.evaluate(async () => {
      window.voiceAlerts = true;
      state.waypoints = [{ lat: 32.0, lng: 34.0, name: 'ALPHA' },
                         { lat: 32.008, lng: 34.0, name: 'BRAVO' }];
      syncLegs();
      state.notes = [{ lat: 32.008, lng: 34.0, cc: 'BRAVO',
                       freqName: 'PLUTO_EAST', freq: '118.4' }];
      gpsAlertLegIndex = 0;
      window._gpsAlertConfirmed = true;
      gpsOwn = { lat: 32.008, lng: 34.0, t: Date.now() };
      gpsLastAlt = null;
      gpsCheckLegAlerts();
      await window.__gpsSpeakChain;
      return window.__spoken.map(s => s.text);
    });
    const top = spoken.find(t => /טופ/.test(t));
    expect(top).toBeTruthy();
    expect(top).toContain('נקודה');     // the decimal, spoken
    expect(top).not.toContain('118.4');
  });
});
