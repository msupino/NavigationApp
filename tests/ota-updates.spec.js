// @ts-check
// Over-the-air updates for the embedded iOS build.
//
// The App Store build carries the web app inside the binary, so a deploy does not reach it --
// without this, a fixed typo is a submission and a review. Guideline 2.5.2 permits updating
// the interpreted code a WebView runs, and that is all this moves.
//
// The rules worth pinning, because getting any of them wrong is worse than not shipping it:
// the web app and the Android shell must never do this at all; a bundle is armed for the NEXT
// launch, never swapped under a pilot reading a chart; every failure leaves the app on the
// bundle it has; and notifyAppReady() is called at boot, because a bundle that does not say
// it started is rolled back to the one that did.
const { test, expect } = require('./_setup');

const boot = (page) => page.goto('?lang=en&nogist');

// A plugin that records what it was asked to do. `installed` is what a real one keeps: the
// bundle currently running.
const stub = (page, opts) => page.evaluate((o) => {
  window.__ota = {
    downloads: [], next: [], set: [], ready: 0, delays: [], cancels: 0,
    current: { id: 'running', version: o.running || '1.0-old' },
    pending: o.pending || null,
  };
  window.__navaidEmbedded = o.embedded !== false;
  const updater = {
    notifyAppReady: async () => { window.__ota.ready++; },
    current: async () => ({ bundle: window.__ota.current }),
    download: async (args) => {
      window.__ota.downloads.push(args);
      if (o.downloadFails) throw new Error('relay is down');
      return { id: 'downloaded', version: args.version };
    },
    next: async (args) => {
      if (o.nextFails) throw new Error('could not arm the bundle');
      window.__ota.next.push(args);
    },
    set: async (args) => {
      // The real set() makes the pending bundle current WITHOUT consuming the pending
      // pointer -- which is the whole reason it must not be used to install one.
      window.__ota.set.push(args);
      window.__ota.current = { id: args.id, version: 'set-' + args.id };
    },
    reload: async () => {
      window.__ota.reloads = (window.__ota.reloads || 0) + 1;
      if (o.reloadDoesNothing) return;
      // The pending-aware path: apply the queued bundle, then clear the pointer.
      const queued = window.__ota.pending;
      if (queued && queued.id !== window.__ota.current.id) {
        window.__ota.current = { id: queued.id, version: queued.version };
        window.__ota.pending = null;
      }
    },
    getNextBundle: async () => window.__ota.pending || null,
    cancelDelay: async () => { window.__ota.cancels++; },
  };
  // An older plugin with no delay API is a real case: the tests for it turn this off.
  if (o.noDelayApi !== true) {
    updater.setMultiDelay = async (args) => {
      if (o.delayFails) throw new Error('delay refused');
      window.__ota.delays.push(args);
    };
  }
  const plugins = { CapacitorUpdater: updater };
  // Wi-Fi unless a test says otherwise: on a phone the answer comes from the native plugin,
  // because navigator.connection does not exist in WKWebView.
  if (o.network !== null) {
    plugins.Network = { getStatus: async () => ({ connected: true, connectionType: o.network || 'wifi' }) };
  }
  window.Capacitor = { isNativePlatform: () => o.native !== false, Plugins: plugins };
}, opts || {});

const MANIFEST = {
  version: '1.0-new', url: 'https://navaid.supino.org/ota/navaid-1.0-new.zip',
  checksum: 'a'.repeat(64),
};

const check = (page, manifest, force) => page.evaluate(
  ([m, f]) => NavAid.ota.checkForUpdate({ manifest: m, force: f !== false })
    .then((r) => ({ result: r, seen: window.__ota })),
  [manifest || MANIFEST, force]);

test('the web app never updates itself this way', async ({ page }) => {
  await boot(page);
  // No Capacitor at all: this is a browser, and the site IS the update.
  const got = await page.evaluate(() => NavAid.ota.checkForUpdate({ force: true }));
  expect(got.checked).toBe(false);
  expect(await page.evaluate(() => NavAid.ota.notifyReady())).toBe(false);
});

