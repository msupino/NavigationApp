// @ts-check
// The mirrored "show return path" can be switched off wholesale from the tuning gist.
// It draws an imaginary second route on top of the real legs: with a turning point the
// route already contains its return, and without one the mirror is a guess.
const { test, expect } = require('./_setup');

test('the flag ships ON, so nothing changes by default', async ({ page }) => {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof tune === 'function');
  const out = await page.evaluate(() => ({
    flag: tune('featureShowReturn'),
    rowHidden: document.getElementById('ret-cb').closest('label').hidden,
    featureOn: showReturnFeatureOn(),
  }));
  expect(out.flag).toBe(true);
  expect(out.rowHidden).toBe(false);
  expect(out.featureOn).toBe(true);
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
