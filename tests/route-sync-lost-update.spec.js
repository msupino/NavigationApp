// @ts-check
// Two devices syncing the route library at once. The path was: list the file, download it,
// merge with local, PATCH the whole array back. Nothing checked that the file was still the
// one that had been read, so a second device's upload landing in between was overwritten --
// its routes gone from Drive and from every device that synced afterwards.
//
// Drive v3 has no precondition on a content write, so the file's version is re-read
// immediately before the PATCH: the window narrows from "download + merge" to one request,
// and a race aborts rather than overwrites. The settings file has worked this way already;
// this is the same guard on the routes.
const { test, expect } = require('./_setup');

const FILE = { id: 'f1', name: 'navaid-routes.json', modifiedTime: '2026-01-01T00:00:00Z', version: '7' };

async function stubDrive(page, { remote, versionAtWrite = '7' }) {
  await page.route(/googleapis\.com\/drive\/v3\/files\?/, r =>
    r.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ files: [FILE] }) }));
  await page.route(/drive\/v3\/files\/f1\?alt=media/, r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(remote) }));
  // The check just before the PATCH: hand back whatever version the test wants it to see.
  await page.route(/drive\/v3\/files\/f1\?fields=/, r =>
    r.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ version: versionAtWrite, modifiedTime: '2026-01-01T00:00:00Z' }) }));
  await page.route(/upload\/drive\/v3\/files/, async r => {
    await page.evaluate(body => { window.__uploaded = JSON.parse(body); },
      r.request().postData() || '[]');
    r.fulfill({ status: 200, contentType: 'application/json', body: '{"id":"f1"}' });
  });
}

async function boot(page, opts) {
  await stubDrive(page, opts);
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof _gdriveSyncOnce === 'function' &&
    typeof persistRouteLibrary === 'function');
  await page.evaluate(() => {
    window.__uploaded = null;
    window.gdriveHeaders = () => ({ Authorization: 'Bearer test' });
  });
}

// A library entry as the app stores one: mergeRouteLibraries keeps entries that carry
// `data` (a saved route), a GPS `track`, or a `deleted` tombstone -- anything else is
// dropped, which is why these fixtures use `data`.
const entry = (name, savedAt) => ({ id: name, name, savedAt, data: { waypoints: [], legs: [], notes: [] } });

test('an untouched file still syncs, and the merge is uploaded', async ({ page }) => {
  await boot(page, { remote: [entry('remote-one', '2026-01-02T00:00:00Z')] });
  const out = await page.evaluate(async () => {
    persistRouteLibrary([{ id: 'local-one', name: 'local-one', savedAt: '2026-01-03T00:00:00Z',
      data: { waypoints: [], legs: [], notes: [] } }]);
    const merged = await _gdriveSyncOnce();
    return { names: merged.map(e => e.name).sort(), uploaded: (window.__uploaded || []).map(e => e.name).sort() };
  });
  expect(out.names).toEqual(['local-one', 'remote-one']);
  expect(out.uploaded).toEqual(['local-one', 'remote-one']);
});

test('a file that changed under us aborts instead of overwriting', async ({ page }) => {
  // Version 9 at write time: another device uploaded after our download.
  await boot(page, { remote: [entry('remote-one', '2026-01-02T00:00:00Z')], versionAtWrite: '9' });
  const out = await page.evaluate(async () => {
    persistRouteLibrary([{ id: 'local-one', name: 'local-one', savedAt: '2026-01-03T00:00:00Z',
      data: { waypoints: [], legs: [], notes: [] } }]);
    try {
      await _gdriveSyncOnce();
      return { threw: false, uploaded: window.__uploaded };
    } catch (e) {
      return { threw: true, message: String(e && e.message), uploaded: window.__uploaded,
               local: loadRouteLibrary().map(r => r.name) };
    }
  });
  expect(out.threw).toBe(true);
  expect(out.uploaded).toBeNull();             // nothing was written over the other device
  expect(out.local).toEqual(['local-one']);    // and this device kept its own routes
  expect(out.message).toMatch(/sync/i);
});

// The guard must not fire on a first sync, where there is no file to have changed.
test('a first sync with no remote file uploads normally', async ({ page }) => {
  await page.route(/googleapis\.com\/drive\/v3\/files\?/, r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ files: [] }) }));
  await page.route(/upload\/drive\/v3\/files/, async r => {
    await page.evaluate(body => { window.__uploaded = body; }, r.request().postData() || '');
    r.fulfill({ status: 200, contentType: 'application/json', body: '{"id":"new"}' });
  });
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof _gdriveSyncOnce === 'function');
  const out = await page.evaluate(async () => {
    window.gdriveHeaders = () => ({ Authorization: 'Bearer test' });
    persistRouteLibrary([{ id: 'only', name: 'only', savedAt: '2026-01-03T00:00:00Z',
      data: { waypoints: [], legs: [], notes: [] } }]);
    const merged = await _gdriveSyncOnce();
    return { names: merged.map(e => e.name), uploadedSomething: !!window.__uploaded };
  });
  expect(out.names).toEqual(['only']);
  expect(out.uploadedSomething).toBe(true);
});
