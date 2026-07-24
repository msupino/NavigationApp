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
