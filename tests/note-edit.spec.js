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
      inp.value = '2';
      inp.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(await page.evaluate(() => state.notes[0].size)).toBe(2);
    const after = await page.evaluate(() => { const r = noteRect(0); return { w: r.w, h: r.h }; });
    expect(after.w).toBeGreaterThan(before.w);
    expect(after.h).toBeCloseTo(before.h * 2, 0);   // height scales with size
  });

  test('the note size slider has a ↻ reset to default (100%)', async ({ page }) => {
    await bootWithNote(page);
    await page.evaluate(() => { state.notes[0].size = 2.5; state.selected = { type: 'note', index: 0 }; showInspector(); });
    const reset = page.locator('#insp-body .row .slider-reset');
    await expect(reset).toHaveCount(1);
    await reset.click();
    expect(await page.evaluate(() => state.notes[0].size)).toBe(1);
  });

  test('framed A4 export: an oval note prints the same box as a rectangle note', async ({ page }) => {
    await bootWithNote(page);
    const out = await page.evaluate(() => {
      window.pageOrient = 'landscape';
      if (pageSize !== 'A4') setPage('A4');
      draw();
      const fr = pageFrameRect(), paperW = 297;
      NavAid._exportPxPerMm = fr.w / paperW;
      state.notes[0].shape = 'oval'; const ov = noteRect(0);
      state.notes[0].shape = 'rect'; const rc = noteRect(0);
      NavAid._exportPxPerMm = 0;
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

  test('framed A4 export sizes a default note rectangle to 21 × 14 mm', async ({ page }) => {
    await bootWithNote(page);
    const out = await page.evaluate(() => {
      // A short single-line note so the box sits at its default (min) size.
      state.notes = [{ lat: 32.1, lng: 34.9, text: 'X', shape: 'rect' }];
      window.pageOrient = 'landscape';
      if (pageSize !== 'A4') setPage('A4');
      draw();
      const fr = pageFrameRect();
      const paperW = 297;                        // A4 landscape width in mm
      NavAid._exportPxPerMm = fr.w / paperW;     // screen px per paper mm
      const r = noteRect(0);
      NavAid._exportPxPerMm = 0;
      // printed mm = screenPx * paperW / fr.w
      return { wMm: r.w * paperW / fr.w, hMm: r.h * paperW / fr.w,
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
});
