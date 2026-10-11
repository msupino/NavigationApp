// @ts-check
// Asked: Add/Delete frequency change should behave like the hotspot toggle, and "check other
// buttons keep style". Every toggle in the waypoint panel is one button with two states: the
// same shape pressed or not (border width, height, margin, radius), lit with the shared
// insp-btn-on look and aria-pressed while on. The on-state ring used to be a 2 px border, which
// made a pressed button 2 px taller; the clock toggle had no pressed look at all; Delete
// frequency change was a red danger button with a 14 px gap above it.
const { test, expect } = require('./_setup');

for (const [name, size, theme] of [['phone, light', { width: 390, height: 844 }, 'light'],
  ['desktop, dark', { width: 1280, height: 900 }, 'dark']]) {
  test(`waypoint toggles keep their shape and share one pressed look (${name})`, async ({ page }) => {
    await page.setViewportSize(size);
    await page.addInitScript((t) => { try { localStorage.setItem('navaid.theme', t); } catch (e) {} }, theme);
    await page.goto('?lang=en&nogist');
    await page.waitForFunction(() => typeof showInspector === 'function' && typeof findNavWpToken === 'function');
    await page.evaluate(async () => {
      if (navWP === null) await loadNavWaypoints();
      await loadCommChange();
      state.waypoints = ['LLHZ', 'DEROR', 'HADRA', 'SHARO', 'LLHZ'].map(c => {
        const p = findNavWpToken(c); return { lat: p.lat, lng: p.lng, name: p.name };
      });
      state.legs = []; state.notes = []; state.commChangeSuppressions = ['DEROR'];
      // No point starts as a hotspot, so every toggle is pressed from off to on.
      for (const w of state.waypoints) w.hotspot = false;
      syncLegs(); draw();
    });
    const read = (sel, index) => page.evaluate(([s, i]) => {
      state.selected = { type: 'wp', index: i }; showInspector();
      const el = document.querySelector('#insp-body ' + s);
      if (!el) return null;
      const c = getComputedStyle(el);
      return { shape: [c.borderTopWidth, c.marginTop, c.borderTopLeftRadius, Math.round(el.getBoundingClientRect().height)].join(' '),
        on: el.classList.contains('insp-btn-on'), pressed: el.getAttribute('aria-pressed'),
        danger: el.classList.contains('insp-btn-danger'), bg: c.backgroundColor };
    }, [sel, index]);
    const press = (sel, index) => page.evaluate(([s, i]) => {
      state.selected = { type: 'wp', index: i }; showInspector();
      document.querySelector('#insp-body ' + s).click();
    }, [sel, index]);
    const onBg = new Set();
    for (const [sel, index] of [['#insp-turn-btn', 2], ['#insp-timer-btn', 2], ['.freq-change-slot', 1]]) {
      const off = await read(sel, index);
      await press(sel, index);
      const on = await read(sel, index);
      expect(off && on, sel).toBeTruthy();
      expect(on.shape, sel + ' keeps its shape').toBe(off.shape);
      expect([off.on, off.pressed], sel + ' off').toEqual([false, 'false']);
      expect([on.on, on.pressed, on.danger], sel + ' on').toEqual([true, 'true', false]);
      onBg.add(on.bg);
      await press(sel, index);
    }
    expect([...onBg]).toHaveLength(1);              // one pressed look for all of them
  });
}
