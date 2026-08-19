// @ts-check
// Coverage for PR #513: cumulative-time kite (drawCumTimeArrow / cumLabel +
// the showCumTime toggle) and the leg line-width slider.
const { test, expect } = require('./_setup');
const { enableShowReturn } = require('./_show-return');
const { LLHZ, LLHA } = require('./_airfieldArp');
const { hideToolbarMenus } = require('./_toolbar');

// Plain waypoints at the same coordinates the airfields sit on: this suite is about kite
// geometry and the sliders, and a route BETWEEN FIELDS would now have both of its legs
// inside a CTR (no cum kite, no drift cone) -- which is the CTR rule working, and tested in
// ctr-clock.spec.js, but it would leave nothing here to measure.
const ROUTE = {
  waypoints: [
    { lat: LLHZ.lat, lng: LLHZ.lng, name: 'START' },
    { lat: 32.45, lng: 34.9, name: 'A' },
    { lat: LLHA.lat, lng: LLHA.lng, name: 'END' },
  ],
};

async function boot(page) {
  await page.addInitScript(() => {
    try {
      if (localStorage.getItem('__cum_init') !== '1') {
        localStorage.clear();
        sessionStorage.clear();
        for (const s of ['build', 'view', 'display', 'charts', 'export', 'print'])
          localStorage.setItem('navaid.sec.' + s, '1');
        localStorage.setItem('__cum_init', '1');
      }
    } catch (e) {}
  });
  await page.goto('?lang=en');
  await page.waitForFunction(() => typeof state !== 'undefined' && typeof draw === 'function');
}

async function loadRoute(page) {
  await page.evaluate(route => {
    state.waypoints = route.waypoints.map(w => ({ lat: w.lat, lng: w.lng, name: w.name }));
    syncLegs();
    // Frame the route instead of trusting the landing view: these tests drag labels by
    // screen coordinates, and the route runs off the top of the map at the default zoom.
    if (typeof fitView === 'function') fitView();
    draw();
  }, ROUTE);
}

test.describe('Leg line-width slider', () => {
  test('slider min/max/step come from the JS constants', async ({ page }) => {
    await boot(page);
    // Range is symmetric about the shipped 0.5 default so the slider can thin the line
    // as well as thicken it — it used to run 0.1..2, putting the default 21% along.
    const s = page.locator('#leg-line-width');
    expect(await s.getAttribute('min')).toBe('0.1');
    expect(await s.getAttribute('max')).toBe('0.9');
    expect(await s.getAttribute('step')).toBe('0.1');
  });

  test('dragging the slider sets legLineWidth and persists it', async ({ page }) => {
    await boot(page);
    await page.locator('#leg-line-width').fill('0.8');
    await page.locator('#leg-line-width').dispatchEvent('input');
    const live = await page.evaluate(() => window.legLineWidth);
    expect(live).toBeCloseTo(0.8, 1);
    const stored = await page.evaluate(() => localStorage.getItem('navaid.legLineWidth3'));
    expect(parseFloat(stored)).toBeCloseTo(0.8, 1);
  });

  test('stored line width restores on reload', async ({ page }) => {
    await boot(page);
    await page.locator('#leg-line-width').fill('0.7');
    await page.locator('#leg-line-width').dispatchEvent('input');
    await page.reload();
    await page.waitForFunction(() => typeof state !== 'undefined');
    expect(await page.locator('#leg-line-width').inputValue()).toBe('0.7');
    expect(await page.evaluate(() => window.legLineWidth)).toBeCloseTo(0.7, 1);
  });

  test('the stroke width scales with legLineWidth', async ({ page }) => {
    await boot(page);
    await loadRoute(page);
    // Stub the canvas stroke to capture the lineWidth used for the leg line.
    const widths = await page.evaluate(() => {
      const seen = [];
      const realStroke = octx.stroke.bind(octx);
      octx.stroke = function () { seen.push(octx.lineWidth); return realStroke(); };
      window.legLineWidth = 1; draw();
      const baseMax = Math.max.apply(null, seen.filter(w => w >= 3 && w <= 6));
      seen.length = 0;
      window.legLineWidth = 2; draw();
      const wideMax = Math.max.apply(null, seen.filter(w => w >= 3 && w <= 12));
      octx.stroke = realStroke;
      return { baseMax, wideMax };
    });
    // Doubling legLineWidth roughly doubles the (non-selected) leg stroke (3.5 → 7).
    expect(widths.wideMax).toBeGreaterThan(widths.baseMax + 2);
  });
});

