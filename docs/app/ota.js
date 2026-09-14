'use strict';

// Over-the-air updates for the embedded iOS build.
//
// The Android app and the web app load the live site, so a deploy reaches them the moment it
// lands. The App Store build cannot: it carries the app inside the binary (see
// mobile/scripts/bundle-web.mjs and why), and without this every fixed typo would be a
// submission and a review.
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

  async function readManifest() {
    // A 404, a parse error, no network: all the same answer -- there is no update today.
    try {
      const res = await fetch(MANIFEST, { cache: 'no-store' });
      if (!res.ok) return null;
      const data = await res.json();
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
    const manifest = o.manifest || await readManifest();
    if (!manifest) return { checked: true, updated: false, reason: 'no manifest' };
    const running = await runningVersion(p);
    if (running && running === manifest.version) {
      return { checked: true, updated: false, reason: 'already running it' };
    }
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

  window.NavAid = window.NavAid || {};
  NavAid.ota = {
    notifyReady, checkForUpdate, readManifest, appIsUp, installPendingAtStartup, MANIFEST,
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
    setTimeout(() => { checkForUpdate({ plugin: p }).catch(() => {}); }, 15000);
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'complete') boot();
    else window.addEventListener('load', () => boot());
  }
}());
