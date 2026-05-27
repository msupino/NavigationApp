// @ts-check
// Regression test for #176: closing the plate viewer or charts modal via
// the ✕ button must remove the keydown listener so it doesn't accumulate
// across open/close cycles.
const { test, expect } = require('./_setup');

// Instrument window.add/removeEventListener so we can count outstanding
// keydown listeners. Hook returned by the helper restores the originals.
async function installListenerCounter(page) {
  await page.addInitScript(() => {
    window.__keyAdds = 0;
    window.__keyRems = 0;
    const _add = window.addEventListener.bind(window);
    const _rem = window.removeEventListener.bind(window);
    window.addEventListener = function (t, fn, opts) {
      if (t === 'keydown') window.__keyAdds++;
      return _add(t, fn, opts);
    };
    window.removeEventListener = function (t, fn, opts) {
      if (t === 'keydown') window.__keyRems++;
      return _rem(t, fn, opts);
    };
  });
}

test.describe('#176 Escape listener leak in modals', () => {
  test('charts modal: open / ✕ / open / ✕ — keydown adds match removes', async ({ page }) => {
    await installListenerCounter(page);
    await page.goto('?lang=en');
    await page.waitForFunction(() => typeof showChartsModal === 'function');
    await page.evaluate(() => { window.airfields = window.airfields || []; });

    // Baseline counter: bumps from app boot (we only care about the delta).
    const base = await page.evaluate(() => ({ a: window.__keyAdds, r: window.__keyRems }));

    for (let i = 0; i < 5; i++) {
      await page.evaluate(() => showChartsModal());
      // Click the ✕ button (the test-fixture path #184 fixes).
      await page.locator('.modal-close-x').last().click();
    }

    const after = await page.evaluate(() => ({ a: window.__keyAdds, r: window.__keyRems }));
    // Every showChartsModal adds exactly one keydown listener; every ✕ close
    // must remove it. If the leak is present, adds outpace removes by 5.
    expect(after.a - base.a).toBeGreaterThan(0);   // sanity: did add some
    expect(after.a - base.a).toBe(after.r - base.r);
  });

  test('plate viewer: ✕ button removes the Escape listener', async ({ page }) => {
    await installListenerCounter(page);
    await page.goto('?lang=en');
    await page.waitForFunction(() => typeof showPlateViewer === 'function');

    // Block the network fetch so the viewer doesn't try to load a real PDF.
    await page.route('**/byop/**', r => r.fulfill({ status: 404, body: '' }));

    const base = await page.evaluate(() => ({ a: window.__keyAdds, r: window.__keyRems }));

    for (let i = 0; i < 3; i++) {
      await page.evaluate(() => showPlateViewer('LLBG_SID_08.pdf', 'SID 08'));
      await page.locator('.modal-close-x').last().click();
    }

    const after = await page.evaluate(() => ({ a: window.__keyAdds, r: window.__keyRems }));
    expect(after.a - base.a).toBeGreaterThan(0);
    expect(after.a - base.a).toBe(after.r - base.r);
  });
});
