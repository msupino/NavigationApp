/* NavAid — optional Google Drive sync for the saved-route library (#677).
 *
 * Fully client-side: Google Identity Services (token flow) + the Drive REST
 * API from the browser. No backend. Routes are stored as a single JSON file
 * in the per-app hidden folder (scope `drive.appdata`) — a non-sensitive
 * scope, so no Google app-verification is required and the app can never see
 * the user's other files.
 *
 * Offline-first: localStorage (navaid.routes) stays the source of truth; Drive
 * is an opt-in mirror. Nothing here runs or loads any Google code until the
 * user clicks "Connect Google Drive".
 *
 * SETUP: create an OAuth 2.0 *Web* client ID in Google Cloud Console, add the
 * deployed origin(s) to "Authorized JavaScript origins", and paste the ID
 * below (or set window.NAVAID_GDRIVE_CLIENT_ID before this script loads). The
 * client ID is public by design. Until it is set, the Drive UI stays hidden.
 */
var GDRIVE_CLIENT_ID = (typeof window !== 'undefined' && window.NAVAID_GDRIVE_CLIENT_ID) ||
  '1027636470762-lcnmpfmk4ef9rff2be3kg6qfd25vg7q1.apps.googleusercontent.com';
const GDRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
const GDRIVE_FILE = 'navaid-routes.json';
const GIS_SRC = 'https://accounts.google.com/gsi/client';

let _gdriveToken = null;        // { access_token, expiry } in memory only
let _gdriveTokenClient = null;
let _gisLoading = null;

function gdriveConfigured() {
  return typeof GDRIVE_CLIENT_ID === 'string' && GDRIVE_CLIENT_ID.length > 0;
}
function gdriveConnected() {
  return !!(_gdriveToken && _gdriveToken.access_token &&
    _gdriveToken.expiry > Date.now() + 5000);
}

// Lazy-load the Google Identity Services script (only on first connect).
function loadGis() {
  if (typeof google !== 'undefined' && google.accounts && google.accounts.oauth2) {
    return Promise.resolve();
  }
  if (_gisLoading) return _gisLoading;
  _gisLoading = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = GIS_SRC;
    s.async = true;
    s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Failed to load Google Identity Services'));
    document.head.appendChild(s);
  });
  return _gisLoading;
}

// Request an access token. `prompt:''` lets Google issue one silently when the
// user is already signed in and has consented; otherwise it shows consent.
function gdriveRequestToken(interactive) {
  return loadGis().then(() => new Promise((resolve, reject) => {
    if (!_gdriveTokenClient) {
      _gdriveTokenClient = google.accounts.oauth2.initTokenClient({
        client_id: GDRIVE_CLIENT_ID,
        scope: GDRIVE_SCOPE,
        callback: () => {},   // replaced per-request below
      });
    }
    _gdriveTokenClient.callback = (resp) => {
      if (resp && resp.access_token) {
        _gdriveToken = {
          access_token: resp.access_token,
          expiry: Date.now() + (Number(resp.expires_in || 3600) * 1000),
        };
        resolve(_gdriveToken);
      } else {
        reject(new Error((resp && resp.error) || 'No access token'));
      }
    };
    _gdriveTokenClient.requestAccessToken({ prompt: interactive ? 'consent' : '' });
  }));
}

