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
