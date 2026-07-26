// @ts-check
// Optional Google Drive settings sync (gdrive.js). Pure/local behaviour only —
// no network: the allowlist, collect/apply round-trip, last-write-wins merge,
// and the opt-in flag. Verifies device-local + secret keys never sync.
const { test, expect } = require('./_setup');

async function boot(page) {
  await page.goto('?lang=en');
  await page.waitForFunction(() =>
    typeof collectSyncableSettings === 'function' &&
    typeof applySyncableSettings === 'function' &&
    typeof mergeSettings === 'function' &&
    Array.isArray(window.GDRIVE_SETTINGS_KEYS));
}

test('collect returns only allowlisted keys; secrets and device-local keys are excluded', async ({ page }) => {
  await boot(page);
  const out = await page.evaluate(() => {
    localStorage.setItem('navaid.showDrift', '0');       // synced (toggle)
    localStorage.setItem('navaid.layer', 'nav');         // synced
    localStorage.setItem('navaid.ai.key.anthropic', 'sk-secret'); // NEVER
    localStorage.setItem('navaid.inspPos', '10,20');     // device-local
    localStorage.setItem('navaid.route', '{"waypoints":[]}'); // route lib covers this
    localStorage.setItem('navaid.sec.build', '1');       // toolbar state, device-local
    return collectSyncableSettings();
  });
  expect(out['navaid.showDrift']).toBe('0');
  expect(out['navaid.layer']).toBe('nav');
  expect(out['navaid.ai.key.anthropic']).toBeUndefined();
  expect(out['navaid.inspPos']).toBeUndefined();
  expect(out['navaid.route']).toBeUndefined();
  expect(out['navaid.sec.build']).toBeUndefined();
});

test('the allowlist never contains an API key or panel-geometry key', async ({ page }) => {
  await boot(page);
  const keys = await page.evaluate(() => window.GDRIVE_SETTINGS_KEYS);
  expect(keys.some(k => k.startsWith('navaid.ai.key'))).toBe(false);
  expect(keys.some(k => /Pos$/.test(k))).toBe(false);
  expect(keys).toContain('navaid.layer');
  expect(keys).toContain('navaid.showCircuit');
});

test('apply writes allowlisted keys and ignores foreign keys in the blob', async ({ page }) => {
  await boot(page);
  const out = await page.evaluate(() => {
    const changed = applySyncableSettings({
      'navaid.showMsa': '1',                 // allowlisted → applied
      'navaid.ai.key.anthropic': 'sk-evil',  // not allowlisted → ignored
      'navaid.evilKey': 'boom',              // foreign → ignored
    });
    return {
      changed,
      msa: localStorage.getItem('navaid.showMsa'),
      key: localStorage.getItem('navaid.ai.key.anthropic'),
      evil: localStorage.getItem('navaid.evilKey'),
    };
  });
  expect(out.changed).toBe(true);
  expect(out.msa).toBe('1');
  expect(out.key).toBeNull();
  expect(out.evil).toBeNull();
});

test('collect → apply round-trips a settings snapshot', async ({ page }) => {
  await boot(page);
  const ok = await page.evaluate(() => {
    localStorage.setItem('navaid.layer', 'heli');
    localStorage.setItem('navaid.plateOpacity', '0.4');
    const blob = collectSyncableSettings();
    localStorage.setItem('navaid.layer', 'cvfr');       // change locally
    localStorage.removeItem('navaid.plateOpacity');
    applySyncableSettings(blob);                          // restore from snapshot
    return localStorage.getItem('navaid.layer') === 'heli' &&
           localStorage.getItem('navaid.plateOpacity') === '0.4';
  });
  expect(ok).toBe(true);
});

test('merge is last-write-wins by updatedAt, ties keep local', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(() => {
    const local = { updatedAt: 100, values: { 'navaid.layer': 'cvfr' } };
    const remote = { updatedAt: 200, values: { 'navaid.layer': 'nav' } };
    return {
      remoteNewer: mergeSettings(local, remote).winner,
      localNewer: mergeSettings({ updatedAt: 300, values: {} }, remote).winner,
      tie: mergeSettings({ updatedAt: 200, values: {} }, remote).winner,
      noRemote: mergeSettings(local, null).winner,
    };
  });
  expect(r.remoteNewer).toBe('remote');
  expect(r.localNewer).toBe('local');
  expect(r.tie).toBe('local');       // ties keep this device
  expect(r.noRemote).toBe('local');
});

test('the route library shows a "Sync settings too" checkbox that persists the opt-in', async ({ page }) => {
  await boot(page);
  await page.waitForFunction(() => typeof showRouteLibraryModal === 'function' && gdriveConfigured());
  await page.evaluate(() => showRouteLibraryModal());
  const chk = page.locator('.route-library-gdrive-settings input[type="checkbox"]');
  await expect(chk).toBeVisible();
  await expect(chk).not.toBeChecked();          // off by default
  await chk.check();
  expect(await page.evaluate(() => settingsSyncEnabled())).toBe(true);
  expect(await page.evaluate(() => localStorage.getItem('navaid.syncSettings'))).toBe('1');
});

test('a fresh device (no snapshot) does not outrank an existing remote', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(() => {
    // Brand-new device: settings present, but the first sync never ran, so the
    // snapshot is unseeded. It must NOT claim Date.now() and beat the remote it
    // was set up to receive (the exact inverse the feature would otherwise cause).
    localStorage.removeItem('navaid.settingsSnapshot');
    localStorage.removeItem('navaid.settingsSyncedAt');
    localStorage.setItem('navaid.layer', 'nav');
    const local = _localSettingsBlob();
    const remote = { updatedAt: 1000, values: { 'navaid.layer': 'cvfr' } };
    return {
      updatedAt: local.updatedAt,
      winner: mergeSettings({ updatedAt: local.updatedAt, values: local.values }, remote).winner,
    };
  });
  expect(r.updatedAt).toBe(0);        // no baseline → 0, not Date.now()
  expect(r.winner).toBe('remote');    // receives the other device's settings
});

