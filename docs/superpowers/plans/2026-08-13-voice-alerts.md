# Spoken In-Flight Alerts (APK) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Speak the four existing in-flight alerts (leg approach, TOP, altitude off plan, off-course) aloud in the NavAid Android APK, so a pilot hears them instead of having to look at a phone or watch.

**Architecture:** The four alerts already funnel through one function, `gpsSendWatchAlert(title, body)` in `docs/app/gps.js`. That function gains an optional third argument, `speech`. When it is present, the app is running natively, and the pilot has switched voice alerts on, the text is spoken through a native TTS plugin. Everything else — the permission gate, the mobile-device gate, the per-leg one-shot latches — already lives above or inside that funnel and keeps working untouched.

**Tech Stack:** Vanilla JS (no build step for `docs/`), Capacitor 8.4.0, `@capacitor-community/text-to-speech@8.0.2`, Playwright for tests.

## Global Constraints

- Plugin version: `@capacitor-community/text-to-speech@8.0.2` (peer `@capacitor/core >=8.0.0`; repo is on 8.4.0). Added to `mobile/package.json`, NOT the repo-root `package.json`.
- `docs/` has no build step. Plain ES5-compatible browser JS, same style as the surrounding code (`var`/`function` in `gps.js`, `const`/arrow in `ui.js`).
- Every new user-visible string MUST exist in BOTH `docs/app/core.js` (English defaults) and `docs/i18n/he/strings.js` (Hebrew). `tests/string-parity.spec.js` fails otherwise.
- Voice is APK-only: gated on `Capacitor.isNativePlatform()`. Nothing speaks on the website.
- The voice setting defaults to **off** and its UI row is **hidden entirely** when not running natively.
- Speech is best-effort: any TTS failure is caught and ignored. It must never prevent or delay the notification, which is sent first.
- Spoken text is a SEPARATE string set from the notification body. Never speak the notification body.
- Spoken numbers: headings digit-by-digit ("zero zero four"), times rounded to whole minutes, no `°`/`—`/`h:mm:ss` symbols.
- Branch off `origin/dev`. Never commit to `dev` or `main` directly.

---

### Task 1: Spoken string set (EN + HE)

Adds the spoken phrasings and the toggle label. No behaviour yet — this task exists on its own because the parity test is the gate, and later tasks depend on these exact key names.

**Files:**
- Modify: `docs/app/core.js` (English defaults, beside the existing `watchAlert*` keys around line 1671-1705)
- Modify: `docs/i18n/he/strings.js` (Hebrew, beside the existing `watchAlert*` keys around line 1002-1022)
- Test: `tests/string-parity.spec.js` (extend the existing key list)

**Interfaces:**
- Consumes: nothing.
- Produces: on the global `S` object —
  - `S.speakAlertLeg(wp: string, alt: number|null, hdgDigits: string|null, mins: number|null) => string`
  - `S.speakAlertTop() => string`
  - `S.speakAlertAlt(actual: number, planned: number) => string`
  - `S.speakAlertDrift(driftOut: number, driftIn: number, wp: string) => string`
  - `S.speakAlertDriftDirect(correction: number, wp: string) => string`
  - `S.tbVoiceAlerts: string`, `S.tbVoiceAlertsTitle: string` (checkbox label + tooltip)
  - `hdgDigits` is ALREADY digit-separated by the caller (Task 4), e.g. `"zero zero four"` / `"אפס אפס ארבע"`. These functions do not convert numbers to words.

- [ ] **Step 0: Create the branch**

```bash
cd /home/marco/NavigationApp
git fetch origin dev
git checkout -b feat/voice-alerts origin/dev
```

- [ ] **Step 1: Write the failing test**

In `tests/string-parity.spec.js`, extend the existing key list in the second test:

```javascript
    for (const k of ['sliderReset', 'exportShowCumTime',
      'speakAlertLeg', 'speakAlertTop', 'speakAlertAlt',
      'speakAlertDrift', 'speakAlertDriftDirect',
      'tbVoiceAlerts', 'tbVoiceAlertsTitle']) {
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx playwright test tests/string-parity.spec.js --reporter=list`
Expected: FAIL — `expect(enKeys).toContain('speakAlertLeg')`.

- [ ] **Step 3: Add the English strings**

In `docs/app/core.js`, immediately AFTER the `watchAlertDriftDirectBody` function (~line 1703):

