// @ts-check
// Every knob the VOR range ring and the search registry use must be gist-driveable:
// registered in NavAid.tuningDefaults, exposed in a ?tune group, and actually READ at
// runtime (a registered key nothing reads is a dead slider, which has shipped before).
const { test, expect } = require('./_setup');

const RING = ['vorRangeRingColor', 'vorRangeRingAlpha', 'vorRangeRingWidthPx',
  'vorRangeRingDashPx', 'vorRangeRingGapPx', 'vorRangeRingLabel', 'vorRangeRingSteps',
  'vorRangeRingLabelGapPx'];
const SEARCH = ['searchMaxResults', 'searchMaxVor', 'searchMaxAirfields', 'searchMaxNavWp',
  'searchMaxRouteWp', 'searchMaxNotes', 'searchNoteLabelChars'];

async function boot(page) {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof tune === 'function' && !!window.NavAid);
}

test('all new knobs are registered and grouped in the tune menu', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(([ring, search]) => {
    const grouped = new Set(NavAid.tuningGroups.flatMap(g => g.keys));
    const miss = k => !NavAid.tuningDefaults[k];
    return {
      unregistered: [...ring, ...search].filter(miss),
      ungrouped: [...ring, ...search].filter(k => !grouped.has(k)),
    };
  }, [RING, SEARCH]);
  expect(r.unregistered).toEqual([]);
  expect(r.ungrouped).toEqual([]);
});

test('a gist override of the ring knobs changes what is drawn', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(async () => {
    await loadVors();
    window.showVorStations = true;
    map.setView([30.5589, 35.1619], 9, { animate: false });
    state.selected = { type: 'vor', index: vors.findIndex(v => v.ident === 'ZFR') };
    // Capture the dash pattern + segment count the ring actually strokes.
    const spy = () => {
      let dash = null, moves = 0;
      const od = octx.setLineDash.bind(octx), ol = octx.lineTo.bind(octx);
      octx.setLineDash = a => { if (a && a.length && a[0]) dash = a.slice(); return od(a); };
      octx.lineTo = (x, y) => { moves++; return ol(x, y); };
      draw();
      octx.setLineDash = od; octx.lineTo = ol;
      return { dash, moves };
    };
    const before = spy();
    // Drive them the way the live gist does: overwrite the registry defaults.
    NavAid.tuningDefaults.vorRangeRingDashPx.value = 21;
    NavAid.tuningDefaults.vorRangeRingGapPx.value = 17;
    NavAid.tuningDefaults.vorRangeRingSteps.value = 16;
    const after = spy();
    NavAid.tuningDefaults.vorRangeRingDashPx.value = 7;
    NavAid.tuningDefaults.vorRangeRingGapPx.value = 6;
    NavAid.tuningDefaults.vorRangeRingSteps.value = 96;
    return { before, after };
  });
  expect(r.before.dash).toEqual([7, 6]);
  expect(r.after.dash).toEqual([21, 17]);          // gist value reached the canvas
  expect(r.after.moves).toBeLessThan(r.before.moves);  // fewer segments = coarser ring
});

test('a gist override of the search caps changes the result count', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(async () => {
    await loadVors();
    const run = () => {
      const inp = document.getElementById('wp-search');
      inp.value = 'A';                       // deliberately broad
      inp.dispatchEvent(new Event('input', { bubbles: true }));
      return document.querySelectorAll('#wp-search-results .wp-search-item').length;
    };
    const wide = run();
    NavAid.tuningDefaults.searchMaxResults.value = 4;
    const narrow = run();
    NavAid.tuningDefaults.searchMaxResults.value = 12;
    return { wide, narrow };
  });
  expect(r.wide).toBeGreaterThan(4);
  expect(r.narrow).toBeLessThanOrEqual(4);   // the cap is honoured live
});

// Guard the general invariant the user asked for: presentation values are driven by
// the tuning registry (and therefore by the live gist), not by literals in the
// drawing code. Structural resets (lineWidth = 1 after a stroke) are NOT tuning and
// are deliberately excluded.
const fs = require('fs');
const path = require('path');
const APP = path.join(__dirname, '..', 'docs', 'app');

test('no presentational colour literals are left in the drawing code', () => {
  const offenders = [];
  for (const f of ['draw.js', 'gps.js', 'interact.js', 'io.js']) {
    const src = fs.readFileSync(path.join(APP, f), 'utf8');
    src.split('\n').forEach((line, i) => {
      if (!/'#[0-9a-fA-F]{3,8}'/.test(line)) return;
      // Fallbacks next to a tune() call, and named *_FALLBACK constants, are fine.
      if (/tune\(/.test(line) || /FALLBACK/.test(line)) return;
      offenders.push(`${f}:${i + 1}: ${line.trim().slice(0, 70)}`);
    });
  }
  expect(offenders).toEqual([]);
});

test('overlay label halos share one gistable width', () => {
  const src = fs.readFileSync(path.join(APP, 'draw.js'), 'utf8');
  // Every halo stroke should read the knob rather than repeating a literal.
  expect(src).not.toMatch(/lineWidth = 2\.5;\s*\n\s*octx\.strokeStyle = colorWithAlpha\(tune\('overlayLabelHaloColor'\)/);
  expect(src).toMatch(/tune\('overlayLabelHaloWidthPx'\)/);
});
