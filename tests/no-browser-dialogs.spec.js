// @ts-check
// alert(), confirm() and prompt() are dialogs the page does not own: the APK's WebView never
// shows them -- confirm() answers "no", prompt() answers null, alert() says nothing -- so every
// question asked that way was silently refused there (Back could never close the app, Reset
// all marker positions did nothing, a saved route could not be renamed). The app asks in its
// own dialogs (askYesNo / appConfirm / askText / showCopyText) and says things in toasts.
//
// What remains is fallback only, for a build or boot moment where the app's own dialog is not
// there yet. This pins that list, so a new browser dialog cannot slip back in.
const { test, expect, answerAppDialogs } = require('./_setup');
const fs = require('fs');
const path = require('path');

const ALLOWED = {
  'assistant.js': 1,   // confirmAction: only when askYesNo is missing
  'core.js': 1,        // refuse(): only before the toast exists (a boot failure)
  'editor.js': 3,      // ask/askLine/say: only without ui.js
  'followme.js': 1,    // New link: only when askYesNo is missing
  'ui.js': 4,          // askFollowMeCode / askYesNo / askText / showCopyText: no modal factory
};

test('the app uses no browser dialog outside its documented fallbacks', () => {
  const dir = path.join(__dirname, '..', 'docs', 'app');
  const found = {};
  for (const f of fs.readdirSync(dir).filter(n => n.endsWith('.js'))) {
    const lines = fs.readFileSync(path.join(dir, f), 'utf8').split('\n');
    const n = lines.filter(l => !/^\s*\/\//.test(l) &&
      /(^|[^.\w])(window\.)?(alert|confirm|prompt)\(/.test(
        l.replace(/\/\/.*$/, '').replace(/'[^']*'/g, "''"))).length;
    if (n) found[f] = n;
  }
  expect(found).toEqual(ALLOWED);
});

test('a saved route is renamed in the app\'s own dialog', async ({ page }) => {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof routeLibrarySaveCurrent === 'function');
  const browserDialogs = [];
  page.on('dialog', d => { browserDialogs.push(d.message()); d.dismiss(); });
  await page.evaluate(() => {
    state.waypoints = [{ lat: 32.18, lng: 34.83, name: 'LLHZ' }, { lat: 32.8, lng: 35.04, name: 'LLHA' }];
    syncLegs();
    routeLibrarySaveCurrent('Coast hop');
  });
  await answerAppDialogs(page, 'North coast');
  await page.evaluate(() => document.getElementById('route-library').click());
  await page.locator('.route-library-modal').getByRole('button', { name: 'Rename' }).first().click();
  await expect.poll(() => page.evaluate(() =>
    JSON.parse(localStorage.getItem('navaid.routes')).map(r => r.name))).toContain('North coast');
  expect(browserDialogs).toEqual([]);
});

test('Reset all marker positions asks in the app and resets on OK', async ({ page }) => {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof syncLegs === 'function');
  const browserDialogs = [];
  page.on('dialog', d => { browserDialogs.push(d.message()); d.dismiss(); });
  await page.evaluate(() => {
    state.waypoints = [{ lat: 32.18, lng: 34.83, name: 'LLHZ' }, { lat: 32.8, lng: 35.04, name: 'LLHA' }];
    syncLegs();
    state.legs[0].inLabel = { a: 0.5, p: 40, _m: 1 };     // a hand-dragged kite
  });
  await answerAppDialogs(page, true);
  await page.evaluate(() => document.getElementById('tool-reset-all-markers').click());
  await expect.poll(() => page.evaluate(() => state.legs[0].inLabel && state.legs[0].inLabel._default)).toBe(1);
  expect(browserDialogs).toEqual([]);
});

test('when the clipboard refuses, the share link is shown to copy by hand', async ({ page }) => {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof buildShareUrl === 'function');
  const browserDialogs = [];
  page.on('dialog', d => { browserDialogs.push(d.message()); d.dismiss(); });
  await page.evaluate(() => {
    state.waypoints = [{ lat: 32.18, lng: 34.83, name: 'LLHZ' }, { lat: 32.8, lng: 35.04, name: 'LLHA' }];
    syncLegs();
    Object.defineProperty(navigator, 'clipboard',
      { value: { writeText: () => Promise.reject(new Error('denied')) }, configurable: true });
  });
  const url = await page.evaluate(() => buildShareUrl().url);
  await page.evaluate(() => document.getElementById('share').click());
  const area = page.locator('.copy-text-modal .copy-text-area');
  await expect(area).toHaveValue(url);
  expect(browserDialogs).toEqual([]);
});