// --- native (Capacitor APK) sign-in --------------------------------------
// Google BLOCKS OAuth inside WebViews (disallowed_useragent) and the GIS token
// popup can't open there, so the browser flow above is dead in the APK. The
// @capgo/capacitor-social-login plugin runs the platform's native Google
// Sign-In instead and returns an access token for the requested Drive scope.
// Requires an Android OAuth client (package + signing SHA-1) registered in the
// same Google Cloud project as GDRIVE_CLIENT_ID.
function _nativeSocialLogin() {
  const C = typeof window !== 'undefined' && window.Capacitor;
  return (C && typeof C.isNativePlatform === 'function' && C.isNativePlatform() &&
    C.Plugins && C.Plugins.SocialLogin) || null;
}
let _nativeSlInit = null;
function gdriveNativeToken() {
  const SL = _nativeSocialLogin();
  if (!SL) return Promise.reject(new Error('native sign-in unavailable'));
  if (!_nativeSlInit) {
    _nativeSlInit = SL.initialize({
      google: { webClientId: GDRIVE_CLIENT_ID, mode: 'online' },
    }).catch(e => { _nativeSlInit = null; throw e; });
  }
  return _nativeSlInit
    .then(() => SL.login({
      provider: 'google',
      options: { scopes: [GDRIVE_SCOPE] },
    }))
    .then(res => {
      const r = (res && res.result) || res || {};
      const tok = (r.accessToken && (r.accessToken.token || r.accessToken)) ||
        r.access_token || null;
      if (!tok || typeof tok !== 'string') throw new Error('No access token');
      _gdriveToken = { access_token: tok, expiry: Date.now() + 55 * 60 * 1000 };
      return _gdriveToken;
    });
}

function gdriveConnect(interactive) {
  if (!gdriveConfigured()) {
    return Promise.reject(new Error('Google Drive is not configured'));
  }
  if (gdriveConnected()) return Promise.resolve(_gdriveToken);
  if (_nativeSocialLogin()) return gdriveNativeToken();
  return gdriveRequestToken(interactive !== false);
}

function gdriveDisconnect() {
  const tok = _gdriveToken && _gdriveToken.access_token;
  _gdriveToken = null;
  const SL = _nativeSocialLogin();
  if (SL) { try { SL.logout({ provider: 'google' }); } catch (e) { /* */ } }
  if (tok && typeof google !== 'undefined' && google.accounts && google.accounts.oauth2) {
    try { google.accounts.oauth2.revoke(tok); } catch (e) { /* */ }
  }
}

function gdriveHeaders() {
  return { Authorization: 'Bearer ' + _gdriveToken.access_token };
}

// Locate the library file in the app-data folder (null if none yet).
function gdriveFindFile() {
  const q = encodeURIComponent("name='" + GDRIVE_FILE + "'");
  const url = 'https://www.googleapis.com/drive/v3/files?spaces=appDataFolder' +
    '&fields=files(id,name,modifiedTime)&q=' + q;
  return fetch(url, { headers: gdriveHeaders() })
    .then(r => { if (!r.ok) throw new Error('Drive list failed: ' + r.status); return r.json(); })
    .then(j => (j.files && j.files[0]) || null);
}

function gdriveDownload(fileId) {
  return fetch('https://www.googleapis.com/drive/v3/files/' + fileId + '?alt=media',
    { headers: gdriveHeaders() })
    .then(r => { if (!r.ok) throw new Error('Drive download failed: ' + r.status); return r.json(); })
    // A non-array means the remote file is corrupt/foreign. Abort the sync
    // rather than treating it as [] — merging [] then uploading would silently
    // overwrite every route that lived only on Drive.
    .then(j => { if (!Array.isArray(j)) throw new Error('Drive file is not a route array'); return j; });
}

// Create or overwrite the library file with the given array.
function gdriveUpload(fileId, library) {
  const body = JSON.stringify(library);
  if (fileId) {
    return fetch('https://www.googleapis.com/upload/drive/v3/files/' + fileId +
      '?uploadType=media', {
      method: 'PATCH',
      headers: Object.assign(gdriveHeaders(), { 'Content-Type': 'application/json' }),
      body,
    }).then(r => { if (!r.ok) throw new Error('Drive update failed: ' + r.status); return r.json(); });
  }
  const meta = { name: GDRIVE_FILE, parents: ['appDataFolder'] };
  const boundary = 'navaid' + Date.now();
  const multipart =
    '--' + boundary + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' +
    JSON.stringify(meta) + '\r\n' +
    '--' + boundary + '\r\nContent-Type: application/json\r\n\r\n' +
    body + '\r\n--' + boundary + '--';
  return fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart' +
    '&fields=id', {
    method: 'POST',
    headers: Object.assign(gdriveHeaders(),
      { 'Content-Type': 'multipart/related; boundary=' + boundary }),
    body: multipart,
  }).then(r => { if (!r.ok) throw new Error('Drive create failed: ' + r.status); return r.json(); });
}

