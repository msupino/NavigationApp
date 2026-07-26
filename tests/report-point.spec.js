// @ts-check
// Identification / report points (נקי הזדהות): an oval note anchored to a leg,
// added from the leg inspector. It slides only along its leg, shows the
// still-air (TAS) planned time from the leg start, and persists like a note.
const { test, expect } = require('./_setup');

async function boot(page) {
  await page.goto('?lang=en');
  await page.waitForFunction(() => typeof state !== 'undefined' &&
    typeof addReportPointToLeg === 'function' && typeof reportPointTime === 'function' &&
    typeof syncLegs === 'function' && typeof geo === 'function');
}

// A single 19 NM leg at 90 kt → 12.67 min total (mid-leg = 6:20).
async function oneLeg(page) {
  await page.evaluate(() => {
    state.waypoints = [{ lat: 32.0, lng: 35.0, name: 'A' }, { lat: 32.0 + 19 / 60, lng: 35.0, name: 'B' }];
    state.legs = []; syncLegs();
    state.legs[0].flightSpeed = 90;
    state.wind = { dir: 0, speed: 40 };   // wind present — planning time must ignore it
    draw();
  });
}

test('inspector button adds a leg-anchored oval showing time from leg start', async ({ page }) => {
  await boot(page);
  await oneLeg(page);
  const r = await page.evaluate(() => {
    state.selected = { type: 'leg', index: 0 };
    const idx = addReportPointToLeg(0);
    const n = state.notes[idx];
    return {
      isOval: n.shape === 'oval',
      anchored: !!n.rp && n.rp.leg === 0,
      midTime: reportPointTime(n),               // default t = 0.5 → half of 12:40
      selected: state.selected.type === 'note' && state.selected.index === idx,
      lines: noteLines(n),
    };
  });
  expect(r.isOval).toBe(true);
  expect(r.anchored).toBe(true);
  expect(r.midTime).toBe('6:20');
  expect(r.selected).toBe(true);
  expect(r.lines).toEqual(['6:20']);
});

test('planning time is TAS-based (ignores the forecast wind)', async ({ page }) => {
  await boot(page);
  await oneLeg(page);
  const t = await page.evaluate(() => {
    const idx = addReportPointToLeg(0);
    const n = state.notes[idx];
    // Place exactly on the 6-minute tick → must read 6:00 despite the 40 kt wind.
    const g = geo(state.waypoints[0], state.waypoints[1]);
    n.rp.t = 6 / (g.dist / 90 * 60);
    return reportPointTime(n);
  });
  expect(t).toBe('6:00');
});

test('the oval is fixed-size and its lat/lng follows the leg on draw', async ({ page }) => {
  await boot(page);
  await oneLeg(page);
  const r = await page.evaluate(() => {
    const idx = addReportPointToLeg(0);
    const n = state.notes[idx];
    n.lat = 0; n.lng = 0;                 // clobber; draw() must resync from the anchor
    draw();
    const A = state.waypoints[0], B = state.waypoints[1];
    const onLeg = Math.abs(n.lat - (A.lat + (B.lat - A.lat) * 0.5)) < 1e-6;
    return { onLeg, fixed: !!noteRect(idx).fixed };
  });
  expect(r.onLeg).toBe(true);
  expect(r.fixed).toBe(true);
});

test('an optional label shows under the time', async ({ page }) => {
  await boot(page);
  await oneLeg(page);
  const lines = await page.evaluate(() => {
    const idx = addReportPointToLeg(0);
    const n = state.notes[idx];
    n.text = 'GATE';
    return noteLines(n);
  });
  expect(lines).toEqual(['6:20', 'GATE']);
});

