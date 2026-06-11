// #722 — wind speed/direction effect on a leg / flight path.
// Wind-triangle engine (windTriangle / legWindFor), route-wide wind inputs
// in the View section + corner readout, per-leg override rows and the live
// "With wind" readout in the leg inspector, and round-trip persistence.
const { test, expect } = require('@playwright/test');

async function boot(page) {
  await page.goto('?lang=en');
  await page.waitForFunction(() => typeof state !== 'undefined' &&
    typeof windTriangle === 'function' && typeof legWindFor === 'function' &&
    typeof showInspector === 'function');
}

// Two waypoints due north of each other → true course 0°, dist ~30 NM.
async function seedLeg(page) {
  await page.evaluate(() => {
    state.waypoints = [{ lat: 32.0, lng: 35.0, name: 'A' },
                       { lat: 32.5, lng: 35.0, name: 'B' }];
    state.legs = []; syncLegs();
    state.legs[0].flightSpeed = 100;
    state.selected = { type: 'leg', index: 0 }; showInspector();
  });
}

test('windTriangle: direct crosswind crabs into the wind, GS < TAS', async ({ page }) => {
  await boot(page);
  const fx = await page.evaluate(() =>
    windTriangle(0, 100, { dir: 270, speed: 20 }));   // wind from the left (west)
  // WCA = asin(-20/100) ≈ -11.5° (crab left, into the wind)
  expect(fx.wcaDeg).toBeCloseTo(-11.54, 1);
  expect(fx.hdgTrue).toBeCloseTo(348.46, 1);
  // GS = 100·cos(WCA) − 0 head component ≈ 98.0
  expect(fx.gs).toBeCloseTo(97.98, 1);
});

test('windTriangle: pure headwind / tailwind shifts GS, zero WCA', async ({ page }) => {
  await boot(page);
  const { head, tail } = await page.evaluate(() => ({
    head: windTriangle(0, 100, { dir: 0, speed: 20 }),
    tail: windTriangle(0, 100, { dir: 180, speed: 20 }),
  }));
  expect(head.wcaDeg).toBeCloseTo(0, 5);
  expect(head.gs).toBeCloseTo(80, 5);
  expect(tail.gs).toBeCloseTo(120, 5);
});

test('windTriangle: calm or unflyable wind returns null', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(() => ({
    calm: windTriangle(0, 100, { dir: 270, speed: 0 }),
    unflyable: windTriangle(0, 20, { dir: 90, speed: 30 }),  // crosswind > TAS
    noTas: windTriangle(0, 0, { dir: 90, speed: 10 }),
  }));
  expect(r.calm).toBeNull();
  expect(r.unflyable).toBeNull();
  expect(r.noTas).toBeNull();
});

test('legWindFor: per-leg override beats route wind; speed 0 marks calm', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(() => {
    state.wind = { dir: 270, speed: 15 };
    const out = {};
    out.global = legWindFor({});                          // falls back to route wind
    out.override = legWindFor({ wind: { dir: 90, speed: 25 } });
    out.partial = legWindFor({ wind: { speed: 25 } });    // dir from route wind
    out.calmLeg = legWindFor({ wind: { speed: 0 } });     // explicit calm
    state.wind = { dir: 270, speed: 0 };
    out.allCalm = legWindFor({});
    return out;
  });
  expect(r.global).toEqual({ dir: 270, speed: 15 });
  expect(r.override).toEqual({ dir: 90, speed: 25 });
  expect(r.partial).toEqual({ dir: 270, speed: 25 });
  expect(r.calmLeg).toBeNull();
  expect(r.allCalm).toBeNull();
});

test('Show-wind toggle reveals the inputs; they drive state.wind + readout', async ({ page }) => {
  await page.addInitScript(() => {
    try { localStorage.setItem('navaid.sec.view', '1'); } catch (e) {}
  });
  await boot(page);
  const dir = page.locator('#wind-dir');
  const speed = page.locator('#wind-speed');
  // Inputs hidden until the toggle is on.
  await expect(dir).toBeHidden();
  const toggle = page.locator('#show-wind-cb');
  await expect(toggle).not.toBeChecked();
  await toggle.check();
  await expect(dir).toBeVisible();
  await expect(speed).toBeVisible();
  // Calm by default — readout hidden.
  await expect(page.locator('#wind-readout')).not.toHaveClass(/show/);
  await dir.fill('300');
  await speed.fill('18');
  await page.waitForFunction(() =>
    state.wind && state.wind.dir === 300 && state.wind.speed === 18);
  const readout = page.locator('#wind-readout');
  await expect(readout).toHaveClass(/show/);
  await expect(readout).toContainText('300');
  await expect(readout).toContainText('18');
  // Back to calm hides it again.
  await speed.fill('0');
  await expect(readout).not.toHaveClass(/show/);
  // Turning the toggle off hides the inputs and the readout again.
  await speed.fill('18');
  await expect(readout).toHaveClass(/show/);
  await toggle.uncheck();
  await expect(dir).toBeHidden();
  await expect(readout).not.toHaveClass(/show/);
});