// Merge two route-library arrays by id, keeping the newer savedAt on conflict.
// Pure + testable; no network. Entries without an id are kept as-is (deduped
// by a name+savedAt signature so repeated syncs don't pile up duplicates).
//
// Deletes are represented as TOMBSTONES: an entry with `deleted: true` (no
// `data`) and the deletion timestamp in `savedAt`. Because conflicts resolve
// newest-savedAt-wins, a tombstone (deleted after the route was last saved)
// beats the route on every device — so deletes propagate instead of being
// resurrected by the union. Stale tombstones (older than 90 days) are pruned.
const ROUTE_TOMBSTONE_TTL_MS = 90 * 24 * 60 * 60 * 1000;
function mergeRouteLibraries(a, b) {
  const byId = new Map();
  const sigSeen = new Set();
  const out = [];
  const take = (entry) => {
    // keep routes (data), GPS tracks (track), and tombstones (deleted)
    const isTrack = entry && entry.kind === 'gps' && Array.isArray(entry.track) && entry.track.length;
    if (!entry || (!entry.data && !entry.deleted && !isTrack)) return;
    const sig = (entry.name || '') + '|' + (entry.savedAt || '');
    if (entry.id) {
      const prev = byId.get(entry.id);
      if (!prev) { byId.set(entry.id, entry); out.push(entry); return; }
      // Replace in place if this one is newer.
      if ((entry.savedAt || '') > (prev.savedAt || '')) {
        const i = out.indexOf(prev);
        if (i >= 0) out[i] = entry;
        byId.set(entry.id, entry);
      }
    } else {
      if (sigSeen.has(sig)) return;
      sigSeen.add(sig);
      out.push(entry);
    }
  };
  (Array.isArray(a) ? a : []).forEach(take);
  (Array.isArray(b) ? b : []).forEach(take);
  // Drop tombstones once they're old enough that every device has synced.
  const cutoff = Date.now() - ROUTE_TOMBSTONE_TTL_MS;
  const pruned = out.filter(e => !(e.deleted && Date.parse(e.savedAt || 0) < cutoff));
  // Newest first.
  pruned.sort((x, y) => (y.savedAt || '').localeCompare(x.savedAt || ''));
  return pruned;
}

// The Drive REST calls throw `... failed: <status>`; detect a token lapse so
// we can re-authenticate and retry once. Only 401 (unauthenticated) — NOT 403,
// which Drive also returns for rate-limit/quota, where dropping a still-valid
// token and forcing an interactive re-auth would be a wrong, surprising retry.
function _isAuthError(err) {
  return /\b401\b/.test(String((err && err.message) || ''));
}

// One merge+upload pass against Drive (assumes a valid token).
function _gdriveSyncOnce() {
  return gdriveFindFile().then(file => {
    const remote = file ? gdriveDownload(file.id) : Promise.resolve([]);
    return remote.then(remoteArr => {
      const local = (typeof loadRouteLibrary === 'function') ? loadRouteLibrary() : [];
      const merged = mergeRouteLibraries(local, remoteArr);
      // Upload FIRST, then write local only after Drive confirms — so a failed
      // upload (expired token, network) leaves local + Drive each unchanged
      // rather than updating local while Drive silently missed the push.
      return gdriveUpload(file && file.id, merged).then(() => {
        window._navaidSyncing = true;   // guard so persistRouteLibrary's auto-sync hook doesn't loop
        try { if (typeof persistRouteLibrary === 'function') persistRouteLibrary(merged); }
        finally { window._navaidSyncing = false; }
        return merged;
      });
    });
  });
}

