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

test('collect includes the flight profile and AI choices but excludes credentials', async ({ page }) => {
  await boot(page);
  const out = await page.evaluate(() => {
    localStorage.setItem('navaid.showDrift', '0');                    // synced (toggle)
    localStorage.setItem('navaid.layer', 'nav');                      // synced
    localStorage.setItem('navaid.ai.key.anthropic', 'sk-ant-abc');   // device-local secret
    localStorage.setItem('navaid.ai.provider', 'anthropic');          // synced
    localStorage.setItem('navaid.ai.model.anthropic', 'claude-3-5'); // synced
    localStorage.setItem('navaid.fpl.pic', 'Test Pilot');             // synced profile
    localStorage.setItem('navaid.fpl.license', '123456');             // synced profile
    localStorage.setItem('navaid.fpl.aisEmail', 'other@example.com'); // excluded routing
    localStorage.setItem('navaid.ai.baseUrl', 'https://x.com');       // excluded — routing
    localStorage.setItem('navaid.ai.panelPos', '10,20');              // excluded — geometry
    localStorage.setItem('navaid.inspPos', '10,20');                  // device-local
    localStorage.setItem('navaid.route', '{"waypoints":[]}');         // route lib covers this
    localStorage.setItem('navaid.sec.build', '1');                    // toolbar state, device-local
    return collectSyncableSettings();
  });
  expect(out['navaid.showDrift']).toBe('0');
  expect(out['navaid.layer']).toBe('nav');
  expect(out['navaid.ai.key.anthropic']).toBeUndefined();
  expect(out['navaid.ai.provider']).toBe('anthropic');
  expect(out['navaid.ai.model.anthropic']).toBe('claude-3-5');
  expect(out['navaid.fpl.pic']).toBe('Test Pilot');
  expect(out['navaid.fpl.license']).toBe('123456');
  expect(out['navaid.fpl.aisEmail']).toBeUndefined();
  expect(out['navaid.ai.baseUrl']).toBeUndefined();
  expect(out['navaid.ai.panelPos']).toBeUndefined();
  expect(out['navaid.inspPos']).toBeUndefined();
  expect(out['navaid.route']).toBeUndefined();
  expect(out['navaid.sec.build']).toBeUndefined();
});

test('the allowlist contains AI choices but not credentials, baseUrl or panel geometry', async ({ page }) => {
  await boot(page);
  const keys = await page.evaluate(() => window.GDRIVE_SETTINGS_KEYS);
  expect(keys).toContain('navaid.ai.provider');
  expect(keys.some(k => k.startsWith('navaid.ai.key.'))).toBe(false);
  expect(keys).toContain('navaid.ai.model.anthropic');
  expect(keys).not.toContain('navaid.ai.baseUrl');
  expect(keys.some(k => /Pos$/.test(k))).toBe(false);
  expect(keys).toContain('navaid.layer');
  expect(keys).toContain('navaid.showCircuit');
});

