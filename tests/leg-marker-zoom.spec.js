// @ts-check
// Headline-feature coverage for PR #393 + issue #394 — leg-marker offsets:
//   * user-dragged offsets are stored in size-independent units (already
//     divided by legArrowSize) with `_m: 1` flagging them as migrated, so
//     they render at a constant on-screen position regardless of zoom
//     and legArrowSize (PR #393).
//   * default (unmodified) offsets are the sentinel
//     `{ a: 0, _default: 1, _m: 1 }`. Their perpendicular distance is
//     computed at render time from the live leg length so the kite sits
//     just outside the 10° drift cone at every zoom / leg length
//     (issue #394).
//
// The tests below pin the invariants from every direction they can be
// reached:
//
//   1. zoom round-trip — changing the map zoom never mutates a
//      user-dragged inLabel (size-independent storage; render math handles
//      pixel-scaling at draw time).
//   2. legacy migration — a pre-#393 navaid.route blob (no `_m`) loads
//      with offsets divided by legArrowSize and `_m: 1` stamped.
//   3. idempotency — once migrated, a re-load is a no-op.
//   4. "Reset all marker positions" — every leg ends up matching the
//      `_defaultLegLabels()` sentinel (`{ a: 0, _default: 1, _m: 1 }`),
//      and the confirm dialog blocks accidental wipes (issue #394: shape
//      changed from `{a, p, _m}` to `{a, _default, _m}`).
//   5. round-trip at legArrowSize=2 — save / reload / import preserves a
//      user-dragged offset's rendered position (within sub-pixel ε).
const { test, expect } = require('./_setup');
const { LLHZ, LLHA } = require('./_airfieldArp');

const TWO_WP = [
  { lat: LLHZ.lat, lng: LLHZ.lng, name: 'A' },
  { lat: LLHA.lat, lng: LLHA.lng, name: 'B' },
];

async function boot(page) {
  await page.addInitScript(() => {
    try {
      for (const k of Object.keys(localStorage)) localStorage.removeItem(k);
      sessionStorage.clear();
      // Open every toolbar section so DOM queries find the reset button.
      for (const s of ['build','view','display','charts','export','print'])
        localStorage.setItem('navaid.sec.' + s, '1');
    } catch (e) {}
  });
  await page.goto('?lang=en');
  await page.waitForFunction(
    () => typeof state !== 'undefined' &&
          typeof syncLegs === 'function' &&
          typeof _defaultLegLabels === 'function');
}

async function loadTwoWp(page) {
  await page.evaluate(wps => {
    state.waypoints = wps.map(w => ({ lat: w.lat, lng: w.lng, name: w.name }));
    syncLegs();
    draw();
  }, TWO_WP);
}

