// @ts-check
// The turning-point button is a toggle, and a toggle has to look pressed. It said "on" with
// font-weight alone — invisible on a small button — so a marked turning point looked exactly
// like an unmarked one. The status line beneath it carried the whole message.
const { test, expect } = require('./_setup');

// A there-and-back route: LLHZ out to a far point and home again, so a turning point is
// available to mark (the control needs a route that returns to the field it left).
async function boot(page) {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof syncLegs === 'function' && typeof setTurnWaypoint === 'function');
  await page.evaluate(() => {
    state.waypoints = [
      { lat: 32.18, lng: 34.83, name: 'LLHZ' },
      { lat: 32.40, lng: 34.95, name: 'MID' },
      { lat: 32.62, lng: 35.05, name: 'FAR' },
      { lat: 32.18, lng: 34.83, name: 'LLHZ' },
    ];
    syncLegs();
    draw();
  });
}

const openWp = (page, i) => page.evaluate((idx) => {
  state.selected = { type: 'wp', index: idx };
  showInspector();
  const b = document.getElementById('insp-turn-btn');
  if (!b) return null;
  const cs = getComputedStyle(b);
  return { text: b.textContent.trim(), cls: b.className, disabled: b.disabled,
           bg: cs.backgroundColor, border: cs.borderTopColor, weight: cs.fontWeight };
}, i);

test('marking a turning point shows on the button, not only in the text', async ({ page }) => {
  await boot(page);
  const before = await openWp(page, 2);
  expect(before).not.toBeNull();
  expect(before.text).toMatch(/Mark as turning point/);

  await page.evaluate(() => document.getElementById('insp-turn-btn').click());
  const after = await openWp(page, 2);
  expect(after.text).toMatch(/Clear turning point/);
  expect(after.cls).toMatch(/insp-btn-on/);
  // Told apart by more than the weight of the type.
  expect(after.bg).not.toBe(before.bg);
  expect(after.border).not.toBe(before.border);
});

// One pressed look for the whole panel: the turning point and the hotspot mark different
// things, but "this is set" should read the same wherever it appears.
test('the pressed look is the same as the hotspot toggle', async ({ page }) => {
  await boot(page);
  const both = await page.evaluate(() => {
    state.selected = { type: 'wp', index: 2 };
    showInspector();
    document.getElementById('insp-turn-btn').click();
    state.selected = { type: 'wp', index: 2 };
    showInspector();
    document.getElementById('insp-hotspot-btn').click();
    state.selected = { type: 'wp', index: 2 };
    showInspector();
    const read = (id) => {
      const b = document.getElementById(id);
      const cs = getComputedStyle(b);
      return { on: b.className.includes('insp-btn-on'), bg: cs.backgroundColor,
               border: cs.borderTopColor, weight: cs.fontWeight };
    };
    return { turn: read('insp-turn-btn'), hotspot: read('insp-hotspot-btn') };
  });
  expect(both.turn.on).toBe(true);
  expect(both.hotspot.on).toBe(true);
  expect(both.turn.bg).toBe(both.hotspot.bg);
  expect(both.turn.border).toBe(both.hotspot.border);
  expect(both.turn.bg).toBe('rgb(255, 209, 102)');
  expect(both.turn.border).toBe('rgb(215, 38, 61)');
});

// A route that never comes home has no far end to mark. The button says so and is disabled --
// that IS dimmed, correctly, and the two states must not be confusable.
test('an outbound-only route disables it, which looks different again', async ({ page }) => {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof syncLegs === 'function');
  const state2 = await page.evaluate(() => {
    state.waypoints = [{ lat: 32.18, lng: 34.83, name: 'LLHZ' },
                       { lat: 32.62, lng: 35.05, name: 'FAR' }];
    syncLegs();
    state.selected = { type: 'wp', index: 1 };
    showInspector();
    const b = document.getElementById('insp-turn-btn');
    const cs = getComputedStyle(b);
    return { disabled: b.disabled, opacity: cs.opacity, title: b.title, cls: b.className };
  });
  expect(state2.disabled).toBe(true);
  expect(Number(state2.opacity)).toBeLessThan(1);       // faded, because it cannot be used
  expect(state2.title).toMatch(/returns to the airfield/i);
  expect(state2.cls).not.toMatch(/insp-btn-on/);
});