test('Show-wind toggle persists across reload', async ({ page }) => {
  await page.addInitScript(() => {
    try { localStorage.setItem('navaid.sec.view', '1'); } catch (e) {}
  });
  await boot(page);
  await page.locator('#show-wind-cb').check();
  expect(await page.evaluate(() => localStorage.getItem('navaid.showWind'))).toBe('1');
  await page.reload();
  await page.waitForFunction(() => typeof state !== 'undefined');
  await expect(page.locator('#show-wind-cb')).toBeChecked();
  expect(await page.evaluate(() => window.showWind)).toBe(true);
});

test('leg inspector shows the wind-triangle readout and live-updates', async ({ page }) => {
  await boot(page);
  await seedLeg(page);
  await page.evaluate(() => {
    window.showWind = true;                // gate the inspector wind rows
    state.wind = { dir: 270, speed: 20 };
    showInspector();                       // rebuild with wind present
  });
  // Direct 20 kt crosswind on TAS 100: HDG ≈ 348T → 343M (magVar −5), GS ≈ 98.
  const fxVal = page.locator('#insp-body .row .val').filter({ hasText: 'GS' });
  await expect(fxVal).toContainText('343');
  await expect(fxVal).toContainText('GS 98');
  await expect(fxVal).toContainText('-12');
  // Override the leg to calm — readout row hides.
  const windInputs = page.locator('#insp-body .row input[type="number"]');
  // Input order: speed, in-alt, out-alt, wind dir, wind speed.
  await windInputs.nth(4).fill('0');
  await expect(fxVal).toBeHidden();
  expect(await page.evaluate(() => state.legs[0].wind)).toEqual({ speed: 0 });
});

test('leg wind ↻ clears the override back to the route wind', async ({ page }) => {
  await boot(page);
  await seedLeg(page);
  await page.evaluate(() => {
    window.showWind = true;
    state.wind = { dir: 270, speed: 20 };
    state.legs[0].wind = { dir: 90, speed: 35 };
    showInspector();
  });
  const dirInput = page.locator('#insp-body .row input[type="number"]').nth(3);
  await expect(dirInput).toHaveValue('90');
  // seedLeg has no charted altitude, so the only row-reset buttons are the two
  // wind rows: first = wind direction, second = wind speed.
  const dirReset = page.locator('#insp-body button.row-reset').first();
  await dirReset.click();
  await expect(dirInput).toHaveValue('');                 // blank → inherits route wind
  await expect(dirInput).toHaveAttribute('placeholder', '270');
  expect(await page.evaluate(() => state.legs[0].wind)).toEqual({ speed: 35 });
});

test('leg wind direction wraps on blur (-395 → 325)', async ({ page }) => {
  await boot(page);
  await seedLeg(page);
  await page.evaluate(() => { window.showWind = true; showInspector(); });
  const dirInput = page.locator('#insp-body .row input[type="number"]').nth(3);
  await dirInput.fill('-395');
  await dirInput.blur();
  await expect(dirInput).toHaveValue('325');
  expect(await page.evaluate(() => state.legs[0].wind.dir)).toBe(325);
});

test('route wind + per-leg overrides round-trip through serialize/apply', async ({ page }) => {
  await boot(page);
  await seedLeg(page);
  const r = await page.evaluate(() => {
    state.wind = { dir: 240, speed: 12 };
    state.legs[0].wind = { dir: 90, speed: 30 };
    const blob = serializeRoute();
    const verr = validateRoute(blob);
    applyRouteData(JSON.parse(JSON.stringify(blob)));
    return { verr, blob, wind: state.wind, legWind: state.legs[0].wind };
  });
  expect(r.verr).toBeNull();
  expect(r.blob.wind).toEqual({ dir: 240, speed: 12 });
  expect(r.blob.legs[0].wind).toEqual({ dir: 90, speed: 30 });
  expect(r.wind).toEqual({ dir: 240, speed: 12 });
  expect(r.legWind).toEqual({ dir: 90, speed: 30 });
});

test('validateRoute rejects malformed wind, accepts blobs without wind', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(() => {
    const base = { waypoints: [], legs: [], notes: [] };
    return {
      none: validateRoute(base),
      bad: validateRoute({ ...base, wind: 'strong' }),
      badDir: validateRoute({ ...base, wind: { dir: 'west', speed: 5 } }),
      ok: validateRoute({ ...base, wind: { dir: 200, speed: 5 } }),
    };
  });
  expect(r.none).toBeNull();
  expect(r.bad).toContain('root.wind');
  expect(r.badDir).toContain('root.wind.dir');
  expect(r.ok).toBeNull();
});

test('calm wind is omitted from saved blobs (no schema churn)', async ({ page }) => {
  await boot(page);
  await seedLeg(page);
  const blob = await page.evaluate(() => {
    state.wind = { dir: 270, speed: 0 };
    return serializeRoute();
  });
  expect(blob.wind).toBeUndefined();
  expect(blob.legs[0].wind).toBeUndefined();
});
