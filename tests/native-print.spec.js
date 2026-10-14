// @ts-check
// Printing in the Android app (from APK 1.26). A WebView's window.print() does nothing, so the
// Print buttons hand the job to Android's print system through the NavAidPrint plugin
// (native-print.js): window.print() -> printPage, the map -> its images written to the cache
// and a page of them -> printHtml. Android prints after its dialog, so the page keeps its print
// layout until "printFinished". A browser, and an older APK, carry on as before.
const { test, expect } = require('./_setup');

async function bootNative(page) {
  await page.addInitScript(() => {
    window.__np = { pages: 0, html: null, writes: [], listeners: {} };
    window.Capacitor = {
      isNativePlatform: () => true, getPlatform: () => 'android',
      isPluginAvailable: (n) => n === 'NavAidPrint' || n === 'Filesystem',
      Plugins: {
        NavAidPrint: {
          printPage: async () => { window.__np.pages++; },
          printHtml: async (o) => { window.__np.html = o.html; },
          addListener: (name, fn) => { window.__np.listeners[name] = fn; return { remove() {} }; },
        },
        Filesystem: {
          writeFile: async (o) => { window.__np.writes.push(o.path); return { uri: 'file:///cache/' + o.path }; },
        },
      },
    };
  });
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => window.NavAidNativePrint && typeof openPrintWindow === 'function');
}

test('the map prints through the app: images to the cache, a page of them to Android', async ({ page }) => {
  await bootNative(page);
  const r = await page.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 4; c.height = 3;
    const png = await new Promise(res => c.toBlob(res, 'image/png'));
    openPrintWindow([png, png], 210, 297);
    for (let i = 0; i < 50 && !window.__np.html; i++) await new Promise(x => setTimeout(x, 50));
    return { html: window.__np.html, writes: window.__np.writes.length, frame: !!document.getElementById('navaid-print-frame') };
  });
  expect(r.writes).toBe(2);
  expect(r.frame).toBe(false);                               // no browser frame in the app
  expect(r.html).toContain('@page{size:210mm 297mm');
  expect((r.html.match(/<img [^>]*src="file:\/\/\/cache\/print\//g) || []).length).toBe(2);
});

test('window.print goes to Android, and the flight plan keeps its print layout until the dialog is done', async ({ page }) => {
  await bootNative(page);
  const r = await page.evaluate(async () => {
    window.print();
    const pages = window.__np.pages;
    document.body.classList.add('printing-plan');
    window.addEventListener('afterprint', () => document.body.classList.remove('printing-plan'), { once: true });
    const busyBefore = NavAidNativePrint.busy();
    window.__np.listeners.printFinished();                   // Android: the dialog is done
    return { pages, busyBefore, busyAfter: NavAidNativePrint.busy(), still: document.body.classList.contains('printing-plan') };
  });
  expect(r.pages).toBe(1);
  expect(r.busyBefore).toBe(true);
  expect(r.busyAfter).toBe(false);
  expect(r.still).toBe(false);                               // afterprint raised
});

test('in a browser nothing changes: no plugin, the hidden frame prints', async ({ page }) => {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => window.NavAidNativePrint && typeof openPrintWindow === 'function');
  expect(await page.evaluate(() => NavAidNativePrint.available())).toBe(false);
});
