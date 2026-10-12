'use strict';
/* NavAid — printing in the Android app.

   A WebView's window.print() does nothing on Android, so in the APK every Print button went
   quiet. From APK 1.26 the app carries a print plugin (NavAidPrint, NavAidPrintPlugin.java)
   that hands the job to Android's print system -- the phone's printers and "Save as PDF":

     - window.print() (the flight plan, the nav log, the planning form, the route mosaic) prints
       the app's own page with its print styles: NavAidPrint.printPage;
     - the map (io.js openPrintWindow) writes its image(s) to the app's cache and prints a page
       of them, one a sheet: NavAidPrint.printHtml.

   Android prints after the dialog, not inside window.print(), so the page keeps its print
   layout until "printFinished" -- raised here as the browser's own afterprint -- and busy()
   tells the fallback timers that still undo a layout after a few seconds to wait.

   Only where the APK has the plugin (Capacitor.isPluginAvailable): a browser, and an older APK,
   carry on exactly as before. */
(function () {
  const C = window.Capacitor;
  const plugin = () => (C && typeof C.isNativePlatform === 'function' && C.isNativePlatform()
    && typeof C.isPluginAvailable === 'function' && C.isPluginAvailable('NavAidPrint')
    && C.Plugins && C.Plugins.NavAidPrint) || null;
  let busy = false;

  function available() { return !!plugin(); }

  function done() {
    busy = false;
    try { window.dispatchEvent(new Event('afterprint')); } catch (e) { /* */ }
  }

  async function printPage() {
    const p = plugin();
    if (!p) return false;
    busy = true;
    try { await p.printPage({ name: 'NavAid' }); return true; }
    catch (e) { done(); return false; }
  }

  function toBase64(blob) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onerror = () => reject(r.error || new Error('could not read the image'));
      r.onload = () => resolve(String(r.result).split(',')[1] || '');
      r.readAsDataURL(blob);
    });
  }

  // The map: each image written to the cache, then a page of them, each a sheet of the paper.
  async function printImages(blobs, paperWmm, paperHmm) {
    const p = plugin();
    const fs = C && C.Plugins && C.Plugins.Filesystem;
    if (!p || !fs) return false;
    busy = true;
    try {
      const uris = [];
      for (let i = 0; i < blobs.length; i++) {
        const written = await fs.writeFile({
          path: 'print/navaid-print-' + Date.now() + '-' + i + '.png',
          data: await toBase64(blobs[i]), directory: 'CACHE', recursive: true,
        });
        uris.push(written.uri);
      }
      const sized = (paperWmm && paperHmm)
        ? '@page{size:' + paperWmm + 'mm ' + paperHmm + 'mm;margin:0}img{width:' + paperWmm + 'mm;height:' + paperHmm + 'mm;display:block}'
        : '@page{margin:0}img{max-width:100%;display:block}';
      const html = '<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;padding:0}' + sized +
        'img{break-after:page;page-break-after:always}img:last-child{break-after:auto;page-break-after:auto}' +
        '</style></head><body>' + uris.map(u => '<img alt="" src="' + u + '">').join('') + '</body></html>';
      await p.printHtml({ html, name: 'NavAid' });
      return true;
    } catch (e) {
      done();
      return false;
    }
  }

  const p = plugin();
  if (p) {
    try { p.addListener('printFinished', done); } catch (e) { /* no event: the fallback timers clear it */ }
    window.print = function () { printPage(); };
  }

  window.NavAidNativePrint = { available, printPage, printImages, busy: () => busy };
}());
