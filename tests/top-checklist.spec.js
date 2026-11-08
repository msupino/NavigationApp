// @ts-check
// Asked: after TOP, the leg-entry checks -- Hebrew בד"ח צא כיוון, כז״גמ״ד (כיוון, זמן, גובה, מנוע,
// דיווח); English FREDA (fuel, radio, engine, direction, altimeter) -- with the new leg's own
// figures: the heading, its planned time, its altitude, and the frequency when this waypoint
// changes it. Shown and spoken; at the last waypoint it stays a plain TOP; the gist can withdraw it.
const { test, expect } = require('./_setup');

async function boot(page, lang, gist) {
  await page.addInitScript(() => {
    window.__spoken = []; window.__notes = [];
    window.Capacitor = {
      isNativePlatform: () => true,
      Plugins: {
        TextToSpeech: {
          speak: (o) => { window.__spoken.push(o.text); return Promise.resolve(); },
          getSupportedLanguages: () => Promise.resolve({ languages: ['en-US', 'he-IL'] }),
        },
        LocalNotifications: {
          requestPermissions: () => Promise.resolve({ display: 'granted' }),
          schedule: (o) => { (o.notifications || []).forEach(n => window.__notes.push({ title: n.title, body: n.body })); return Promise.resolve(); },
        },
      },
    };
  });
  await page.goto('?lang=' + lang + '&nogist');
  await page.waitForFunction(() => typeof gpsCheckLegAlerts === 'function');
  if (gist === false) await page.evaluate(() => { NavAid.tuning.topChecklist = false; });
}

// Overhead BRAVO (ALPHA -> BRAVO -> CHARLIE, 6 NM legs, the second at 2500 ft), with a
// frequency change at BRAVO when `cc`.
const overBravo = (page, cc, last) => page.evaluate(async ([cc, last]) => {
  window.voiceAlerts = true;
  state.waypoints = [{ lat: 32.0, lng: 34.0, name: 'ALPHA' }, { lat: 32.10, lng: 34.0, name: 'BRAVO' }]
    .concat(last ? [] : [{ lat: 32.20, lng: 34.0, name: 'CHARLIE' }]);
  syncLegs();
  if (state.legs[1]) state.legs[1].inboundAltitude = 2500;
  state.notes = cc ? [{ lat: 32.10, lng: 34.0, cc: 'BRAVO', freqName: 'PLUTO_EAST', freq: '118.4' }] : [];
  gpsAlertLegIndex = 0;
  window._gpsAlertConfirmed = true;
  _gpsAlertLegFired = true;                  // the two-minute call has been made
  gpsOwn = { lat: 32.10, lng: 34.0, t: Date.now() };
  gpsLastAlt = null;
  gpsCheckLegAlerts();
  await window.__gpsSpeakChain;
  await new Promise(r => setTimeout(r, 50));
  return { spoken: window.__spoken.slice(), notes: window.__notes.slice() };
}, [cc, last]);

test('English: FREDA with the new leg\'s heading and altitude, and the frequency', async ({ page }) => {
  await boot(page, 'en');
  const out = await overBravo(page, true);
  const top = out.notes.find(n => n.title === 'TOP');
  expect(top.body).toMatch(/^Fuel · Radio 118\.4 · Engine · Direction \d{3} · Altimeter 2500 ft$/);
  const call = out.spoken.find(t => /^Top\./.test(t));
  expect(call).toMatch(/^Top\. Fuel\. Radio, one one eight decimal four\. Engine\. Direction \w+ \w+ \w+\. Altimeter 2500 feet\.$/);
});

test('Hebrew: כז״גמ״ד with the heading, the leg time and the altitude; מגמה when spoken', async ({ page }) => {
  await boot(page, 'he');
  const out = await overBravo(page, false);
  const top = out.notes.find(n => n.title === 'TOP');
  expect(top.body).toMatch(/^כיוון \d{3} · זמן \d+:\d{2} · גובה 2500 רגל · מנוע · דיווח$/);
  const call = out.spoken.find(t => /^טופ\./.test(t));
  expect(call.startsWith('טופ. מגמה ')).toBe(true);           // never the homograph כיוון aloud
  expect(call).toContain('. זמן ');
  expect(call).toContain('. גובה 2500 רגל. מנוע. דיווח.');
});

test('at the last waypoint it stays a plain TOP', async ({ page }) => {
  await boot(page, 'en');
  const out = await overBravo(page, false, true);
  expect(out.notes.find(n => n.title === 'TOP').body).toBe('TOP');
});

test('the gist can withdraw the checklist', async ({ page }) => {
  await boot(page, 'en', false);
  const out = await overBravo(page, false);
  expect(out.notes.find(n => n.title === 'TOP').body).toBe('TOP');
  expect(out.spoken.find(t => /^Top/.test(t))).toBe('Top.');
});