// Two-way sync: merge local + remote, write the merged set both to localStorage
// and back to Drive. Returns the merged array.
function gdriveSync() {
  // Try a silent token first (returning, already-consented users get no popup);
  // fall back to interactive consent so a first-time user can grant it (the
  // silent prompt:'' can never obtain the initial consent). On native, the
  // first connect is ALREADY an interactive account picker, so don't retry it —
  // that would pop the picker a second time when the user dismisses the first.
  const connect = gdriveConnect(false).catch(err =>
    _nativeSocialLogin() ? Promise.reject(err) : gdriveConnect(true));
  return connect.then(_gdriveSyncOnce).catch(err => {
    // A 401/403 mid-sync means the token lapsed or was revoked (e.g. the native
    // token outlived our conservative expiry estimate). Drop it, re-auth once,
    // and retry — otherwise the whole sync fails and never recovers.
    if (_isAuthError(err)) {
      _gdriveToken = null;
      return gdriveConnect(true).then(_gdriveSyncOnce);
    }
    throw err;
  });
}

// --- optional settings sync (opt-in) --------------------------------------
// A second app-data file mirrors a curated set of *portable* preferences so a
// pilot's display/layer choices follow them across devices. Kept separate from
// the route library (different merge rule) and OFF by default.
//
// EXPLICIT allowlist — new or sensitive keys never sync by accident. Excluded
// on purpose: API tokens (navaid.ai.key.*), device-local panel geometry
// (*Pos), toolbar section state (navaid.sec.*), local-tile flags, and the
// in-progress working route (navaid.route, which the route library already
// covers).
const GDRIVE_SETTINGS_FILE = 'navaid-settings.json';
const GDRIVE_SETTINGS_KEYS = [
  // base layer + page setup
  'navaid.layer', 'navaid.pageSize', 'navaid.pageOrient',
  // display / layer toggles
  'navaid.showAirfields', 'navaid.showVorStations', 'navaid.showNavWP',
  'navaid.showWpNames', 'navaid.showCumTime', 'navaid.showDrift',
  'navaid.showFreqChanges', 'navaid.showCommChange', 'navaid.showMidLeg',
  'navaid.highlightDiff', 'navaid.limitLegKites', 'navaid.showMsa',
  'navaid.showReporting', 'navaid.forceSnap', 'navaid.showReturn',
  'navaid.showNotam', 'navaid.showWind', 'navaid.windField', 'navaid.imsPwx',
  'navaid.sigwxOv', 'navaid.showLsaBubbles', 'navaid.showCircuit',
  'navaid.showTraining', 'navaid.showCvfr', 'navaid.showHeli',
  'navaid.showCommfail',
  // sizes / widths / opacities
  'navaid.legArrowSize', 'navaid.legLineWidth', 'navaid.driftLineWidth',
  'navaid.cvfrOpacity', 'navaid.heliOpacity', 'navaid.circuitOpacity',
  'navaid.plateOpacity', 'navaid.commfailOpacity', 'navaid.mapOpacity.v2',
  // flight-plan columns, aircraft profile, user data corrections
  'navaid.fpColumns', 'navaid.aircraft', 'navaid.airfieldFreqOverrides',
  'navaid.commFreqOverrides', 'navaid.overlayBoundsOverrides',
];
const SETTINGS_ENABLED_KEY = 'navaid.syncSettings';   // '1' when opted in (device-local, never synced)
const SETTINGS_SYNCED_AT_KEY = 'navaid.settingsSyncedAt';
const SETTINGS_SNAP_KEY = 'navaid.settingsSnapshot';

function _lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
function _lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* storage full/blocked */ } }

function settingsSyncEnabled() { return _lsGet(SETTINGS_ENABLED_KEY) === '1'; }
function setSettingsSyncEnabled(on) { _lsSet(SETTINGS_ENABLED_KEY, on ? '1' : '0'); }

// Snapshot of the allowlisted keys currently in localStorage → { key: string }.
function collectSyncableSettings() {
  const out = {};
  for (const k of GDRIVE_SETTINGS_KEYS) {
    const v = _lsGet(k);
    if (v !== null) out[k] = v;
  }
  return out;
}

