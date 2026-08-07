// Storage isolation for PR previews. Injected into a preview's index.html by the Deploy
// workflow and NOWHERE else -- production and staging never see this file.
//
// A preview is served from the production origin (navaid.supino.org/pr/<n>/), and
// localStorage is per ORIGIN, not per path. Without this, an unreviewed branch shares one
// store with the live app: it can read the pilot's saved routes, their Drive/BYOK tokens
// and every setting, and a bug in it can overwrite them. Namespacing the store means a
// preview starts empty, keeps its own state, and cannot touch the real one.
//
// It replaces window.localStorage / window.sessionStorage with objects that prefix every
// key, and runs before any app script, so the bare `localStorage` identifier in app code
// resolves to the namespaced one.
(function () {
  var PREFIX = '__PR_PREFIX__';           // rewritten to e.g. "pr-1453." at build time
  if (!PREFIX || PREFIX.indexOf('__PR_') === 0) return;   // not substituted: do nothing

  function wrap(real) {
    if (!real) return real;
    var ns = {
      getItem: function (k) { return real.getItem(PREFIX + k); },
      setItem: function (k, v) { return real.setItem(PREFIX + k, v); },
      removeItem: function (k) { return real.removeItem(PREFIX + k); },
      // Only this preview's own keys -- clear() must never wipe the pilot's real data.
      clear: function () {
        var mine = [];
        for (var i = 0; i < real.length; i++) {
          var k = real.key(i);
          if (k && k.indexOf(PREFIX) === 0) mine.push(k);
        }
        for (var j = 0; j < mine.length; j++) real.removeItem(mine[j]);
      },
      key: function (i) {
        var n = 0;
        for (var x = 0; x < real.length; x++) {
          var k = real.key(x);
          if (k && k.indexOf(PREFIX) === 0) {
            if (n === i) return k.slice(PREFIX.length);
            n++;
          }
        }
        return null;
      },
    };
    Object.defineProperty(ns, 'length', {
      get: function () {
        var n = 0;
        for (var i = 0; i < real.length; i++) {
          var k = real.key(i);
          if (k && k.indexOf(PREFIX) === 0) n++;
        }
        return n;
      },
    });
    return ns;
  }

  // Storage can throw on access in private mode / with site data blocked; a preview that
  // cannot isolate its storage must not boot with the REAL one, so fall back to an
  // in-memory store rather than leaving the live keys exposed.
  function memory() {
    var m = {};
    return {
      getItem: function (k) { return Object.prototype.hasOwnProperty.call(m, k) ? m[k] : null; },
      setItem: function (k, v) { m[k] = String(v); },
      removeItem: function (k) { delete m[k]; },
      clear: function () { m = {}; },
      key: function (i) { var ks = Object.keys(m); return i < ks.length ? ks[i] : null; },
      get length() { return Object.keys(m).length; },
    };
  }

  ['localStorage', 'sessionStorage'].forEach(function (name) {
    var ns;
    try { ns = wrap(window[name]) || memory(); } catch (e) { ns = memory(); }
    try {
      Object.defineProperty(window, name, { value: ns, configurable: true, writable: false });
    } catch (e) { /* locked down: leave it alone rather than half-isolating */ }
  });

  // A preview must not register a service worker. Cache Storage is per ORIGIN, so a
  // preview worker's activate cleanup used to delete the live app's offline shell -- and a
  // preview has no use for offline anyway. (sw.js is also removed from the published
  // preview, so a direct request 404s.)
  try {
    if (navigator.serviceWorker) {
      navigator.serviceWorker.register = function () {
        return Promise.reject(new Error('service workers are disabled in PR previews'));
      };
      // Anything registered under this scope by an earlier visit goes too.
      if (navigator.serviceWorker.getRegistrations) {
        navigator.serviceWorker.getRegistrations().then(function (rs) {
          for (var i = 0; i < rs.length; i++) {
            if (String(rs[i].scope).indexOf(location.origin + '/pr/') === 0) rs[i].unregister();
          }
        }).catch(function () {});
      }
    }
  } catch (e) { /* no service worker support */ }

  // Visible in the console, and something the preview's own tests can assert on.
  window.__navPreviewStorePrefix = PREFIX;
})();