test.describe('Drift line-width slider', () => {
  test('slider min/max/step come from the JS constants', async ({ page }) => {
    await boot(page);
    // Symmetric about the shipped 1 default (was 0.5..6, putting it 9% along) and on a
    // 0.1 grid, which also gives 17 stops instead of coarse half-unit jumps.
    const s = page.locator('#drift-line-width');
    expect(await s.getAttribute('min')).toBe('0.2');
    expect(await s.getAttribute('max')).toBe('1.8');
    expect(await s.getAttribute('step')).toBe('0.1');
  });

  test('dragging the slider sets driftLineWidth and persists it', async ({ page }) => {
    await boot(page);
    await page.locator('#drift-line-width').fill('1.5');
    await page.locator('#drift-line-width').dispatchEvent('input');
    expect(await page.evaluate(() => window.driftLineWidth)).toBeCloseTo(1.5, 1);
    const stored = await page.evaluate(() => localStorage.getItem('navaid.driftLineWidth2'));
    expect(parseFloat(stored)).toBeCloseTo(1.5, 1);
  });

  test('stored drift width restores on reload', async ({ page }) => {
    await boot(page);
    await page.locator('#drift-line-width').fill('1.7');
    await page.locator('#drift-line-width').dispatchEvent('input');
    await page.reload();
    await page.waitForFunction(() => typeof state !== 'undefined');
    expect(await page.locator('#drift-line-width').inputValue()).toBe('1.7');
    expect(await page.evaluate(() => window.driftLineWidth)).toBeCloseTo(1.7, 1);
  });

  test('the drift-line stroke scales with driftLineWidth', async ({ page }) => {
    await boot(page);
    await loadRoute(page);
    const widths = await page.evaluate(() => {
      window.showDrift = true;
      // The drift lines are the only strokes painted with this exact colour.
      const DRIFT = 'rgba(20,20,20,0.6)';
      let captured = null;
      const realStroke = octx.stroke.bind(octx);
      octx.stroke = function () {
        if (octx.strokeStyle === DRIFT || octx.strokeStyle === 'rgba(20, 20, 20, 0.6)') {
          captured = octx.lineWidth;
        }
        return realStroke();
      };
      window.driftLineWidth = 1; draw();
      const base = captured;
      captured = null;
      window.driftLineWidth = 3; draw();
      const wide = captured;
      octx.stroke = realStroke;
      return { base, wide };
    });
    expect(widths.base).toBeCloseTo(1.5, 1);
    expect(widths.wide).toBeCloseTo(4.5, 1);
  });

  test('drift-line dashes are longer while endpoint length stays unchanged', async ({ page }) => {
    await boot(page);
    const out = await page.evaluate(() => {
      const dashCalls = [];
      const segments = [];
      const realSave = octx.save.bind(octx);
      const realRestore = octx.restore.bind(octx);
      const realSetLineDash = octx.setLineDash.bind(octx);
      const realBeginPath = octx.beginPath.bind(octx);
      const realMoveTo = octx.moveTo.bind(octx);
      const realLineTo = octx.lineTo.bind(octx);
      const realStroke = octx.stroke.bind(octx);
      let last = null;
      octx.save = function () {};
      octx.restore = function () {};
      octx.setLineDash = function (dash) { dashCalls.push(Array.from(dash)); };
      octx.beginPath = function () { last = null; };
      octx.moveTo = function (x, y) { last = { x, y }; };
      octx.lineTo = function (x, y) {
        if (last) {
          segments.push(Math.hypot(x - last.x, y - last.y));
        }
        last = { x, y };
      };
      octx.stroke = function () {};
      drawDriftLines({ x: 0, y: 0 }, { x: 100, y: 0 });
      octx.save = realSave;
      octx.restore = realRestore;
      octx.setLineDash = realSetLineDash;
      octx.beginPath = realBeginPath;
      octx.moveTo = realMoveTo;
      octx.lineTo = realLineTo;
      octx.stroke = realStroke;
      return { dash: dashCalls[0], segments };
    });
    expect(out.dash).toEqual([12, 8]);
    expect(out.segments).toHaveLength(2);
    expect(out.segments[0]).toBeCloseTo(50, 5);
    expect(out.segments[1]).toBeCloseTo(50, 5);
  });
});

