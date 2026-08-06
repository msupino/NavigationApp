// @ts-check
// The wind field can only be drawn north-up: leaflet-velocity derives its field bounds from
// two opposite viewport corners, which is only valid at bearing 0 (at 45° the latitude span
// it computes is less than half the real one), so on a rotated map the field lands off the
// viewport. Rather than offer a toggle that cannot produce a field and only explain itself in
// a status line after it is ticked, the toggle is disabled while the map is rotated, with a
// note beside its label.
const { test, expect } = require('./_setup');

async function boot(page) {
  await page.addInitScript(() => {
    try {
      for (const s of ['build', 'view', 'display', 'charts', 'export', 'print', 'weather'])
        localStorage.setItem('navaid.sec.' + s, '1');
    } catch (e) {}
  });
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof map !== 'undefined' &&
    !!document.getElementById('windfield-cb') &&
    !!document.getElementById('windfield-north-note'));
}

const state = page => page.evaluate(() => {
  const cb = document.getElementById('windfield-cb');
  const note = document.getElementById('windfield-north-note');
  return {
    bearing: map.getBearing ? map.getBearing() : 0,
    disabled: cb.disabled,
    checked: cb.checked,
    noteVisible: !note.hidden,
    noteText: (note.textContent || '').trim(),
    noteTitle: note.title || '',
    labelDimmed: !!(cb.closest('label') && cb.closest('label').classList.contains('navtoggle-disabled')),
  };
});

async function setBearing(page, deg) {
  await page.evaluate(d => { map.setBearing(d); }, deg);
  // The overlay coalesces rotate events into one frame.
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
}

test('rotating the map disables the wind-field toggle and explains why', async ({ page }) => {
  await boot(page);
  const north = await state(page);
  expect(north.disabled).toBe(false);
  expect(north.noteVisible).toBe(false);

  await setBearing(page, 40);
  const rotated = await state(page);
  expect(rotated.bearing).toBe(40);
  // Disabled, dimmed, and the reason is next to the control instead of only in a status
  // line that appears after ticking it.
  expect(rotated.disabled).toBe(true);
  expect(rotated.labelDimmed).toBe(true);
  expect(rotated.noteVisible).toBe(true);
  expect(rotated.noteText).toMatch(/north-up only/i);
  expect(rotated.noteTitle).toMatch(/0°|north/i);

  await setBearing(page, 0);
  const back = await state(page);
  expect(back.disabled).toBe(false);
  expect(back.noteVisible).toBe(false);
});

test('a field that was on comes back by itself at 0°', async ({ page }) => {
  await boot(page);
  // Pretend it was enabled: the checked state must survive the rotation, or a pilot who
  // rotates to look at something loses the overlay permanently.
  await page.evaluate(() => { document.getElementById('windfield-cb').checked = true; });
  await setBearing(page, 25);
  const rotated = await state(page);
  expect(rotated.disabled).toBe(true);
  expect(rotated.checked).toBe(true);        // not silently unticked
  await setBearing(page, 0);
  const back = await state(page);
  expect(back.checked).toBe(true);
  expect(back.disabled).toBe(false);
});

test('a page loaded on a rotated map starts disabled', async ({ page }) => {
  await page.addInitScript(() => {
    try {
      for (const s of ['build', 'view', 'display', 'charts', 'export', 'print', 'weather'])
        localStorage.setItem('navaid.sec.' + s, '1');
      // A persisted rotated view, which is what a reload restores.
      localStorage.setItem('navaid.view', JSON.stringify({ lat: 32.1, lng: 34.9, zoom: 11, bearing: 30 }));
    } catch (e) {}
  });
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof map !== 'undefined' &&
    !!document.getElementById('windfield-north-note'));
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  const s = await state(page);
  // The availability call runs at boot too, not only on the first rotate event.
  if (s.bearing !== 0) {
    expect(s.disabled).toBe(true);
    expect(s.noteVisible).toBe(true);
  }
});

test('the note is translated', async ({ page }) => {
  await page.goto('?lang=he&nogist');
  await page.waitForFunction(() => typeof S === 'object' && !!S.windFieldNorthUpNote);
  const he = await page.evaluate(() => ({ note: S.windFieldNorthUpNote, title: S.windFieldNorthUpNoteTitle }));
  // A Hebrew session must not get the English fallback at the one moment the wording
  // explains why a control is dead.
  expect(he.note).toMatch(/[֐-׿]/);
  expect(he.title).toMatch(/[֐-׿]/);
});
