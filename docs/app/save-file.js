// How a file leaves NavAid.
//
// A browser saves one by clicking an <a download>. An Android WebView does not: there is no
// download manager behind it, so the click is swallowed without a word and the file never
// appears. Every export in the app ended in those same three lines, so every one of them
// failed the same silent way on the phone -- reported from the APK as "can't export from
// saved records, maybe also saved routes". It was all of them.
//
// So there is one place that decides how a file leaves: an anchor in a browser, and on a
// native shell a write into the app's cache followed by the system share sheet, which is how
// a phone hands a file to Drive, to mail, or to Files.
(function () {
  'use strict';

  // The share sheet needs both halves: somewhere to put the file, and something to hand it
  // to. Either one missing means this shell cannot do it, and the browser path is the wrong
  // answer on a phone -- it is exactly what fails there.
  function sharePlugins() {
    const p = window.Capacitor && window.Capacitor.Plugins;
    return (p && p.Filesystem && p.Share) ? p : null;
  }

  function isNativeShell() {
    if (typeof isNativeCapacitorShell === 'function') return isNativeCapacitorShell();
    const c = window.Capacitor;
    return !!(c && typeof c.isNativePlatform === 'function' && c.isNativePlatform());
  }

  // Capacitor's Filesystem writes base64, not a Blob.
  function toBase64(blob) {
    return new Promise(function (resolve, reject) {
      const r = new FileReader();
      r.onerror = function () { reject(r.error || new Error('could not read the file')); };
      r.onload = function () {
        const s = String(r.result || '');
        const comma = s.indexOf(',');            // strip the "data:<mime>;base64," prefix
        resolve(comma < 0 ? s : s.slice(comma + 1));
      };
      r.readAsDataURL(blob);
    });
  }

  // A file name here is a label, never a path. Several are built from a route or a recording
  // named by the pilot, and a slash in one of those would write outside the directory asked
  // for.
  function safeName(name) {
    const base = String(name == null ? '' : name)
      .split(/[\\/]/).pop()
      .replace(/^\.+/, '')
      .trim();
    return base || ('navaid-' + Date.now());
  }

  function saveViaAnchor(blob, filename) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    // Revoking synchronously after the click can abort the download (Firefox/Safari).
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
  }

  // A pilot who backs out of the share sheet has not hit a fault, and an alert saying the
  // export failed would be a lie. Both platforms report it in the message.
  function wasCancelled(err) {
    return /cancel/i.test(String((err && (err.message || err.errorMessage)) || err || ''));
  }

  async function saveViaShareSheet(p, blob, filename) {
    const data = await toBase64(blob);
    // Cache, not Documents: the file exists to be handed to another app, and the share sheet
    // is where the pilot says which. Copies left in the app's own document store would pile
    // up with nothing in NavAid to browse or delete them.
    const written = await p.Filesystem.writeFile({
      path: filename, data: data, directory: 'CACHE', recursive: true,
    });
    await p.Share.share({
      title: filename,
      files: [written.uri],
      dialogTitle: (window.S && S.saveShareTitle) || 'Save or send',
    });
  }

  // Returns true when the file was handed over, false when it was not -- a cancelled share
  // sheet, or a shell that cannot save. Callers do not have to check: the failure is already
  // reported to the pilot here, in the one place that knows which path was taken.
  async function saveFile(blob, filename) {
    const name = safeName(filename);
    const p = sharePlugins();
    if (p) {
      try {
        await saveViaShareSheet(p, blob, name);
        return true;
      } catch (e) {
        if (wasCancelled(e)) return false;
        try {
          alert(((window.S && S.errSaveFailed) || 'That file could not be saved.') +
            '\n\n' + String((e && e.message) || e));
        } catch (ignored) { /* an alert is best effort */ }
        return false;
      }
    }
    if (isNativeShell()) {
      // An older APK, built before the app could save files. Saying so beats a button that
      // does nothing, which is the bug this whole file exists to end.
      try {
        alert((window.S && S.errSaveNeedsAppUpdate) ||
          'Saving files needs a newer version of the NavAid app. Update it, or export from the website.');
      } catch (ignored) { /* an alert is best effort */ }
      return false;
    }
    saveViaAnchor(blob, name);
    return true;
  }

  // Some exports are a file the app never built -- an AIP plate served from the site. Fetch
  // it so the phone shares the document itself and not a link to it.
  async function saveFileFromUrl(url, filename) {
    if (!sharePlugins() && !isNativeShell()) {
      const a = document.createElement('a');
      a.href = url;
      a.download = safeName(filename);
      a.click();
      return true;
    }
    let blob;
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      blob = await r.blob();
    } catch (e) {
      try {
        alert(((window.S && S.errSaveFailed) || 'That file could not be saved.') +
          '\n\n' + String((e && e.message) || e));
      } catch (ignored) { /* an alert is best effort */ }
      return false;
    }
    return saveFile(blob, filename);
  }

  window.saveFile = saveFile;
  window.saveFileFromUrl = saveFileFromUrl;
  // Named so a test can reach the decision without a device: everything above turns on
  // whether this shell can share.
  window.saveFileCanShare = function () { return !!sharePlugins(); };
})();