```javascript
  // Spoken forms of the alerts above. Deliberately NOT the notification bodies: those are
  // written for a watch face -- dense, and full of symbols (-, °, 0:12:30) whose spoken
  // rendering is entirely up to the device's TTS engine. These spell the units out, take
  // the heading already split into digits (see gpsSpokenDigits), and give a time in whole
  // minutes. A missing field is left out here exactly as it is left out of the
  // notification: never guessed.
  speakAlertLeg: function(wp, alt, hdgDigits, mins) {
    let s = 'Approaching ' + wp + '.';
    const parts = [];
    if (alt != null) parts.push(alt + ' feet');
    if (hdgDigits != null) parts.push('heading ' + hdgDigits);
    if (mins != null) parts.push(mins < 1 ? 'less than a minute' : (mins + ' minutes'));
    if (parts.length) s += ' Next leg ' + parts.join(', ') + '.';
    return s;
  },
  speakAlertTop: function() { return 'Top.'; },
  speakAlertAlt: function(actual, planned) {
    return 'Altitude ' + actual + ' feet, planned ' + planned + '.';
  },
  speakAlertDrift: function(driftOut, driftIn, wp) {
    return driftOut + ' degrees off course. ' + driftIn + ' to intercept toward ' + wp + '.';
  },
  speakAlertDriftDirect: function(correction, wp) {
    return correction + ' degrees to ' + wp + '.';
  },
  tbVoiceAlerts: '🔊 Speak alerts',
  tbVoiceAlertsTitle: 'Say the in-flight alerts out loud (leg, TOP, altitude, off course). App only — needs a voice installed for your language.',
```

- [ ] **Step 4: Add the Hebrew strings**

In `docs/i18n/he/strings.js`, immediately AFTER the `watchAlertDriftDirectBody` function (~line 1021):

```javascript
  // ראו את ההערה בגרסה האנגלית: אלה הניסוחים המדוברים, ולא גוף ההתראה.
  speakAlertLeg: function(wp, alt, hdgDigits, mins) {
    let s = 'מתקרב אל ' + wp + '.';
    const parts = [];
    if (alt != null) parts.push(alt + ' רגל');
    if (hdgDigits != null) parts.push('כיוון ' + hdgDigits);
    if (mins != null) parts.push(mins < 1 ? 'פחות מדקה' : (mins + ' דקות'));
    if (parts.length) s += ' הקטע הבא ' + parts.join(', ') + '.';
    return s;
  },
  speakAlertTop: function() { return 'טופ.'; },
  speakAlertAlt: function(actual, planned) {
    return 'גובה ' + actual + ' רגל, מתוכנן ' + planned + '.';
  },
  speakAlertDrift: function(driftOut, driftIn, wp) {
    return driftOut + ' מעלות סטייה. ' + driftIn + ' לתיקון לכיוון ' + wp + '.';
  },
  speakAlertDriftDirect: function(correction, wp) {
    return correction + ' מעלות אל ' + wp + '.';
  },
  tbVoiceAlerts: '🔊 הקראת התראות',
  tbVoiceAlertsTitle: 'הקראה קולית של התראות הטיסה (קטע, טופ, גובה, סטייה). באפליקציה בלבד — נדרש קול מותקן בשפה שלך.',
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx playwright test tests/string-parity.spec.js --reporter=list`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add docs/app/core.js docs/i18n/he/strings.js tests/string-parity.spec.js
git commit -m "feat: spoken phrasings for the in-flight alerts, EN and HE"
```

---

### Task 2: Digit-by-digit heading helper

A heading spoken as "four" instead of "zero zero four" is a readback error waiting to happen, and every aviation heading in this app is already displayed three-digit padded. This is pure and testable on its own.

**Files:**
- Modify: `docs/app/gps.js` (add near the other `_gps*` helpers, just above `_nativeNotify` at ~line 1015)
- Test: `tests/gps-voice-alerts.spec.js` (new file)

**Interfaces:**
- Consumes: nothing.
- Produces: `gpsSpokenDigits(value: string|number, lang: 'en'|'he') => string` on `window`. Splits a heading into spoken digit words. `gpsSpokenDigits('004', 'en')` → `'zero zero four'`. Non-digit characters are dropped. Empty/nullish input returns `''`.

- [ ] **Step 1: Write the failing test**

Create `tests/gps-voice-alerts.spec.js`:

```javascript
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx playwright test tests/gps-voice-alerts.spec.js --reporter=list`
Expected: FAIL — timeout waiting for `gpsSpokenDigits` to be a function.

- [ ] **Step 3: Write the implementation**

In `docs/app/gps.js`, immediately BEFORE the `// Native (APK) local-notifications plugin` comment (~line 1015):