test('the remote shell never updates itself either', async ({ page }) => {
  await boot(page);
  // Native, but loading the live site: a deploy already reached it. Android is this.
  await stub(page, { embedded: false });
  const got = await check(page);
  expect(got.result.checked).toBe(false);
  expect(got.seen.downloads).toEqual([]);
});

test('a newer bundle is downloaded and armed for the next launch', async ({ page }) => {
  await boot(page);
  await stub(page, { running: '1.0-old' });
  const got = await check(page);
  expect(got.result.updated).toBe(true);
  expect(got.result.version).toBe('1.0-new');
  expect(got.seen.downloads).toEqual([
    { url: MANIFEST.url, version: MANIFEST.version, checksum: MANIFEST.checksum },
  ]);
  // next(), not set(): set() reloads the WebView where it stands, and a chart vanishing
  // under a pilot mid-flight is not an acceptable way to deliver a typo fix.
  expect(got.seen.next).toEqual([{ id: 'downloaded' }]);
  expect(got.seen.set).toEqual([]);
  // ...and next() alone is NOT next launch. The plugin installs a pending bundle when the
  // app moves to the BACKGROUND, so answering a message mid-flight and coming back would
  // reload NavAid. A `kill` condition is cleared only when the app is actually terminated.
  expect(got.seen.delays).toEqual([{ delayConditions: [{ kind: 'kill' }] }]);
});

test('a plugin that cannot defer to a cold start arms nothing', async ({ page }) => {
  await boot(page);
  await stub(page, { noDelayApi: true });
  const got = await check(page);
  // Nothing is armed at all: next() is never reached, because arming without a delay leaves
  // a bundle that installs on the next backgrounding.
  expect(got.result.updated).toBe(false);
  expect(got.seen.next).toEqual([]);
});

// The order is the fix. next() arms the install; the delay makes it safe. Arming first and
// then failing to set the delay leaves a pending bundle behind -- and cancelDelay() clears
// delay CONDITIONS, not a pending bundle, so there would be no way back.
test('a delay that cannot be set leaves nothing armed', async ({ page }) => {
  await boot(page);
  await stub(page, { delayFails: true });
  const got = await check(page);
  expect(got.result.updated).toBe(false);
  expect(got.seen.next, 'a bundle was armed with no condition holding it').toEqual([]);
});

test('a bundle that cannot be armed takes its delay back off', async ({ page }) => {
  await boot(page);
  await stub(page, { nextFails: true });
  const got = await check(page);
  expect(got.result.updated).toBe(false);
  expect(got.seen.delays.length).toBe(1);
  expect(got.seen.cancels, 'a kill condition was left behind for the next bundle').toBe(1);
});

// The plugin does NOT install a pending bundle at startup: initialLoad() loads the CURRENT
// one and checkCancelDelay(.killed) only removes the condition, so the install waits for the
// next appMovedToBackground -- a pilot switching apps in flight and coming back to a reloaded
// NavAid. It is done here instead, while the app is still starting.
test('a pending bundle is installed at startup, not on the next backgrounding', async ({ page }) => {
  await boot(page);
  await stub(page, { pending: { id: 'waiting', version: '1.0-new', status: 'success' } });
  const got = await page.evaluate(async () => {
    localStorage.removeItem('navaid.otaInstalling');
    const r = await NavAid.ota.installPendingAtStartup({});
    return { r, seen: window.__ota, noted: localStorage.getItem('navaid.otaInstalling') };
  });
  expect(got.r.installed).toBe(true);
  expect(got.seen.cancels, 'the condition holding it back has to go with it').toBe(1);
  expect(got.seen.reloads).toBe(1);
  expect(got.noted).toBe('waiting');
  // set() + reload() looks equivalent and is not: set() makes the pending bundle current, so
  // reload() no longer sees a pending one, takes the plain path, and leaves the pointer --
  // which reinstalls the same bundle on every launch afterwards. reload() alone applies it
  // AND clears the pointer.
  expect(got.seen.set, 'set() leaves the pending pointer behind').toEqual([]);
  expect(got.seen.pending, 'the pending bundle was not consumed').toBeNull();
});