test('reversing the route keeps the report point on the same geographic spot', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => {
    state.waypoints = [{ lat: 32.1, lng: 35.0, name: 'A' }, { lat: 32.4, lng: 35.0, name: 'B' }, { lat: 32.7, lng: 35.0, name: 'C' }];
    state.legs = []; syncLegs();
  });
  const r = await page.evaluate(() => {
    const idx = addReportPointToLeg(0);
    const n = state.notes[idx];
    n.rp.t = 0.3;
    const g0 = reportPointGeom(n);
    document.getElementById('reverse').click();
    const n2 = state.notes.find(x => x && x.rp);
    const g1 = reportPointGeom(n2);
    return { before: g0.lat, after: g1.lat, leg: n2.rp.leg, t: n2.rp.t, count: state.notes.filter(x => x && x.rp).length };
  });
  expect(r.count).toBe(1);              // not dropped
  expect(r.after).toBeCloseTo(r.before, 6);   // same point
  expect(r.leg).toBe(1);                // anchor remapped to the mirrored leg
  expect(r.t).toBeCloseTo(0.7, 6);
});

test('the oval is clickable where it is drawn, not 90° off', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => {
    // Due-EAST leg → the oval is drawn rotated 90° (long axis across the track),
    // so it paints NARROW horizontally and TALL vertically.
    state.waypoints = [{ lat: 32.0, lng: 35.0, name: 'A' }, { lat: 32.0, lng: 35.4, name: 'B' }];
    state.legs = []; syncLegs();
    state.legs[0].flightSpeed = 90;
    map.setView([32.0, 35.2], 11, { animate: false });
    addReportPointToLeg(0);
    draw();
  });
  const r = await page.evaluate(() => {
    const idx = state.notes.findIndex(n => n && n.rp);
    const rc = noteRect(idx);
    const cx = rc.x + rc.w / 2, cy = rc.y + rc.h / 2;
    const halfLong = rc.w / 2, halfShort = rc.h / 2;   // w is the LONG axis, drawn vertical
    return {
      ang: Math.round(noteDrawAngle(state.notes[idx]) * 180 / Math.PI),
      centre: hitNote(cx, cy) === idx,
      // Along the drawn long axis (vertical here) — inside the painted oval.
      alongDrawn: hitNote(cx, cy + halfLong * 0.8) === idx,
      // Along the drawn short axis (horizontal) at the same distance — OUTSIDE.
      offDrawn: hitNote(cx + halfLong * 0.8, cy) === idx,
      inShort: hitNote(cx + halfShort * 0.8, cy) === idx,
    };
  });
  expect(Math.abs(r.ang)).toBe(90);      // drawn across the track
  expect(r.centre).toBe(true);
  expect(r.alongDrawn).toBe(true);       // tall direction is grabbable (was a miss)
  expect(r.offDrawn).toBe(false);        // empty map beside it is not (was a false grab)
  expect(r.inShort).toBe(true);
});

test('deleting a mid-route waypoint keeps a marker whose segment still exists', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(() => {
    state.waypoints = [
      { lat: 32.0, lng: 35.0, name: 'A' }, { lat: 32.2, lng: 35.0, name: 'B' },
      { lat: 32.4, lng: 35.0, name: 'C' }, { lat: 32.6, lng: 35.0, name: 'D' },
    ];
    state.legs = []; syncLegs();
    const idx = addReportPointToLeg(2);            // on C–D
    state.notes[idx].rp.t = 0.5;
    const before = reportPointGeom(state.notes[idx]).lat;
    deleteWaypoint(1);                              // delete B; C–D still exists (now leg 1)
    const n = state.notes.find(x => x && x.rp);
    return n ? { kept: true, leg: n.rp.leg, lat: reportPointGeom(n).lat, before }
             : { kept: false, before };
  });
  expect(r.kept).toBe(true);             // was silently deleted by the index prune
  expect(r.leg).toBe(1);                 // anchor renumbered onto the same segment
  expect(r.lat).toBeCloseTo(r.before, 6);   // and it did not move on the map
});