```javascript
// --- spoken alerts (APK) -------------------------------------------------
// A heading is read digit by digit -- "zero zero four", never "four". Every heading this
// app displays is already three-digit padded (pad3), and a TTS engine handed "004" says
// "four", which is a different heading to anyone listening.
var _GPS_DIGIT_WORDS = {
  en: ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'],
  he: ['אפס', 'אחת', 'שתיים', 'שלוש', 'ארבע', 'חמש', 'שש', 'שבע', 'שמונה', 'תשע'],
};
function gpsSpokenDigits(value, lang) {
  if (value == null) return '';
  const words = _GPS_DIGIT_WORDS[lang] || _GPS_DIGIT_WORDS.en;
  const out = [];
  const s = String(value);
  for (let i = 0; i < s.length; i++) {
    const d = s.charCodeAt(i) - 48;
    if (d >= 0 && d <= 9) out.push(words[d]);
  }
  return out.join(' ');
}
window.gpsSpokenDigits = gpsSpokenDigits;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx playwright test tests/gps-voice-alerts.spec.js --reporter=list`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add docs/app/gps.js tests/gps-voice-alerts.spec.js
git commit -m "feat: gpsSpokenDigits -- headings read digit by digit"
```

---

### Task 3: The speak path (plugin, language fallback, queue)

The whole speaking mechanism, with no call sites wired yet. Kept in one task because the plugin lookup, the setting gate, the language fallback and the queue are useless individually and are tested through one entry point.

**Files:**
- Modify: `docs/app/gps.js` (append after `gpsSpokenDigits` from Task 2)
- Modify: `mobile/package.json` (add the dependency)
- Test: `tests/gps-voice-alerts.spec.js` (extend)

**Interfaces:**
- Consumes: `gpsSpokenDigits` (Task 2) — not called here, but lives in the same block.
- Produces:
  - `_nativeTts() => object|null` — the plugin when `Capacitor.isNativePlatform()`, else `null`.
  - `gpsVoiceAlertsOn() => boolean` — reads `window.voiceAlerts` (set by Task 5).
  - `gpsSpeak(text: string) => void` — best-effort; no-ops when not native, when the setting is off, or when `text` is falsy. Serialises overlapping calls.
  - `window.__gpsSpeakChain` — internal promise chain; tests await it to know speech settled.

- [ ] **Step 1: Write the failing test**

Append to `tests/gps-voice-alerts.spec.js`:

```javascript
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx playwright test tests/gps-voice-alerts.spec.js --reporter=list`
Expected: FAIL — timeout waiting for `gpsSpeak` to be a function.

- [ ] **Step 3: Add the dependency**

In `mobile/package.json`, add to `dependencies`, keeping alphabetical order (after `@capacitor-community/background-geolocation`):

```json
    "@capacitor-community/text-to-speech": "^8.0.2",
