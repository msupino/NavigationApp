// @ts-check
// Asked: "in alerts, 2 minutes before the next TOP, notify, also voice, for the pilot to find the
// next waypoint" -- the clock-to-map-to-ground technique (Hebrew ש.מ.ש, שעון-מפה-שטח). The
// two-minute next-leg call carries it: the notification is titled with it and the spoken call
// opens with it. One call, not a second alert about the same point. The gist can withdraw it.
const { test, expect } = require('./_setup');

async function boot(page, lang, gist) {
  await page.addInitScript(() => {
    window.__spoken = [];
    window.__notes = [];
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
  if (gist === false) await page.evaluate(() => { NavAid.tuning.legClockMapGround = false; });
}

// ALPHA -> BRAVO -> CHARLIE, 6 NM legs at the default 90 kt; ~2 NM to run to BRAVO is inside
// the two-minute lead.
const approachBravo = (page) => page.evaluate(async () => {
  window.voiceAlerts = true;
  state.waypoints = [{ lat: 32.0, lng: 34.0, name: 'ALPHA' }, { lat: 32.10, lng: 34.0, name: 'BRAVO' },
    { lat: 32.20, lng: 34.0, name: 'CHARLIE' }];
  state.notes = [];
  syncLegs();
  gpsAlertLegIndex = 0;
  window._gpsAlertConfirmed = true;
  gpsOwn = { lat: 32.07, lng: 34.0, t: Date.now() };
  gpsLastAlt = null;
  gpsCheckLegAlerts();
  await window.__gpsSpeakChain;
  await new Promise(r => setTimeout(r, 50));
  return { spoken: window.__spoken.slice(), notes: window.__notes.slice() };
});

test('two minutes out, the next-leg call is the clock-to-map-to-ground cue (English)', async ({ page }) => {
  await boot(page, 'en');
  const out = await approachBravo(page);
  const note = out.notes.find(n => /BRAVO/.test(n.body));
  expect(note.title).toBe('Clock to map to ground');
  expect(note.body).toMatch(/^Approaching BRAVO/);            // the body a watch shows is unchanged
  const call = out.spoken.find(t => /Approaching/.test(t));
  expect(call.startsWith('Clock to map to ground. Approaching')).toBe(true);
  expect(out.spoken.filter(t => /Approaching/.test(t))).toHaveLength(1);   // one call, not two
});

test('in Hebrew the title is ש.מ.ש and the words are spoken in full', async ({ page }) => {
  await boot(page, 'he');
  const out = await approachBravo(page);
  const note = out.notes.find(n => /BRAVO/.test(n.body));
  expect(note.title).toBe('ש.מ.ש');
  const call = out.spoken.find(t => /מתקרב אל/.test(t));
  expect(call.startsWith('שעון, מפה, שטח. מתקרב אל')).toBe(true);
  expect(call).not.toContain('ש.מ.ש');                       // never read out as letters
});

test('the gist can withdraw the cue: the call is the plain next-leg call again', async ({ page }) => {
  await boot(page, 'en', false);
  const out = await approachBravo(page);
  const note = out.notes.find(n => /BRAVO/.test(n.body));
  expect(note.title).toBe('Next leg');
  const call = out.spoken.find(t => /Approaching/.test(t));
  expect(call.startsWith('Approaching')).toBe(true);
});