test('splitting an earlier leg does not slide a marker onto the wrong leg', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(() => {
    state.waypoints = [
      { lat: 32.0, lng: 35.0, name: 'A' }, { lat: 32.2, lng: 35.0, name: 'B' },
      { lat: 32.4, lng: 35.0, name: 'C' }, { lat: 32.6, lng: 35.0, name: 'D' },
    ];
    state.legs = []; syncLegs();
    const idx = addReportPointToLeg(2);            // on C–D
    state.notes[idx].rp.t = 0.5;
    const before = reportPointGeom(state.notes[idx]).lat;
    splitLegAt(0, { lat: 32.1, lng: 35.0 });        // insert X inside A–B
    const n = state.notes.find(x => x && x.rp);
    return { leg: n.rp.leg, lat: reportPointGeom(n).lat, before };
  });
  expect(r.leg).toBe(3);                 // shifted up: C–D is now leg 3 (stayed 2 before)
  expect(r.lat).toBeCloseTo(r.before, 6);   // marker stayed on the same ground point
});

test('splitting the marker\'s own leg keeps it on the correct half', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(() => {
    state.waypoints = [{ lat: 32.0, lng: 35.0, name: 'A' }, { lat: 32.4, lng: 35.0, name: 'B' }];
    state.legs = []; syncLegs();
    const idx = addReportPointToLeg(0);
    state.notes[idx].rp.t = 0.75;                   // in the far quarter
    const before = reportPointGeom(state.notes[idx]).lat;
    splitLegAt(0, { lat: 32.2, lng: 35.0 });        // split at the midpoint
    const n = state.notes.find(x => x && x.rp);
    return { leg: n.rp.leg, t: n.rp.t, lat: reportPointGeom(n).lat, before };
  });
  expect(r.leg).toBe(1);                 // moved to the second half
  expect(r.t).toBeCloseTo(0.5, 2);       // t rescaled within that half
  expect(r.lat).toBeCloseTo(r.before, 6);   // same ground point
});

test('removing the anchor leg prunes the report point', async ({ page }) => {
  await boot(page);
  await oneLeg(page);
  const after = await page.evaluate(() => {
    addReportPointToLeg(0);
    const before = state.notes.filter(n => n && n.rp).length;
    state.waypoints = [state.waypoints[0]];   // no legs left
    syncLegs();
    return { before, after: state.notes.filter(n => n && n.rp).length };
  });
  expect(after.before).toBe(1);
  expect(after.after).toBe(0);
});

test('a report point produces a storage snapshot that passes validation', async ({ page }) => {
  await boot(page);
  await oneLeg(page);
  const r = await page.evaluate(() => {
    const idx = addReportPointToLeg(0);
    const snap = JSON.parse(JSON.stringify(routeSnapshotForStorage()));
    return { color: state.notes[idx].color, err: validateRoute(snap) };
  });
  // Regression: rp notes must carry a colour, or the strict note validator
  // rejects the whole route on the next restore ("notes[N].color: missing").
  expect(typeof r.color).toBe('string');
  expect(r.color.length).toBeGreaterThan(0);
  expect(r.err).toBeNull();
});

test('report point survives a save → load round-trip', async ({ page }) => {
  await boot(page);
  await oneLeg(page);
  const r = await page.evaluate(() => {
    const idx = addReportPointToLeg(0);
    state.notes[idx].rp.t = 0.25;
    state.notes[idx].text = 'PT';
    const json = JSON.stringify(serializeRoute());
    // Wipe and reload from the serialized copy.
    state.notes = []; state.waypoints = []; state.legs = [];
    applyRouteData(JSON.parse(json));
    const n = state.notes.find(x => x && x.rp);
    return n ? { leg: n.rp.leg, t: n.rp.t, text: n.text } : null;
  });
  expect(r).not.toBeNull();
  expect(r.leg).toBe(0);
  expect(r.t).toBeCloseTo(0.25, 2);
  expect(r.text).toBe('PT');
});