// Write inbound values back to localStorage — but ONLY allowlisted keys, so a
// foreign/corrupt remote file can never inject arbitrary keys. Returns true if
// anything actually changed.
function applySyncableSettings(values) {
  if (!values || typeof values !== 'object') return false;
  // Some allowlisted toggles are gist-controlled: applyDefaultVisibility only
  // honors the gist while the key is null (non-null = an explicit user choice).
  // Blindly pinning an inbound value that merely equals the current default would
  // freeze this device on it, permanently opting it out of future gist changes.
  // So for those keys we write only genuine deviations; when the inbound value
  // matches the gist default we clear the key, keeping it gist-controlled.
  const gistDefault = {};
  const map = (typeof NavAid === 'object' && NavAid && NavAid.defaultVisibilityMap) || [];
  if (typeof tune === 'function') {
    for (const row of map) gistDefault[row[1]] = tune(row[2]) ? '1' : '0';
  }
  let changed = false;
  for (const k of GDRIVE_SETTINGS_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(values, k)) continue;
    const next = values[k];
    if (typeof next !== 'string') continue;
    if (Object.prototype.hasOwnProperty.call(gistDefault, k) && next === gistDefault[k]) {
      if (_lsGet(k) !== null) { try { localStorage.removeItem(k); } catch (e) { /* */ } changed = true; }
      continue;
    }
    if (_lsGet(k) !== next) { _lsSet(k, next); changed = true; }
  }
  return changed;
}

// Pure last-write-wins on the settings blob {updatedAt:<ms>, values:{}}. Ties
// keep local (this device) so a no-op sync doesn't ping-pong. Testable; no I/O.
function mergeSettings(local, remote) {
  const lt = (local && +local.updatedAt) || 0;
  const rt = (remote && +remote.updatedAt) || 0;
  return rt > lt ? { winner: 'remote', blob: remote } : { winner: 'local', blob: local };
}

// Local blob with a change-detected timestamp: if the current settings differ
// from the snapshot we last synced, they changed on THIS device → stamp now so
// they win; otherwise keep the last synced timestamp so a newer remote wins.
function _localSettingsBlob() {
  const values = collectSyncableSettings();
  const cur = JSON.stringify(values);
  const snap = _lsGet(SETTINGS_SNAP_KEY);
  // A device that has never completed a sync (snapshot unseeded) has no baseline
  // proving its settings are newer than a peer's. Claiming Date.now() here let a
  // fresh device outrank — and overwrite — the very settings it was meant to
  // receive (the exact inverse of the feature). Until the first sync seeds a
  // snapshot, this device's blob carries updatedAt 0, so any real remote wins;
  // only when NO remote exists does it establish the file (stamped at upload).
  const changedLocally = snap !== null && cur !== snap;
  const updatedAt = snap === null ? 0
    : (changedLocally ? Date.now() : (+_lsGet(SETTINGS_SYNCED_AT_KEY) || 0));
  return { values, cur, updatedAt, changedLocally };
}

// Generic app-data helpers (the route ones hard-code the file name + array shape).
function gdriveFindNamed(name) {
  const url = 'https://www.googleapis.com/drive/v3/files?spaces=appDataFolder' +
    '&fields=files(id,name,modifiedTime)&q=' + encodeURIComponent("name='" + name + "'");
  return fetch(url, { headers: gdriveHeaders() })
    .then(r => { if (!r.ok) throw new Error('Drive list failed: ' + r.status); return r.json(); })
    .then(j => (j.files && j.files[0]) || null);
}
function gdriveDownloadJson(fileId) {
  return fetch('https://www.googleapis.com/drive/v3/files/' + fileId + '?alt=media',
    { headers: gdriveHeaders() })
    .then(r => { if (!r.ok) throw new Error('Drive download failed: ' + r.status); return r.json(); });
}
function gdriveUploadJson(fileId, name, obj) {
  const body = JSON.stringify(obj);
  if (fileId) {
    return fetch('https://www.googleapis.com/upload/drive/v3/files/' + fileId + '?uploadType=media', {
      method: 'PATCH',
      headers: Object.assign(gdriveHeaders(), { 'Content-Type': 'application/json' }),
      body,
    }).then(r => { if (!r.ok) throw new Error('Drive update failed: ' + r.status); return r.json(); });
  }
  const meta = { name, parents: ['appDataFolder'] };
  const boundary = 'navaid' + Date.now();
  const multipart =
    '--' + boundary + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' +
    JSON.stringify(meta) + '\r\n' +
    '--' + boundary + '\r\nContent-Type: application/json\r\n\r\n' +
    body + '\r\n--' + boundary + '--';
  return fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id', {
    method: 'POST',
    headers: Object.assign(gdriveHeaders(), { 'Content-Type': 'multipart/related; boundary=' + boundary }),
    body: multipart,
  }).then(r => { if (!r.ok) throw new Error('Drive create failed: ' + r.status); return r.json(); });
}