// The consequence, end to end: install it, let the launch succeed (which clears our own
// marker), and start again. Nothing pending, nothing installed, no second reload.
test('an installed bundle is not installed again on the next launch', async ({ page }) => {
  await boot(page);
  await stub(page, { pending: { id: 'waiting', version: '1.0-new', status: 'success' } });
  const got = await page.evaluate(async () => {
    localStorage.removeItem('navaid.otaInstalling');
    const first = await NavAid.ota.installPendingAtStartup({});
    // What a healthy launch on the new bundle does.
    localStorage.removeItem('navaid.otaInstalling');
    const second = await NavAid.ota.installPendingAtStartup({});
    return { first, second, reloads: window.__ota.reloads, current: window.__ota.current };
  });
  expect(got.first.installed).toBe(true);
  expect(got.second.installed).toBe(false);
  expect(got.reloads, 'the same update reinstalled itself').toBe(1);
  expect(got.current.id).toBe('waiting');
});

// ...and the same guard with the pointer left behind by something else: a bundle that is
// already the one running is not an update, whatever the pointer says.
test('a pending pointer at the bundle already running is nothing to do', async ({ page }) => {
  await boot(page);
  await stub(page, { running: '1.0-new', pending: { id: 'running', version: '1.0-new', status: 'success' } });
  const got = await page.evaluate(async () => {
    localStorage.setItem('navaid.otaInstalling', 'running');
    const r = await NavAid.ota.installPendingAtStartup({});
    return { r, reloads: window.__ota.reloads || 0, noted: localStorage.getItem('navaid.otaInstalling') };
  });
  expect(got.r.installed).toBe(false);
  expect(got.r.reason).toMatch(/already the one running/);
  expect(got.reloads).toBe(0);
  expect(got.noted, 'a stale attempt marker is cleared').toBeNull();
});

// A reload that does not take is not an install. The launch has to be vouched for anyway, or
// a bundle that is working would be rolled back for standing still.
test('a reload that changes nothing is not reported as an install', async ({ page }) => {
  await boot(page);
  await stub(page, {
    pending: { id: 'waiting', version: '1.0-new', status: 'success' }, reloadDoesNothing: true,
  });
  const got = await page.evaluate(async () => {
    localStorage.removeItem('navaid.otaInstalling');
    return NavAid.ota.installPendingAtStartup({});
  });
  expect(got.installed).toBe(false);
  expect(got.reason).toMatch(/did not take/);
});

test('a pending bundle is tried once, not on every launch', async ({ page }) => {
  await boot(page);
  await stub(page, { pending: { id: 'waiting', version: '1.0-new', status: 'success' } });
  const got = await page.evaluate(async () => {
    localStorage.setItem('navaid.otaInstalling', 'waiting');    // a launch that did not come back
    const r = await NavAid.ota.installPendingAtStartup({});
    return { r, seen: window.__ota };
  });
  expect(got.r.installed).toBe(false);
  expect(got.seen.set, 'a bundle that cannot be set would be a reload loop').toEqual([]);
});

test('a bundle the plugin already failed on is not installed', async ({ page }) => {
  await boot(page);
  await stub(page, { pending: { id: 'bad', version: '1.0-bad', status: 'error' } });
  const got = await page.evaluate(async () => {
    localStorage.removeItem('navaid.otaInstalling');
    const r = await NavAid.ota.installPendingAtStartup({});
    return { r, seen: window.__ota };
  });
  expect(got.r.installed).toBe(false);
  expect(got.seen.set).toEqual([]);
});

test('nothing pending, nothing done', async ({ page }) => {
  await boot(page);
  await stub(page, {});
  const got = await page.evaluate(() => NavAid.ota.installPendingAtStartup({}));
  expect(got.installed).toBe(false);
  expect(got.reason).toMatch(/no pending/);
});

test('the bundle already running is not downloaded again', async ({ page }) => {
  await boot(page);
  await stub(page, { running: '1.0-new' });
  const got = await check(page);
  expect(got.result.updated).toBe(false);
  expect(got.seen.downloads).toEqual([]);
});