test('apply writes allowlisted keys and ignores foreign keys in the blob', async ({ page }) => {
  await boot(page);
  const out = await page.evaluate(() => {
    const changed = applySyncableSettings({
      'navaid.showMsa': '1',                      // allowlisted → applied
      'navaid.ai.key.anthropic': 'sk-synced',     // credential → ignored
      'navaid.ai.baseUrl': 'https://evil.com',    // not allowlisted → ignored
      'navaid.evilKey': 'boom',                   // foreign → ignored
    });
    return {
      changed,
      msa: localStorage.getItem('navaid.showMsa'),
      key: localStorage.getItem('navaid.ai.key.anthropic'),
      baseUrl: localStorage.getItem('navaid.ai.baseUrl'),
      evil: localStorage.getItem('navaid.evilKey'),
    };
  });
  expect(out.changed).toBe(true);
  expect(out.msa).toBe('1');
  expect(out.key).toBeNull();
  expect(out.baseUrl).toBeNull();
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

test('the opt-in names the personal data it uploads, before it is ticked', async ({ page }) => {
  await boot(page);
  await page.waitForFunction(() => typeof showRouteLibraryModal === 'function' && gdriveConfigured());
  await page.evaluate(() => showRouteLibraryModal());
  const hint = page.locator('.route-library-gdrive-pii');
  // Visible with the box still UNticked: what it would upload is what decides the tick.
  await expect(page.locator('.route-library-gdrive-settings input')).not.toBeChecked();
  await expect(hint).toBeVisible();
  const txt = (await hint.textContent()) || '';
  // "settings" reads as preferences; the licence number is the word that corrects that.
  expect(txt.toLowerCase()).toContain('licence');
  expect(txt).toMatch(/stay on this device/i);
  await page.locator('.route-library-gdrive-settings input').check();
  await expect(hint).toBeVisible();            // and it does not vanish once ticked
});

test('the upload disclosure is translated, not left in English', async ({ page }) => {
  await page.goto('?lang=he');
  await page.waitForFunction(() => typeof showRouteLibraryModal === 'function' && gdriveConfigured());
  await page.evaluate(() => showRouteLibraryModal());
  const txt = (await page.locator('.route-library-gdrive-pii').textContent()) || '';
  expect(txt).toMatch(/[\u0590-\u05FF]/);      // Hebrew present
  expect(txt).toContain('רישיון');              // and it still names the licence
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

test('a snapshot key this build no longer syncs is not read as a local edit', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(() => {
    // A snapshot written by an OLDER build: same values for every key this build syncs,
    // plus one key that has since been dropped from the allowlist (navaid.fpl.aisEmail was,
    // and navaid.showCommChange was before it -- removing one is a normal event).
    localStorage.setItem('navaid.layer', 'nav');
    const snap = Object.assign({}, collectSyncableSettings(),
      { 'navaid.fpl.aisEmail': 'ops@example.com', 'navaid.gone.forever': '1' });
    localStorage.setItem('navaid.settingsSnapshot', JSON.stringify(snap));
    localStorage.setItem('navaid.settingsSyncedAt', '500');
    const local = _localSettingsBlob(1000);
    const remote = { updatedAt: 1000, values: collectSyncableSettings() };
    return {
      changed: local.changedLocally,
      updatedAt: local.updatedAt,
      winner: mergeSettings({ updatedAt: local.updatedAt, values: local.values }, remote).winner,
    };
  });
  // Compared per CURRENT allowlist key: the extra keys are invisible, so this device made
  // no edit. A raw JSON string compare called it an edit, stamped above the remote and
  // pushed pre-upgrade values over a peer's newer ones -- once per upgraded device.
  expect(r.changed).toBe(false);
  expect(r.updatedAt).toBe(500);
  expect(r.winner).toBe('remote');
});

test('a real edit is still detected when the snapshot also carries a dropped key', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(() => {
    localStorage.setItem('navaid.layer', 'nav');
    const snap = Object.assign({}, collectSyncableSettings(),
      { 'navaid.layer': 'heli', 'navaid.fpl.aisEmail': 'ops@example.com' });
    localStorage.setItem('navaid.settingsSnapshot', JSON.stringify(snap));
    localStorage.setItem('navaid.settingsSyncedAt', '500');
    const local = _localSettingsBlob(1000);
    return { changed: local.changedLocally, updatedAt: local.updatedAt };
  });
  expect(r.changed).toBe(true);                 // navaid.layer really did change
  expect(r.updatedAt).toBeGreaterThan(1000);
});

test('a key ADDED to the allowlist is not read as a local edit either', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(() => {
    // The mirror image of the removal case: after a release ADDS an allowlist key, a device
    // that already had that value in localStorage has it in `values` and absent from its
    // older snapshot. Simulated by deleting a key from the snapshot the other way round.
    localStorage.setItem('navaid.layer', 'nav');
    const snap = collectSyncableSettings();
    delete snap['navaid.layer'];                       // as if 'navaid.layer' were new
    localStorage.setItem('navaid.settingsSnapshot', JSON.stringify(snap));
    // ...and the snapshot says so: it was written against an allowlist without that key.
    localStorage.setItem('navaid.settingsSnapKeys',
      JSON.stringify(GDRIVE_SETTINGS_KEYS.filter(k => k !== 'navaid.layer')));
    localStorage.setItem('navaid.settingsSyncedAt', '500');
    const local = _localSettingsBlob(1000);
    const remote = { updatedAt: 1000, values: collectSyncableSettings() };
    return {
      changed: local.changedLocally,
      updatedAt: local.updatedAt,
      winner: mergeSettings({ updatedAt: local.updatedAt, values: local.values }, remote).winner,
      // ...and the value is still published, so the new key does reach the blob.
      published: local.values['navaid.layer'],
    };
  });
  expect(r.changed).toBe(false);
  expect(r.updatedAt).toBe(500);
  expect(r.winner).toBe('remote');
  expect(r.published).toBe('nav');
});

test('a key deleted since the last sync is still a local edit', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(() => {
    // The snapshot HAS an opinion about this key and we no longer have it: a real deletion,
    // which must still win so the tombstone reaches the other devices.
    localStorage.removeItem('navaid.layer');
    const snap = Object.assign({}, collectSyncableSettings(), { 'navaid.layer': 'heli' });
    localStorage.setItem('navaid.settingsSnapshot', JSON.stringify(snap));
    localStorage.setItem('navaid.settingsSyncedAt', '500');
    const local = _localSettingsBlob(1000);
    return { changed: local.changedLocally, updatedAt: local.updatedAt };
  });
  expect(r.changed).toBe(true);
  expect(r.updatedAt).toBeGreaterThan(1000);
});