// One settings sync pass (assumes a valid token — callers connect first).
// Resolves { applied } — true when newer remote settings were written locally.
function _gdriveSyncSettingsOnce() {
  return gdriveFindNamed(GDRIVE_SETTINGS_FILE).then(file => {
    // Do NOT swallow a download error into "no remote": a transient 500/offline
    // blip would make local win and PATCH over the other device's settings. Let
    // it reject so the sync aborts instead of clobbering (same stance the route
    // path takes — throw on a bad read rather than overwrite).
    const remoteP = file ? gdriveDownloadJson(file.id) : Promise.resolve(null);
    return remoteP.then(remote => {
      const local = _localSettingsBlob();
      const localBlob = { updatedAt: local.updatedAt, values: local.values };
      const remoteOk = remote && typeof remote === 'object' && remote.values;
      const { winner } = mergeSettings(localBlob, remoteOk ? remote : null);
      if (winner === 'remote') {
        const changed = applySyncableSettings(remote.values);
        _lsSet(SETTINGS_SNAP_KEY, JSON.stringify(collectSyncableSettings()));
        _lsSet(SETTINGS_SYNCED_AT_KEY, String((+remote.updatedAt) || Date.now()));
        return { applied: changed };
      }
      // Local wins (or no remote): push local up and remember what we synced. A
      // first-ever push (no baseline → updatedAt 0) stamps now so the file it
      // establishes outranks the next fresh device — and so the uploaded blob and
      // our local syncedAt agree (they previously diverged: 0 up, now local).
      const stamp = localBlob.updatedAt || Date.now();
      localBlob.updatedAt = stamp;
      return gdriveUploadJson(file && file.id, GDRIVE_SETTINGS_FILE, localBlob).then(() => {
        _lsSet(SETTINGS_SNAP_KEY, local.cur);
        _lsSet(SETTINGS_SYNCED_AT_KEY, String(stamp));
        return { applied: false };
      });
    });
  });
}

// Two-way settings sync for the manual button: connect (reusing the route
// flow's token), then one pass. Retries once on a token lapse like gdriveSync.
function gdriveSyncSettings() {
  if (!settingsSyncEnabled()) return Promise.resolve({ applied: false, skipped: true });
  const connect = gdriveConnected() ? Promise.resolve()
    : gdriveConnect(false).catch(err => (_nativeSocialLogin() ? Promise.reject(err) : gdriveConnect(true)));
  return connect.then(_gdriveSyncSettingsOnce).catch(err => {
    if (_isAuthError(err)) { _gdriveToken = null; return gdriveConnect(true).then(_gdriveSyncSettingsOnce); }
    throw err;
  });
}

if (typeof window !== 'undefined') {
  window.gdriveConfigured = gdriveConfigured;
  window.gdriveConnected = gdriveConnected;
  window.gdriveConnect = gdriveConnect;
  window.gdriveDisconnect = gdriveDisconnect;
  window.gdriveSync = gdriveSync;
  window.mergeRouteLibraries = mergeRouteLibraries;
  window.settingsSyncEnabled = settingsSyncEnabled;
  window.setSettingsSyncEnabled = setSettingsSyncEnabled;
  window.gdriveSyncSettings = gdriveSyncSettings;
  window.collectSyncableSettings = collectSyncableSettings;
  window.applySyncableSettings = applySyncableSettings;
  window.mergeSettings = mergeSettings;
  window.GDRIVE_SETTINGS_KEYS = GDRIVE_SETTINGS_KEYS;
}
