// @ts-check
// Coverage for the note inspector's colorRow + shape selectRow: editing a
// selected note's colour and shape mutates state.notes[i] live.
const { test, expect } = require('./_setup');

async function bootWithNote(page) {
  await page.goto('?lang=en');
  await page.waitForFunction(() =>
    typeof state !== 'undefined' && typeof showInspector === 'function');
  await page.evaluate(() => {
    state.notes = [{ lat: 32.1, lng: 34.9, text: 'X', color: '#fff6aa', shape: 'rect' }];
    state.selected = { type: 'note', index: 0 };
    draw(); showInspector();
  });
}

test.describe('Note inspector edits', () => {
  test('color picker updates state.notes[i].color', async ({ page }) => {
    await bootWithNote(page);
    await page.evaluate(() => {
      const inp = document.querySelector('#insp-body input[type=color]');
      inp.value = '#ff0000';
      inp.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(await page.evaluate(() => state.notes[0].color)).toBe('#ff0000');
  });

  test('shape selector toggles state.notes[i].shape between rect and oval', async ({ page }) => {
    await bootWithNote(page);
    await page.locator('#insp-body select').selectOption('oval');
    expect(await page.evaluate(() => state.notes[0].shape)).toBe('oval');
    await page.locator('#insp-body select').selectOption('rect');
    expect(await page.evaluate(() => state.notes[0].shape)).toBe('rect');
  });
});

test.describe('Note resize', () => {
  test('size slider scales state.notes[i].size and grows the drawn rect', async ({ page }) => {
    await bootWithNote(page);
    const before = await page.evaluate(() => { const r = noteRect(0); return { w: r.w, h: r.h }; });
    // The range input in the note inspector is the size slider.
    await page.evaluate(() => {
      const inp = document.querySelector('#insp-body input[type=range]');
      inp.value = '1.5';                       // top of the symmetric 0.5–1.5 range
      inp.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(await page.evaluate(() => state.notes[0].size)).toBe(1.5);
    const after = await page.evaluate(() => { const r = noteRect(0); return { w: r.w, h: r.h }; });
    expect(after.w).toBeGreaterThan(before.w);
    expect(after.h).toBeCloseTo(before.h * 1.5, 0);   // height scales with size
  });

  test('the note size slider has a ↻ reset to default (100%)', async ({ page }) => {
    await bootWithNote(page);
    await page.evaluate(() => { state.notes[0].size = 2.5; state.selected = { type: 'note', index: 0 }; showInspector(); });
    const reset = page.locator('#insp-body .row .slider-reset');
    await expect(reset).toHaveCount(1);
    await reset.click();
    expect(await page.evaluate(() => state.notes[0].size)).toBe(1);
  });

  test('an oval note is the same box as a rectangle note', async ({ page }) => {
    await bootWithNote(page);
    const out = await page.evaluate(() => {
      window.pageOrient = 'landscape';
      if (pageSize !== 'A4') setPage('A4');
      draw();
      state.notes[0].shape = 'oval'; const ov = noteRect(0);
      state.notes[0].shape = 'rect'; const rc = noteRect(0);
      return { ovW: ov.w, ovH: ov.h, rcW: rc.w, rcH: rc.h };
    });
    expect(out.ovW).toBeCloseTo(out.rcW, 1);
    expect(out.ovH).toBeCloseTo(out.rcH, 1);
  });

  test('a note grows and shrinks with the map zoom, like the leg kites', async ({ page }) => {
    await bootWithNote(page);
    const at = async z => page.evaluate(zz => {
      map.setZoom(zz); draw();
      const r = noteRect(0);
      return { scale: noteScale(state.notes[0]), w: r.w, h: r.h };
    }, z);
    const z12 = await at(12);
    const z14 = await at(14);
    // Two whole zoom levels = 2^2 = 4× on the same curve legZoomScale uses.
    expect(z14.scale / z12.scale).toBeCloseTo(4, 1);
    expect(z14.h / z12.h).toBeCloseTo(4, 1);
    expect(z14.w).toBeGreaterThan(z12.w);
  });

  test('a default note rectangle is a fixed ground size that prints at 21 × 14 mm', async ({ page }) => {
    await bootWithNote(page);
    const out = await page.evaluate(() => {
      // A short single-line note so the box sits at its default (min) size.
      state.notes = [{ lat: 32.1, lng: 34.9, text: 'X', shape: 'rect' }];
      window.pageOrient = 'landscape';
      if (pageSize !== 'A4') setPage('A4');
      draw();
      // Geographic sizing: mm = screenPx / printPxPerMm (= 250/metresPerPixel).
      const ppm = printPxPerMm();
      const r = noteRect(0);
      return { wMm: r.w / ppm, hMm: r.h / ppm,
               tw: tune('notePrintWidthMm'), th: tune('notePrintHeightMm') };
    });
    expect(out.tw).toBe(21);
    expect(out.th).toBe(14);
    expect(out.wMm).toBeCloseTo(21, 1);
    expect(out.hMm).toBeCloseTo(14, 1);
  });

  test('note size round-trips through serializeRoute', async ({ page }) => {
    await bootWithNote(page);
    const blob = await page.evaluate(() => {
      state.notes[0].size = 1.75;
      return serializeRoute();
    });
    expect(blob.notes[0].size).toBe(1.75);
    // size === 1 is the default and must NOT be serialized (no schema churn).
    const blob1 = await page.evaluate(() => { state.notes[0].size = 1; return serializeRoute(); });
    expect('size' in blob1.notes[0]).toBe(false);
  });

  test('a selected item takes drag precedence over an overlapping chooser', async ({ page }) => {
    await bootWithNote(page);
    const out = await page.evaluate(() => {
      state.waypoints = [{ lat: 32.2, lng: 34.88, name: 'A' }, { lat: 32.55, lng: 34.92, name: 'B' }];
      syncLegs(); fitView();
      state.notes = [{ lat: 32.38, lng: 34.9, text: 'NOTE' }];
      state.selected = { type: 'note', index: 0 };
      draw();
      const r = noteRect(0), cx = r.x + r.w / 2, cy = r.y + r.h / 2;
      const onIt = grabSelected(cx, cy, map.containerPointToLatLng([cx, cy]));
      const away = (() => {
        const ax = r.x + r.w + 300, ay = r.y + r.h + 300;
        return grabSelected(ax, ay, map.containerPointToLatLng([ax, ay]));
      })();
      state.selected = null;
      const none = grabSelected(cx, cy, map.containerPointToLatLng([cx, cy]));
      return { onIt, away, none };
    });
    expect(out.onIt).toBe(true);    // press on the selected item → grabbed for drag
    expect(out.away).toBe(false);   // press elsewhere → not hijacked
    expect(out.none).toBe(false);   // nothing selected → no precedence grab
  });
});
