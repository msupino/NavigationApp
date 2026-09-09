// @ts-check
// Reported from the Android app: exports do nothing. Saved records would not export, and
// nor would saved routes. The cause was the same one line in fifteen places -- an
// <a download>, which a WebView has no download manager to answer, so the click was
// swallowed without a message and the pilot was left thinking the app had saved something.
//
// On a native shell a file leaves through the system share sheet instead. These tests stand
// in for the phone: a stubbed Capacitor bridge records what the app asked the platform to
// do, so the path can be proven from a laptop.
const { test, expect } = require('./_setup');

// The two plugins a native shell offers. The stub records every call and hands back the
// shapes the real plugins return, so the app's own sequencing is what is under test.
async function stubNative(page, opts = {}) {
  await page.addInitScript((o) => {
    window.__native = { writes: [], shares: [] };
    window.Capacitor = {
      isNativePlatform: () => true,
      Plugins: o.bare ? {} : {
        Filesystem: {
          writeFile: async (req) => {
            window.__native.writes.push(req);
            if (o.writeFails) throw new Error('disk full');
            return { uri: 'file:///data/user/0/org.supino.navaid/cache/' + req.path };
          },
        },
        Share: {
          share: async (req) => {
            window.__native.shares.push(req);
            if (o.shareCancelled) throw new Error('Share canceled');
          },
        },
      },
    };
  }, opts);
}

async function boot(page) {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof saveFile === 'function' && typeof state !== 'undefined');
  // Alerts would block the run, and one of these tests is about an alert being raised.
  await page.evaluate(() => {
    window.__alerts = [];
    window.alert = (m) => { window.__alerts.push(String(m)); };
  });
}

const save = (page, text, name) => page.evaluate(([t, n]) =>
  saveFile(new Blob([t], { type: 'application/json' }), n), [text, name]);

test('on a phone the file goes to the share sheet, not to a dead anchor', async ({ page }) => {
  await stubNative(page);
  await boot(page);
  const ok = await save(page, '{"a":1}', 'navaid-routes-20260909.json');
  expect(ok).toBe(true);
  const got = await page.evaluate(() => window.__native);
  // Written first, then handed over: the share sheet needs a file that exists.
  expect(got.writes.length).toBe(1);
  expect(got.writes[0].path).toBe('navaid-routes-20260909.json');
  // Cache, not Documents -- the copy exists only to be handed to another app.
  expect(got.writes[0].directory).toBe('CACHE');
  // Base64 without the data: prefix, which is what Filesystem takes.
  expect(got.writes[0].data).not.toMatch(/^data:/);
  expect(Buffer.from(got.writes[0].data, 'base64').toString()).toBe('{"a":1}');
  expect(got.shares.length).toBe(1);
  expect(got.shares[0].files).toEqual([
    'file:///data/user/0/org.supino.navaid/cache/navaid-routes-20260909.json']);
});

test('in a browser nothing changes: the anchor still does the saving', async ({ page }) => {
  await boot(page);
  const anchor = await page.evaluate(async () => {
    const seen = [];
    const realClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () { seen.push({ name: this.download, href: this.href }); };
    await saveFile(new Blob(['x'], { type: 'text/plain' }), 'note.txt');
    HTMLAnchorElement.prototype.click = realClick;
    return seen;
  });
  expect(anchor.length).toBe(1);
  expect(anchor[0].name).toBe('note.txt');
  expect(anchor[0].href).toMatch(/^blob:/);
});

test('a file name is a label, never a path', async ({ page }) => {
  await stubNative(page);
  await boot(page);
  // Recordings and routes are named by the pilot, and those names reach this function. A
  // slash would write outside the directory asked for.
  await save(page, 'x', '../../etc/passwd');
  const got = await page.evaluate(() => window.__native.writes[0].path);
  expect(got).toBe('passwd');
});

test('backing out of the share sheet is not an error worth an alert', async ({ page }) => {
  await stubNative(page, { shareCancelled: true });
  await boot(page);
  const ok = await save(page, 'x', 'a.json');
  expect(ok).toBe(false);
  // A pilot who changed their mind has not hit a fault; saying "could not be saved" would
  // be a lie about their own action.
  expect(await page.evaluate(() => window.__alerts)).toEqual([]);
});

test('a real failure is said out loud rather than swallowed', async ({ page }) => {
  await stubNative(page, { writeFails: true });
  await boot(page);
  expect(await save(page, 'x', 'a.json')).toBe(false);
  const alerts = await page.evaluate(() => window.__alerts);
  expect(alerts.length).toBe(1);
  expect(alerts[0]).toMatch(/could not be saved/i);
  expect(alerts[0]).toMatch(/disk full/);
});

test('an app too old to share says so instead of doing nothing', async ({ page }) => {
  // The whole defect was a button that looked like it worked. An APK built before the
  // plugins existed still loads the live site, so it reaches this code with no way to save.
  await stubNative(page, { bare: true });
  await boot(page);
  expect(await save(page, 'x', 'a.json')).toBe(false);
  const alerts = await page.evaluate(() => window.__alerts);
  expect(alerts.length).toBe(1);
  expect(alerts[0]).toMatch(/newer version/i);
});

test('the exports the app reports as broken all go through the one saver', async ({ page }) => {
  await stubNative(page);
  await boot(page);
  // Saved records (a GPS recording) and Saved routes (the library), named in the report,
  // plus the single-route export they sit beside.
  const got = await page.evaluate(async () => {
    const names = [];
    const real = window.saveFile;
    window.saveFile = (blob, name) => { names.push(name); return real(blob, name); };
    downloadGpsTrackGpx({ name: 'morning hop', points: [{ lat: 32, lng: 34.9, t: 0, alt: 100 }] });
    downloadGpsTrackJson({ name: 'morning hop', points: [{ lat: 32, lng: 34.9, t: 0, alt: 100 }] });
    state.waypoints = [{ lat: 32.0, lng: 34.9, name: 'A' }, { lat: 32.3, lng: 35.1, name: 'B' }];
    syncLegs();
    save();
    exportGpx();
    await new Promise(r => setTimeout(r, 50));
    window.saveFile = real;
    return names;
  });
  expect(got).toEqual([
    'morning_hop.gpx', 'morning_hop.json',
    expect.stringMatching(/\.json$/), expect.stringMatching(/\.gpx$/),
  ]);
  // And each really reached the platform, rather than being counted on the way past.
  expect(await page.evaluate(() => window.__native.shares.length)).toBe(4);
});