test('setting something for the FIRST time since the last sync is a local edit', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(() => {
    // The key was already syncable and simply had no value, so the snapshot has no entry for
    // it -- byte-identical in the values to "the allowlist gained this key". Only the
    // recorded key list tells them apart, and getting it wrong loses the pilot's setting:
    // the newer remote wins, then the parity write absorbs the local value into the
    // snapshot, so it is never uploaded and never would be.
    localStorage.removeItem('navaid.layer');
    const snap = collectSyncableSettings();            // no navaid.layer in it
    localStorage.setItem('navaid.settingsSnapshot', JSON.stringify(snap));
    localStorage.setItem('navaid.settingsSnapKeys', JSON.stringify(GDRIVE_SETTINGS_KEYS));
    localStorage.setItem('navaid.settingsSyncedAt', '500');
    localStorage.setItem('navaid.layer', 'nav');       // the pilot's first choice
    const local = _localSettingsBlob(1000);
    const remote = { updatedAt: 1000, values: { 'navaid.layer': 'heli' } };
    return { changed: local.changedLocally, updatedAt: local.updatedAt,
      winner: mergeSettings({ updatedAt: local.updatedAt, values: local.values }, remote).winner };
  });
  expect(r.changed).toBe(true);
  expect(r.updatedAt).toBeGreaterThan(1000);
  expect(r.winner).toBe('local');
});

test('a completed sync records the allowlist its snapshot covered', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(() => {
    localStorage.removeItem('navaid.settingsSnapKeys');
    _recordSettingsSynced(collectSyncableSettings(), 1234);
    const raw = localStorage.getItem('navaid.settingsSnapKeys');
    const parsed = JSON.parse(raw || 'null');
    return { isArray: Array.isArray(parsed), same: JSON.stringify(parsed) === JSON.stringify(GDRIVE_SETTINGS_KEYS) };
  });
  expect(r).toEqual({ isArray: true, same: true });
});

test('a refused key-list write leaves no stale list beside a fresh snapshot', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(() => {
    // The list is written AFTER the snapshot and its failure is tolerated -- but a list left
    // over from an EARLIER sync would describe the wrong snapshot, and the detector would
    // skip a real edit as "not syncable then".
    localStorage.setItem('navaid.settingsSnapKeys', JSON.stringify(['navaid.layer']));
    const realSet = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) {
      if (k === 'navaid.settingsSnapKeys') throw new Error('QuotaExceededError');
      return realSet.call(this, k, v);
    };
    let threw = false;
    try { _recordSettingsSynced(collectSyncableSettings(), 4321); } catch (e) { threw = true; }
    Storage.prototype.setItem = realSet;
    return { threw, stored: localStorage.getItem('navaid.settingsSnapKeys'),
      snapshot: !!localStorage.getItem('navaid.settingsSnapshot'),
      syncedAt: localStorage.getItem('navaid.settingsSyncedAt') };
  });
  expect(r.threw).toBe(false);          // a refused list is tolerated, never fatal
  expect(r.stored).toBe(null);          // ...and the stale one is gone, not left behind
  expect(r.snapshot).toBe(true);        // the snapshot, which matters more, was written
  expect(r.syncedAt).toBe('4321');
});

