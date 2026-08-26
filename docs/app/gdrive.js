/* NavAid — optional Google Drive sync for the saved-route library.
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
// Every Drive call goes through here, for two reasons.
//
// A hung socket used to wedge sync for as long as the network kept the connection open with
// nothing on it: fetch has no timeout of its own, so "Syncing…" sat there and the button
// never came back. This aborts and rejects instead.
//
// And the error carries the HTTP status as a NUMBER. The auth retry used to decide whether
// to re-authenticate by matching /401/ against the error's message text, which is one
// reworded string away from either never retrying or retrying on a route named "401".
const DRIVE_TIMEOUT_MS = 20000;
function driveFetch(url, opts, what) {
  const ctl = (typeof AbortController === 'function') ? new AbortController() : null;
  const timer = ctl ? setTimeout(() => ctl.abort(), DRIVE_TIMEOUT_MS) : 0;
  const init = Object.assign({}, opts || {}, ctl ? { signal: ctl.signal } : {});
  return fetch(url, init).then(r => {
    if (timer) clearTimeout(timer);
    if (!r.ok) {
      const err = new Error('Drive ' + what + ' failed: ' + r.status);
      err.status = r.status;
      throw err;
    }
    return r;
  }, e => {
    if (timer) clearTimeout(timer);
    if (e && e.name === 'AbortError') {
      const err = new Error('Drive ' + what + ' timed out after ' + (DRIVE_TIMEOUT_MS / 1000) + 's');
      err.timeout = true;
      throw err;
    }
    throw e;
  });
}

function gdriveFindFile() {
  const q = encodeURIComponent("name='" + GDRIVE_FILE + "'");
  // Deliberately NOT ordered by createdTime: an account that already has two
  // library files would switch to the earliest one, and routes that live only in
  // the newer file would become unreachable from every device. The settings file is
  // new enough to have no such legacy, so only it is ordered (gdriveFindNamed).
  // `version` comes back so a write can check nothing landed between this read and
  // the PATCH -- see gdriveAssertUnchanged. Without it the route library had a
  // read -> merge -> overwrite window in which a second device's upload disappeared.
  const url = 'https://www.googleapis.com/drive/v3/files?spaces=appDataFolder' +
    '&fields=files(id,name,modifiedTime,version)&q=' + q;
  return driveFetch(url, { headers: gdriveHeaders() }, 'list')
    .then(r => r.json())
    .then(j => (j.files && j.files[0]) || null);
}

function gdriveDownload(fileId) {
  return driveFetch('https://www.googleapis.com/drive/v3/files/' + fileId + '?alt=media',
    { headers: gdriveHeaders() }, 'download')
    .then(r => r.json())
    // A non-array means the remote file is corrupt/foreign. Abort the sync
    // rather than treating it as [] — merging [] then uploading would silently
    // overwrite every route that lived only on Drive.
    .then(j => { if (!Array.isArray(j)) throw new Error('Drive file is not a route array'); return j; });
}

// Create or overwrite the library file with the given array.
function gdriveUpload(fileId, library) {
  const body = JSON.stringify(library);
  if (fileId) {
    return driveFetch('https://www.googleapis.com/upload/drive/v3/files/' + fileId +
      '?uploadType=media', {
      method: 'PATCH',
      headers: Object.assign(gdriveHeaders(), { 'Content-Type': 'application/json' }),
      body,
    }, 'update').then(r => r.json());
  }
  const meta = { name: GDRIVE_FILE, parents: ['appDataFolder'] };
  const boundary = 'navaid' + Date.now();
  const multipart =
    '--' + boundary + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' +
    JSON.stringify(meta) + '\r\n' +
    '--' + boundary + '\r\nContent-Type: application/json\r\n\r\n' +
    body + '\r\n--' + boundary + '--';
  return driveFetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart' +
    '&fields=id', {
    method: 'POST',
    headers: Object.assign(gdriveHeaders(),
      { 'Content-Type': 'multipart/related; boundary=' + boundary }),
    body: multipart,
  }, 'create').then(r => r.json());
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
  // The status, when we have it -- driveFetch attaches it. The message match stays as a
  // fallback for errors raised elsewhere, but it is no longer what the decision rests on:
  // matching /401/ against prose is one reworded string away from never retrying, and one
  // route named "401" away from retrying when it should not.
  if (err && typeof err.status === 'number') return err.status === 401;
  return /\b401\b/.test(String((err && err.message) || ''));
}

// One merge+upload pass against Drive (assumes a valid token).
function _gdriveSyncOnce() {
  return gdriveFindFile().then(file => {
    const remote = file ? gdriveDownload(file.id) : Promise.resolve([]);
    // What the file looked like when we read it. Checked again immediately before the
    // PATCH: Drive v3 offers no precondition on a content write, so this narrows the
    // lost-update window from "download + merge" to one request. It does not close it,
    // and aborting is the safe side -- the next sync merges both sides normally, where
    // an overwrite would have taken the other device's routes with it.
    const seen = file && (file.version || file.modifiedTime);
    return remote.then(remoteArr => {
      const local = (typeof loadRouteLibrary === 'function') ? loadRouteLibrary() : [];
      const merged = mergeRouteLibraries(local, remoteArr);
      // Upload FIRST, then write local only after Drive confirms — so a failed
      // upload (expired token, network) leaves local + Drive each unchanged
      // rather than updating local while Drive silently missed the push.
      return gdriveAssertUnchanged(file && file.id, seen)
        .then(() => gdriveUpload(file && file.id, merged)).then(() => {
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
// on purpose: navaid.ai.baseUrl (decides where data is sent — a synced blob
// must not be able to redirect it), device-local panel geometry (*Pos,
// navaid.ai.panelSize), toolbar section state (navaid.sec.*), local-tile
// flags, and the in-progress working route (navaid.route, which the route
// library already covers).
// Provider/model choices and the flight-plan profile are portable. AI credentials and
// fields that choose a data recipient remain device-local.
const GDRIVE_SETTINGS_FILE = 'navaid-settings.json';
const GDRIVE_SETTINGS_KEYS = [
  // base layer + page setup
  'navaid.layer', 'navaid.pageSize', 'navaid.pageOrient',
  // display / layer toggles
  'navaid.showAirfields', 'navaid.showVorStations', 'navaid.showNavWP',
  'navaid.showHotspots2', 'navaid.showWpNames', 'navaid.showCumTime', 'navaid.showDrift',
  'navaid.autoRoute',
  'navaid.showFreqChanges', 'navaid.showMidLeg',
  'navaid.highlightDiff', 'navaid.limitLegKites', 'navaid.showMsa',
  'navaid.showReporting', 'navaid.forceSnap', 'navaid.showReturn',
  'navaid.legDirFilter',
  'navaid.showWind', 'navaid.windField', 'navaid.imsPwx',
  // NOTAM visibility is remembered per chart (see notamPrefKey), so the shared
  // 'navaid.showNotam' this list used to carry is no longer written by anything —
  // syncing it silently stopped carrying the pilot's choice between devices.
  'navaid.showNotam.cvfr', 'navaid.showNotam.lsa', 'navaid.showNotam.heli',
  'navaid.showNotam.ats',
  'navaid.baseLayer',
  'navaid.showNotam.last',
  'navaid.sigwxOv', 'navaid.showLsaBubbles', 'navaid.showCircuit',
  'navaid.showTraining', 'navaid.showCvfr', 'navaid.showHeli',
  'navaid.showCommfail',
  'navaid.showIfr',
  'navaid.showTraffic',
  'navaid.showAirspace',
  // sizes / widths / opacities
  // legLineWidth2, not legLineWidth: the key was bumped to v2 when the slider's
  // range changed, and the old name has not been written since — so this list was
  // syncing a dead key and leaving the live one behind.
  'navaid.legArrowSize', 'navaid.legLineWidth3', 'navaid.driftLineWidth2',
  'navaid.wpSize', 'navaid.legArrowAlpha', 'navaid.yellowAlpha',
  // Colours picked in the Display menu. Written by wireColorPicker with the key
  // passed as an ARGUMENT, which is exactly why the drift guard could not see
  // them and they sat unsynced.
  'navaid.waypointColor', 'navaid.legArrowColor',
  'navaid.trainingOpacity',
  'navaid.cvfrOpacity', 'navaid.heliOpacity', 'navaid.circuitOpacity',
  'navaid.plateOpacity', 'navaid.commfailOpacity', 'navaid.mapOpacity.v2',
  'navaid.wxOpacity',   // one slider fades both the PWX and SIGWX overlays
  // flight-plan columns, aircraft profile, user data corrections
  'navaid.fpColumns', 'navaid.aircraft', 'navaid.airfieldFreqOverrides',
  'navaid.commFreqOverrides', 'navaid.overlayBoundsOverrides',
  // Siblings of the above that were never added: the VOR corrections belong with
  // the other freq overrides, the nav-data source with the base layer, and the
  // cruise/climb numbers with the aircraft profile.
  'navaid.vorFreqOverrides', 'navaid.vorRef', 'navaid.navDataPrefix',
  'navaid.defaultSpeed', 'navaid.profileVS', 'navaid.geTourSpeed',
  // The pilot/aircraft profile follows the user across devices when settings sync is
  // explicitly enabled. The filing destination (aisEmail) stays device-local because it
  // decides where a plan is sent.
  ...['reg', 'type', 'wake', 'equip', 'surv', 'pic', 'license', 'cell',
    'endurance', 'persons', 'kind', 'replyTo',
    'company', 'purpose', 'altField'].map(f => 'navaid.fpl.' + f),
  // AI assistant: active provider and per-provider model. API keys stay on the device.
  // navaid.ai.baseUrl.<provider> excluded — it decides where data is sent.
  // Per PROVIDER now, and still device-local: a synced proxy URL would carry a synced key to
  // a host the other device never agreed to. This allowlist is exact-match, so the new
  // per-provider keys are excluded by construction; that is deliberate, not an oversight.
  // navaid.ai.panelPos/Size excluded — device-local geometry.
  'navaid.ai.provider',
  'navaid.ai.model.gemini',
  'navaid.ai.model.anthropic',
  'navaid.ai.model.openrouter',
  'navaid.ai.model.deepseek',
  'navaid.ai.model.orcarouter',
];
const SETTINGS_ENABLED_KEY = 'navaid.syncSettings';   // '1' when opted in (device-local, never synced)
const SETTINGS_SYNCED_AT_KEY = 'navaid.settingsSyncedAt';
const SETTINGS_SNAP_KEY = 'navaid.settingsSnapshot';
// The allowlist the snapshot above was written against -- see _settingsChangedLocally.
const SETTINGS_SNAPKEYS_KEY = 'navaid.settingsSnapKeys';

function _lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
// Returns false when the write did NOT land (quota/blocked). Callers that record
// sync bookkeeping MUST check it: silently swallowing a failed write let a
// partially-applied sync be recorded as full parity, which then pushed the stale
// value back over the authoring device.
function _lsSet(k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } }
function _lsDel(k) { try { localStorage.removeItem(k); return true; } catch (e) { return false; } }

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
//
// Three inbound states per key, and the distinction matters:
//   string  → an explicit value on the author's device; pin it here too.
//   null    → a TOMBSTONE: the key is gone on the author's device, so delete it
//             here. For a plain setting that is a real deletion; for a
//             gist-controlled toggle it means "the author is following the gist",
//             and clearing the key puts this device back under gist control too
//             (applyDefaultVisibility only honors the gist while the key is null).
//             One mechanism, and it is symmetric — the previous code cleared a
//             key whenever the inbound value merely EQUALED the local gist
//             default while the sender kept its pin, so an explicit choice that
//             coincided with today's default was erased on the receiver and the
//             two devices diverged for good once the gist default flipped.
//   absent  → no information (an older blob, written before tombstones); skip.
//
// Throws if any write was rejected (quota), so the caller aborts BEFORE recording
// parity rather than remembering a partial apply as complete.
function applySyncableSettings(values) {
  if (!values || typeof values !== 'object') return false;
  let changed = false;
  const failed = [];
  const undo = [];               // [key, previousValue|null] for rollback
  for (const k of GDRIVE_SETTINGS_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(values, k)) continue;
    const next = values[k];
    const prev = _lsGet(k);
    if (next === null) {
      if (prev !== null) {
        if (_lsDel(k)) { undo.push([k, prev]); changed = true; } else failed.push(k);
      }
      continue;
    }
    if (typeof next !== 'string') continue;
    if (prev !== next) {
      if (_lsSet(k, next)) { undo.push([k, prev]); changed = true; } else failed.push(k);
    }
  }
  if (failed.length) {
    // Roll the successful writes back, then abort. A half-applied device is worse
    // than an unapplied one: its next sync sees cur !== snap, reads that as a local
    // edit, wins on the monotonic stamp and PATCHes the mixture over the authoring
    // device's settings — the very clobber aborting was meant to prevent.
    const stuck = [];
    for (const [k, prev] of undo.reverse()) {
      const ok = (prev === null) ? _lsDel(k) : _lsSet(k, prev);
      if (!ok) stuck.push(k);   // restoring a larger previous value can itself fail
    }
    const label = (typeof S === 'object' && S && S.routeLibraryGdriveStorageFull) ||
      'This device could not store the settings (storage full).';
    throw new Error(label + ' [' + failed.join(', ') +
      (stuck.length ? '; not restored: ' + stuck.join(', ') : '') + ']');
  }
  return changed;
}

// Values to PUBLISH: everything present locally, plus an explicit null for any
// allowlisted key that we synced before and that is now gone locally — a real
// deletion, or a toggle handed back to gist control. Tombstones the remote
// already carries are preserved while the key stays absent here, so a deletion
// keeps propagating to a device that has not synced yet instead of being
// resurrected by the next upload.
function _settingsPublishValues(values, snapValues, remoteValues) {
  const out = Object.assign({}, values);
  for (const k of GDRIVE_SETTINGS_KEYS) {
    if (Object.prototype.hasOwnProperty.call(values, k)) continue;   // still set here
    const knownBefore = snapValues &&
      Object.prototype.hasOwnProperty.call(snapValues, k) && snapValues[k] !== null;
    const remoteTomb = remoteValues &&
      Object.prototype.hasOwnProperty.call(remoteValues, k) && remoteValues[k] === null;
    if (knownBefore || remoteTomb) out[k] = null;
  }
  return out;
}

function _sameSettingsValues(a, b) {
  if (!a || !b) return false;
  for (const k of GDRIVE_SETTINGS_KEYS) {
    const ha = Object.prototype.hasOwnProperty.call(a, k);
    const hb = Object.prototype.hasOwnProperty.call(b, k);
    if (ha !== hb) return false;
    if (ha && a[k] !== b[k]) return false;
  }
  return true;
}
// Did THIS device edit its settings since the last sync? Only keys the snapshot has an
// opinion about can answer that:
//   a key the snapshot HAS and we no longer do is a deletion -- a real edit;
//   a key we have that the snapshot does NOT has two possible reasons, and the values alone
//     cannot tell them apart:
//       the allowlist has GAINED the key since -- the value was sitting in localStorage
//         before it was ever syncable, so there is no information about it, and counting it
//         as an edit made the device stamp itself above the remote and push its pre-upgrade
//         values over a peer's newer ones, once, on every upgraded device;
//       the key was already syncable and simply had no value -- so the pilot has set it for
//         the FIRST time, which is a real edit. Skipping it silently dropped that setting:
//         the newer remote won, and the following parity write absorbed the local value
//         into the snapshot, so it was never uploaded and never would be.
//     Most keys are unset until first used, so that second case is the common one -- which
//     is why the snapshot records WHICH keys it covered (SETTINGS_SNAPKEYS_KEY). Without
//     that record (a snapshot from an older build) absence counts as an edit: pushing our
//     values can cost a peer one round of settings, dropping the pilot's own edit is
//     permanent, so the tie breaks that way -- but see the remote check below, which is what
//     keeps that tie-break from costing a peer its own edits.
// Removing a key from the allowlist is covered too: the loop only visits current keys.
function _settingsChangedLocally(values, snapValues, snapKeys) {
  // A snapshot that will not parse proves nothing about this device, so it cannot claim an
  // edit: claiming one outranks a newer remote, overwrites a peer's values, and drops
  // peer-only keys from the blob entirely (there is no snapshot to tombstone them from), so
  // a third device loses them too. Reporting "unchanged" lets the newer remote heal this
  // device instead, which costs at most this device's unsynced edits.
  if (!snapValues) return false;
  const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  for (const k of GDRIVE_SETTINGS_KEYS) {
    if (!has(snapValues, k)) {
      // The key list says whether this key was even syncable when the snapshot was written.
      // _adoptLegacySnapshot guarantees a list exists, so "absent from the snapshot AND
      // listed" means it was syncable and simply had no value -- the pilot has set it since.
      if (snapKeys && snapKeys.indexOf(k) === -1) continue;   // not syncable then
      if (has(values, k)) return true;                        // set here since
      continue;
    }
    if (!has(values, k)) return true;                         // deleted here
    if (values[k] !== snapValues[k]) return true;             // changed here
  }
  return false;
}

// Every stamp this device writes is strictly greater than both its own last
// stamp and the remote's, i.e. monotonic rather than raw wall-clock. That kills
// two failures at once: a device whose clock is months ahead no longer outranks
// everyone else forever (the next real edit anywhere still advances past it), and
// re-publishing on a tie can no longer freeze updatedAt so that two devices
// overwrite each other's blob without ever converging.
function _nextSettingsStamp(remoteAt) {
  const last = +_lsGet(SETTINGS_SYNCED_AT_KEY) || 0;
  return Math.max(Date.now(), last + 1, (+remoteAt || 0) + 1);
}

// Record "we are in parity with `values` as of `stamp`". Snapshots the values we
// actually intended, not a fresh read of localStorage — re-reading live storage
// is what let a write that silently failed be remembered as applied.
// Session fallback for the snapshot when localStorage refuses it. Without this, a
// storage-pressured device has no baseline at all: it could never detect a local
// edit, so the user's change was silently reverted by the next remote blob.
let _settingsSnapMem = null;
let _settingsSnapKeysMem = null;

function _recordSettingsSynced(values, stamp) {
  // The snapshot is the biggest write in the feature (every allowlisted key,
  // including the aircraft profile and the override maps), so it is the one most
  // likely to be refused at quota. Ignoring that failure left a stale snapshot
  // with a current syncedAt, which reads as a permanent local edit: the device
  // would then win every later sync and push its pre-sync values over everyone.
  // Serialized in canonical allowlist order. That no longer decides anything --
  // _localSettingsBlob compares per key now, not as strings -- but it is kept so the
  // stored file stays diffable, and so a snapshot built by Object.assign (the
  // first-sync union) and one built here are byte-identical for the same values.
  const canon = {};
  for (const k of GDRIVE_SETTINGS_KEYS) {
    if (values && Object.prototype.hasOwnProperty.call(values, k) && values[k] !== null) {
      canon[k] = values[k];
    }
  }
  const canonStr = JSON.stringify(canon);
  _settingsSnapMem = canonStr;               // always keep an in-memory baseline
  // Which keys this snapshot had an opinion about, so a later build can tell "the allowlist
  // gained this key" from "the pilot has since set it". Best-effort: a build without it
  // falls back to treating absence as an edit.
  _settingsSnapKeysMem = GDRIVE_SETTINGS_KEYS.slice();
  if (!_lsSet(SETTINGS_SNAP_KEY, canonStr)) {
    // Do NOT throw: by now the values are applied locally and/or already uploaded,
    // so rejecting would leave storage and the running app disagreeing and skip the
    // reload. Instead clear the snapshot, which marks this device unseeded — its
    // next sync takes the loss-free union path rather than mistaking a stale
    // snapshot for a local edit and winning every future sync with it.
    // Keep syncedAt: it is what tells _localSettingsBlob this device HAS synced.
    // Clearing both made the device look brand new, so the next sync re-entered the
    // first-sync union against the blob this very device had just uploaded — and
    // popped the once-only conflict dialog, where accepting discarded the user's
    // newer local edit.
    _lsDel(SETTINGS_SNAP_KEY);
    // The stored list would describe a snapshot that is now gone. _settingsSnapKeysMem is
    // KEPT: it still describes the in-memory snapshot, which is the baseline this session
    // will actually use, and throwing it away re-armed the allowlist-gain false edit.
    _lsDel(SETTINGS_SNAPKEYS_KEY);
    _lsSet(SETTINGS_SYNCED_AT_KEY, String(stamp));
    return;
  }
  // Written AFTER the snapshot, and its failure is tolerated: without it the detector falls
  // back to the ambiguous branch above, which is a smaller loss than a refused snapshot.
  // Storing it first let 1.5 KB of key names take the space the snapshot needed.
  if (!_lsSet(SETTINGS_SNAPKEYS_KEY, JSON.stringify(_settingsSnapKeysMem))) {
    _lsDel(SETTINGS_SNAPKEYS_KEY);      // no stale list beside a fresh snapshot
  }
  _lsSet(SETTINGS_SYNCED_AT_KEY, String(stamp));
}

// Pure last-write-wins on the settings blob {updatedAt:<ms>, values:{}}. Ties
// keep local (this device) so a no-op sync doesn't ping-pong. Testable; no I/O.
function mergeSettings(local, remote) {
  const lt = (local && +local.updatedAt) || 0;
  const rt = (remote && +remote.updatedAt) || 0;
  return rt > lt ? { winner: 'remote', blob: remote } : { winner: 'local', blob: local };
}

// A snapshot written before the key list existed cannot say which keys it covered, and no
// amount of comparing values or consulting the remote can recover that. So it is adopted
// ONCE: every allowlisted key we hold a value for but the snapshot lacks is taken INTO the
// snapshot, as if it had been synced, and the full key list is recorded beside it. After that
// the baseline is self-describing and every later edit is detected exactly.
// The only cost is that a value set before the upgrade and never synced does not propagate
// until it is touched again -- it was never in the blob, so nothing the blob had is lost, and
// nothing on any device is overwritten.
function _adoptLegacySnapshot(values, snapValues, stamp) {
  const adopted = Object.assign({}, snapValues);
  for (const k of GDRIVE_SETTINGS_KEYS) {
    if (Object.prototype.hasOwnProperty.call(snapValues, k)) continue;
    if (Object.prototype.hasOwnProperty.call(values, k)) adopted[k] = values[k];
  }
  _recordSettingsSynced(adopted, stamp);
  return adopted;
}

// Local blob with a change-detected timestamp: if the current settings differ
// from the snapshot we last synced, they changed on THIS device → stamp now so
// they win; otherwise keep the last synced timestamp so a newer remote wins.
function _localSettingsBlob(remoteAt) {
  const values = collectSyncableSettings();
  // Fall back to the in-memory baseline when storage could not hold the snapshot.
  const snap = _lsGet(SETTINGS_SNAP_KEY) !== null ? _lsGet(SETTINGS_SNAP_KEY) : _settingsSnapMem;
  let snapValues = null;      // reassigned by the legacy adoption below
  if (snap !== null) { try { snapValues = JSON.parse(snap); } catch (e) { snapValues = null; } }
  // A device that has never completed a sync (snapshot unseeded) has no baseline
  // proving its settings are newer than a peer's. Claiming Date.now() here let a
  // fresh device outrank — and overwrite — the very settings it was meant to
  // receive (the exact inverse of the feature). Until the first sync seeds a
  // snapshot, this device's blob carries updatedAt 0, so any real remote wins.
  // A first sync against an EXISTING file does not use this ranking at all — see
  // the union branch in _gdriveSyncSettingsOnce, which is loss-free either way.
  // A missing snapshot WITH a recorded syncedAt means "synced before, but the
  // snapshot could not be stored" — not a new device. Treating it as first-sync
  // re-ran the union (and its dialog) against our own uploaded blob. With no
  // baseline to compare we cannot detect a local edit, so assume unchanged and let
  // the recorded stamp rank us.
  const syncedAt = +_lsGet(SETTINGS_SYNCED_AT_KEY) || 0;
  const firstSync = snap === null && !syncedAt;
  // Per key, and read against the allowlist the snapshot was written with -- see
  // _settingsChangedLocally. A raw JSON string compare called an allowlist change an edit;
  // ignoring every absent key dropped the pilot's first setting of anything.
  let snapKeys = null;
  // Prefer the in-memory list: it always describes the snapshot this session wrote, whereas
  // a stored one can be left over from an earlier sync if its write was refused at quota.
  const rawSnapKeys = _settingsSnapKeysMem !== null
    ? _settingsSnapKeysMem : _lsGet(SETTINGS_SNAPKEYS_KEY);
  if (rawSnapKeys) {
    try {
      const parsed = typeof rawSnapKeys === 'string' ? JSON.parse(rawSnapKeys) : rawSnapKeys;
      if (Array.isArray(parsed)) snapKeys = parsed;
    } catch (e) { snapKeys = null; }
  }
  // A baseline with no key list is adopted before it is read from, so the ambiguous case
  // exists for exactly one call rather than forever.
  if (snap !== null && snapValues && !snapKeys) {
    snapValues = _adoptLegacySnapshot(values, snapValues, syncedAt);
    snapKeys = GDRIVE_SETTINGS_KEYS.slice();
  }
  const changedLocally = snap !== null
    && _settingsChangedLocally(values, snapValues, snapKeys);
  const updatedAt = firstSync ? 0
    : (changedLocally ? _nextSettingsStamp(remoteAt) : syncedAt);
  return { values, snapValues, firstSync, updatedAt, changedLocally };
}

// Generic app-data helpers (the route ones hard-code the file name + array shape).
// `version` is requested so a write can confirm nothing landed between our read
// and our PATCH (Drive v3 has no If-Match for file content).
function gdriveFindNamed(name) {
  const url = 'https://www.googleapis.com/drive/v3/files?spaces=appDataFolder' +
    '&fields=files(id,name,modifiedTime,version)&orderBy=createdTime' +
    '&q=' + encodeURIComponent("name='" + name + "'");
  return driveFetch(url, { headers: gdriveHeaders() }, 'list')
    .then(r => r.json())
    .then(j => (j.files && j.files[0]) || null);
}
// Re-read just the version/modifiedTime to confirm the file has not changed since
// `seen`. Drive offers no atomic precondition on a content PATCH, so this narrows
// the lost-update window from the whole download+merge to one request; it does not
// eliminate it. Aborting is the safe side: the next sync merges normally.
function gdriveAssertUnchanged(fileId, seen) {
  if (!fileId || !seen) return Promise.resolve();
  const url = 'https://www.googleapis.com/drive/v3/files/' + fileId + '?fields=version,modifiedTime';
  return driveFetch(url, { headers: gdriveHeaders() }, 'check')
    .then(r => r.json())
    .then(j => {
      const now = String((j && (j.version || j.modifiedTime)) || '');
      if (now && String(seen) !== now) {
        throw new Error((typeof S === 'object' && S && S.routeLibraryGdriveRaced) ||
          'Another device changed the settings while syncing — sync again.');
      }
    });
}
function gdriveDownloadJson(fileId) {
  return driveFetch('https://www.googleapis.com/drive/v3/files/' + fileId + '?alt=media',
    { headers: gdriveHeaders() }, 'download').then(r => r.json());
}
function gdriveUploadJson(fileId, name, obj) {
  const body = JSON.stringify(obj);
  if (fileId) {
    return driveFetch('https://www.googleapis.com/upload/drive/v3/files/' + fileId + '?uploadType=media', {
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
  return driveFetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id', {
    method: 'POST',
    headers: Object.assign(gdriveHeaders(), { 'Content-Type': 'multipart/related; boundary=' + boundary }),
    body: multipart,
  }, 'create').then(r => r.json());
}

// One settings sync pass (assumes a valid token — callers connect first).
// Resolves { applied } — true when newer remote settings were written locally.
// `resolveFirstConflict` is an optional callback the UI supplies. On the FIRST
// sync of a device that already has its own settings, keys set on both sides
// genuinely conflict and there is no correct automatic answer — see the union
// branch below. It is called with the conflicting key list and returns (or
// resolves to) 'local' or 'remote'. Absent, it defaults to 'local'.
function _gdriveSyncSettingsOnce(resolveFirstConflict) {
  return gdriveFindNamed(GDRIVE_SETTINGS_FILE).then(file => {
    // Do NOT swallow a download error into "no remote": a transient 500/offline
    // blip would make local win and PATCH over the other device's settings. Let
    // it reject so the sync aborts instead of clobbering (same stance the route
    // path takes — throw on a bad read rather than overwrite).
    const remoteP = file ? gdriveDownloadJson(file.id) : Promise.resolve(null);
    const seen = file && (file.version || file.modifiedTime);
    return remoteP.then(remote => {
      const remoteOk = !!(remote && typeof remote === 'object' &&
        remote.values && typeof remote.values === 'object');
      const remoteValues = remoteOk ? remote.values : null;
      const remoteAt = remoteOk ? (+remote.updatedAt || 0) : 0;
      // Older releases copied AI credentials into this blob. Any successful sync rewrites
      // the remote file without them. Flight-plan profile fields are intentionally portable.
      const remoteNeedsSensitiveScrub = !!(remoteValues && Object.keys(remoteValues).some(k =>
        k.startsWith('navaid.ai.key.')));
      const local = _localSettingsBlob(remoteAt);

      const push = (values, stamp, snapshot) =>
        gdriveAssertUnchanged(file && file.id, seen)
          .then(() => gdriveUploadJson(file && file.id, GDRIVE_SETTINGS_FILE,
            { updatedAt: stamp, values }))
          .then(() => {
            // `snapshot === null` means "the caller records parity itself, after it has
            // applied": see the union branch, where recording `merged` here left a snapshot
            // claiming values that a rolled-back apply had not written.
            if (snapshot !== null) _recordSettingsSynced(snapshot, stamp);
            return { applied: false };
          });

      // FIRST sync against an existing file. There is no baseline here, so ranking
      // by timestamp is not an option: it silently overwrote whichever device
      // happened to opt in second, and that device might be the one with a year of
      // tuning on it. Union per key instead — keys only one side has are simply
      // taken, which is loss-free. Keys BOTH sides set with different values are a
      // real conflict with no correct automatic answer, so the UI is asked; without
      // a resolver this device's values win (and nothing it has is ever lost).
      if (local.firstSync && remoteOk) {
        const conflicts = [];
        for (const k of GDRIVE_SETTINGS_KEYS) {
          if (!Object.prototype.hasOwnProperty.call(local.values, k)) continue;
          if (!Object.prototype.hasOwnProperty.call(remoteValues, k)) continue;
          const rv = remoteValues[k];
          // A remote tombstone against a value we still hold is "deleted there,
          // kept here" — just as much a conflict as two different values, and it
          // must reach the dialog or the deletion is silently discarded.
          if (rv === null || (typeof rv === 'string' && rv !== local.values[k])) {
            conflicts.push(k);
          }
        }
        const decide = (conflicts.length && typeof resolveFirstConflict === 'function')
          ? Promise.resolve(resolveFirstConflict(conflicts.slice())).catch(() => 'abort')
          : Promise.resolve('local');
        return decide.then(side => {
          // Neither side is safe by default: keeping local overwrites the peer's
          // values in the shared blob, taking remote overwrites this device's. A
          // dismissed dialog is not an answer, so change nothing anywhere and let
          // the user re-run the sync and choose.
          if (side !== 'local' && side !== 'remote') {
            return { applied: false, skipped: true, needsChoice: conflicts.slice() };
          }
          const preferRemote = side === 'remote';
          const merged = {};
          const incoming = {};
          for (const k of GDRIVE_SETTINGS_KEYS) {
            const haveLocal = Object.prototype.hasOwnProperty.call(local.values, k);
            const haveRemote = Object.prototype.hasOwnProperty.call(remoteValues, k);
            const rv = haveRemote ? remoteValues[k] : undefined;
            const remoteUsable = haveRemote && typeof rv === 'string';
            if (haveLocal && preferRemote && rv === null) {
              merged[k] = null; incoming[k] = null;   // accept the deletion
              continue;
            }
            if (haveLocal && remoteUsable && preferRemote) {
              merged[k] = rv; if (rv !== local.values[k]) incoming[k] = rv;
              continue;
            }
            if (haveLocal) { merged[k] = local.values[k]; continue; }
            if (!haveRemote) continue;
            // Carry a remote tombstone forward instead of dropping it: re-publishing
            // without it erased a deletion from the shared blob for good, so the key
            // came back on every device that had not applied it yet.
            if (rv === null) { merged[k] = null; continue; }
            if (!remoteUsable) continue;
            merged[k] = rv; incoming[k] = rv;
          }
          // Upload FIRST, then apply locally. Applying first meant a failed push
          // (a version race, a 5xx, offline) left this device's settings already
          // replaced with no bookkeeping and no reload — and because local then
          // equalled the remote, the next sync found no conflict and consumed the
          // once-only prompt, making the original values unrecoverable.
          const stamp = _nextSettingsStamp(remoteAt);
          return push(merged, stamp, null)
            .then(() => {
              // applySyncableSettings throws if a write was rejected, and it rolls back --
              // so parity is recorded from what storage ACTUALLY holds afterwards, never
              // from what we hoped to write. A failed apply leaves this device unseeded,
              // which re-runs the loss-free union next time rather than publishing a
              // snapshot that would tombstone the peer's keys.
              const applied = applySyncableSettings(incoming);
              _recordSettingsSynced(collectSyncableSettings(), stamp);
              return { applied };
            });
        });
      }

      const { winner } = mergeSettings(
        { updatedAt: local.updatedAt, values: local.values },
        remoteOk ? remote : null);
      if (winner === 'remote') {
        // Remote wins. applySyncableSettings throws if a write was rejected, so a
        // partial apply never reaches the bookkeeping below.
        const changed = applySyncableSettings(remoteValues);
        const cleanValues = collectSyncableSettings();
        if (remoteNeedsSensitiveScrub) {
          const stamp = _nextSettingsStamp(remoteAt);
          const publish = _settingsPublishValues(cleanValues, local.snapValues, remoteValues);
          return push(publish, stamp, cleanValues).then(() => ({ applied: changed }));
        }
        _recordSettingsSynced(cleanValues, remoteAt);
        return { applied: changed };
      }

      // Local wins (or there is no remote yet).
      const publish = _settingsPublishValues(local.values, local.snapValues, remoteValues);
      if (remoteOk && !remoteNeedsSensitiveScrub && !local.changedLocally &&
          _sameSettingsValues(publish, remoteValues)) {
        // Already identical — record parity and write nothing. Re-publishing here
        // is what used to overwrite the peer's blob on every no-op sync.
        _recordSettingsSynced(local.values, Math.max(remoteAt, local.updatedAt));
        return { applied: false };
      }
      return push(publish, _nextSettingsStamp(remoteAt), local.values);
    });
  });
}

// Two-way settings sync for the manual button: connect (reusing the route
// flow's token), then one pass. Retries once on a token lapse like gdriveSync.
function gdriveSyncSettings(opts) {
  if (!settingsSyncEnabled()) return Promise.resolve({ applied: false, skipped: true });
  const resolver = opts && opts.resolveFirstConflict;
  const once = () => _gdriveSyncSettingsOnce(resolver);
  const connect = gdriveConnected() ? Promise.resolve()
    : gdriveConnect(false).catch(err => (_nativeSocialLogin() ? Promise.reject(err) : gdriveConnect(true)));
  return connect.then(once).catch(err => {
    if (_isAuthError(err)) { _gdriveToken = null; return gdriveConnect(true).then(once); }
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
