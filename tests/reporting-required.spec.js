// @ts-check
// Issue #404 — `reportRequired` dataset + UI.
//
// Asserts the user-visible behaviour of the new "Show reporting type" overlay,
// the underlying docs/reporting-types.json data, and the inspector badge —
// without depending on the implementation details (no canvas-pixel sniffing,
// no globals beyond the public model).
//
// The dataset is intentionally separate from comm-change.json (#399). Both
// can apply to the same waypoint: e.g. TYONA & GALIM are *both* mandatory
// reporters and frequency-change points.
const { test, expect } = require('./_setup');

async function boot(page, { lang = 'en', noReporting = false } = {}) {
  await page.addInitScript(() => {
    try {
      if (localStorage.getItem('__test_reporting_init') !== '1') {
        for (const k of Object.keys(localStorage)) localStorage.removeItem(k);
        sessionStorage.clear();
        for (const s of ['build','view','display','charts','export','print'])
          localStorage.setItem('navaid.sec.' + s, '1');
        localStorage.setItem('__test_reporting_init', '1');
      }
    } catch (e) {}
  });
  if (noReporting) {
    await page.addInitScript(() => {
      try { localStorage.setItem('navaid.showReporting', '0'); } catch (e) {}
    });
  }
  await page.goto('?lang=' + lang);
  await page.waitForFunction(() => typeof state !== 'undefined');
  if (!noReporting) {
    // The toolbar boot kicks off loadReporting() too, but tests don't want
    // to race that — pre-warm explicitly so reportingFor() always resolves.
    await page.evaluate(() => loadReporting());
    await page.waitForFunction(() =>
      Array.isArray(window.reporting) && window.reporting.length > 0);
  }
  // navWP needed for the inspector flow (the route's waypoint is matched
  // against navWP for snap, then the inspector reads its name).
  await page.evaluate(() => loadNavWaypoints());
  await page.waitForFunction(() =>
    Array.isArray(window.navWP) && window.navWP.length > 0);
}