test('a failed download leaves the app on the bundle it has', async ({ page }) => {
  await boot(page);
  await stub(page, { downloadFails: true });
  const got = await check(page);
  expect(got.result.updated).toBe(false);
  expect(got.result.reason).toMatch(/relay is down/);
  expect(got.seen.next).toEqual([]);          // nothing armed
});

test('a manifest missing anything it needs is no update at all', async ({ page }) => {
  await boot(page);
  await stub(page, {});
  for (const manifest of [
    { version: '1.0-new', url: 'https://x/y.zip' },            // no checksum
    { version: '1.0-new', checksum: 'a'.repeat(64) },          // no url
    { url: 'https://x/y.zip', checksum: 'a'.repeat(64) },      // no version
  ]) {
    // Passed as a manifest object, but the client's own reader is what enforces the shape,
    // so the same objects go through it.
    const ok = await page.evaluate((m) => {
      const real = window.fetch;
      window.fetch = async () => ({ ok: true, json: async () => m });
      return NavAid.ota.readManifest().finally(() => { window.fetch = real; });
    }, manifest);
    expect(ok).toBeNull();
  }
});

test('a missing manifest is silence, not an error', async ({ page }) => {
  await boot(page);
  await stub(page, {});
  const got = await page.evaluate(() => {
    const real = window.fetch;
    window.fetch = async () => ({ ok: false, status: 404, json: async () => ({}) });
    return NavAid.ota.checkForUpdate({ force: true }).finally(() => { window.fetch = real; });
  });
  expect(got.updated).toBe(false);
  expect(got.reason).toBe('no manifest');
});

test('the gist can switch it off', async ({ page }) => {
  await boot(page);
  await stub(page, {});
  const got = await page.evaluate(() => {
    NavAid.tuningDefaults.featureOtaUpdates.value = false;
    return NavAid.ota.checkForUpdate({ force: true });
  });
  expect(got.checked).toBe(false);
});

test('cellular is left alone -- and an unknown connection counts as cellular', async ({ page }) => {
  await boot(page);
  // The bug this replaces: navigator.connection is Chromium-only, so on every iPhone the
  // old check found no information and read it as permission to download.
  await stub(page, { network: 'cellular' });
  const onCell = await page.evaluate(() => NavAid.ota.checkForUpdate({}));
  expect(onCell.checked).toBe(false);
  expect(onCell.reason).toMatch(/unmetered/);

  // No Network plugin and no navigator.connection: exactly an iPhone before this fix.
  await stub(page, { network: null });
  const unknown = await page.evaluate(() => {
    delete navigator.connection;
    return NavAid.ota.checkForUpdate({});
  });
  expect(unknown.checked, 'silence is not consent for someone else\'s data plan').toBe(false);

  await stub(page, { network: 'wifi' });
  const onWifi = await check(page, undefined, false);
  expect(onWifi.result.updated).toBe(true);
});

test('a disconnected phone does not try', async ({ page }) => {
  await boot(page);
  await stub(page, { network: 'none' });
  const got = await page.evaluate(() => NavAid.ota.checkForUpdate({}));
  expect(got.checked).toBe(false);
});

// The rollback contract. A bundle that never says it started is replaced by the one before
// it after appReadyTimeout -- which is what makes shipping this way safe, and which only
// works if the call happens on every launch.
test('a launch that comes up tells the plugin so, once', async ({ page }) => {
  await page.addInitScript(() => {
    window.__navaidEmbedded = true;
    window.__readyCalls = 0;
    window.Capacitor = {
      isNativePlatform: () => true,
      Plugins: { CapacitorUpdater: { notifyAppReady: async () => { window.__readyCalls++; } } },
    };
  });
  await boot(page);
  await page.waitForFunction(() => window.__readyCalls > 0);
  expect(await page.evaluate(() => window.__readyCalls)).toBe(1);
  // And it only said so because the app really is up.
  expect(await page.evaluate(() => NavAid.ota.appIsUp())).toBe(true);
});

