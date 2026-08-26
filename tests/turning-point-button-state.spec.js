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

// Both buttons say "this is set" at a glance, in the panel's own vocabulary: the hotspot
// keeps the red of a chart mark and takes the hotspot ring as its border, the turning point
// takes the filled highlight. What matters is that neither is told apart by type weight
// alone, which is what made them read as inert.
test('both toggles show their set state', async ({ page }) => {
  await boot(page);
  const both = await page.evaluate(() => {
    const read = (id) => {
      const b = document.getElementById(id);
      const cs = getComputedStyle(b);
      return { on: b.className.includes('insp-btn-on'), bg: cs.backgroundColor,
               border: cs.borderTopColor };
    };
    state.selected = { type: 'wp', index: 2 };
    showInspector();
    const turnOff = read('insp-turn-btn');
    const hotOff = read('insp-hotspot-btn');
    document.getElementById('insp-turn-btn').click();
    state.selected = { type: 'wp', index: 2 };
    showInspector();
    document.getElementById('insp-hotspot-btn').click();
    state.selected = { type: 'wp', index: 2 };
    showInspector();
    return { turnOff, hotOff, turnOn: read('insp-turn-btn'), hotOn: read('insp-hotspot-btn') };
  });
  expect(both.turnOn.on).toBe(true);
  expect(both.hotOn.on).toBe(true);
  expect(both.turnOn.bg).not.toBe(both.turnOff.bg);       // filled once set
  expect(both.hotOn.border).not.toBe(both.hotOff.border); // ringed once set
  expect(both.hotOn.bg).toBe('rgb(176, 54, 54)');         // red once the mark exists
  expect(both.hotOff.bg).not.toBe('rgb(176, 54, 54)');    // ...and quiet before it does
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
