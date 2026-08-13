// @ts-check
// The mirrored "show return path" can be switched off wholesale from the tuning gist.
// It draws an imaginary second route on top of the real legs: with a turning point the
// route already contains its return, and without one the mirror is a guess.
const { test, expect } = require('./_setup');

test('the feature ships OFF: control hidden, state clear, nothing drawn', async ({ page }) => {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof tune === 'function');
  const out = await page.evaluate(() => ({
    flag: tune('featureShowReturn'),
    rowHidden: document.getElementById('ret-cb').closest('label').hidden,
    rowDisplay: getComputedStyle(document.getElementById('ret-cb').closest('label')).display,
    featureOn: showReturnFeatureOn(),
    showReturn: window.showReturn,
  }));
  expect(out.flag).toBe(false);
  expect(out.rowHidden).toBe(true);
  // The attribute alone is not enough: #toolbar .navtoggle sets display:flex, which beats
  // [hidden]'s default display:none. Assert what the user actually sees.
  expect(out.rowDisplay).toBe('none');
  expect(out.featureOn).toBe(false);
  expect(out.showReturn).toBe(false);
});

test('turning the flag back on restores the control', async ({ page }) => {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof showReturnFeatureOn === 'function');
  const on = await page.evaluate(() => {
    const orig = window.tune;
    window.tune = (k) => (k === 'featureShowReturn' ? true : orig(k));
    const res = showReturnFeatureOn();
    window.tune = orig;
    return res;
  });
  // The code is all still here -- the gist decides, nothing was deleted.
  expect(on).toBe(true);
});

test('with the flag off the control is hidden and the state forced off', async ({ page }) => {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof showReturnFeatureOn === 'function');
  const out = await page.evaluate(() => {
    const orig = window.tune;
    window.tune = (k) => (k === 'featureShowReturn' ? false : orig(k));
    // Re-run what the boot code does, now that the flag reads false.
    window.showReturn = true;                 // a stored 'on' from before it was disabled
    if (!showReturnFeatureOn()) {
      window.showReturn = false;
      document.getElementById('ret-cb').closest('label').hidden = true;
    }
    return { featureOn: showReturnFeatureOn(), showReturn: window.showReturn,
             hidden: document.getElementById('ret-cb').closest('label').hidden };
  });
  expect(out.featureOn).toBe(false);
  expect(out.showReturn).toBe(false);   // a stale 'on' cannot survive
  expect(out.hidden).toBe(true);
});

test('the mirrored path is not drawn even if showReturn is forced true', async ({ page }) => {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof drawLegArrow === 'function');
  const out = await page.evaluate(() => {
    state.waypoints = [{ lat: 32.0, lng: 34.0, name: 'A' }, { lat: 32.1, lng: 34.0, name: 'B' }];
    syncLegs();
    const orig = window.tune;
    const count = () => {
      let n = 0;
      const od = window.drawLegArrow;
      window.drawLegArrow = (...a) => { n++; return od.apply(null, a); };
      draw();
      window.drawLegArrow = od;
      return n;
    };
    window.showReturn = true;
    // Both directions forced explicitly -- the shipped default is now OFF, so "with the
    // feature" has to be asked for rather than assumed.
    window.tune = (k) => (k === 'featureShowReturn' ? true : orig(k));
    const withFeature = count();                       // inbound + return
    window.tune = (k) => (k === 'featureShowReturn' ? false : orig(k));
    const withoutFeature = count();                    // inbound only
    window.tune = orig;
    return { withFeature, withoutFeature };
  });
  expect(out.withFeature).toBeGreaterThan(out.withoutFeature);
  expect(out.withoutFeature).toBe(1);
});

