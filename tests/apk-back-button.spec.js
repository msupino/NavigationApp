// @ts-check
// A phone's Back button sits under the pilot's thumb for the whole flight, and in a WebView
// with no history it closes the app outright. Back means "go back one step" while there is a
// step, and asks before the press that leaves. APK only: in a browser, Back belongs to the
// browser, and beforeunload can raise nothing but a dialog nobody worded.
const { test, expect } = require('./_setup');

// The APK's own shell, faked: the app decides by hostname + the Capacitor bridge.
async function bootNative(page) {
  await page.addInitScript(() => {
    window.__backHandlers = [];
    window.__exited = 0;
    window.Capacitor = {
      isNativePlatform: () => true,
      getPlatform: () => 'android',
      Plugins: {
        App: {
          addListener: (name, fn) => { if (name === 'backButton') window.__backHandlers.push(fn); },
          exitApp: () => { window.__exited++; },
        },
      },
    };
  });
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof backButtonStep === 'function' && typeof draw === 'function');
  await page.evaluate(() => {
    state.waypoints = [{ lat: 32.0, lng: 34.8, name: 'A' }, { lat: 32.3, lng: 35.0, name: 'B' }];
    syncLegs(); draw();
  });
}

const back = (page, confirmIt) => page.evaluate((yes) => {
  window.confirm = () => yes;
  // The listener is armed only in the native shell; call the step directly where it is not.
  if (window.__backHandlers.length) window.__backHandlers.forEach(fn => fn());
  else backButtonStep();
}, confirmIt);

test('back closes the inspector before anything else', async ({ page }) => {
  await bootNative(page);
  await page.evaluate(() => { state.selected = { type: 'wp', index: 0 }; showInspector(); });
  await back(page, false);
  expect(await page.evaluate(() =>
    document.getElementById('inspector').classList.contains('hidden'))).toBe(true);
  expect(await page.evaluate(() => window.__exited)).toBe(0);
});

test('back closes an open chart modal first', async ({ page }) => {
  await bootNative(page);
  await page.evaluate(() => showChartsModal());
  await page.waitForSelector('.modal-back');
  await back(page, false);
  expect(await page.locator('.modal-back').count()).toBe(0);
  expect(await page.evaluate(() => window.__exited)).toBe(0);
});

test('back closes the flight plan through its cleanup and allows it to reopen', async ({ page }) => {
  await bootNative(page);
  await page.evaluate(() => showFlightPlan());
  await expect(page.locator('.modal-back.flight-plan')).toHaveCount(1);
  await back(page, false);
  expect(await page.evaluate(() => ({ fpOpen, hasRefresh: !!refreshFlightPlan,
    connected: !!(flightPlanBack && flightPlanBack.isConnected) })))
    .toEqual({ fpOpen: false, hasRefresh: false, connected: false });
  await page.evaluate(() => showFlightPlan());
  await expect(page.locator('.modal-back.flight-plan')).toHaveCount(1);
});

test('a later toast does not hide the actual top modal from Back', async ({ page }) => {
  await bootNative(page);
  await page.evaluate(() => { showChartsModal(); showToast('later notice'); });
  await expect(page.locator('.modal-back')).toHaveCount(1);
  await back(page, false);
  await expect(page.locator('.modal-back')).toHaveCount(0);
  expect(await page.evaluate(() => window.__exited)).toBe(0);
});

test('back closes shortcuts through cleanup and allows them to reopen', async ({ page }) => {
  await bootNative(page);
  await page.evaluate(() => showShortcutsHelp());
  await expect(page.locator('.modal-back.shortcuts-help')).toHaveCount(1);
  await back(page, false);
  await expect(page.locator('.modal-back.shortcuts-help')).toHaveCount(0);
  expect(await page.evaluate(() => _shortcutsHelpBack)).toBeNull();
  await page.evaluate(() => showShortcutsHelp());
  await expect(page.locator('.modal-back.shortcuts-help')).toHaveCount(1);
});

test('back leaves a map tool before it leaves the app', async ({ page }) => {
  await bootNative(page);
  await page.evaluate(() => setMode('add'));
  await back(page, false);
  expect(await page.evaluate(() => state.mode)).toBe(null);
  expect(await page.evaluate(() => window.__exited)).toBe(0);
});

test('with nothing open it asks, and stays when the answer is no', async ({ page }) => {
  await bootNative(page);
  await back(page, false);
  expect(await page.evaluate(() => window.__exited)).toBe(0);
});

test('...and exits when the answer is yes', async ({ page }) => {
  await bootNative(page);
  await back(page, true);
  expect(await page.evaluate(() => window.__exited)).toBe(1);
});

// In a browser there is no listener at all: Back is the browser's.
test('a browser session arms no back handler', async ({ page }) => {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof armAndroidBackButton === 'function');
  const armed = await page.evaluate(() => {
    let added = 0;
    window.Capacitor = { Plugins: { App: { addListener: () => { added++; } } } };
    armAndroidBackButton();     // not the native shell: hostname is not app.navaid.local
    return added;
  });
  expect(armed).toBe(0);
});

// The APK loads the live site, so ui.js can run before the native bridge has injected its
// plugins. Giving up on the first look left Back unhandled for the whole session.
test('it waits for the bridge rather than giving up on the first look', async ({ page }) => {
  await page.addInitScript(() => {
    window.__backHandlers = [];
    // A bridge that arrives late, as the WebView's does.
    window.Capacitor = { isNativePlatform: () => true, getPlatform: () => 'android', Plugins: {} };
    setTimeout(() => {
      window.Capacitor.Plugins.App = {
        addListener: (n, fn) => { if (n === 'backButton') window.__backHandlers.push(fn); },
        exitApp: () => { window.__exited = (window.__exited || 0) + 1; },
      };
    }, 600);
  });
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof armAndroidBackButton === 'function');
  await expect.poll(() => page.evaluate(() => window.__backHandlers.length), { timeout: 8000 })
    .toBeGreaterThan(0);
});