// ---------------------------------------------------------------------------
// Dataset shape — strict schema + coverage sanity.
// ---------------------------------------------------------------------------
test.describe('reporting-types.json — schema & coverage', () => {
  test('JSON parses, points have name + reportRequired ∈ {mandatory,on-request,arp}', async ({ page }) => {
    await boot(page);
    const summary = await page.evaluate(() => {
      const d = window.reporting;
      const types = new Set(d.map(r => r.reportRequired));
      const counts = { mandatory: 0, 'on-request': 0, arp: 0 };
      for (const r of d) counts[r.reportRequired] = (counts[r.reportRequired] || 0) + 1;
      const codes = new Set(d.map(r => r.name));
      return {
        total: d.length,
        unique: codes.size,
        types: [...types].sort(),
        counts,
        allHaveCode: d.every(r => typeof r.name === 'string' && /^[A-Z]{4,5}$/.test(r.name)),
      };
    });
    // Source: user transcription of IAA CVFR chart (issue #404).
    expect(summary.total).toBe(198);
    expect(summary.unique).toBe(198);
    expect(summary.types).toEqual(['arp', 'mandatory', 'on-request']);
    expect(summary.allHaveCode).toBe(true);
    // Loose lower-bound on each bucket — the chart wouldn't drop the order
    // of magnitude on a chart edition update.
    expect(summary.counts.mandatory).toBeGreaterThan(50);
    expect(summary.counts['on-request']).toBeGreaterThan(50);
    expect(summary.counts.arp).toBeGreaterThan(15);
  });

  test('validateReporting() rejects missing/wrong type fields', async ({ page }) => {
    await boot(page);
    const errs = await page.evaluate(() => ({
      noPoints: validateReporting({}),
      wrongRoot: validateReporting([]),
      missingName: validateReporting({ points: [{ reportRequired: 'mandatory' }] }),
      badType: validateReporting({ points: [{ name: 'XYZ', reportRequired: 'maybe' }] }),
      ok: validateReporting({ points: [
        { name: 'OHLIM', reportRequired: 'mandatory' },
        { name: 'EVLYM', reportRequired: 'on-request' },
        { name: 'LLBG',  reportRequired: 'arp' },
      ] }),
    }));
    expect(errs.noPoints).toMatch(/points/);
    expect(errs.wrongRoot).toMatch(/root/);
    expect(errs.missingName).toMatch(/name/);
    expect(errs.badType).toMatch(/reportRequired/);
    expect(errs.ok).toBeNull();
  });

  test('known sample mappings match the chart transcription', async ({ page }) => {
    await boot(page);
    const samples = await page.evaluate(() => ({
      OHLIM: reportingFor('OHLIM'),
      OLGAH: reportingFor('OLGAH'),
      TYONA: reportingFor('TYONA'),
      GALIM: reportingFor('GALIM'),
      EVLYM: reportingFor('EVLYM'),
      EILAT: reportingFor('EILAT'),
      BOREN: reportingFor('BOREN'),
      LLBG:  reportingFor('LLBG'),
      LLER:  reportingFor('LLER'),
      UNKNOWN: reportingFor('XXXXX'),
      empty: reportingFor(''),
    }));
    expect(samples.OHLIM).toBe('mandatory');
    expect(samples.OLGAH).toBe('mandatory');
    expect(samples.TYONA).toBe('mandatory');
    expect(samples.GALIM).toBe('mandatory');
    expect(samples.EVLYM).toBe('on-request');
    expect(samples.EILAT).toBe('on-request');
    expect(samples.BOREN).toBe('on-request');
    expect(samples.LLBG).toBe('arp');
    expect(samples.LLER).toBe('arp');
    expect(samples.UNKNOWN).toBeNull();
    expect(samples.empty).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Toolbar toggle + persistence.
// ---------------------------------------------------------------------------
test.describe('toolbar — Show reporting type', () => {
  test('checkbox is default-on, label rendered in English', async ({ page }) => {
    await boot(page);
    await expect(page.locator('#reporting-cb')).toBeChecked();
    const text = await page.locator('label[data-i18n-title="tbShowReportingTitle"]').textContent();
    expect(text || '').toMatch(/Show reporting type/i);
  });

  test('Hebrew locale renders Hebrew label', async ({ page }) => {
    await boot(page, { lang: 'he' });
    const text = await page.locator('label[data-i18n-title="tbShowReportingTitle"]').textContent();
    expect(text || '').toMatch(/הצג סוג דיווח/);
  });

  test('toggling the checkbox flips showReporting and persists', async ({ page }) => {
    await boot(page);
    await page.locator('#reporting-cb').click();
    await expect(page.locator('#reporting-cb')).not.toBeChecked();
    const stored = await page.evaluate(() => ({
      val: window.showReporting,
      ls: localStorage.getItem('navaid.showReporting'),
    }));
    expect(stored.val).toBe(false);
    expect(stored.ls).toBe('0');

    await page.locator('#reporting-cb').click();
    await expect(page.locator('#reporting-cb')).toBeChecked();
    const stored2 = await page.evaluate(() => ({
      val: window.showReporting,
      ls: localStorage.getItem('navaid.showReporting'),
    }));
    expect(stored2.val).toBe(true);
    expect(stored2.ls).toBe('1');
  });

  test('opt-out via localStorage starts the page with checkbox off', async ({ page }) => {
    await boot(page, { noReporting: true });
    await expect(page.locator('#reporting-cb')).not.toBeChecked();
    const v = await page.evaluate(() => window.showReporting);
    expect(v).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Inspector badge — only mandatory / on-request shown; ARP suppressed because
// the airfields section already covers it.
// ---------------------------------------------------------------------------
test.describe('inspector — reporting-type badge', () => {
  test('mandatory waypoint shows the mandatory badge', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => {
      const wp = navWP.find(w => w.name === 'OHLIM');
      state.waypoints = [{ lat: wp.lat, lng: wp.lng, name: 'OHLIM' }];
      syncLegs();
      state.selected = { type: 'wp', index: 0 };
      showInspector();
    });
    const badge = page.locator('.reporting-badge.reporting-mandatory');
    await expect(badge).toHaveCount(1);
    await expect(badge).toContainText('Mandatory');
  });

  test('on-request waypoint shows the on-request badge', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => {
      const wp = navWP.find(w => w.name === 'EVLYM');
      state.waypoints = [{ lat: wp.lat, lng: wp.lng, name: 'EVLYM' }];
      syncLegs();
      state.selected = { type: 'wp', index: 0 };
      showInspector();
    });
    const badge = page.locator('.reporting-badge.reporting-on-request');
    await expect(badge).toHaveCount(1);
    await expect(badge).toContainText('On request');
  });

  test('ARP waypoint (e.g. LLBG) gets NO reporting badge — airfields panel handles it', async ({ page }) => {
    await boot(page);
    await page.evaluate(async () => {
      await loadAirfields();
      const af = airfields.find(a => a.name === 'LLBG');
      state.waypoints = [{ lat: af.lat, lng: af.lng, name: 'LLBG' }];
      syncLegs();
      state.selected = { type: 'wp', index: 0 };
      showInspector();
    });
    await expect(page.locator('.reporting-badge')).toHaveCount(0);
  });

  test('unknown / user-typed waypoint name shows no badge', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => {
      state.waypoints = [{ lat: 32.0, lng: 35.0, name: 'MY-CUSTOM-WP' }];
      syncLegs();
      state.selected = { type: 'wp', index: 0 };
      showInspector();
    });
    await expect(page.locator('.reporting-badge')).toHaveCount(0);
  });
});

// ---------------------------------------------------------------------------
// Independence from comm-change (issue #399) — the two attributes can both
// apply, so reportingFor() doesn't depend on commChange and vice versa.
// ---------------------------------------------------------------------------
test.describe('independence from commChange (#399)', () => {
  test('TYONA and GALIM are mandatory reporters in this dataset', async ({ page }) => {
    await boot(page);
    // Even on dev (where comm-change.json is not yet present), reporting must
    // resolve these two unambiguously. They are the canonical "both" examples.
    const results = await page.evaluate(() => ({
      TYONA: reportingFor('TYONA'),
      GALIM: reportingFor('GALIM'),
    }));
    expect(results.TYONA).toBe('mandatory');
    expect(results.GALIM).toBe('mandatory');
  });
});
