// @ts-check
// Per-leg drift-line hiding, the counterpart to "Hide kite": on a busy chart several legs'
// drift cones overlap into noise, and the pilot wants one leg's cone gone without losing the
// leg, its kite, or anything the plan computes.
const { test, expect } = require('./_setup');

async function boot(page) {
  await page.addInitScript(() => {
    try {
      for (const s of ['build', 'view', 'display', 'export', 'print'])
        localStorage.setItem('navaid.sec.' + s, '1');
    } catch (e) {}
  });
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof state !== 'undefined' &&
    typeof showInspector === 'function' && typeof legDriftHidden === 'function');
  await page.evaluate(() => {
    state.waypoints = [
      { lat: 32.10, lng: 34.85, name: 'A' },
      { lat: 32.40, lng: 35.05, name: 'B' },
      { lat: 32.60, lng: 35.30, name: 'C' },
    ];
    syncLegs();
    draw();
  });
}

const driftBtn = page => page.evaluate(() => {
  const b = Array.from(document.querySelectorAll('#insp-body button.insp-btn'))
    .find(x => /drift/i.test(x.textContent));
  return b ? { text: b.textContent, pressed: b.getAttribute('aria-pressed'), title: b.title } : null;
});

const clickDrift = page => page.evaluate(() => {
  const b = Array.from(document.querySelectorAll('#insp-body button.insp-btn'))
    .find(x => /drift/i.test(x.textContent));
  if (!b) throw new Error('no drift button in the leg inspector');
  b.click();
});

test('the leg inspector offers hiding this leg\'s drift lines, and restoring them', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => { state.selected = { type: 'leg', index: 0 }; showInspector(); });
  const before = await driftBtn(page);
  expect(before, 'no drift button on a selected leg').not.toBeNull();
  expect(before.text).toMatch(/hide/i);
  expect(before.pressed).toBe('false');

  await clickDrift(page);
  expect(await page.evaluate(() => legDriftHidden(state.legs[0]))).toBe(true);
  // The button relabels to what it now does — this is how the pilot gets them back.
  const after = await driftBtn(page);
  expect(after.text).toMatch(/show/i);
  expect(after.pressed).toBe('true');

  await clickDrift(page);
  expect(await page.evaluate(() => legDriftHidden(state.legs[0]))).toBe(false);
  expect(await page.evaluate(() => 'hideDrift' in state.legs[0])).toBe(false);   // removed, not falsy
});

test('hiding one leg\'s drift lines leaves every other leg drawing its own', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(() => {
    state.legs[0].hideDrift = 1;
    return { leg0: legDriftHidden(state.legs[0]), leg1: legDriftHidden(state.legs[1]) };
  });
  expect(r.leg0).toBe(true);
  expect(r.leg1).toBe(false);
});

test('the leg, its kite and the plan are untouched', async ({ page }) => {
  await boot(page);
  const snap = () => {
    const leg = state.legs[0];
    const { dist, brg } = geo(state.waypoints[0], state.waypoints[1]);
    return { dist: +dist.toFixed(6), brg: +brg.toFixed(6), kite: legKiteHidden(leg),
      wps: state.waypoints.length, legs: state.legs.length,
      inAlt: leg.inboundAltitude, speed: leg.flightSpeed };
  };
  const r = await page.evaluate(`(() => {
    const snap = ${snap.toString()};
    const before = snap();
    state.legs[0].hideDrift = 1;
    draw();
    return { before, after: snap() };
  })()`);
  // Decluttering is a drawing choice, never a navigational one.
  expect(r.after).toEqual(r.before);
});

test('hiding the drift lines does not move the kite', async ({ page }) => {
  await boot(page);
  // The kite is placed just outside the drift cone. It must keep that offset when the cone
  // is hidden -- otherwise decluttering one leg makes its kite jump, which reads as a bug.
  const r = await page.evaluate(() => {
    const at = () => (typeof legLabelCenter === 'function' ? legLabelCenter(0, 'in') : null);
    const before = at();
    state.legs[0].hideDrift = 1;
    draw();
    const after = at();
    return { before, after };
  });
  expect(r.after).toEqual(r.before);
});

test('the choice survives a save/load round trip', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(() => {
    state.legs[1].hideDrift = 1;
    const parsed = JSON.parse(JSON.stringify(serializeRoute()));
    return { wrote: parsed.legs.map(l => l.hideDrift || 0), errs: validateRoute(parsed) };
  });
  // Written only for the leg that set it, and only as the literal 1 the validator accepts.
  expect(r.wrote).toEqual([0, 1]);
  expect(r.errs).toBeNull();          // validateRoute: null when clean, a joined string when not
});

test('the validator rejects anything but the literal 1', async ({ page }) => {
  await boot(page);
  const errs = await page.evaluate(() => {
    const d = JSON.parse(JSON.stringify(serializeRoute()));
    d.legs[0].hideDrift = 'false';       // truthy, but not something the app can honour
    return validateRoute(d);
  });
  // Same rule as hideKite: a file saying `"false"` is saying something the app cannot
  // honestly interpret, so it is an error rather than a silently-truthy hide.
  expect(errs).toMatch(/hideDrift: expected 1, got "false"/);
});

test('reversing the route keeps each leg\'s drift choice with its leg', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(() => {
    state.legs[0].hideDrift = 1;                   // A→B decluttered
    const namesBefore = state.waypoints.map(w => w.name);
    document.getElementById('reverse').click();
    return { namesBefore, namesAfter: state.waypoints.map(w => w.name),
      hidden: state.legs.map(l => (l.hideDrift ? 1 : 0)) };
  });
  expect(r.namesAfter).toEqual(r.namesBefore.slice().reverse());
  // Reverse REBUILDS each leg field by field, so an unlisted field is silently dropped —
  // which is exactly how a deliberately decluttered leg would redraw its cone after a
  // reverse. A→B was hidden, so after reversal that same segment is the LAST leg.
  expect(r.hidden).toEqual([0, 1]);
});

test('hiding every leg draws exactly what the global toggle off draws', async ({ page }) => {
  await boot(page);
  // Ink on the route canvas is the honest measure: it counts what the pilot actually sees,
  // not what a flag says. If the per-leg gate did anything beyond suppressing that leg's
  // cone, these two numbers would differ.
  const r = await page.evaluate(() => {
    const cb = document.getElementById('drift-cb');
    if (cb && !cb.checked) { cb.checked = true; cb.dispatchEvent(new Event('change')); }
    const ink = () => {
      const c = document.getElementById('overlay');
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 16) n++;
      return n;
    };
    draw(); const all = ink();
    for (const l of state.legs) l.hideDrift = 1;
    draw(); const eachHidden = ink();
    for (const l of state.legs) delete l.hideDrift;
    cb.checked = false; cb.dispatchEvent(new Event('change'));
    draw(); const globalOff = ink();
    return { all, eachHidden, globalOff };
  });
  expect(r.eachHidden).toBeLessThan(r.all);        // something actually disappeared...
  expect(r.eachHidden).toBe(r.globalOff);          // ...and exactly the cones, nothing else
});
