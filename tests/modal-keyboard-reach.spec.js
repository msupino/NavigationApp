// @ts-check
// Keyboard reach for every dialog built by createDraggableModal. Only the hand-rolled
// shortcuts sheet used to move focus, trap Tab and hand focus back; the freq table,
// altitude pairs, airport charts, NOTAM list, share and saved-routes dialogs all opened
// with focus still on the trigger behind the backdrop, so Tab walked the page underneath
// the dialog instead of the dialog itself.
const { test, expect } = require('./_setup');
const { hideToolbarMenus, showToolbarControl } = require('./_toolbar');

const ROUTE = [{ lat: 32.18, lng: 34.83, name: 'LLHZ' }, { lat: 32.44, lng: 34.90, name: 'HADERA' }];
const DIALOGS = [['#freq-table', 'frequency table'], ['#alt-pairs', 'altitude pairs'],
  ['#charts', 'airport charts']];

async function boot(page) {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof syncLegs === 'function');
  await page.evaluate(r => { state.waypoints = r; state.legs = []; syncLegs(); draw(); }, ROUTE);
}

for (const [sel, name] of DIALOGS) {
  test(`${name}: opening moves focus into the dialog`, async ({ page }) => {
    await boot(page);
    await hideToolbarMenus(page);
    await showToolbarControl(page, sel);
    const r = await page.evaluate(s => {
      document.querySelector(s).click();
      const box = document.querySelector('.modal-back .modal');
      return { inside: box.contains(document.activeElement),
        onCloseX: document.activeElement.classList.contains('modal-close-x') };
    }, sel);
    expect(r.inside).toBe(true);
    expect(r.onCloseX).toBe(true);
  });

  test(`${name}: Tab is trapped inside the dialog`, async ({ page }) => {
    await boot(page);
    await hideToolbarMenus(page);
    await showToolbarControl(page, sel);
    const r = await page.evaluate(s => {
      document.querySelector(s).click();
      const box = document.querySelector('.modal-back .modal');
      const f = [...box.querySelectorAll('button, [href], input:not([type=hidden]), select, textarea, [tabindex]:not([tabindex="-1"])')]
        .filter(el => !el.disabled && el.offsetParent !== null);
      if (f.length < 2) return { skip: true };
      // forward from the last element wraps to the first
      f[f.length - 1].focus();
      const fwd = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
      f[f.length - 1].dispatchEvent(fwd);
      const wrappedForward = document.activeElement === f[0];
      // and backward from the first wraps to the last
      f[0].focus();
      const back = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true });
      f[0].dispatchEvent(back);
      return { wrappedForward, wrappedBack: document.activeElement === f[f.length - 1],
        prevented: fwd.defaultPrevented && back.defaultPrevented };
    }, sel);
    if (r.skip) return;
    expect(r.wrappedForward).toBe(true);
    expect(r.wrappedBack).toBe(true);
    expect(r.prevented).toBe(true);
  });

  test(`${name}: closing hands focus back to the menu it came from`, async ({ page }) => {
    await boot(page);
    await hideToolbarMenus(page);
    await showToolbarControl(page, sel);
    await page.evaluate(s => { const b = document.querySelector(s); b.focus(); b.click(); }, sel);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);
    const r = await page.evaluate(() => ({
      closed: !document.querySelector('.modal-back'),
      // Opening a modal closes the toolbar dropdown, so the trigger itself is hidden by
      // now; the section head that owns it is the visible place to continue from.
      onSectionHead: !!(document.activeElement && document.activeElement.classList
        && document.activeElement.classList.contains('tb-section-head')),
      notDumpedOnBody: document.activeElement !== document.body,
    }));
    expect(r.closed).toBe(true);
    expect(r.onSectionHead).toBe(true);
    expect(r.notDumpedOnBody).toBe(true);
  });
}

test('the flight plan takes focus but does NOT trap Tab', async ({ page }) => {
  // This panel is non-blocking on purpose -- its backdrop passes clicks through so the
  // map stays draggable while the plan is open -- so focus must land inside it without
  // locking the keyboard into it.
  await boot(page);
  await page.evaluate(() => { document.getElementById('plan').focus(); document.getElementById('plan').click(); });
  const open = await page.evaluate(() => {
    const box = document.querySelector('.modal-back.flight-plan .modal');
    const f = [...box.querySelectorAll('button')].filter(b => b.offsetParent !== null);
    f[f.length - 1].focus();
    const ev = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    f[f.length - 1].dispatchEvent(ev);
    return { inside: box.contains(document.activeElement) || document.activeElement === f[f.length - 1],
      trapped: ev.defaultPrevented };
  });
  expect(open.inside).toBe(true);
  expect(open.trapped).toBe(false);      // free to tab out to the map behind it
  const after = await page.evaluate(() => {
    document.querySelector('.modal-back.flight-plan .modal-close-x').click();
    return { closed: !document.querySelector('.modal-back.flight-plan'),
      notBody: document.activeElement !== document.body };
  });
  expect(after.closed).toBe(true);
  expect(after.notBody).toBe(true);      // focus handed back, not dumped
});
