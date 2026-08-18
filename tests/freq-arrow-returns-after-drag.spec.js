// @ts-check
// Dragging a waypoint hides its callout for the duration (see freq-arrow-hidden-while-
// dragging). It then stayed hidden after the finger came up: every draw() in the release
// path ran with the drag state still set, so the repaint that should have brought it back
// was the one repaint that could not, and nothing redrew until some later interaction did.
const { test, expect } = require('./_setup');

async function boot(page) {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof seedCommChangeNotes === 'function' &&
    typeof endMouseDrag === 'function' && commChangeMap);
  return page.evaluate(() => {
    const name = Object.keys(commChangeMap).find(k => commChangeMap[k] && commChangeMap[k].commChange);
    const ref = (navWP || []).find(w => (w.name || '') === name);
    state.waypoints = [
      { lat: ref.lat, lng: ref.lng, name },
      { lat: ref.lat - 0.12, lng: ref.lng + 0.12, name: 'OTHER' },
    ];
    syncLegs();
    seedCommChangeNotes();
    map.setView([ref.lat, ref.lng], 11);
    draw();
    return state.notes.filter(n => n.cc).length;
  });
}

// Count comm-change callouts painted on the NEXT frame, after any pending redraw settles.
const paintedNextFrame = async (page) => {
  await page.waitForTimeout(120);          // let scheduleDraw's rAF land
  return page.evaluate(() => {
    let n = 0;
    const orig = window.drawCommCallout;
    window.drawCommCallout = (...a) => { n++; return orig.apply(null, a); };
    draw();
    window.drawCommCallout = orig;
    return n;
  });
};

test('the callout is back as soon as the drag ends — no extra click needed', async ({ page }) => {
  const seeded = await boot(page);
  expect(seeded).toBeGreaterThan(0);

  const during = await page.evaluate(() => {
    const wp = state.waypoints[0];
    window.__wp0 = { lat: wp.lat, lng: wp.lng };
    const p0 = map.latLngToContainerPoint([wp.lat, wp.lng]);
    map.fire('mousedown', { containerPoint: p0, latlng: L.latLng(wp.lat, wp.lng) });
    const p1 = L.point(p0.x + 70, p0.y + 50);
    map.fire('mousemove', { containerPoint: p1, latlng: map.containerPointToLatLng(p1) });
    let n = 0;
    const orig = window.drawCommCallout;
    window.drawCommCallout = (...a) => { n++; return orig.apply(null, a); };
    draw();
    window.drawCommCallout = orig;
    return n;
  });
  expect(during).toBe(0);                       // hidden for the drag, as designed

  // Back onto the comm-change point before letting go: dropping a waypoint AWAY from it
  // breaks the link and the callout is meant to stay gone, which would prove nothing here.
  await page.evaluate(() => {
    const p = map.latLngToContainerPoint([window.__wp0.lat, window.__wp0.lng]);
    map.fire('mousemove', { containerPoint: p, latlng: L.latLng(window.__wp0.lat, window.__wp0.lng) });
    endMouseDrag();
  });
  expect(await paintedNextFrame(page)).toBeGreaterThan(0);   // ...and back on release
});

test('the same on the touch path', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => {
    touchDrag = { kind: 'wp', i: 0, moved: true, offLat: 0, offLng: 0 };
    draw();
  });
  expect(await page.evaluate(() => {
    let n = 0;
    const orig = window.drawCommCallout;
    window.drawCommCallout = (...a) => { n++; return orig.apply(null, a); };
    draw();
    window.drawCommCallout = orig;
    return n;
  })).toBe(0);
  await page.evaluate(() => { endTouch(); });
  expect(await paintedNextFrame(page)).toBeGreaterThan(0);
});
