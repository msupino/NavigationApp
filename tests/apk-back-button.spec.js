// @ts-check
// A phone's Back button sits under the pilot's thumb for the whole flight, and in a WebView
// with no history it closes the app outright. Back means "go back one step" while there is a
// step, and asks before the press that leaves. APK only: in a browser, Back belongs to the
// browser, and beforeunload can raise nothing but a dialog nobody worded.
const { test, expect, answerAppDialogs } = require('./_setup');

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

// "Close NavAid?" is asked in the app's own dialog (bilingual, themed -- not the native
// English-only confirm), and answered the way a pilot would: OK or Cancel.
const back = async (page, confirmIt) => {
  await answerAppDialogs(page, confirmIt);
  await page.evaluate(async () => {
    // The listener is armed only in the native shell; call the step directly where it is not.
    if (window.__backHandlers.length) await Promise.all(window.__backHandlers.map(fn => fn()));
    else backButtonStep();
  });
};

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

test('back closes a plate through cleanup so one Escape closes the reopened viewer', async ({ page }) => {
  await bootNative(page);
  await page.evaluate(() => showPlateViewer('dummy.pdf', 'Dummy'));
  await expect(page.locator('.modal-back.plate-viewer')).toHaveCount(1);
  await back(page, false);
  await expect(page.locator('.modal-back.plate-viewer')).toHaveCount(0);

  await page.evaluate(() => showPlateViewer('dummy.pdf', 'Dummy'));
  await expect(page.locator('.modal-back.plate-viewer')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(page.locator('.modal-back.plate-viewer')).toHaveCount(0);
});

test('back cancels the export preview through cleanup and leaves no stale Escape handler', async ({ page }) => {
  await bootNative(page);
  await page.evaluate(() => {
    const toolbarToggle = document.getElementById('navwp-cb');
    if (toolbarToggle) toolbarToggle.checked = false;
    window.showNavWP = false;
    showExportModal();
    const previewToggle = document.getElementById('export-navwp-cb');
    previewToggle.checked = true;
    previewToggle.dispatchEvent(new Event('change', { bubbles: true }));
  });
  expect(await page.evaluate(() => showNavWP)).toBe(true);
  await back(page, false);
  await expect(page.locator('.modal-back.export-options')).toHaveCount(0);
  expect(await page.evaluate(() => showNavWP)).toBe(false);

  await page.evaluate(() => showExportModal());
  await expect(page.locator('.modal-back.export-options')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(page.locator('.modal-back.export-options')).toHaveCount(0);
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

// The question is the app's own dialog, not window.confirm (in the APK a native dialog with
// English OK / Cancel), and a second Back while it is up closes it: the answer is "stay".
test('the exit question is the app\'s own dialog, and a second Back dismisses it', async ({ page }) => {
  await bootNative(page);
  const browserDialogs = [];
  page.on('dialog', d => { browserDialogs.push(d.message()); d.dismiss(); });
  await page.evaluate(() => { window.__backDone = Promise.all(window.__backHandlers.map(fn => fn())); });
  await expect(page.locator('.follow-me-ask-modal')).toHaveCount(1);
  await expect(page.locator('.follow-me-ask-modal')).toContainText('Close NavAid?');
  await page.evaluate(() => backButtonStep());          // the second Back
  await page.evaluate(() => window.__backDone);
  await expect(page.locator('.follow-me-ask-modal')).toHaveCount(0);
  expect(await page.evaluate(() => window.__exited)).toBe(0);
  expect(browserDialogs).toEqual([]);
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

// The question is its title; the line under it says closing keeps the route, recordings and
// settings -- and a recording in progress is saved before the app closes, so that is true.
test('the exit question is titled by the question, and a running recording is saved before closing', async ({ page }) => {
  await bootNative(page);
  await page.evaluate(() => { new Function('gpsRecording = true; gpsTrack = [{lat:32,lng:34.8,t:1},{lat:32.1,lng:34.9,t:2}]')(); });
  const before = await page.evaluate(() => (typeof routeLibrary !== 'undefined' && Array.isArray(routeLibrary)) ? routeLibrary.length : -1);
  await page.evaluate(() => { window.__backDone = Promise.all(window.__backHandlers.map(fn => fn())); });
  const ask = page.locator('.follow-me-ask-modal');
  await expect(ask.locator('.modal-title, h3').first()).toHaveText('Close NavAid?');
  await expect(ask).toContainText('route, recordings and settings are kept');
  await ask.locator('.follow-me-ask-ok').click();
  await page.evaluate(() => window.__backDone);
  expect(await page.evaluate(() => window.__exited)).toBe(1);
  expect(await page.evaluate(() => gpsRecording)).toBe(false);
  if (before >= 0) expect(await page.evaluate(() => routeLibrary.length)).toBe(before + 1);
});
