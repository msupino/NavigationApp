// @ts-check
// A note is a piece of paper laid on the chart, and it has an angle of its own: a label that
// reads along a coastline, a runway or a valley. That angle belongs to the note and to
// nothing else -- not the map bearing, not the leg it happens to sit beside.
const { test, expect } = require('./_setup');

async function boot(page) {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof state !== 'undefined' && typeof draw === 'function'
    && typeof showInspector === 'function' && typeof noteDrawAngle === 'function');
}

async function addNote(page, extra = {}) {
  await page.evaluate((x) => {
    state.notes = [Object.assign({ lat: 32.0, lng: 34.9, text: 'ridge' }, x)];
    state.selected = { type: 'note', index: 0 };
    draw();
    showInspector();
  }, extra);
}

const rotRow = (page) => page.locator('#insp-body .row', { hasText: 'Rotation' });

test('a note carries its own angle, in degrees', async ({ page }) => {
  await boot(page);
  await addNote(page);
  await expect(rotRow(page)).toBeVisible();
  await page.evaluate(() => {
    const r = [...document.querySelectorAll('#insp-body .row')]
      .find(el => el.textContent.includes('Rotation'));
    const input = r.querySelector('input[type="range"]');
    input.value = '45';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const got = await page.evaluate(() => ({
    stored: state.notes[0].rot,
    radians: noteDrawAngle(state.notes[0]),
  }));
  expect(got.stored).toBe(45);
  // Degrees on the note, radians at the point of drawing: 45 degrees is a quarter of pi/2.
  expect(got.radians).toBeCloseTo(Math.PI / 4, 5);
});

test('the angle is the note\'s alone: turning the map does not move it', async ({ page }) => {
  await boot(page);
  await addNote(page, { rot: 30 });
  const before = await page.evaluate(() => noteDrawAngle(state.notes[0]));
  await page.evaluate(() => { if (map.setBearing) map.setBearing(90); draw(); });
  const after = await page.evaluate(() => noteDrawAngle(state.notes[0]));
  // Rotating the chart rotates the whole canvas; the note's own angle is not part of that
  // and must not be quietly added to or cancelled by it.
  expect(after).toBeCloseTo(before, 6);
});

test('the clickable region turns with the note', async ({ page }) => {
  await boot(page);
  await addNote(page, { text: 'a long label that makes a wide box', rot: 90 });
  // hitNote un-rotates by noteDrawAngle before testing the box, so a turned note is hit
  // where it is painted rather than where it used to be. A wide box turned on its end is
  // tall: a point well above the anchor is inside it only when the rotation is honoured.
  const hit = await page.evaluate(() => {
    const s = proj(state.notes[0]);
    const r = noteRect(0);
    // Half the box's WIDTH above the centre: outside an unrotated box, inside a turned one.
    const probeY = s.y - (r.w / 2) * 0.6;
    return { turned: hitNote(s.x, probeY), flatCheck: (r.h / 2) < (r.w / 2) * 0.6 };
  });
  expect(hit.flatCheck, 'the probe must be outside the unrotated box for this to prove anything').toBe(true);
  expect(hit.turned).toBe(0);
});

test('a note with no angle set behaves exactly as before', async ({ page }) => {
  await boot(page);
  await addNote(page);
  expect(await page.evaluate(() => noteDrawAngle(state.notes[0]))).toBe(0);
  expect(await page.evaluate(() => state.notes[0].rot)).toBeUndefined();
});

test('an identification-point oval keeps its across-the-leg alignment', async ({ page }) => {
  await boot(page);
  // Report-point ovals are aligned across their leg by rule. The inspector offers them no
  // rotation control, and the rule must survive regardless.
  await page.evaluate(() => {
    state.waypoints = [{ lat: 32.0, lng: 34.9, name: 'A' }, { lat: 32.4, lng: 35.2, name: 'B' }];
    syncLegs();
    state.notes = [{ lat: 32.2, lng: 35.05, text: '12:00', rp: { leg: 0, t: 0.5 } }];
    state.selected = { type: 'note', index: 0 };
    draw();
    showInspector();
  });
  await expect(rotRow(page)).toHaveCount(0);
  expect(await page.evaluate(() => Math.abs(noteDrawAngle(state.notes[0])) > 0.01)).toBe(true);
});

test('the angle rides along when the route is saved and loaded again', async ({ page }) => {
  await boot(page);
  await addNote(page, { rot: 135 });
  // A route serializes through an explicit allowlist, so a new note property is dropped on
  // the way out AND on the way back in unless it is added there. An angle that survived in
  // memory and vanished from the saved file would be worse than no control at all: the
  // pilot would lay every note out again on the next flight.
  const round = await page.evaluate(() => {
    const data = JSON.parse(JSON.stringify(serializeRoute()));
    const inFile = data.notes[0].rot;
    state.notes = [];
    applyRouteData(data);
    return { inFile, afterLoad: state.notes[0].rot };
  });
  expect(round.inFile).toBe(135);
  expect(round.afterLoad).toBe(135);
});

test('a saved route keeps the angle, through the library and its validator', async ({ page }) => {
  await boot(page);
  // The Saved-routes library is a different path from the JSON export: it stores
  // serializeRoute() and applies it back through validateRoute() and applyRouteData(). A
  // validator that rejected an unknown field, or a load path missing the property, would
  // lose the angle exactly where a pilot expects it kept.
  await page.evaluate(() => {
    state.waypoints = [{ lat: 32.0, lng: 34.9, name: 'A' }, { lat: 32.3, lng: 35.1, name: 'B' }];
    syncLegs();
    state.notes = [{ lat: 32.1, lng: 34.95, text: 'ridge', rot: 60 }];
  });
  const round = await page.evaluate(() => {
    const entry = routeLibrarySaveCurrent('rot test');
    const stored = entry && entry.data.notes[0].rot;
    const invalid = typeof validateRoute === 'function' ? validateRoute(entry.data) : null;
    state.notes = [];
    state.waypoints = [];
    syncLegs();
    const applied = routeLibraryApply(entry);
    return { stored, invalid, applied, after: state.notes.length ? state.notes[0].rot : null };
  });
  expect(round.stored).toBe(60);
  expect(round.invalid, 'the validator must not reject a route carrying a note angle').toBeNull();
  expect(round.applied).toBe(true);
  expect(round.after).toBe(60);
});

test('a note left straight adds nothing to the saved file', async ({ page }) => {
  await boot(page);
  await addNote(page);
  // Zero is the default: writing it would grow every route file ever saved for nothing.
  const keys = await page.evaluate(() => Object.keys(serializeRoute().notes[0]));
  expect(keys).not.toContain('rot');
});
