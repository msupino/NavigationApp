// @ts-check
// Every chart window announces itself the same way.
//
// Three windows are hand-built (the SIGWX and PWX viewers, the offline manager) and declared
// role="dialog"; the nine from createDraggableModal declared nothing at all. Same kind of
// window, different announcement, depending on which file happened to make it. And not one
// of the twelve had an accessible name, though every one of them has a visible title sitting
// right there to point at -- so they all opened as an unnamed "dialog".
//
// aria-modal is deliberately not universal. The factory traps Tab either way, so a keyboard
// user cannot leave any of these; but a non-blocking window leaves the map live under the
// pointer on purpose, and claiming the rest of the page is inert would be a promise it does
// not keep.
const { test, expect } = require('./_setup');

// The suite switches the safety notice off by default; the test below is about it.
test.use({ acknowledgeDisclaimer: false });

const OPENERS = ['route-templates', 'freq-table', 'alt-pairs', 'nav-log', 'charts', 'sigwx-btn',
  'pwx-btn', 'sigmet-btn', 'route-check-btn', 'plan', 'route-library', 'offline-tiles-btn'];

async function boot(page) {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.addInitScript(() => {
    for (const s of ['build', 'view', 'display', 'charts', 'export', 'print'])
      try { localStorage.setItem('navaid.sec.' + s, '1'); } catch (e) {}
  });
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof draw === 'function'
    && !document.documentElement.classList.contains('app-booting'));
  await page.evaluate(() => {
    const b = document.getElementById('boot-loading'); if (b) b.remove();
    state.waypoints = [{ lat: 32.18, lng: 34.83, name: 'LLHZ' }, { lat: 32.78, lng: 35.04, name: 'LLHA' }];
    syncLegs(); draw();
  });
}

// Open each one in turn and report what it says about itself.
const survey = page => page.evaluate((ids) => {
  const out = [];
  for (const id of ids) {
    for (const b of document.querySelectorAll('.modal-back')) {
      if (b._navaidClose) b._navaidClose(); else b.remove();
    }
    const btn = document.getElementById(id);
    if (!btn || btn.hidden || btn.disabled) continue;
    const cs = getComputedStyle(btn);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    btn.click();
    const back = [...document.querySelectorAll('.modal-back')]
      .find(b => getComputedStyle(b).display !== 'none' && !b.hidden);
    if (!back) continue;
    const m = back.querySelector('.modal, [class*="modal"]') || back.firstElementChild;
    const by = m.getAttribute('aria-labelledby');
    const named = !!(m.getAttribute('aria-label')
      || (by && document.getElementById(by) && document.getElementById(by).textContent.trim()));
    out.push({ id, role: m.getAttribute('role'), named });
  }
  return out;
}, ids => ids);

test('every chart window is a named dialog', async ({ page }) => {
  await boot(page);
  const rows = await page.evaluate((ids) => {
    const out = [];
    for (const id of ids) {
      for (const b of document.querySelectorAll('.modal-back')) {
        if (b._navaidClose) b._navaidClose(); else b.remove();
      }
      const btn = document.getElementById(id);
      if (!btn || btn.hidden || btn.disabled) continue;
      const cs = getComputedStyle(btn);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      btn.click();
      const back = [...document.querySelectorAll('.modal-back')]
        .find(b => getComputedStyle(b).display !== 'none' && !b.hidden);
      if (!back) continue;
      const m = back.querySelector('.modal, [class*="modal"]') || back.firstElementChild;
      const by = m.getAttribute('aria-labelledby');
      const label = by && document.getElementById(by);
      out.push({
        id,
        role: m.getAttribute('role'),
        name: m.getAttribute('aria-label') || (label ? label.textContent.trim() : ''),
      });
    }
    return out;
  }, OPENERS);

  expect(rows.length, 'no windows opened — the survey proves nothing').toBeGreaterThan(8);
  expect(rows.filter(r => r.role !== 'dialog').map(r => r.id),
    'windows not declaring role="dialog"').toEqual([]);
  expect(rows.filter(r => !r.name).map(r => r.id),
    'dialogs with no accessible name').toEqual([]);
});

test('the safety notice is a named alertdialog', async ({ page }) => {
  // It is the first thing the app puts on screen and the only window that must be read, so
  // it keeps alertdialog rather than dialog -- but it was announcing itself without a name,
  // like the rest of them.
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('?lang=en&nogist');
  await page.waitForSelector('.disclaimer-back', { timeout: 25000 });
  const seen = await page.evaluate(() => {
    const box = document.querySelector('.disclaimer-back .disclaimer-modal');
    const by = box.getAttribute('aria-labelledby');
    const label = by && document.getElementById(by);
    return { role: box.getAttribute('role'), name: label ? label.textContent.trim() : '' };
  });
  expect(seen.role).toBe('alertdialog');
  expect(seen.name, 'the safety notice has no accessible name').toBeTruthy();
});

test('a non-blocking window does not claim the page behind it is inert', async ({ page }) => {
  await boot(page);
  // The flight plan is the non-blocking one: the map stays live under the pointer while it
  // is up, which is the whole point of it. Tab is still trapped, so a keyboard user cannot
  // wander off -- but aria-modal would be claiming more than that.
  await page.evaluate(() => document.getElementById('plan').click());
  await page.waitForTimeout(350);
  const seen = await page.evaluate(() => {
    const back = document.querySelector('.modal-back.flight-plan');
    if (!back) return null;
    const m = back.querySelector('.modal, [class*="modal"]') || back.firstElementChild;
    return { role: m.getAttribute('role'), ariaModal: m.getAttribute('aria-modal') };
  });
  expect(seen, 'the flight plan did not open non-blocking').not.toBeNull();
  expect(seen.role).toBe('dialog');
  expect(seen.ariaModal, 'a non-blocking window must not claim aria-modal').toBeNull();
});