test('a snapshot with no key list is adopted once, then read exactly', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(() => {
    // A baseline from a build before the key list existed. It cannot say whether a key it
    // lacks was unsyncable then or simply unset, and neither the values nor the remote can
    // recover that -- asking the remote resolved a peer's DELETION as "not an edit" and
    // erased a value the pilot had just typed. So the baseline is adopted instead: values we
    // hold for keys it lacks are taken into it, as if they had been synced.
    localStorage.removeItem('navaid.settingsSnapKeys');
    localStorage.setItem('navaid.layer', 'heli');
    const snap = collectSyncableSettings();
    delete snap['navaid.layer'];
    localStorage.setItem('navaid.settingsSnapshot', JSON.stringify(snap));
    localStorage.setItem('navaid.settingsSyncedAt', '500');

    const first = _localSettingsBlob(1000);
    const adoptedSnap = JSON.parse(localStorage.getItem('navaid.settingsSnapshot'));
    const listed = JSON.parse(localStorage.getItem('navaid.settingsSnapKeys') || 'null');
    // Nothing is claimed as an edit on the strength of a baseline that cannot say...
    const afterAdopt = { changed: first.changedLocally, updatedAt: first.updatedAt };
    // ...and from here on the baseline is exact: the SAME key changing IS an edit.
    localStorage.setItem('navaid.layer', 'cvfr');
    const second = _localSettingsBlob(1000);
    return { afterAdopt, adopted: adoptedSnap['navaid.layer'],
      listedIsFull: Array.isArray(listed) && listed.length === GDRIVE_SETTINGS_KEYS.length,
      changedAfter: second.changedLocally, updatedAtAfter: second.updatedAt };
  });
  expect(r.afterAdopt).toEqual({ changed: false, updatedAt: 500 });
  expect(r.adopted).toBe('heli');          // taken into the baseline, not published over
  expect(r.listedIsFull).toBe(true);       // ...and the baseline now describes itself
  expect(r.changedAfter).toBe(true);       // a real later edit is detected exactly
  expect(r.updatedAtAfter).toBeGreaterThan(1000);
});

test('an unparseable snapshot lets the newer remote heal this device', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(() => {
    localStorage.setItem('navaid.layer', 'nav');
    localStorage.setItem('navaid.settingsSnapshot', '{not json');
    localStorage.setItem('navaid.settingsSyncedAt', '500');
    const local = _localSettingsBlob(1000);
    return { changed: local.changedLocally, updatedAt: local.updatedAt,
      winner: mergeSettings({ updatedAt: local.updatedAt, values: local.values },
        { updatedAt: 1000, values: { 'navaid.layer': 'heli' } }).winner };
  });
  // A baseline that will not parse proves nothing, so it must not outrank a newer remote:
  // claiming an edit there overwrote a peer's values AND dropped peer-only keys from the blob
  // entirely -- there is no snapshot to tombstone them from, so a third device lost them too.
  expect(r.changed).toBe(false);
  expect(r.updatedAt).toBe(500);
  expect(r.winner).toBe('remote');
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
  expect(r.threw).toMatch(/could not store the settings/i);   // surfaced, not swallowed
  expect(r.aircraft).toBeNull();                     // the write really did fail
});

test('a failed snapshot write clears the baseline instead of throwing', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(() => {
    localStorage.setItem('navaid.settingsSnapshot', '{"navaid.layer":"nav"}');
    localStorage.setItem('navaid.settingsSyncedAt', '5000');
    const orig = Storage.prototype.setItem;
    let threw = null;
    Storage.prototype.setItem = function (k, v) {
      if (k === 'navaid.settingsSnapshot') throw new Error('quota');
      return orig.call(this, k, v);
    };
    try { _recordSettingsSynced({ 'navaid.layer': 'heli' }, 9000); }
    catch (e) { threw = e.message; } finally { Storage.prototype.setItem = orig; }
    return {
      threw,
      snap: localStorage.getItem('navaid.settingsSnapshot'),
      at: localStorage.getItem('navaid.settingsSyncedAt'),
    };
  });
  // Throwing here would leave storage applied but the app un-reloaded. Instead the
  // snapshot is dropped while syncedAt is KEPT: that marks the device "synced, but
  // no baseline" rather than "brand new", so the next sync ranks by the stamp
  // instead of re-running the first-sync union (and its prompt) against the blob
  // this device just uploaded.
  expect(r.threw).toBeNull();
  expect(r.snap).toBeNull();
  expect(r.at).toBe('9000');
});

test('the snapshot is written in canonical allowlist order', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(() => {
    localStorage.setItem('navaid.layer', 'nav');
    localStorage.setItem('navaid.showMsa', '1');
    // Record with the keys in the WRONG order (what Object.assign produced).
    _recordSettingsSynced({ 'navaid.showMsa': '1', 'navaid.layer': 'nav' }, 1234);
    const snap = localStorage.getItem('navaid.settingsSnapshot');
    return { snap, live: JSON.stringify(collectSyncableSettings()) };
  });
  // Must match collectSyncableSettings() byte-for-byte, or every later sync reads a
  // phantom local edit and pushes over a newer remote.
  expect(r.snap).toBe(r.live);
});