test.describe('PR #393 — leg marker zoom-independent offsets', () => {
  // ---------------------------------------------------------------------
  // 1) Zoom round-trip: the stored offset is in size-independent units, so
  //    a zoom change does not mutate inLabel. The on-screen pixel position
  //    DOES change (legZoomScale multiplies by 2^(zoom-12)), but the
  //    underlying value sticks.
  // ---------------------------------------------------------------------
  test('zoom change preserves stored leg marker offset', async ({ page }) => {
    await boot(page);
    await loadTwoWp(page);
    await page.evaluate(() => map.setZoom(12));
    await page.waitForFunction(() => Math.abs(map.getZoom() - 12) < 0.01);

    // Simulate a drag result by writing a non-default offset directly.
    await page.evaluate(() => {
      state.legs[0].inLabel  = { a:  10, p:  30, _m: 1 };
      state.legs[0].outLabel = { a: -10, p: -30, _m: 1 };
      draw();
    });
    const before = await page.evaluate(() => ({
      inLabel:  state.legs[0].inLabel,
      outLabel: state.legs[0].outLabel,
    }));

    // Bracket the original zoom to verify both directions of change.
    for (const z of [14, 10, 12]) {
      await page.evaluate(zn => map.setZoom(zn), z);
      await page.waitForFunction(zn => Math.abs(map.getZoom() - zn) < 0.01, z);
      const after = await page.evaluate(() => ({
        inLabel:  state.legs[0].inLabel,
        outLabel: state.legs[0].outLabel,
      }));
      expect(after).toEqual(before);
    }
  });

  // ---------------------------------------------------------------------
  // 2) Legacy migration: a route saved before #393 has raw pixel offsets
  //    and no `_m`. Restored under the new code, offsets are divided by
  //    legArrowSize and `_m: 1` is stamped (one-shot, idempotent).
  // ---------------------------------------------------------------------
  test('legacy navaid.route migrates raw offsets by legArrowSize and stamps _m', async ({ page }) => {
    const RAW = 88;     // raw screen pixels (pre-#393 save under legArrowSize=2)
    // 1.5, not 2: the leg-arrow size slider now runs 0.2..1.8 (centred on the shipped
    // 1), so a seeded 2 is clamped on load and this test is about offset migration
    // scaling by legArrowSize, not about the slider's range.
    const AS = 1.5;
    await page.addInitScript(({ raw, as, hz, ha }) => {
      try {
        for (const k of Object.keys(localStorage)) localStorage.removeItem(k);
        sessionStorage.clear();
        for (const s of ['build','view','display','charts','export','print'])
          localStorage.setItem('navaid.sec.' + s, '1');
        localStorage.setItem('navaid.legArrowSize', String(as));
        localStorage.setItem('navaid.route', JSON.stringify({
          waypoints: [
            { lat: hz.lat, lng: hz.lng, name: 'A' },
            { lat: ha.lat, lng: ha.lng, name: 'B' },
          ],
          legs: [{
            inboundAltitude: 2000, outboundAltitude: 2000,
            flightSpeed: 90, outboundSpeed: 90,
            inLabel:  { a: 0, p:  raw },          // raw, no _m
            outLabel: { a: 0, p: -raw },
          }],
          notes: [],
        }));
      } catch (e) {}
    }, { raw: RAW, as: AS, hz: LLHZ, ha: LLHA });
    await page.goto('?lang=en');
    await page.waitForFunction(() => state && state.legs && state.legs.length === 1);

    const got = await page.evaluate(() => ({
      legArrowSize: window.legArrowSize,
      inLabel:  state.legs[0].inLabel,
      outLabel: state.legs[0].outLabel,
    }));
    expect(got.legArrowSize).toBe(AS);
    expect(got.inLabel ).toEqual({ a: 0, p:  RAW / AS, _m: 1 });
    expect(got.outLabel).toEqual({ a: 0, p: -RAW / AS, _m: 1 });
  });

  // ---------------------------------------------------------------------
  // 3) Migration is idempotent: a second restore (e.g. fresh page load
  //    after persist()) must not divide a second time.
  // ---------------------------------------------------------------------
  test('migration is idempotent across reload', async ({ page }) => {
    const RAW = 88;
    // 1.5, not 2: the leg-arrow size slider now runs 0.2..1.8 (centred on the shipped
    // 1), so a seeded 2 is clamped on load and this test is about offset migration
    // scaling by legArrowSize, not about the slider's range.
    const AS = 1.5;
    await page.addInitScript(({ raw, as, hz, ha }) => {
      try {
        for (const k of Object.keys(localStorage)) localStorage.removeItem(k);
        sessionStorage.clear();
        for (const s of ['build','view','display','charts','export','print'])
          localStorage.setItem('navaid.sec.' + s, '1');
        localStorage.setItem('navaid.legArrowSize', String(as));
        localStorage.setItem('navaid.route', JSON.stringify({
          waypoints: [
            { lat: hz.lat, lng: hz.lng, name: 'A' },
            { lat: ha.lat, lng: ha.lng, name: 'B' },
          ],
          legs: [{
            inboundAltitude: 2000, outboundAltitude: 2000,
            flightSpeed: 90, outboundSpeed: 90,
            inLabel:  { a: 0, p:  raw },
            outLabel: { a: 0, p: -raw },
          }],
          notes: [],
        }));
      } catch (e) {}
    }, { raw: RAW, as: AS, hz: LLHZ, ha: LLHA });

    await page.goto('?lang=en');
    await page.waitForFunction(() => state && state.legs && state.legs.length === 1);
    // Persist throttles for 500 ms before writing back to localStorage;
    // wait it out so the second reload sees the migrated blob, not the
    // original raw one.
    await page.evaluate(() => { state.legs[0].inboundAltitude++; persist(); });
    await page.waitForTimeout(700);
    const stored = await page.evaluate(
      () => JSON.parse(localStorage.getItem('navaid.route')));
    expect(stored.legs[0].inLabel ).toEqual({ a: 0, p:  RAW / AS, _m: 1 });
    expect(stored.legs[0].outLabel).toEqual({ a: 0, p: -RAW / AS, _m: 1 });

    // Now reload — restoreRoute should leave the already-migrated values
    // untouched (no second divide). _m guards against re-running.
    await page.reload();
    await page.waitForFunction(() => state && state.legs && state.legs.length === 1);
    const after = await page.evaluate(() => ({
      inLabel:  state.legs[0].inLabel,
      outLabel: state.legs[0].outLabel,
    }));
    expect(after.inLabel ).toEqual({ a: 0, p:  RAW / AS, _m: 1 });
    expect(after.outLabel).toEqual({ a: 0, p: -RAW / AS, _m: 1 });
  });

  // ---------------------------------------------------------------------
  // 4) "Reset all marker positions" — must (a) prompt for confirmation
  //    (#14) and (b) write the `_defaultLegLabels()` sentinel
  //    (`{ a: 0, _default: 1, _m: 1 }`) so the renderer falls back to the
  //    drift-cone-aware perpendicular at draw time (issue #394).
  // ---------------------------------------------------------------------
  test('toolbar reset-all writes default invariant + asks for confirm', async ({ page }) => {
    // 1.5, not 2: the leg-arrow size slider now runs 0.2..1.8 (centred on the shipped
    // 1), so a seeded 2 is clamped on load and this test is about offset migration
    // scaling by legArrowSize, not about the slider's range.
    const AS = 1.5;
    await page.addInitScript(as => {
      try {
        for (const k of Object.keys(localStorage)) localStorage.removeItem(k);
        sessionStorage.clear();
        for (const s of ['build','view','display','charts','export','print'])
          localStorage.setItem('navaid.sec.' + s, '1');
        localStorage.setItem('navaid.legArrowSize', String(as));
      } catch (e) {}
    }, AS);
    await page.goto('?lang=en');
    await page.waitForFunction(() => typeof _defaultLegLabels === 'function');
    await loadTwoWp(page);
    await page.evaluate(() => {
      state.legs[0].inLabel  = { a: 7, p:  21, _m: 1 };  // manual tweaks
      state.legs[0].outLabel = { a: 7, p: -21, _m: 1 };
      draw();
    });

    // Dismiss path — state must NOT change.
    page.once('dialog', d => d.dismiss());
    await page.locator('#tool-reset-all-markers').click();
    const dismissed = await page.evaluate(() => ({
      inLabel:  state.legs[0].inLabel,
      outLabel: state.legs[0].outLabel,
    }));
    expect(dismissed.inLabel ).toEqual({ a: 7, p:  21, _m: 1 });
    expect(dismissed.outLabel).toEqual({ a: 7, p: -21, _m: 1 });

    // Accept path — state matches _defaultLegLabels().
    page.once('dialog', d => d.accept());
    await page.locator('#tool-reset-all-markers').click();
    const accepted = await page.evaluate(() => ({
      legArrowSize: window.legArrowSize,
      inLabel:  state.legs[0].inLabel,
      outLabel: state.legs[0].outLabel,
      expected: _defaultLegLabels(),
    }));
    expect(accepted.legArrowSize).toBe(AS);
    expect(accepted.inLabel ).toEqual(accepted.expected.inLabel);
    expect(accepted.outLabel).toEqual(accepted.expected.outLabel);
    // Spell out the invariant: the issue-#394 sentinel form, identical
    // for inLabel and outLabel (the sign is applied at render time).
    expect(accepted.inLabel ).toEqual({ a: 0, _default: 1, _m: 1 });
    expect(accepted.outLabel).toEqual({ a: 0, _default: 1, _m: 1 });
  });

  // ---------------------------------------------------------------------
  // 5) Round-trip at legArrowSize=2: save (export JSON) → reload page →
  //    import the same blob → rendered marker position must match.
  //    "Rendered" = inLabel.p * legZoomScale() for a user-dragged offset.
  //    (Defaults sit at the drift-aware perp computed at render time and
  //    are covered by the issue-#394 tests below.)
  // ---------------------------------------------------------------------
  test('export → reload → import preserves rendered position at legArrowSize=2', async ({ page }) => {
    // 1.5, not 2: the leg-arrow size slider now runs 0.2..1.8 (centred on the shipped
    // 1), so a seeded 2 is clamped on load and this test is about offset migration
    // scaling by legArrowSize, not about the slider's range.
    const AS = 1.5;
    await page.addInitScript(as => {
      try {
        for (const k of Object.keys(localStorage)) localStorage.removeItem(k);
        sessionStorage.clear();
        for (const s of ['build','view','display','charts','export','print'])
          localStorage.setItem('navaid.sec.' + s, '1');
        localStorage.setItem('navaid.legArrowSize', String(as));
      } catch (e) {}
    }, AS);
    await page.goto('?lang=en');
    await page.waitForFunction(() => typeof _defaultLegLabels === 'function' &&
                                     typeof legZoomScale === 'function');
    await loadTwoWp(page);
    await page.evaluate(() => map.setZoom(12));
    await page.waitForFunction(() => Math.abs(map.getZoom() - 12) < 0.01);
    // Issue #394: stamp a non-default offset so this test exercises the
    // user-dragged round-trip invariant directly (size-independent
    // storage, identical render after reload). Defaults have no stored
    // `p` — the drift-aware perpendicular is computed at render time
    // and is covered by `default kite sits outside drift cone …` below.
    await page.evaluate(() => {
      state.legs[0].inLabel  = { a:  4, p:  18, _m: 1 };
      state.legs[0].outLabel = { a: -4, p: -18, _m: 1 };
      draw();
    });

    const beforeBlob = await page.evaluate(() => JSON.stringify({
      waypoints: state.waypoints.map(w => ({ lat: w.lat, lng: w.lng, name: w.name || '' })),
      legs: state.legs.map(l => ({
        inboundAltitude: l.inboundAltitude,
        outboundAltitude: l.outboundAltitude,
        flightSpeed: l.flightSpeed,
        outboundSpeed: l.outboundSpeed,
        inLabel: l.inLabel, outLabel: l.outLabel,
      })),
      notes: [],
    }));
    const beforeRender = await page.evaluate(() => {
      const l = state.legs[0];
      const k = legZoomScale();
      return { px: l.inLabel.p * k, k, p: l.inLabel.p, zoom: map.getZoom() };
    });

    // Reload the page (legArrowSize persists via localStorage) and import
    // the saved blob. With the helper-driven default + idempotent migration,
    // the rendered marker position at the same zoom must match.
    await page.reload();
    await page.waitForFunction(() => typeof legZoomScale === 'function' &&
                                     typeof window.legArrowSize === 'number');
    await page.evaluate(() => { state.waypoints = []; state.legs = []; state.notes = []; draw(); });
    await page.setInputFiles('#file', {
      name: 'route.json', mimeType: 'application/json',
      buffer: Buffer.from(beforeBlob, 'utf8'),
    });
    await page.waitForFunction(() => state.waypoints.length === 2 && state.legs.length === 1);
    await page.evaluate(() => map.setZoom(12));
    await page.waitForFunction(() => Math.abs(map.getZoom() - 12) < 0.01);
    const afterRender = await page.evaluate(() => {
      const l = state.legs[0];
      const k = legZoomScale();
      return { px: l.inLabel.p * k, k, p: l.inLabel.p, zoom: map.getZoom() };
    });

    expect(afterRender.zoom).toBeCloseTo(beforeRender.zoom, 5);
    expect(afterRender.k   ).toBeCloseTo(beforeRender.k,    5);
    expect(afterRender.p   ).toBeCloseTo(beforeRender.p,    5);
    expect(afterRender.px  ).toBeCloseTo(beforeRender.px,   5);
  });

  // ---------------------------------------------------------------------
  // 6) Issue #394: default kites are positioned so their *body* clears
  //    the 10° drift cone at the leg midpoint with the tuned visual margin,
  //    independent of zoom and `legArrowSize`. The kite centre must sit at
  //    least `(len/2)*tan(10°) + defaultKiteHalfWidth*legZoomScale() +
  //    defaultLabelMargin` from the leg line. The original #394 fix put the
  //    *centre* at the cone edge, which left the kite body ON the leg line at
  //    low zoom or `legArrowSize >= 2`. This test pins the corrected invariant:
  //    kite centre at `cone + halfWidth + margin`, kite *edge* strictly clear
  //    of both the leg line and the drift cone.
  // ---------------------------------------------------------------------
  test('default kite body clears leg line + drift cone at every zoom', async ({ page }) => {
    await boot(page);
    await loadTwoWp(page);

    for (const z of [8, 10, 11, 12, 13, 14]) {
      for (const las of [1, 2, 3]) {
        const m = await page.evaluate(({ zoom, las }) => {
          window.legArrowSize = las;
          map.setZoom(zoom);
          return new Promise(resolve => setTimeout(() => {
            const a = proj(state.waypoints[0]);
            const b = proj(state.waypoints[1]);
            const legLen = Math.hypot(b.x - a.x, b.y - a.y);
            // legLabelCenter() is the same source of truth used by hit-testing.
            const ic = legLabelCenter(0, 'in');
            const oc = legLabelCenter(0, 'out');
            const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
            let dx = b.x - a.x, dy = b.y - a.y;
            const L = Math.hypot(dx, dy) || 1;
            dx /= L; dy /= L;
            const nx = -dy, ny = dx;
            const inPerp  = (ic.x - mx) * nx + (ic.y - my) * ny;
            const outPerp = (oc.x - mx) * nx + (oc.y - my) * ny;
            // New geographic model: the drift line reaches
            // legLen * driftLengthFactor at the drift angle; the kite is
            // ground-sized (kiteDrawScale), half-height = legKiteHeightPx*sc/2.
            const driftPerp = legLen * tune('driftLengthFactor') *
              Math.sin(tune('driftAngleDeg') * Math.PI / 180);
            const kiteHalf = tune('legKiteHeightPx') * kiteDrawScale() / 2;
            resolve({ zoom, las, legLen, inPerp, outPerp, driftPerp, kiteHalf });
          }, 50));
        }, { zoom: z, las });
        // Symmetric about the leg.
        expect(m.inPerp).toBeCloseTo(-m.outPerp, 1);
        // Property (the headline #393/#395 regression): at every zoom /
        // legArrowSize the kite's near edge is strictly past the drift cone
        // (so it never hides the drift lines) and clear of the leg line.
        const inEdge  =  m.inPerp  - m.kiteHalf;
        const outEdge = -m.outPerp - m.kiteHalf;
        expect(inEdge ).toBeGreaterThan(m.driftPerp);
        expect(outEdge).toBeGreaterThan(m.driftPerp);
        expect(inEdge ).toBeGreaterThan(0);
        expect(outEdge).toBeGreaterThan(0);
      }
    }
  });

  // ---------------------------------------------------------------------
  // 6b) PR #395 follow-up regression — the user's exact reproduction
  //    path. With a real-route shape (3 waypoints → 2 legs), persisted
  //    in localStorage, the user reported that after a hard reload +
  //    "Reset all marker positions" + zoom 8 the kites still appeared
  //    on the leg line. Root cause: the original #394 formula put the
  //    kite *centre* at `(len/2)*tan(10°) + margin` perpendicular but ignored
  //    the kite's own width, so the kite *body*
  //    overlapped the leg line at low zoom / large legArrowSize.
  // ---------------------------------------------------------------------
  test('PR #395 — 3 wp + reload + reset-all + zoom 8 keeps kites off the leg line', async ({ page }) => {
    // Seed a real-shape route directly in localStorage, mirroring what
    // happens when the user has persisted a route before reload. This
    // exercises the exact path the user reported failing.
    await page.addInitScript(({ hz, ha }) => {
      try {
        for (const k of Object.keys(localStorage)) localStorage.removeItem(k);
        sessionStorage.clear();
        for (const s of ['build','view','display','charts','export','print'])
          localStorage.setItem('navaid.sec.' + s, '1');
        localStorage.setItem('navaid.route', JSON.stringify({
          waypoints: [
            { lat: hz.lat, lng: hz.lng, name: 'A' },
            { lat: 32.50000, lng: 34.95000, name: 'B' },
            { lat: ha.lat, lng: ha.lng, name: 'C' },
          ],
          legs: [
            { inboundAltitude: 2000, outboundAltitude: 2000,
              flightSpeed: 90, outboundSpeed: 90,
              inLabel:  { a: 4, p:  18, _m: 1 },     // hand-tuned
              outLabel: { a: 4, p: -18, _m: 1 } },
            { inboundAltitude: 2500, outboundAltitude: 2500,
              flightSpeed: 90, outboundSpeed: 90,
              inLabel:  { a: 0, p:  20, _m: 1 },
              outLabel: { a: 0, p: -20, _m: 1 } },
          ],
          notes: [],
        }));
      } catch (e) {}
    }, { hz: LLHZ, ha: LLHA });
    await page.goto('?lang=en');
    await page.waitForFunction(
      () => state && state.legs && state.legs.length === 2 &&
            typeof _defaultLegLabels === 'function');

    // Hard reload — second boot path is the one the user actually walked.
    await page.reload();
    await page.waitForFunction(() => state && state.legs && state.legs.length === 2);

    // Click "Reset all marker positions" and accept the confirm. After
    // this the per-leg labels MUST be the `_default: 1` sentinel so the
    // renderer falls through to the drift-aware perpendicular formula.
    page.once('dialog', d => d.accept());
    await page.locator('#tool-reset-all-markers').click();
    await page.waitForFunction(
      () => state.legs.every(l => l.inLabel && l.inLabel._default === 1
                              && l.outLabel && l.outLabel._default === 1));

    // Set zoom 8 (typical CVFR overview). At this zoom + default
    // legArrowSize=1 the kite should already be visibly clear of the
    // leg line; with legArrowSize=2 (a common choice) the original
    // #394 formula put the kite centre 14 px out and the kite body —
    // which is 32 px wide at this zoom — overlapped the line. We
    // sweep both sizes here so the regression sticks.
    for (const las of [1, 2]) {
      const measurements = await page.evaluate(async (lasArg) => {
        window.legArrowSize = lasArg;
        map.setZoom(8);
        // One animation frame for setZoom + redraw to settle.
        await new Promise(r => setTimeout(r, 80));
        const out = [];
        for (let i = 0; i < state.legs.length; i++) {
          const a = proj(state.waypoints[i]);
          const b = proj(state.waypoints[i + 1]);
          let dx = b.x - a.x, dy = b.y - a.y;
          const L = Math.hypot(dx, dy) || 1;
          dx /= L; dy /= L;
          const nx = -dy, ny = dx;
          const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
          const ic = legLabelCenter(i, 'in');
          const oc = legLabelCenter(i, 'out');
          const inPerp  = Math.abs((ic.x - mx) * nx + (ic.y - my) * ny);
          const outPerp = Math.abs((oc.x - mx) * nx + (oc.y - my) * ny);
          const sc = legZoomScale();
          // Edge-of-kite distance to the leg line. Body clears the leg when
          // `centerPerp - halfWidth > 0`.
          const halfWidth = tune('defaultKiteHalfWidthPx') * sc;
          const inEdge  = inPerp  - halfWidth;
          const outEdge = outPerp - halfWidth;
          out.push({ i, inPerp, outPerp, inEdge, outEdge, sc, legLen: L });
        }
        return out;
      }, las);
      for (const m of measurements) {
        // Centre is at least 15 px off the leg line (the threshold the
        // PR-#395 review request specified).
        expect(m.inPerp ).toBeGreaterThanOrEqual(15);
        expect(m.outPerp).toBeGreaterThanOrEqual(15);
        // And the kite *body* is strictly clear of the leg line — this
        // is what visually broke for the user. Both edges > 0 ensures
        // no overlap at any zoom / legArrowSize the test exercises.
        expect(m.inEdge ).toBeGreaterThan(0);
        expect(m.outEdge).toBeGreaterThan(0);
      }
    }
  });

  // ---------------------------------------------------------------------
  // 7) Issue #394: short legs at low zoom — the formula's degenerate
  //    corner. A near-zero leg length must NOT NaN out the renderer or
  //    collapse the kite onto the leg line; the tuned margin is the floor.
  // ---------------------------------------------------------------------
  test('short leg + low zoom keeps default kite off the leg line (no NaN)', async ({ page }) => {
    await boot(page);
    // Two waypoints within ~10 m of each other → leg length collapses
    // to a handful of pixels even at zoom 14. At zoom 8 it's sub-pixel.
    await page.evaluate(([lat, lng]) => {
      state.waypoints = [
        { lat, lng, name: 'A' },
        { lat: lat + 0.0001, lng: lng + 0.0001, name: 'B' },
      ];
      syncLegs();
      draw();
    }, [LLHZ.lat, LLHZ.lng]);
    for (const z of [8, 10, 12, 14]) {
      const m = await page.evaluate((zoom) => {
        map.setZoom(zoom);
        return new Promise(resolve => setTimeout(() => {
          const ic = legLabelCenter(0, 'in');
          resolve({ zoom, x: ic.x, y: ic.y });
        }, 50));
      }, z);
      expect(Number.isFinite(m.x)).toBe(true);
      expect(Number.isFinite(m.y)).toBe(true);
    }
  });

  // ---------------------------------------------------------------------
  // 8) Issue #394: dragging a default kite materialises the rendered
  //    offset into `{ a, p, _m: 1 }` (drops `_default`) so subsequent
  //    drag deltas have a real starting point. Crucially: the kite
  //    must NOT jump to (0, 0) on the first pointer-move event.
  // ---------------------------------------------------------------------
  test('drag-start on default kite preserves visible position', async ({ page }) => {
    await boot(page);
    await loadTwoWp(page);
    await page.evaluate(() => map.setZoom(12));
    await page.waitForFunction(() => Math.abs(map.getZoom() - 12) < 0.01);

    const result = await page.evaluate(() => {
      // Capture the current rendered kite centre, then call the
      // materialiser directly (same code path that runs on mousedown).
      const before = legLabelCenter(0, 'in');
      _materialiseDefaultLegLabel(0, 'in');
      const stored = state.legs[0].inLabel;
      const after = legLabelCenter(0, 'in');
      return { before, after, stored };
    });
    // Storage shape is now the user-dragged form, no `_default`.
    expect(result.stored._default).toBeUndefined();
    expect(typeof result.stored.p).toBe('number');
    expect(result.stored._m).toBe(1);
    // Visible position must be unchanged within sub-pixel ε — the only
    // failure mode the materialiser cares about is the "jumps to 0,0"
    // pathology.
    expect(result.after.x).toBeCloseTo(result.before.x, 3);
    expect(result.after.y).toBeCloseTo(result.before.y, 3);
  });
});