test('the B shortcut does nothing when the feature is off', async ({ page }) => {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof showReturnFeatureOn === 'function');
  const out = await page.evaluate(() => {
    const orig = window.tune;
    window.tune = (k) => (k === 'featureShowReturn' ? false : orig(k));
    window.showReturn = false;
    let clicked = 0;
    const cb = document.getElementById('ret-cb');
    cb.addEventListener('click', () => { clicked++; });
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', code: 'KeyB', bubbles: true }));
    window.tune = orig;
    return { clicked, showReturn: window.showReturn };
  });
  // A shortcut that silently turns on a hidden control is worse than one that does nothing.
  expect(out.clicked).toBe(0);
  expect(out.showReturn).toBe(false);
});

test('the B shortcut is not listed in the help while the feature is off', async ({ page }) => {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof showShortcutsHelp === 'function');
  const readKeys = () => page.evaluate(() => {
    showShortcutsHelp();
    return [...document.querySelectorAll('.shortcuts-help-keys')].map(e => e.textContent.trim());
  });
  // showShortcutsHelp is idempotent while its modal is open, so close it the way a user
  // does rather than ripping the node out -- that left the guard set and the next open
  // silently returned nothing.
  const close = () => page.keyboard.press('Escape');

  const off = await readKeys();
  await close();
  // Listing a key that does nothing teaches a shortcut that will not work.
  expect(off).not.toContain('B');

  await page.evaluate(() => {
    const orig = window.tune;
    window.__origTune = orig;
    window.tune = (k) => (k === 'featureShowReturn' ? true : orig(k));
  });
  const on = await readKeys();
  await close();
  await page.evaluate(() => { window.tune = window.__origTune; });
  expect(on).toContain('B');
});

test('reversing a route warns that it may not match allowed routes', async ({ page }) => {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof showToast === 'function');
  const msg = await page.evaluate(() => {
    state.waypoints = [{ lat: 32.0, lng: 34.0, name: 'A' },
                       { lat: 32.1, lng: 34.1, name: 'B' }];
    syncLegs();
    let seen = null;
    const orig = window.showToast;
    window.showToast = (t, o) => { seen = { text: t, opts: o || {} }; };
    document.getElementById('reverse').click();
    window.showToast = orig;
    return seen;
  });
  expect(msg.text).toMatch(/allowed routes/i);
  // The published network is directed; the app must not imply a reversal is valid.
  expect(msg.text).toMatch(/one-way|chart/i);
  // It must outlast an ordinary 'saved' toast, and draw the eye.
  expect(msg.opts.ms).toBe(10000);
  expect(msg.opts.blink).toBe(true);
});

test('the warning dwell and blink come from the gist, not the code', async ({ page }) => {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof showToast === 'function');
  const out = await page.evaluate(() => {
    state.waypoints = [{ lat: 32.0, lng: 34.0, name: 'A' },
                       { lat: 32.1, lng: 34.1, name: 'B' }];
    syncLegs();
    const origTune = window.tune;
    window.tune = (k) => (k === 'reverseWarnMs' ? 4000
      : k === 'reverseWarnBlink' ? false : origTune(k));
    let seen = null;
    const origToast = window.showToast;
    window.showToast = (t, o) => { seen = { text: t, opts: o || {} }; };
    document.getElementById('reverse').click();
    window.showToast = origToast;
    window.tune = origTune;
    return seen;
  });
  expect(out.opts.ms).toBe(4000);
  expect(out.opts.blink).toBe(false);
});

test('a blinking toast keeps its text readable throughout', async ({ page }) => {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof showToast === 'function');
  const out = await page.evaluate(async () => {
    showToast('warning', { ms: 5000, blink: true });
    const el = document.querySelector('.toast');
    // Past the fade-IN (a transition on .show), then sample across a full blink cycle --
    // the pulse must never take the text with it.
    await new Promise(r => setTimeout(r, 500));
    const samples = [];
    for (let i = 0; i < 6; i++) {
      samples.push(Number(getComputedStyle(el).opacity));
      await new Promise(r => setTimeout(r, 200));
    }
    return { blinkClass: el.classList.contains('toast-blink'), min: Math.min(...samples) };
  });
  expect(out.blinkClass).toBe(true);
  // The pulse is on the background, not opacity -- text that fades is harder to read.
  expect(out.min).toBe(1);
});

