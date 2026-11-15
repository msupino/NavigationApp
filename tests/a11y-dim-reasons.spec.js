// Dimmed controls carry their reason in title / aria-description, and the hand-built windows
// are named dialogs that take focus on open and give it back.
const { test, expect } = require('./_setup');

async function open(page, lang = 'en') {
  await page.goto('?lang=' + lang + '&nogist');
  await page.waitForFunction(() => typeof window.setButtonWhy === 'function' && document.getElementById('tool-save-route-wide'));
}

test('setButtonWhy puts the reason in title and aria-description and restores the title', async ({ page }) => {
  await open(page);
  const r = await page.evaluate(() => {
    const b = document.createElement('button');
    b.title = 'Normal';
    document.body.appendChild(b);
    setButtonWhy(b, 'Because');
    const dim = { title: b.title, desc: b.getAttribute('aria-description') };
    setButtonWhy(b, null);
    return { dim, live: { title: b.title, desc: b.getAttribute('aria-description') } };
  });
  expect(r.dim).toEqual({ title: 'Because', desc: 'Because' });
  expect(r.live).toEqual({ title: 'Normal', desc: null });
});

test('Save route says why in its tooltip and description on an empty route', async ({ page }) => {
  await open(page);
  await page.waitForFunction(() => document.getElementById('tool-save-route-wide').classList.contains('is-dim'));
  const r = await page.evaluate(() => {
    const b = document.getElementById('tool-save-route-wide');
    return { title: b.title, desc: b.getAttribute('aria-description') };
  });
  expect(r.desc).toMatch(/nothing to save/i);
  expect(r.title).toBe(r.desc);
});

test('coordinate readout is a keyboard button; zoom readout is labelled', async ({ page }) => {
  await open(page);
  const c = page.locator('#coord-readout');
  await expect(c).toHaveAttribute('role', 'button');
  await expect(c).toHaveAttribute('tabindex', '0');
  await expect(c).toHaveAttribute('aria-label', /.+/);
  await c.focus();
  await page.keyboard.press('Enter');
  await expect(c).toHaveClass(/editing/);
  await expect(page.locator('#zoom-readout')).toHaveAttribute('aria-label', /.+/);
});

test('hand-built windows are named dialogs, take focus, and give it back', async ({ page }) => {
  await open(page);
  const r = await page.evaluate(async () => {
    const btn = document.getElementById('tool-save-route-wide');
    btn.focus();
    window.sigmetMeta = {};
    showMetList('sigmet', [{ raw: 'LLLL SIGMET 1 VALID 010000/010400 LLBD-', id: 'x' }]);
    const back = document.querySelector('.modal-back');
    const box = back.querySelector('.modal');
    const out = {
      role: box.getAttribute('role'), modal: box.getAttribute('aria-modal'),
      name: !!document.getElementById(box.getAttribute('aria-labelledby')),
      inside: box.contains(document.activeElement),
    };
    back.remove();
    await new Promise(r => setTimeout(r, 50));
    out.restored = document.activeElement === btn;
    return out;
  });
  expect(r).toEqual({ role: 'dialog', modal: 'true', name: true, inside: true, restored: true });
});

test('deck sheet is named and Escape closes it from inside', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await open(page);
  await page.waitForSelector('#deck-sheet', { state: 'attached' });
  const sheet = page.locator('#deck-sheet');
  await expect(sheet).toHaveAttribute('aria-labelledby', 'deck-sheet-title');
  await page.evaluate(() => { const s = document.getElementById('deck-sheet'); s.hidden = false; s.querySelector('.deck-sheet-close').focus(); });
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
});

// Icon-only (asked, like Divert): no words on the button, so its accessible name starts with the
// short label (voice control: "tap Comm fail") and the title shows that label on a mouse.
for (const lang of ['en', 'he']) test('comm fail strip is icon-only and its name starts with the label (' + lang + ')', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await open(page, lang);
  const r = await page.evaluate(() => {
    const b = document.querySelector('.deck-strip-commfail');
    return b && { label: b.getAttribute('aria-label'), title: b.title, text: b.textContent.trim(),
      svg: b.querySelectorAll('svg').length, want: S.deckCommFail };
  });
  expect(r).not.toBeNull();
  expect(r.text).toBe('');
  expect(r.svg).toBe(1);
  expect(r.title).toBe(r.want);
  expect(r.label.startsWith(r.want)).toBe(true);
});