test('a rejected write is rolled back, leaving nothing half-applied', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(() => {
    localStorage.setItem('navaid.layer', 'nav');
    localStorage.removeItem('navaid.aircraft');
    const orig = Storage.prototype.setItem;
    let threw = null;
    Storage.prototype.setItem = function (k, v) {
      if (k === 'navaid.aircraft') throw new Error('quota');
      return orig.call(this, k, v);
    };
    try {
      applySyncableSettings({ 'navaid.layer': 'heli', 'navaid.aircraft': '{"reg":"4X"}' });
    } catch (e) { threw = e.message; } finally { Storage.prototype.setItem = orig; }
    return { threw, layer: localStorage.getItem('navaid.layer') };
  });
  expect(r.threw).toMatch(/could not store the settings/i);
  expect(r.layer).toBe('nav');       // the successful write was undone, not kept
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

// --- end-to-end pass over a stubbed Drive -----------------------------------
// The helpers above are unit-tested, but the ~90 lines that WIRE them together
// (the first-sync union, resolveFirstConflict, the parity short-circuit) had no
// coverage at all. Stub the three Drive endpoints and drive _gdriveSyncSettingsOnce
// for real. The invariant that matters: after a union push, the snapshot must equal
// JSON.stringify(collectSyncableSettings()) — otherwise every later sync reports a
// phantom local edit and pushes over a newer remote.
async function stubDrive(page, remoteBlob) {
  await page.route(/googleapis\.com\/drive\/v3\/files\?/, r =>
    r.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ files: remoteBlob
        ? [{ id: 'f1', name: 'navaid-settings.json', modifiedTime: '2026-01-01T00:00:00Z', version: '7' }]
        : [] }) }));
  await page.route(/drive\/v3\/files\/f1\?alt=media/, r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(remoteBlob) }));
  await page.route(/drive\/v3\/files\/f1\?fields=/, r =>
    r.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ version: '7', modifiedTime: '2026-01-01T00:00:00Z' }) }));
  await page.route(/upload\/drive\/v3\/files/, async r => {
    await page.evaluate(body => { window.__uploaded = JSON.parse(body); },
      r.request().postData() || '{}');
    r.fulfill({ status: 200, contentType: 'application/json', body: '{"id":"f1"}' });
  });
}

async function bootSync(page, remoteBlob) {
  await stubDrive(page, remoteBlob);
  await page.goto('?lang=en');
  await page.waitForFunction(() => typeof _gdriveSyncSettingsOnce === 'function');
  await page.evaluate(() => {
    window.__uploaded = null;
    window.gdriveHeaders = () => ({ Authorization: 'Bearer test' });
  });
}

test('first sync unions per key and leaves a snapshot that matches collect()', async ({ page }) => {
  await bootSync(page, { updatedAt: 1000, values: { 'navaid.showMsa': '1', 'navaid.layer': 'nav' } });
  const r = await page.evaluate(async () => {
    localStorage.removeItem('navaid.settingsSnapshot');
    localStorage.removeItem('navaid.settingsSyncedAt');
    localStorage.removeItem('navaid.showMsa');          // only remote has this
    localStorage.setItem('navaid.layer', 'heli');       // both have it, DIFFERENT
    const res = await _gdriveSyncSettingsOnce(() => 'local');   // keep this device
    return {
      res,
      layer: localStorage.getItem('navaid.layer'),
      msa: localStorage.getItem('navaid.showMsa'),
      uploaded: window.__uploaded,
      snap: localStorage.getItem('navaid.settingsSnapshot'),
      live: JSON.stringify(collectSyncableSettings()),
    };
  });
  expect(r.layer).toBe('heli');                 // local kept on the conflict
  expect(r.msa).toBe('1');                      // remote filled the gap
  expect(r.uploaded.values['navaid.layer']).toBe('heli');
  expect(r.uploaded.values['navaid.showMsa']).toBe('1');
  expect(r.uploaded.updatedAt).toBeGreaterThan(1000);   // monotonic
  expect(r.snap).toBe(r.live);                  // the invariant
});