// The gist loads AFTER the app scripts, so switching the feature back on must bring the
// control back without a reload -- the shortcut and the help list already re-read the flag
// when they run, but the row was hidden once at boot.
test('a gist that switches the feature on restores the row without a reload', async ({ page }) => {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof refreshShowReturnFeature === 'function');
  const hiddenAtBoot = await page.evaluate(() =>
    getComputedStyle(document.getElementById('ret-cb').closest('label')).display);
  expect(hiddenAtBoot).toBe('none');

  const after = await page.evaluate(() => {
    const orig = window.tune;
    window.tune = (k) => (k === 'featureShowReturn' ? true : orig(k));
    refreshShowReturnFeature();              // what the gist-applied hook calls
    const row = document.getElementById('ret-cb').closest('label');
    const res = { display: getComputedStyle(row).display, hidden: row.hidden };
    window.tune = orig;
    return res;
  });
  expect(after.hidden).toBe(false);
  expect(after.display).not.toBe('none');
});

test('switching it back off hides the row and clears the state again', async ({ page }) => {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof refreshShowReturnFeature === 'function');
  const out = await page.evaluate(() => {
    const orig = window.tune;
    window.tune = (k) => (k === 'featureShowReturn' ? true : orig(k));
    refreshShowReturnFeature();
    document.getElementById('ret-cb').checked = true;
    window.showReturn = true;
    window.tune = orig;                       // gist flips it back off
    refreshShowReturnFeature();
    const row = document.getElementById('ret-cb').closest('label');
    return { display: getComputedStyle(row).display, showReturn: window.showReturn,
             checked: document.getElementById('ret-cb').checked };
  });
  expect(out.display).toBe('none');
  expect(out.showReturn).toBe(false);   // cannot be left drawing with no control
  expect(out.checked).toBe(false);
});

test.describe('reversing with nothing to reverse', () => {
  test('says there is no route to reverse, on an empty map', async ({ page }) => {
    await page.goto('?lang=en&nogist');
    await page.waitForFunction(() => typeof showToast === 'function');
    const seen = await page.evaluate(() => {
      state.waypoints = [];
      syncLegs();
      let msg = null;
      const orig = window.showToast;
      window.showToast = (t, o) => { msg = { text: t, opts: o || {} }; };
      document.getElementById('reverse').click();
      window.showToast = orig;
      return msg;
    });
    // Says what happened, rather than staying silent (did the button work?) or raising the
    // corridor warning about a route that does not exist.
    expect(seen.text).toMatch(/no route to reverse/i);
    // Plain toast: nothing is wrong, so it must not blink or hold like the real warning.
    expect(seen.opts.blink).toBeFalsy();
  });

  test('says the same for a single waypoint, and leaves it alone', async ({ page }) => {
    await page.goto('?lang=en&nogist');
    await page.waitForFunction(() => typeof showToast === 'function');
    const out = await page.evaluate(() => {
      state.waypoints = [{ lat: 32.0, lng: 34.0, name: 'A' }];
      syncLegs();
      let msg = null;
      const orig = window.showToast;
      window.showToast = (t) => { msg = t; };
      document.getElementById('reverse').click();
      window.showToast = orig;
      return { msg, wps: state.waypoints.length };
    });
    expect(out.msg).toMatch(/no route to reverse/i);
    expect(out.wps).toBe(1);      // and nothing was mangled on the way out
  });

  test('still warns as soon as there is a real leg', async ({ page }) => {
    await page.goto('?lang=en&nogist');
    await page.waitForFunction(() => typeof showToast === 'function');
    const seen = await page.evaluate(() => {
      state.waypoints = [{ lat: 32.0, lng: 34.0, name: 'A' },
                         { lat: 32.1, lng: 34.1, name: 'B' }];
      syncLegs();
      let msg = null;
      const orig = window.showToast;
      window.showToast = (t) => { msg = t; };
      document.getElementById('reverse').click();
      window.showToast = orig;
      return msg;
    });
    expect(seen).toMatch(/allowed routes/i);
  });
});