test.describe('Cumulative-time kite', () => {
  test('showCumTime toggle persists and defaults on', async ({ page }) => {
    await boot(page);
    expect(await page.locator('#cumtime-cb').isChecked()).toBe(true);
    await page.locator('#cumtime-cb').uncheck();
    expect(await page.evaluate(() => window.showCumTime)).toBe(false);
    expect(await page.evaluate(() => localStorage.getItem('navaid.showCumTime'))).toBe('0');
    await page.reload();
    await page.waitForFunction(() => typeof state !== 'undefined');
    expect(await page.locator('#cumtime-cb').isChecked()).toBe(false);
  });

  test('every leg gets a default cumLabel', async ({ page }) => {
    await boot(page);
    await loadRoute(page);
    const ok = await page.evaluate(() =>
      state.legs.length > 0 &&
      state.legs.every(l => l.cumLabel && l.cumLabel._default === 1));
    expect(ok).toBe(true);
  });

  test('reset-all-markers restores cumLabel to default', async ({ page }) => {
    await boot(page);
    await loadRoute(page);
    // Nudge a cum kite off its default, then reset all.
    await page.evaluate(() => { state.legs[0].cumLabel = { a: 30, p: 20, _m: 1 }; });
    page.once('dialog', d => d.accept());
    await page.locator('#tool-reset-all-markers').click();
    const dflt = await page.evaluate(() => state.legs[0].cumLabel._default === 1);
    expect(dflt).toBe(true);
  });

  test('the cumulative-time kite is hit-testable and drag moves only its own offset', async ({ page }) => {
    await boot(page);
    await loadRoute(page);
    const out = await page.evaluate(() => {
      // Centre of the first cum kite, in container pixels.
      const c = cumLabelCenter(0);
      const inBefore = JSON.stringify(state.legs[0].inLabel);
      const hit = hitCumLabel(Math.round(c.x), Math.round(c.y));
      // Materialise + nudge as the drag handler would.
      _materialiseDefaultCumLabel(0);
      const before = { a: state.legs[0].cumLabel.a, p: state.legs[0].cumLabel.p };
      state.legs[0].cumLabel.a += 15;
      const inAfter = JSON.stringify(state.legs[0].inLabel);
      return { hit: !!hit && hit.i === 0, inUnchanged: inBefore === inAfter,
               moved: state.legs[0].cumLabel.a === before.a + 15 };
    });
    expect(out.hit).toBe(true);
    expect(out.moved).toBe(true);
    expect(out.inUnchanged).toBe(true);    // moving the cum kite must not touch the nav kite
  });

  test('dragging the cumulative-time kite orbits it around the waypoint anchor', async ({ page }) => {
    await boot(page);
    await loadRoute(page);
    await hideToolbarMenus(page);
    const dragPts = await page.evaluate(() => {
      window.showCumTime = true;
      draw();
      // Leg 0 is inside the departure CTR and has no cum kite: drag the first one that does.
      const li = state.legs.findIndex((_, i) => !legInsideCtr(i));
      const c = cumLabelCenter(li);
      const frame = cumLabelDragFrame(li, false);
      const r = mapEl.getBoundingClientRect();
      const vx = c.x - frame.anchor.x;
      const vy = c.y - frame.anchor.y;
      const candidates = [
        { x: frame.anchor.x - vy * 0.8, y: frame.anchor.y + vx * 0.8 },
        { x: frame.anchor.x + vy * 0.8, y: frame.anchor.y - vx * 0.8 },
        { x: frame.anchor.x + vx * 1.45, y: frame.anchor.y + vy * 1.45 },
      ];
      const target = candidates.find(p =>
        p.x > 40 && p.y > 40 && p.x < map.getSize().x - 40 && p.y < map.getSize().y - 40) ||
        candidates[2];
      return {
        start: { x: r.left + c.x + 8, y: r.top + c.y },
        target: { x: r.left + target.x, y: r.top + target.y },
        expected: target,
        li,
        inBefore: JSON.stringify(state.legs[li].inLabel),
      };
    });
    await page.mouse.move(dragPts.start.x, dragPts.start.y);
    await page.mouse.down();
    await page.mouse.move(dragPts.target.x, dragPts.target.y);
    await page.mouse.up();
    const out = await page.evaluate(({ expected, li }) => {
      const c = cumLabelCenter(li);
      const frame = cumLabelDragFrame(li, false);
      const drawn = [];
      const real = window.drawCumTimeArrow;
      window.drawCumTimeArrow = function (cx, cy, ang) {
        drawn.push({ cx, cy, ang });
        return real.apply(this, arguments);
      };
      draw();
      window.drawCumTimeArrow = real;
      const rendered = drawn[0];
      const expectedAngle = Math.atan2(frame.anchor.y - c.y, frame.anchor.x - c.x);
      const angleDelta = Math.atan2(Math.sin(rendered.ang - expectedAngle),
        Math.cos(rendered.ang - expectedAngle));
      return {
        center: c,
        label: state.legs[li].cumLabel,
        inAfter: JSON.stringify(state.legs[li].inLabel),
        distancePx: Math.hypot(c.x - expected.x, c.y - expected.y),
        radialPx: Math.hypot(c.x - frame.anchor.x, c.y - frame.anchor.y),
        angleDelta,
      };
    }, { expected: dragPts.expected, li: dragPts.li });
    expect(out.distancePx).toBeLessThan(2);
    expect(out.radialPx).toBeGreaterThan(10);
    expect(out.angleDelta).toBeCloseTo(0, 6);
    expect(out.label._default).toBeUndefined();
    expect(out.label._m).toBe(1);
    expect(out.inAfter).toBe(dragPts.inBefore);
  });

  test('load() preserves a stored cumLabel offset', async ({ page }) => {
    await boot(page);
    await loadRoute(page);
    await page.evaluate(() => {
      const doc = {
        waypoints: state.waypoints.map(w => ({ lat: w.lat, lng: w.lng, name: w.name })),
        legs: state.legs.map(l => ({
          inboundAltitude: l.inboundAltitude, outboundAltitude: l.outboundAltitude,
          flightSpeed: l.flightSpeed, outboundSpeed: l.outboundSpeed,
          inLabel: l.inLabel, outLabel: l.outLabel,
          cumLabel: { a: 12, p: -8, _m: 1 },
        })),
        notes: [],
      };
      load(new File([JSON.stringify(doc)], 'r.json', { type: 'application/json' }));
    });
    await page.waitForFunction(() =>
      state.legs[0] && state.legs[0].cumLabel && state.legs[0].cumLabel.a === 12);
    const cl = await page.evaluate(() => state.legs[0].cumLabel);
    expect(cl.a).toBe(12);
    expect(cl.p).toBe(-8);
  });

  test('showCumTime gates drawing — one cum kite per leg when on, none when off', async ({ page }) => {
    await boot(page);
    await loadRoute(page);
    const counts = await page.evaluate(() => {
      window.showReturn = false;
      const real = window.drawCumTimeArrow;
      let n = 0;
      window.drawCumTimeArrow = function () { n++; return real.apply(this, arguments); };
      window.showCumTime = true; n = 0; draw(); const on = n;
      window.showCumTime = false; n = 0; draw(); const off = n;
      window.drawCumTimeArrow = real;
      return { on, off, legs: state.legs.length, ctrClockStart: state.legs.filter((_, i) => legInsideCtr(i)).length };
    });
    // One inbound cum kite per leg EXCEPT the legs inside the departure CTR: this route
    // leaves LLHZ, whose first leg is flown on the field's procedure.
    expect(counts.on).toBe(counts.legs - counts.ctrClockStart);
    expect(counts.off).toBe(0);
  });

  test('cumulative time values are the running total of per-leg times', async ({ page }) => {
    await boot(page);
    await loadRoute(page);
    const res = await page.evaluate(() => {
      window.showReturn = false; window.showCumTime = true;
      const real = window.drawCumTimeArrow;
      const shown = [];
      // 4th positional arg of drawCumTimeArrow is the time string.
      window.drawCumTimeArrow = function (cx, cy, ang, cumTime) { shown.push(cumTime); return real.apply(this, arguments); };
      draw();
      window.drawCumTimeArrow = real;
      // Expected running totals from the same geo()/toHMS the renderer uses.
      const expected = [];
      let cum = 0;
      for (let i = 0; i < state.legs.length; i++) {
        // Legs inside the departure CTR contribute nothing and show nothing.
        if (legInsideCtr(i)) continue;
        const { dist } = geo(state.waypoints[i], state.waypoints[i + 1]);
        const sp = state.legs[i].flightSpeed;
        cum += sp > 0 ? dist / sp : 0;
        expected.push(cum > 0 ? toHMS(cum) : '--');
      }
      return { shown, expected };
    });
    expect(res.shown).toEqual(res.expected);
  });

  test('return route adds a second cum kite per leg', async ({ page }) => {
    await boot(page);
    await enableShowReturn(page);
    await loadRoute(page);
    const counts = await page.evaluate(() => {
      window.showCumTime = true;
      const real = window.drawCumTimeArrow;
      let n = 0;
      window.drawCumTimeArrow = function () { n++; return real.apply(this, arguments); };
      window.showReturn = false; n = 0; draw(); const oneWay = n;
      window.showReturn = true; n = 0; draw(); const both = n;
      window.drawCumTimeArrow = real;
      return { oneWay, both, legs: state.legs.length, ctrClockStart: state.legs.filter((_, i) => legInsideCtr(i)).length };
    });
    // Inbound skips the CTR legs; the RETURN kites are unaffected -- flying home, the leg
    // into the field is an arrival, not a departure.
    expect(counts.oneWay).toBe(counts.legs - counts.ctrClockStart);
    expect(counts.both).toBe((counts.legs - counts.ctrClockStart) + counts.legs);
  });

  test('the return cum kite is independently hit-testable and draggable', async ({ page }) => {
    await boot(page);
    await loadRoute(page);
    const out = await page.evaluate(() => {
      window.showReturn = true; window.showCumTime = true;
      draw();
      const c = cumLabelRetCenter(0);
      const hit = hitCumLabelRet(Math.round(c.x), Math.round(c.y));
      _materialiseDefaultCumLabelRet(0);
      const inbBefore = JSON.stringify(state.legs[0].cumLabel);
      state.legs[0].cumLabelRet.a += 20;
      const inbAfter = JSON.stringify(state.legs[0].cumLabel);
      return { hit: !!hit && hit.i === 0, inboundUnchanged: inbBefore === inbAfter };
    });
    expect(out.hit).toBe(true);
    expect(out.inboundUnchanged).toBe(true);   // moving return kite must not move inbound
  });

  test('reverse route preserves moved cumulative-time kite positions', async ({ page }) => {
    await boot(page);
    await loadRoute(page);
    const before = await page.evaluate(() => {
      // This case is about the LABEL OFFSETS surviving a reversal, measured as screen
      // positions. Reverse also turns the map 180 degrees now (reverse-rotates-map.spec.js),
      // which moves every screen coordinate on purpose -- so the rotation is switched off
      // here to keep the measurement about the thing under test.
      setTune('reverseRotatesMap', false);
      window.showReturn = true;
      window.showCumTime = true;
      state.legs[0].cumLabel = { a: 18, p: 12, _m: 1 };
      state.legs[0].cumLabelRet = { a: -24, p: -16, _m: 1 };
      draw();
      return {
        inbound: cumLabelCenter(0),
        ret: cumLabelRetCenter(0),
        target: state.legs.length - 1,
      };
    });
    await page.locator('#reverse').click();
    const after = await page.evaluate(target => ({
      inbound: cumLabelCenter(target),
      ret: cumLabelRetCenter(target),
      labels: {
        cumLabel: state.legs[target].cumLabel,
        cumLabelRet: state.legs[target].cumLabelRet,
      },
    }), before.target);
    expect(after.inbound.x).toBeCloseTo(before.ret.x, 4);
    expect(after.inbound.y).toBeCloseTo(before.ret.y, 4);
    expect(after.ret.x).toBeCloseTo(before.inbound.x, 4);
    expect(after.ret.y).toBeCloseTo(before.inbound.y, 4);
    expect(after.labels.cumLabel).toMatchObject({ a: 24, p: 16, _m: 1 });
    expect(after.labels.cumLabelRet).toMatchObject({ a: -18, p: -12, _m: 1 });
  });

  test('the return cum kite is not hit-testable when the return path is hidden', async ({ page }) => {
    await boot(page);
    await loadRoute(page);
    const hit = await page.evaluate(() => {
      window.showReturn = false; draw();
      const c = cumLabelRetCenter(0);
      return hitCumLabelRet(Math.round(c.x), Math.round(c.y));
    });
    expect(hit).toBeNull();
  });

  test('reset-all-markers restores cumLabelRet to default', async ({ page }) => {
    await boot(page);
    await loadRoute(page);
    await page.evaluate(() => { state.legs[0].cumLabelRet = { a: 40, p: 25, _m: 1 }; });
    page.once('dialog', d => d.accept());
    await page.locator('#tool-reset-all-markers').click();
    expect(await page.evaluate(() => state.legs[0].cumLabelRet._default === 1)).toBe(true);
  });

  test('the cum-kite and nav-kite text each scale with their own (ground-sized) kite', async ({ page }) => {
    await boot(page);
    await loadRoute(page);
    const out = await page.evaluate(() => {
      window.showReturn = false; window.showCumTime = true;
      const c = map.getCenter();
      map.setView([c.lat, c.lng], 12);
      const seen = new Set();
      const realText = octx.fillText.bind(octx);
      octx.fillText = function () { seen.add(octx.font); return realText.apply(this, arguments); };
      draw();
      octx.fillText = realText;
      // Kites are ground-sized now, each with its own draw scale — the text
      // follows suit (fits the smaller cum kite).
      const navFont = 'bold ' + Math.max(4, Math.round(tune('legKiteTextPx') * kiteDrawScale())) + 'px sans-serif';
      const cumFont = 'bold ' + Math.max(4, Math.round(tune('cumKiteTextPx') * cumKiteDrawScale())) + 'px sans-serif';
      return { fonts: Array.from(seen), navFont, cumFont };
    });
    expect(out.fonts).toContain(out.navFont);
    expect(out.fonts).toContain(out.cumFont);
  });
});