// The other half of the contract, and the one that makes the first half worth anything: a
// bundle that did NOT come up must stay silent, so the plugin rolls it back. Saying "ready"
// at the top of a file cannot tell the difference -- the loader carries on past a script
// that threw, and an app with no map would have reported itself healthy.
test('a bundle that did not come up says nothing, and is rolled back', async ({ page }) => {
  await boot(page);
  const got = await page.evaluate(async () => {
    let told = 0;
    const p = { notifyAppReady: async () => { told++; } };
    // What a half-loaded bundle looks like: the app's own state never got built.
    const waypoints = state.waypoints;
    delete state.waypoints;
    const up = NavAid.ota.appIsUp();
    const said = await NavAid.ota.notifyReady({ plugin: p, waitMs: 300 });
    state.waypoints = waypoints;
    return { up, said, told };
  });
  expect(got.up).toBe(false);
  expect(got.said).toBe(false);
  expect(got.told, 'a broken bundle disabled its own rollback').toBe(0);
});

test('an exception on the way up disqualifies the bundle even if it looks loaded', async ({ page }) => {
  await boot(page);
  const got = await page.evaluate(async () => {
    let told = 0;
    const p = { notifyAppReady: async () => { told++; } };
    // Everything is present, but something threw while booting: the app may be half-wired,
    // and the safe reading of that is "do not vouch for this bundle".
    window.dispatchEvent(new ErrorEvent('error', { message: 'boom' }));
    const said = await NavAid.ota.notifyReady({ plugin: p, waitMs: 300 });
    return { said, told, looksUp: typeof draw === 'function' };
  });
  expect(got.looksUp).toBe(true);
  expect(got.said).toBe(false);
  expect(got.told).toBe(0);
});

// The reviewer's own repro, both halves. app/ota.js is the LAST script in index.html's list,
// so a listener registered inside it has already missed every exception thrown by every
// script before it -- and a script that 404s never throws at all, it paints #boot-error. Both
// used to reach notifyAppReady(), which is a broken bundle switching off its own rollback.
for (const [what, breakIt] of [
  ['a script that never arrived', (route) => route.fulfill({ status: 404, body: '' })],
  ['a script that threw on the way up', (route) => route.fulfill({
    status: 200, contentType: 'application/javascript',
    body: 'throw new Error("deck.js is broken");',
  })],
]) {
  test('a bundle with ' + what + ' stays silent', async ({ page }) => {
    await page.route('**/app/deck.js*', breakIt);
    await page.addInitScript(() => {
      window.__navaidEmbedded = true;
      window.__readyCalls = 0;
      window.Capacitor = {
        isNativePlatform: () => true,
        Plugins: {
          CapacitorUpdater: {
            notifyAppReady: async () => { window.__readyCalls++; },
            getNextBundle: async () => null,
          },
        },
      };
    });
    await page.goto('?lang=en&nogist');
    // Long enough for the whole boot path and the readiness wait to have given up.
    await page.waitForTimeout(2500);
    const got = await page.evaluate(() => ({
      told: window.__readyCalls,
      broke: window.__navaidBootBroke === true,
      up: NavAid.ota.appIsUp(),
    }));
    expect(got.broke, 'the loader did not record the failure').toBe(true);
    expect(got.up).toBe(false);
    expect(got.told, 'a broken bundle vouched for itself').toBe(0);
  });
}

// ...and the same page, unbroken, still says so -- or every update would roll back.
test('an ordinary launch is still vouched for', async ({ page }) => {
  await page.addInitScript(() => {
    window.__navaidEmbedded = true;
    window.__readyCalls = 0;
    window.Capacitor = {
      isNativePlatform: () => true,
      Plugins: {
        CapacitorUpdater: {
          notifyAppReady: async () => { window.__readyCalls++; },
          getNextBundle: async () => null,
        },
      },
    };
  });
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => window.__readyCalls > 0, { timeout: 10000 });
  expect(await page.evaluate(() => window.__navaidBootBroke)).toBe(false);
});