test('an established device with local edits stamps a real timestamp and wins over an older remote', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(() => {
    localStorage.setItem('navaid.layer', 'nav');
    localStorage.setItem('navaid.settingsSnapshot', JSON.stringify({ 'navaid.layer': 'heli' })); // differs → changed
    localStorage.setItem('navaid.settingsSyncedAt', '500');
    const local = _localSettingsBlob();
    const remote = { updatedAt: 1000, values: {} };
    return {
      changed: local.changedLocally,
      updatedAt: local.updatedAt,
      winner: mergeSettings({ updatedAt: local.updatedAt, values: local.values }, remote).winner,
    };
  });
  expect(r.changed).toBe(true);
  expect(r.updatedAt).toBeGreaterThan(1000);   // Date.now() ≫ the old remote
  expect(r.winner).toBe('local');
});

test('an explicit null is a tombstone: it deletes the key instead of being ignored', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(() => {
    localStorage.setItem('navaid.showMsa', '1');
    localStorage.setItem('navaid.layer', 'heli');
    // null = "gone on the author's device" → delete here too. An ABSENT key is
    // no information (older blob) and must be left alone.
    const changed = applySyncableSettings({ 'navaid.showMsa': null });
    return {
      changed,
      deleted: localStorage.getItem('navaid.showMsa'),
      untouched: localStorage.getItem('navaid.layer'),
      noopAgain: applySyncableSettings({ 'navaid.showMsa': null }),
    };
  });
  expect(r.changed).toBe(true);
  expect(r.deleted).toBeNull();        // tombstone applied
  expect(r.untouched).toBe('heli');    // absent key untouched
  expect(r.noopAgain).toBe(false);     // already gone → no change reported
});

test('a key deleted since the last sync is published as a tombstone, and a remote tombstone is carried forward', async ({ page }) => {
  await page.goto('?lang=en');
  await page.waitForFunction(() => typeof _settingsPublishValues === 'function');
  const r = await page.evaluate(() => {
    // Deleted locally since the last sync (in snapshot, absent now) → null.
    const a = _settingsPublishValues(
      { 'navaid.layer': 'nav' },
      { 'navaid.layer': 'nav', 'navaid.showMsa': '1' },
      null);
    // Still absent here and the remote already carries the tombstone → keep it,
    // so the deletion keeps reaching devices that have not synced yet.
    const b = _settingsPublishValues(
      { 'navaid.layer': 'nav' }, { 'navaid.layer': 'nav' }, { 'navaid.showMsa': null });
    // Set locally again → the value wins over the stale tombstone.
    const c = _settingsPublishValues(
      { 'navaid.layer': 'nav', 'navaid.showMsa': '0' }, null, { 'navaid.showMsa': null });
    return {
      deleted: a['navaid.showMsa'], hasDeleted: 'navaid.showMsa' in a,
      carried: b['navaid.showMsa'], resurrected: c['navaid.showMsa'],
    };
  });
  expect(r.hasDeleted).toBe(true);
  expect(r.deleted).toBeNull();        // tombstone published
  expect(r.carried).toBeNull();        // remote tombstone carried forward
  expect(r.resurrected).toBe('0');     // a real local value overrides it
});

test('stamps are monotonic, so a skewed clock cannot outrank forever and ties cannot freeze', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(() => {
    const future = Date.now() + 90 * 24 * 3600 * 1000;   // a device 3 months ahead
    localStorage.setItem('navaid.settingsSyncedAt', String(future));
    const past = _nextSettingsStamp(0);            // our own stamp must still advance
    const vsFuture = _nextSettingsStamp(future);   // and must beat the poisoned remote
    localStorage.removeItem('navaid.settingsSyncedAt');
    return { past, vsFuture, future, now: Date.now() };
  });
  expect(r.past).toBeGreaterThan(r.future);        // beats our own stored stamp
  expect(r.vsFuture).toBeGreaterThan(r.future);    // beats the remote's future stamp
});

test('a rejected write aborts the sync instead of being recorded as synced', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(() => {
    const orig = Storage.prototype.setItem;
    let threw = null;
    // Simulate a full quota for one specific key.
    Storage.prototype.setItem = function (k, v) {
      if (k === 'navaid.aircraft') { const e = new Error('quota'); e.name = 'QuotaExceededError'; throw e; }
      return orig.call(this, k, v);
    };
    try {
      applySyncableSettings({ 'navaid.showMsa': '1', 'navaid.aircraft': '{"reg":"4X-ABC"}' });
    } catch (e) { threw = e.message; } finally { Storage.prototype.setItem = orig; }
    return { threw, aircraft: localStorage.getItem('navaid.aircraft') };
  });
  expect(r.threw).toMatch(/could not be stored/i);   // surfaced, not swallowed
  expect(r.aircraft).toBeNull();                     // the write really did fail
});

test('settings sync is opt-in and off by default', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(() => {
    const before = settingsSyncEnabled();
    setSettingsSyncEnabled(true);
    const on = settingsSyncEnabled();
    setSettingsSyncEnabled(false);
    return { before, on, after: settingsSyncEnabled() };
  });
  expect(r.before).toBe(false);
  expect(r.on).toBe(true);
  expect(r.after).toBe(false);
});