test('first sync honours "take Drive" and applies the remote values', async ({ page }) => {
  await bootSync(page, { updatedAt: 1000, values: { 'navaid.layer': 'nav' } });
  const r = await page.evaluate(async () => {
    localStorage.removeItem('navaid.settingsSnapshot');
    localStorage.removeItem('navaid.settingsSyncedAt');
    localStorage.setItem('navaid.layer', 'heli');
    const res = await _gdriveSyncSettingsOnce(() => 'remote');
    return { applied: res.applied, layer: localStorage.getItem('navaid.layer'),
      snap: localStorage.getItem('navaid.settingsSnapshot'),
      live: JSON.stringify(collectSyncableSettings()) };
  });
  expect(r.applied).toBe(true);
  expect(r.layer).toBe('nav');                  // Drive won, as asked
  expect(r.snap).toBe(r.live);
});

test('a dismissed first-sync prompt changes nothing on either side', async ({ page }) => {
  await bootSync(page, { updatedAt: 1000, values: { 'navaid.layer': 'nav' } });
  const r = await page.evaluate(async () => {
    localStorage.removeItem('navaid.settingsSnapshot');
    localStorage.removeItem('navaid.settingsSyncedAt');
    localStorage.setItem('navaid.layer', 'heli');
    const res = await _gdriveSyncSettingsOnce(() => 'abort');
    return { res, layer: localStorage.getItem('navaid.layer'), uploaded: window.__uploaded,
      snap: localStorage.getItem('navaid.settingsSnapshot') };
  });
  expect(r.res.skipped).toBe(true);
  expect(r.res.needsChoice).toContain('navaid.layer');
  expect(r.layer).toBe('heli');        // local untouched
  expect(r.uploaded).toBeNull();       // nothing pushed
  expect(r.snap).toBeNull();           // still unseeded — the user can choose later
});

test('an unchanged established device writes nothing when the remote already matches', async ({ page }) => {
  await bootSync(page, null);
  const r = await page.evaluate(async () => {
    localStorage.setItem('navaid.layer', 'nav');
    const values = collectSyncableSettings();
    localStorage.setItem('navaid.settingsSnapshot', JSON.stringify(values));
    localStorage.setItem('navaid.settingsSyncedAt', '4000');
    // Re-stub with a remote identical to local at the same stamp.
    window.__remoteEcho = { updatedAt: 4000, values };
    return { values };
  });
  // Point the download stub at the echo blob and re-run.
  await page.route(/drive\/v3\/files\?/, rt =>
    rt.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ files: [{ id: 'f1', name: 'navaid-settings.json', version: '7' }] }) }));
  await page.route(/drive\/v3\/files\/f1\?alt=media/, async rt => {
    const blob = await page.evaluate(() => window.__remoteEcho);
    rt.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(blob) });
  });
  const out = await page.evaluate(async () => {
    window.__uploaded = null;
    const res = await _gdriveSyncSettingsOnce();
    return { res, uploaded: window.__uploaded };
  });
  expect(out.res.applied).toBe(false);
  expect(out.uploaded).toBeNull();     // parity → no PATCH (used to overwrite the peer)
  expect(r.values['navaid.layer']).toBe('nav');
});

test('an established device removes legacy credentials but preserves the flight profile', async ({ page }) => {
  await bootSync(page, {
    updatedAt: 5000,
    values: {
      'navaid.layer': null,
      'navaid.ai.key.anthropic': 'legacy-secret',
      'navaid.fpl.pic': 'Legacy Pilot',
      'navaid.fpl.cell': '0500000000',
    },
  });
  const out = await page.evaluate(async () => {
    localStorage.setItem('navaid.layer', 'nav');
    const values = collectSyncableSettings();
    localStorage.setItem('navaid.settingsSnapshot', JSON.stringify(values));
    localStorage.setItem('navaid.settingsSnapKeys', JSON.stringify(GDRIVE_SETTINGS_KEYS));
    localStorage.setItem('navaid.settingsSyncedAt', '4000');
    const res = await _gdriveSyncSettingsOnce();
    return { res, uploaded: window.__uploaded };
  });
  expect(out.res.applied).toBe(true);
  expect(out.uploaded.updatedAt).toBeGreaterThan(5000);
  expect(out.uploaded.values['navaid.layer']).toBeNull();
  expect(Object.keys(out.uploaded.values).some(k => k.startsWith('navaid.ai.key.'))).toBe(false);
  expect(out.uploaded.values['navaid.fpl.pic']).toBe('Legacy Pilot');
  expect(out.uploaded.values['navaid.fpl.cell']).toBe('0500000000');
});
