'use strict';

// Over-the-air updates for the embedded builds: the APK and the App Store app.
//
// The web app loads the live site, so a deploy reaches it the moment it lands. The embedded
// builds cannot: they carry the app inside the package (see mobile/scripts/bundle-web.mjs and
// why) -- which is what lets them start with no network at all -- and without this every fixed
// typo would be a new APK, or a submission and a review. Every production deploy publishes the
// bundle this reads (.github/workflows/deploy.yml).
//
// App Review guideline 2.5.2 allows exactly this and no more: interpreted code -- the HTML,
// CSS and JavaScript a WebView runs -- may be updated, as long as the app stays the app it
// was reviewed as. So this ships the same `docs/` bundle the reviewer saw, never native code,
// and never anything that changes what NavAid is.
//
// Manual mode, not the plugin's automatic one. The site is static hosting: it answers GET and
// nothing else, while the plugin's own updater POSTs to an endpoint. Reading a small JSON
// file ourselves is the whole difference, and it leaves the decisions here where they can be
// read: when to check, what to accept, and -- the one that matters in an aeroplane -- when to
// swap.
(function () {
  const MANIFEST = 'https://navaid.supino.org/ota/manifest.json';

  const plugin = () => {
    const cap = window.Capacitor;
    if (!cap || typeof cap.isNativePlatform !== 'function' || !cap.isNativePlatform()) return null;
    return (cap.Plugins && cap.Plugins.CapacitorUpdater) || null;
  };
  // Only the embedded build has anything to update. The remote shell IS the live site.
  const embedded = () => window.__navaidEmbedded === true;
  const featureOn = () => typeof tune !== 'function' || tune('featureOtaUpdates') !== false;

  // An update that does not say it started is rolled back to the bundle before it after
  // appReadyTimeout -- ultimately to the one Apple reviewed. That is the entire safety story
  // of shipping this way, and it is only worth anything if "started" means the app WORKS.
  //
  // Saying so unconditionally at the top of a file throws it away: this file is one script
  // among twenty, the loader carries on past a script that failed, and an app with no map
  // and no menu would cheerfully report itself healthy and disable its own rollback. So the
  // check is what the app looks like when it is up -- the chart, the state, the strings, the
  // boot overlay gone -- and a boot-time exception disqualifies it outright.
  const READY_POLL_MS = 150;
  // The flag is armed in index.html before the first app script is appended -- this file is
  // the LAST one in that list, so anything registered here has already missed every
  // exception that matters. A listener is kept as well, for what throws after this point.
  let lateBreak = false;
  if (typeof window !== 'undefined') {
    window.addEventListener('error', () => { lateBreak = true; });
  }
  const bootBroke = () => lateBreak || window.__navaidBootBroke === true
    // A required script that never arrived paints this over everything. It is the loader's
    // own verdict, and it outranks anything the app looks like underneath it.
    || !!document.getElementById('boot-error');

  // Read through the bare names, not window.*: a top-level `let` in a classic script is a
  // lexical global and never a property of window, so window.state is undefined in a
  // perfectly healthy app. The boot overlay is not part of this either -- it is removed by a
  // load handler that a slow network can leave sitting there over a working chart.
  function appIsUp() {
    if (bootBroke()) return false;
    try {
      if (typeof draw !== 'function' || typeof syncLegs !== 'function') return false;
      if (typeof state === 'undefined' || !state || !Array.isArray(state.waypoints)) return false;
      if (typeof map === 'undefined' || !map || typeof map.getCenter !== 'function') return false;
      if (typeof S === 'undefined' || !S || !S.flightPlan) return false;   // this language's strings
      return !!document.getElementById('toolbar');
    } catch (e) { return false; }
  }

  // Bounded by the plugin's own rollback window, and deliberately short of it: a verdict that
  // arrives after the plugin has already given up is no verdict at all.
  function waitForApp(deadlineMs) {
    const until = Date.now() + Math.max(0, deadlineMs);
    return new Promise((resolve) => {
      const tick = () => {
        if (appIsUp()) { resolve(true); return; }
        if (Date.now() >= until) { resolve(false); return; }
        setTimeout(tick, READY_POLL_MS);
      };
      tick();
    });
  }

  // `waitMs` exists for the tests; nothing else should be choosing this number.
  async function notifyReady(opts) {
    const o = opts || {};
    const p = o.plugin || plugin();
    if (!p || typeof p.notifyAppReady !== 'function') return false;
    const ok = o.ready !== undefined ? o.ready : await waitForApp(o.waitMs === undefined ? 15000 : o.waitMs);
    // Not ready, or something threw on the way up: say nothing. The plugin rolls this bundle
    // back on its own, which is exactly the outcome wanted -- the pilot gets the bundle that
    // worked, and the broken one is not offered again.
    if (!ok) return false;
    try { await p.notifyAppReady(); return true; } catch (e) { return false; }
  }

  // A pilot on a phone in an aeroplane is not somewhere to be spending their data plan on a
  // 25 MB download.
  //
  // navigator.connection does not exist in WKWebView -- it is Chromium-only -- so asking it
  // on iOS returns "no information", and treating that as permission is how every iPhone
  // ends up downloading on cellular. The native Network plugin is the one that can answer
  // there, and when nothing can answer the download does not happen: for a question about
  // someone else's data plan, silence is not consent.
  async function onUnmeteredConnection() {
    const cap = window.Capacitor;
    const net = cap && cap.Plugins && cap.Plugins.Network;
    if (net && typeof net.getStatus === 'function') {
      try {
        const status = await net.getStatus();
        if (!status || status.connected === false) return false;
        return status.connectionType === 'wifi';
      } catch (e) { return false; }
    }
    const c = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    if (!c || c.saveData === true) return false;
    if (typeof c.type === 'string' && c.type) return c.type === 'wifi' || c.type === 'ethernet';
    return false;
  }

  // On Android the embedded app is served at navaid.supino.org itself (it keeps the site's saved
  // data that way), so a WebView fetch of the manifest is answered from the package -- 404.
  // The native HTTP client goes to the real server.
  async function getJson(url) {
    const cap = window.Capacitor;
    const http = cap && cap.Plugins && cap.Plugins.CapacitorHttp;
    if (http && typeof http.get === 'function') {
      const res = await http.get({ url: url + '?t=' + Date.now(), headers: { 'Cache-Control': 'no-cache' } });
      if (!res || res.status < 200 || res.status >= 300) return null;
      return typeof res.data === 'string' ? JSON.parse(res.data) : res.data;
    }
    const res = await fetch(url, { cache: 'no-store' });
    return res.ok ? res.json() : null;
  }

  async function readManifest() {
    // A 404, a parse error, no network: all the same answer -- there is no update today.
    try {
      const data = await getJson(MANIFEST);
      if (!data || typeof data.version !== 'string' || typeof data.url !== 'string') return null;
      if (typeof data.checksum !== 'string' || !data.checksum) return null;
      return data;
    } catch (e) { return null; }
  }

  async function currentBundle(p) {
    try {
      const current = await p.current();
      return (current && current.bundle) || null;
    } catch (e) { return null; }
  }

  async function runningVersion(p) {
    const bundle = await currentBundle(p);
    return (bundle && bundle.version) || null;
  }

  // `next()` alone is NOT "next launch". The plugin installs a pending bundle when the app
  // moves to the BACKGROUND (appMovedToBackground -> installNext), so answering a message
  // mid-flight and coming back would reload NavAid under the pilot. A `kill` delay condition
  // survives background and foreground and is cleared only when the app is actually
  // terminated, which is the cold start we want.
  // Order matters, and it is the opposite of the obvious one. next() is what arms the
  // install; the delay is what makes it safe. Arming first and then failing to set the delay
  // leaves a bundle that installs on the next backgrounding -- and cancelDelay() does not
  // help, because it clears delay CONDITIONS, not a pending bundle. So the delay goes on
  // first, and if arming then fails the delay is taken back off.
  async function armForColdStart(p, id) {
    if (typeof p.setMultiDelay !== 'function') {
      throw new Error('plugin cannot defer an install to a cold start');
    }
    await p.setMultiDelay({ delayConditions: [{ kind: 'kill' }] });
    try {
      await p.next({ id });
    } catch (e) {
      if (typeof p.cancelDelay === 'function') { try { await p.cancelDelay(); } catch (_) { /* ignore */ } }
      throw e;
    }
  }

  // Downloaded, verified, and armed for the next COLD START -- never swapped under a pilot
  // who is using the map, and never on the way back from another app.
  async function checkForUpdate(opts) {
    const o = opts || {};
    const p = o.plugin || plugin();
    if (!p || !embedded() || !featureOn()) return { checked: false, reason: 'not an embedded native build' };
    if (!o.force && !(await onUnmeteredConnection())) {
      return { checked: false, reason: 'not on an unmetered connection' };
    }
    // The CVFR tiles the APK carries live in its web files until they are copied into the
    // chart store (native-tiles.js). An update replaces those files, so none is taken until the
    // copy is done -- or the chart would go with them.
    const tiles = window.NavAidNativeTiles;
    if (tiles && typeof tiles.bundledSeeded === 'function' && !(await tiles.bundledSeeded())) {
      return { checked: false, reason: 'charts still being copied' };
    }
    const manifest = o.manifest || await readManifest();
    if (!manifest) return { checked: true, updated: false, reason: 'no manifest' };
    const running = await runningVersion(p);
    if ((running && running === manifest.version) || sameBuild(webVersion(), manifest.version)) {
      return { checked: true, updated: false, reason: 'already running it' };
    }
    // Downloaded already and waiting for the next start (the automatic Wi-Fi check got there
    // first): not again -- it was 26 MB, and this time it might be on mobile data.
    try {
      const next = typeof p.getNextBundle === 'function' ? await p.getNextBundle() : null;
      if (next && next.id && next.status !== 'error' && next.version === manifest.version) {
        return { checked: true, updated: false, pending: true, version: manifest.version, reason: 'already downloaded' };
      }
    } catch (e) { /* nothing pending */ }
    try {
      const bundle = await p.download({
        url: manifest.url, version: manifest.version, checksum: manifest.checksum,
      });
      if (!bundle || !bundle.id) return { checked: true, updated: false, reason: 'download failed' };
      await armForColdStart(p, bundle.id);
      return { checked: true, updated: true, version: manifest.version, id: bundle.id };
    } catch (e) {
      // A relay that is down, a half-written zip, a checksum that does not match: the app
      // carries on with the bundle it has. An update is never worth a broken launch.
      return { checked: true, updated: false, reason: (e && e.message) || 'download refused' };
    }
  }

  // A `kill` delay is not an install at startup. The plugin loads the CURRENT bundle
  // (initialLoad), then clears the kill condition -- and nothing installs the pending bundle
  // there. It waits for the next appMovedToBackground, which is a pilot switching apps
  // mid-flight and coming back to a reloaded NavAid. So the install happens here, explicitly,
  // at the one moment a reload costs nothing: while the app is still starting.
  const ATTEMPT_KEY = 'navaid.otaInstalling';
  const RELOAD_GRACE_MS = 3000;
  function alreadyTried(id) {
    try { return localStorage.getItem(ATTEMPT_KEY) === id; } catch (e) { return false; }
  }
  function noteAttempt(id) {
    try { localStorage.setItem(ATTEMPT_KEY, id); } catch (e) { /* private mode */ }
  }
  function clearAttempt() {
    try { localStorage.removeItem(ATTEMPT_KEY); } catch (e) { /* private mode */ }
  }

  async function installPendingAtStartup(opts) {
    const o = opts || {};
    const p = o.plugin || plugin();
    if (!p || !embedded()) return { installed: false, reason: 'not an embedded native build' };
    if (typeof p.getNextBundle !== 'function' || typeof p.set !== 'function') {
      return { installed: false, reason: 'plugin cannot install a pending bundle' };
    }
    let pending;
    try { pending = await p.getNextBundle(); } catch (e) { return { installed: false, reason: 'no pending bundle' }; }
    if (!pending || !pending.id) { clearAttempt(); return { installed: false, reason: 'no pending bundle' }; }
    // A bundle the plugin has already failed on is not tried again, and neither is one this
    // device tried and did not come back from: one attempt per bundle, or a bundle that
    // cannot be set becomes a reload loop on the launch screen.
    if (pending.status === 'error') return { installed: false, reason: 'pending bundle failed before' };
    // Already the bundle we are running: a pending pointer that outlived its install. Nothing
    // to do, and saying so is what stops the same update being installed on every launch.
    const before = await currentBundle(p);
    if (before && before.id === pending.id) {
      clearAttempt();
      return { installed: false, reason: 'pending bundle is already the one running' };
    }
    if (alreadyTried(pending.id)) return { installed: false, reason: 'already tried this bundle' };
    noteAttempt(pending.id);
    try {
      // Installing on our terms, now -- so the condition that was holding it back goes.
      if (typeof p.cancelDelay === 'function') await p.cancelDelay();
      // reload() is the PENDING-AWARE path: it applies the queued bundle and then clears the
      // pointer (setNextBundle(nil)). set() + reload() looks equivalent and is not -- set()
      // makes the pending bundle current, so reload() no longer sees a pending one, takes the
      // plain path, and leaves the pointer behind to be installed again on the next launch.
      if (typeof p.reload !== 'function') return { installed: false, reason: 'plugin cannot apply a pending bundle' };
      // The call may never resolve: the WebView is being torn down under it. If it does come
      // back and nothing moved, the reload did not happen -- and this launch still has to be
      // vouched for, or a working bundle would be rolled back for standing still.
      await Promise.race([p.reload(), new Promise((r) => setTimeout(r, RELOAD_GRACE_MS))]);
      const after = await currentBundle(p);
      if (!after || after.id !== pending.id) return { installed: false, reason: 'reload did not take' };
      return { installed: true, id: pending.id, version: pending.version };
    } catch (e) {
      return { installed: false, reason: (e && e.message) || 'install refused' };
    }
  }

  // The web build this app is running, as the app states it ('1.0-<commit>'). The plugin's own
  // name for the bundle the APK shipped with is 'builtin', which matches no manifest -- so an
  // APK built from the very commit the site serves would download itself again.
  const webVersion = () => (window.NavAid && NavAid.version) || '';
  // Same commit, however short each side abbreviated it (git picks 7 or 8 characters).
  function sameBuild(a, b) {
    const sha = (v) => { const m = /-([0-9a-f]{7,40})$/i.exec(String(v || '')); return m ? m[1].toLowerCase() : ''; };
    const x = sha(a), y = sha(b);
    return !!x && !!y && (x.startsWith(y) || y.startsWith(x));
  }

  // What the App version row shows: 'current' | 'available' | 'pending' | 'unknown'.
  async function status(opts) {
    const o = opts || {};
    const p = o.plugin || plugin();
    if (!p || !embedded()) return { state: 'none' };
    try {
      const next = typeof p.getNextBundle === 'function' ? await p.getNextBundle() : null;
      if (next && next.id && next.status !== 'error') {
        const cur = await currentBundle(p);
        // Downloaded; the question to restart onto it waits while a position is live.
        if (!cur || cur.id !== next.id) return { state: 'pending', version: next.version || '', wait: inFlight() ? 'flight' : null };
      }
    } catch (e) { /* no pending bundle */ }
    const manifest = o.manifest || await readManifest();
    if (!manifest) return { state: 'unknown' };
    const running = await runningVersion(p);
    if (running === manifest.version || sameBuild(webVersion(), manifest.version)) {
      return { state: 'current', version: manifest.version };
    }
    // Why it has not simply downloaded on its own -- said in the row, not left as silence:
    // the automatic download waits for Wi-Fi, and for the bundled chart to finish copying.
    let wait = null;
    if (!(await onUnmeteredConnection())) wait = 'wifi';
    else {
      const tiles = window.NavAidNativeTiles;
      if (tiles && typeof tiles.bundledSeeded === 'function' && !(await tiles.bundledSeeded())) wait = 'charts';
    }
    return { state: 'available', version: manifest.version, bytes: Number(manifest.bytes) || 0, manifest, wait };
  }

  // The pilot asked for it: on mobile data too (the row asks first), and the packed chart is
  // copied now rather than waited for -- the one thing an update must not overtake.
  async function downloadNow(opts) {
    const o = opts || {};
    const tiles = window.NavAidNativeTiles;
    if (tiles && typeof tiles.seedBundled === 'function') {
      try { await tiles.seedBundled(); } catch (e) { /* the gate below says so */ }
    }
    return checkForUpdate({ ...o, force: true });
  }

  // --- Asking -----------------------------------------------------------------------------
  // A downloaded update installs at the next cold start on its own. Asking lets the pilot take
  // it now -- a reload of about two seconds that keeps the route and settings (they are stored
  // on the device, not in the bundle). Never while a position is live: recording, showing the
  // location or a connected simulator. Then the question waits until that stops, and a reload
  // can never happen in the air.
  const ASKED_KEY = 'navaid.otaAskedVersion';
  const APK_ASKED_KEY = 'navaid.apkAskedVersion';
  const GROUND_POLL_MS = 30000;
  const lsGetSafe = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const lsSetSafe = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } };
  const inFlight = () => typeof gpsPositionLive === 'function' && !!gpsPositionLive();
  function onTheGround(pollMs) {
    if (!inFlight()) return Promise.resolve();
    return new Promise((resolve) => {
      const t = setInterval(() => { if (!inFlight()) { clearInterval(t); resolve(); } }, pollMs || GROUND_POLL_MS);
    });
  }
  const ask = (title, text, ok, no) => (typeof window.askYesNo === 'function'
    ? window.askYesNo(title, text, ok, no) : Promise.resolve(false));

  // Apply the downloaded bundle now. The same pending-aware reload the startup install uses.
  async function restartNow(opts) {
    const r = await installPendingAtStartup(opts);
    if (!r.installed && typeof showToast === 'function' && r.reason !== 'no pending bundle') {
      showToast(typeof S.appUpdateFailed === 'function' ? S.appUpdateFailed(r.reason) : r.reason, { warn: true });
    }
    return r;
  }

  // Once per version, unless the pilot just asked for the download (`always`).
  async function offerRestart(version, opts) {
    const o = opts || {};
    const v = String(version || '');
    if (!o.always && v && lsGetSafe(ASKED_KEY) === v) return false;
    await onTheGround(o.pollMs);
    lsSetSafe(ASKED_KEY, v);
    const yes = await ask(S.appUpdateReadyTitle || 'Update ready',
      typeof S.appUpdateReadyText === 'function' ? S.appUpdateReadyText(v)
        : 'A new version of NavAid has been downloaded. Restart now to use it? Your route and settings stay.',
      S.appUpdateRestart || 'Restart now', S.appUpdateLater || 'Later');
    if (yes) await restartNow(o);
    return yes;
  }

  // --- A new APK ----------------------------------------------------------------------------
  // Native changes (a plugin, a permission) cannot come over the air: they need the next APK.
  // The releases are on GitHub (android-vX.Y.Z); the installed one says its own version. When a
  // newer one is out, say so once and open its release page -- the browser downloads the APK
  // and Android's installer puts it over this one, keeping the data.
  const RELEASES = 'https://api.github.com/repos/msupino/NavigationApp/releases/latest';
  const verParts = (v) => (String(v || '').match(/\d+/g) || []).map(Number);
  function newerVersion(a, b) {
    const x = verParts(a), y = verParts(b);
    for (let i = 0; i < Math.max(x.length, y.length); i++) {
      const d = (x[i] || 0) - (y[i] || 0);
      if (d) return d > 0;
    }
    return false;
  }
  async function latestApk() {
    try {
      const rel = await getJson(RELEASES);
      const tag = rel && typeof rel.tag_name === 'string' ? rel.tag_name : '';
      const m = /^android-v(\d+(?:\.\d+)*)$/.exec(tag);
      if (!m || rel.draft || rel.prerelease) return null;
      return { version: m[1], url: String(rel.html_url || '') };
    } catch (e) { return null; }
  }
  async function installedApkVersion() {
    const cap = window.Capacitor;
    const app = cap && cap.Plugins && cap.Plugins.App;
    if (!app || typeof app.getInfo !== 'function') return '';
    try { const i = await app.getInfo(); return (i && i.version) || ''; } catch (e) { return ''; }
  }
  function openOutside(url) {
    // Capacitor hands a navigation to another host to the system (ACTION_VIEW): the browser
    // opens the release page and downloads the APK from there.
    window.location.href = url;
  }
  async function checkForNewApk(opts) {
    const o = opts || {};
    const cap = window.Capacitor;
    const android = cap && typeof cap.getPlatform === 'function' && cap.getPlatform() === 'android';
    if (!o.force && !(android && cap.isNativePlatform && cap.isNativePlatform())) return { offered: false, reason: 'not the Android app' };
    const installed = o.installed || await installedApkVersion();
    const latest = o.latest || await latestApk();
    if (!installed || !latest || !/^https:\/\/github\.com\//.test(latest.url)) return { offered: false, reason: 'unknown' };
    if (!newerVersion(latest.version, installed)) return { offered: false, reason: 'up to date' };
    if (lsGetSafe(APK_ASKED_KEY) === latest.version) return { offered: false, reason: 'asked already' };
    await onTheGround(o.pollMs);
    lsSetSafe(APK_ASKED_KEY, latest.version);
    const yes = await ask(typeof S.apkUpdateTitle === 'function' ? S.apkUpdateTitle(latest.version) : 'NavAid ' + latest.version + ' is available',
      S.apkUpdateText || 'A new version of the app is out. Download it and install it over this one: your routes and settings stay. Do not uninstall first.',
      S.apkUpdateDownload || 'Download', S.appUpdateLater || 'Later');
    if (yes) (o.open || openOutside)(latest.url);
    return { offered: true, accepted: yes, version: latest.version };
  }

  window.NavAid = window.NavAid || {};
  NavAid.ota = {
    notifyReady, checkForUpdate, readManifest, appIsUp, installPendingAtStartup, MANIFEST,
    status, downloadNow, onUnmeteredConnection, sameBuild,
    restartNow, offerRestart, checkForNewApk, newerVersion,
  };

  async function boot() {
    const p = plugin();
    if (!p) return;
    // First, because a reload during startup is the cheapest reload there is. If it installs,
    // the app comes back on the new bundle and runs this again with nothing pending.
    const installed = await installPendingAtStartup({ plugin: p });
    if (installed.installed) return;
    // This bundle is the one running, so it is the one to vouch for -- once it has actually
    // come up. A launch that reaches here having installed nothing and never becomes usable
    // says nothing, and the plugin puts the previous bundle back.
    const ok = await notifyReady({ plugin: p });
    if (ok) clearAttempt();          // this bundle works: let a later one be tried once too
    // Only then look for a newer one, and not while the chart is still being drawn.
    let lastCheck = 0;
    const check = (apkToo) => {
      lastCheck = Date.now();
      return checkForUpdate({ plugin: p }).then((r) => {
        // Downloaded now, or earlier and still waiting: offer it (once per version).
        if (r && (r.updated || r.pending)) return offerRestart(r.version || '', { plugin: p });
        // Nothing for the web app: is there a new APK? One question at a time, never both.
        return apkToo ? checkForNewApk() : null;
      }).catch(() => {});
    };
    setTimeout(() => check(true), 15000);
    // Once at start was all it did: an app started away from Wi-Fi -- the normal case before a
    // flight -- never looked again until the next restart. Look again when Wi-Fi comes back,
    // and when the app comes back to the screen after a while.
    const net = window.Capacitor && Capacitor.Plugins && Capacitor.Plugins.Network;
    if (net && typeof net.addListener === 'function') {
      try {
        net.addListener('networkStatusChange', (s) => {
          if (s && s.connected && s.connectionType === 'wifi' && Date.now() - lastCheck > 60000) check(false);
        });
      } catch (e) { /* no listener: the checks below still run */ }
    }
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && Date.now() - lastCheck > 30 * 60000) check(false);
    });
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'complete') boot();
    else window.addEventListener('load', () => boot());
  }
}());