```

- [ ] **Step 4: Write the implementation**

In `docs/app/gps.js`, immediately AFTER `window.gpsSpokenDigits = gpsSpokenDigits;` from Task 2:

```javascript
// Native TTS, same access pattern as _nativeNotify()/_bgGeo(): the injected Capacitor
// bridge exposes any synced plugin at window.Capacitor.Plugins.*. Web speechSynthesis is
// deliberately NOT a fallback -- browsers suspend it when the page is backgrounded, which
// is exactly the cockpit case (phone locked, background geolocation still feeding fixes).
// A voice that goes quiet precisely when it is needed is worse than none, because it is
// trusted.
function _nativeTts() {
  const C = typeof window !== 'undefined' && window.Capacitor;
  return (C && typeof C.isNativePlatform === 'function' && C.isNativePlatform() &&
          C.Plugins && C.Plugins.TextToSpeech) || null;
}
function gpsVoiceAlertsOn() {
  return typeof window !== 'undefined' && window.voiceAlerts === true;
}
// Resolved once per session: asking the engine on every alert would put a round trip in
// front of speech that is already late by the time it matters.
var _gpsVoiceLang = null;
function _gpsResolveVoiceLang(tts) {
  if (_gpsVoiceLang) return Promise.resolve(_gpsVoiceLang);
  const want = (typeof lang !== 'undefined' && lang === 'he') ? 'he-IL' : 'en-US';
  if (want === 'en-US') { _gpsVoiceLang = want; return Promise.resolve(want); }
  if (typeof tts.getSupportedLanguages !== 'function') {
    _gpsVoiceLang = want;
    return Promise.resolve(want);
  }
  return tts.getSupportedLanguages().then(function (res) {
    const list = (res && res.languages) || [];
    // A device with no Hebrew voice speaks the English phrasing rather than nothing: a
    // missing voice must never mean a missed alert.
    _gpsVoiceLang = list.some(function (l) { return String(l).toLowerCase().indexOf('he') === 0; })
      ? want : 'en-US';
    return _gpsVoiceLang;
  }).catch(function () { _gpsVoiceLang = 'en-US'; return _gpsVoiceLang; });
}
// Chained, never interrupted: a TOP firing seconds after a leg-approach alert waits its
// turn rather than cutting it off mid-word.
window.__gpsSpeakChain = Promise.resolve();
function gpsSpeak(text) {
  if (!text || !gpsVoiceAlertsOn()) return;
  const tts = _nativeTts();
  if (!tts || typeof tts.speak !== 'function') return;
  window.__gpsSpeakChain = window.__gpsSpeakChain.then(function () {
    return _gpsResolveVoiceLang(tts).then(function (voiceLang) {
      return tts.speak({
        text: text,
        lang: voiceLang,
        // Duck other audio (music, intercom) rather than being talked over or blocking it.
        category: 'ambient',
      });
    });
  }).catch(function () { /* best-effort: never let a TTS failure break the chain */ });
}
window.gpsSpeak = gpsSpeak;
window.gpsVoiceAlertsOn = gpsVoiceAlertsOn;
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx playwright test tests/gps-voice-alerts.spec.js --reporter=list`
Expected: PASS (8 tests total, including Task 2's).

- [ ] **Step 6: Commit**

```bash
git add docs/app/gps.js mobile/package.json tests/gps-voice-alerts.spec.js
git commit -m "feat: native TTS speak path with language fallback and queueing"
```

---

### Task 4: Wire speech into the alert funnel and the four call sites

**Files:**
- Modify: `docs/app/gps.js` — `gpsSendWatchAlert` (~line 1061), leg alert (~line 960), altitude alert (~line 975), TOP alert (~line 1005), drift alerts (~line 1171 and ~1179)
- Test: `tests/gps-voice-alerts.spec.js` (extend)

**Interfaces:**
- Consumes: `gpsSpeak` (Task 3), `gpsSpokenDigits` (Task 2), `S.speakAlert*` (Task 1).
- Produces: `gpsSendWatchAlert(title: string, body: string, speech?: string)` — a third optional argument. Absent or empty = notification only, exactly as today.

- [ ] **Step 1: Write the failing test**

Append to `tests/gps-voice-alerts.spec.js`:

```javascript
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx playwright test tests/gps-voice-alerts.spec.js --reporter=list -g "alerts speak"`
Expected: FAIL — `__spoken` is empty (the third argument is ignored today).

- [ ] **Step 3: Teach the funnel to speak**

In `docs/app/gps.js`, replace the `gpsSendWatchAlert` signature line and add ONE line at the top of its body (~line 1061):

```javascript
function gpsSendWatchAlert(title, body, speech) {
  // Speech first, and independent: it is fire-and-forget, and the notification below has
  // its own return paths (native plugin, service worker, plain constructor) that must not
  // decide whether the pilot hears the alert.
  gpsSpeak(speech);
  const nn = _nativeNotify();
```

The rest of the function is unchanged.

- [ ] **Step 4: Pass spoken text at the leg-approach call site**

In `docs/app/gps.js` (~line 955), the block that computes `nextLegTime` currently ends with the `toHMS` assignment. Add a minutes value beside it. Find:

```javascript
        if (nextLegGeo && Number.isFinite(nextLegGeo.dist) && nextLeg && nextLeg.flightSpeed > 0 &&
            typeof toHMS === 'function') {
          nextLegTime = toHMS(nextLegGeo.dist / nextLeg.flightSpeed);
        }
```

Replace with:

```javascript
        if (nextLegGeo && Number.isFinite(nextLegGeo.dist) && nextLeg && nextLeg.flightSpeed > 0 &&
            typeof toHMS === 'function') {
          nextLegTime = toHMS(nextLegGeo.dist / nextLeg.flightSpeed);
          // Whole minutes for the SPOKEN form -- seconds are false precision on a planned
          // time, and they lengthen the phrase at the moment the pilot is busiest.
          nextLegMin = Math.round((nextLegGeo.dist / nextLeg.flightSpeed) * 60);
        }
```

Then declare it beside the existing declarations at `docs/app/gps.js:928-930`. Find:

```javascript
      let nextLegAlt = null;
      let nextLegHdg = null;
      let nextLegTime = null;
```

Replace with:

```javascript
      let nextLegAlt = null;
      let nextLegHdg = null;
      let nextLegTime = null;
      let nextLegMin = null;    // whole minutes, for the spoken form
```

Now replace the `gpsSendWatchAlert` call at ~line 960:

```javascript
      gpsSendWatchAlert((S && S.watchAlertLegTitle) || 'Next leg',
        (S && S.watchAlertLegBody) ? S.watchAlertLegBody(label, nextLegAlt, nextLegHdg, nextLegTime)
          : ('Approaching ' + label),
        (S && S.speakAlertLeg)
          ? S.speakAlertLeg(label, nextLegAlt,
              nextLegHdg == null ? null : gpsSpokenDigits(nextLegHdg, (typeof lang !== 'undefined' ? lang : 'en')),
              nextLegMin)
          : null);
```

- [ ] **Step 5: Pass spoken text at the altitude call site**

In `docs/app/gps.js` (~line 975), replace:

```javascript
        gpsSendWatchAlert((S && S.watchAlertAltTitle) || 'Altitude',
          (S && S.watchAlertAltBody)
            ? S.watchAlertAltBody(Math.round(gpsLastAlt), Math.round(planned))
            : (Math.round(gpsLastAlt) + ' ft, planned ' + Math.round(planned) + ' ft'),
          (S && S.speakAlertAlt)
            ? S.speakAlertAlt(Math.round(gpsLastAlt), Math.round(planned)) : null);
```

- [ ] **Step 6: Pass spoken text at the TOP call site**

In `docs/app/gps.js` (~line 1005), replace:

```javascript
      gpsSendWatchAlert((S && S.watchAlertTopTitle) || 'TOP',
        (S && S.watchAlertTopBody) || 'TOP',
        (S && S.speakAlertTop) ? S.speakAlertTop() : null);
```

- [ ] **Step 7: Pass spoken text at both drift call sites**

In `docs/app/gps.js` (~line 1171), replace:

```javascript
    gpsSendWatchAlert((S && S.watchAlertDriftTitle) || 'Off course',
      (S && S.watchAlertDriftBody) ? S.watchAlertDriftBody(driftOut, driftIn, label)
        : (driftOut + '° off course, ' + driftIn + '° to intercept toward ' + label),
      (S && S.speakAlertDrift) ? S.speakAlertDrift(driftOut, driftIn, label) : null);
```

And at ~line 1179:

```javascript
    gpsSendWatchAlert((S && S.watchAlertDriftTitle) || 'Off course',
      (S && S.watchAlertDriftDirectBody) ? S.watchAlertDriftDirectBody(correction, label)
        : (correction + '° to ' + label),
      (S && S.speakAlertDriftDirect) ? S.speakAlertDriftDirect(correction, label) : null);
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `npx playwright test tests/gps-voice-alerts.spec.js tests/gps-watch-alerts.spec.js --reporter=list`
Expected: PASS. `gps-watch-alerts.spec.js` must be unaffected — the notification behaviour is unchanged.

- [ ] **Step 9: Commit**

```bash
git add docs/app/gps.js tests/gps-voice-alerts.spec.js
git commit -m "feat: speak the four in-flight alerts through the existing funnel"
```

---

### Task 5: The View/Set toggle

**Files:**
- Modify: `docs/index.html` (a `.navtoggle` row in the View/Set section, beside the other overlay checkboxes ~line 239)
- Modify: `docs/app/ui.js` (load/persist near the other toggles ~line 2649-2680; register in `NavAid.defaultVisibilityMap` ~line 7540)
- Test: `tests/gps-voice-alerts.spec.js` (extend)

**Interfaces:**
- Consumes: `gpsVoiceAlertsOn()` (Task 3) reads `window.voiceAlerts`, which this task owns.
- Produces: `window.voiceAlerts: boolean` (default `false`), persisted at `navaid.voiceAlerts`, checkbox `#voice-alerts-cb`, row hidden when not native.

- [ ] **Step 1: Write the failing test**

Append to `tests/gps-voice-alerts.spec.js`:

```javascript
test.describe('the voice-alerts toggle', () => {
  test('is hidden on the website and defaults to off', async ({ page }) => {
    await page.goto('?lang=en&nogist');
    await page.waitForFunction(() => !!document.getElementById('voice-alerts-cb'));
    const out = await page.evaluate(() => {
      const cb = document.getElementById('voice-alerts-cb');
      const row = cb.closest('label');
      return { checked: cb.checked, on: window.voiceAlerts === true,
               rowHidden: getComputedStyle(row).display === 'none' };
    });
    expect(out.checked).toBe(false);
    expect(out.on).toBe(false);
    expect(out.rowHidden).toBe(true);   // no dead switch on the web
  });

  test('is shown in the APK, and toggling it persists', async ({ page }) => {
    await stubTts(page);
    await page.goto('?lang=en&nogist');
    await page.waitForFunction(() => !!document.getElementById('voice-alerts-cb'));
    const shown = await page.evaluate(() => {
      const row = document.getElementById('voice-alerts-cb').closest('label');
      return getComputedStyle(row).display !== 'none';
    });
    expect(shown).toBe(true);
    await page.evaluate(() => { document.getElementById('voice-alerts-cb').click(); });
    const after = await page.evaluate(() => ({
      on: window.voiceAlerts, stored: localStorage.getItem('navaid.voiceAlerts'),
    }));
    expect(after.on).toBe(true);
    expect(after.stored).toBe('1');
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx playwright test tests/gps-voice-alerts.spec.js --reporter=list -g "voice-alerts toggle"`
Expected: FAIL — timeout waiting for `#voice-alerts-cb`.

- [ ] **Step 3: Add the checkbox row**

In `docs/index.html`, immediately AFTER the `navwp-cb` label block (~line 241):

```html
        <!-- APK only: speaks the in-flight alerts. ui.js hides this row on the website,
             where there is no native TTS -- a switch that cannot do anything reads as
             broken rather than as unavailable. -->
        <label class="navtoggle" id="voice-alerts-row" data-i18n-title="tbVoiceAlertsTitle" hidden>
          <input type="checkbox" id="voice-alerts-cb"> <span data-i18n="tbVoiceAlerts"></span>
        </label>
```

- [ ] **Step 4: Load, persist and reveal**

In `docs/app/ui.js`, add the key beside the other toggle keys (~line 2649, after `const CUMTIME_KEY  = 'navaid.showCumTime';`):

```javascript
const VOICE_ALERTS_KEY = 'navaid.voiceAlerts';
```

Inside the existing `try { ... } catch (e) { /* storage unavailable */ }` block that reads the other keys (~line 2654), add:

```javascript
  const sva = lsGet(VOICE_ALERTS_KEY);
  if (sva !== null) window.voiceAlerts = sva === '1';
```

Then after `document.getElementById('limit-kites-cb').checked = limitLegKites;` (~line 2674), add:

```javascript
// Voice alerts: default off (it talks out loud in a cockpit -- opt in, never a surprise
// on first upgrade), and the whole row is revealed only in the APK, where a native TTS
// plugin actually exists.
if (typeof window.voiceAlerts !== 'boolean') window.voiceAlerts = false;
document.getElementById('voice-alerts-cb').checked = window.voiceAlerts === true;
(function () {
  const C = window.Capacitor;
  const native = !!(C && typeof C.isNativePlatform === 'function' && C.isNativePlatform());
  const row = document.getElementById('voice-alerts-row');
  if (row && native) row.removeAttribute('hidden');
})();
document.getElementById('voice-alerts-cb').onchange = e => {
  window.voiceAlerts = e.target.checked;
  try { localStorage.setItem(VOICE_ALERTS_KEY, window.voiceAlerts ? '1' : '0'); } catch (err) { /* */ }
};
```

Finally, register it in `NavAid.defaultVisibilityMap` (~line 7546), after the `['drift-cb', ...]` entry:

```javascript
  ['voice-alerts-cb', 'navaid.voiceAlerts', 'defaultVoiceAlerts'],
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx playwright test tests/gps-voice-alerts.spec.js --reporter=list`
Expected: PASS (all describes).

- [ ] **Step 6: Commit**

```bash
git add docs/index.html docs/app/ui.js tests/gps-voice-alerts.spec.js
git commit -m "feat: View/Set toggle for spoken alerts, APK-only and off by default"
```

---

### Task 6: Full suite, sync the native project, open the PR

**Files:**
- Modify: none (verification and release only)

**Interfaces:**
- Consumes: everything above.
- Produces: a pushed branch and an open PR against `dev`.

- [ ] **Step 1: Run the touched suites**

Run:

```bash
npx playwright test tests/gps-voice-alerts.spec.js tests/gps-watch-alerts.spec.js \
  tests/gps-track-recorder.spec.js tests/string-parity.spec.js \
  tests/toolbar-mobile-size-selects.spec.js --reporter=list
```

Expected: all PASS.

- [ ] **Step 2: Run the whole suite**

Run: `npx playwright test tests/ --reporter=list 2>&1 | tail -40`

Expected: PASS except these four KNOWN pre-existing failures, which are unrelated to this work and fail identically on a clean `dev`:
- `tests/mobile-menu-affordance.spec.js:100`
- `tests/plan-card-export.spec.js:138`
- `tests/toolbar-narrow-desktop.spec.js:53`
- `tests/ui-audit-round2.spec.js:213`

If ANY other test fails, stop and fix it before continuing. If one of the four above is suspected to be newly broken, confirm with `git stash`, re-run that one file, `git stash pop`.

- [ ] **Step 3: Install and sync the native project**

Run:

```bash
cd mobile && npm install && npx cap sync android
```

Expected: `@capacitor-community/text-to-speech` appears in the synced plugin list.

- [ ] **Step 4: Commit the lockfile and native sync output**

```bash
git add mobile/package-lock.json mobile/android
git commit -m "chore: sync the TTS plugin into the Android project"
```

- [ ] **Step 5: Push and open the PR**

```bash
git push -u origin feat/voice-alerts
gh pr create --base dev --head feat/voice-alerts \
  --title "feat: speak the in-flight alerts in the APK" \
  --body "Implements docs/superpowers/specs/2026-08-13-voice-alerts-design.md.

The four alerts (leg approach, TOP, altitude, off course) are spoken aloud through a native TTS plugin, so a pilot hears them instead of looking at a phone or watch.

- Hooks into the existing \`gpsSendWatchAlert\` funnel as an optional third argument, so every gate that already decides an alert is legitimate applies to speech too.
- Separate spoken phrasing from the notification body: the notification is written for a watch face, and its symbols read badly aloud. Headings are spoken digit by digit; times in whole minutes.
- Native only. Web \`speechSynthesis\` is suspended when the page is backgrounded — exactly the cockpit case — so it is not used as a fallback.
- Speaks the UI language, falling back to English phrasing when the device has no Hebrew voice: a missing voice must never mean a missed alert.
- Setting is off by default and its row is hidden entirely on the website.
- Speech is fire-and-forget and chained; a TTS failure can never delay or suppress the notification.

Needs an APK rebuild (native plugin). Real device audio — voice quality, ducking against a headset, behaviour with the phone locked — has to be verified on the APK."
```

- [ ] **Step 6: Mark the PR ready**

The repo opens every PR as a draft (`.github/workflows/draft-auto-merge.yml`); marking it
ready is what arms auto-merge. Read the number back rather than typing it:

```bash
PR=$(gh pr view --json number --jq '.number')
gh pr ready "$PR"
gh pr checks "$PR"
```

---

## Notes for the implementer

- **Do not approve `action_required` workflow runs on the dev→main promotion PR.** They trigger a rebase check that fails by design in this repo (main's promo merge commits never return to dev). Left alone, the promo merges on the push-triggered checks.
- `gpsSpeak` is deliberately fire-and-forget and returns nothing. Do not make callers await it — an alert must not wait on the audio device.
- The `category: 'ambient'` option in `tts.speak` is an iOS audio-session hint and is ignored on Android. It is set now so iOS behaves when that build happens; it is not load-bearing for this plan.
