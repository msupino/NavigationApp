// @ts-check
// Touch targets on the phone (UI review, batch 2): the Menu sheet, the inspector, the windows,
// the first-run notice and the attribution toggle were all measured under the 44px minimum.
// Every control a thumb has to hit is asserted here, in English and in Hebrew; a mouse desktop
// keeps its denser controls (last test).
const { test, expect } = require('./_setup');

const MIN = 43.5;   // 44 less sub-pixel rounding

async function boot(page, lang) {
  await page.goto('?lang=' + lang + '&nogist');
  await page.waitForFunction(() => window.NavAid && NavAid.refreshMobileDeck && typeof draw === 'function'
    && Array.isArray(window.airfields) && airfields.length > 0);
  await page.evaluate(() => {
    document.getElementById('boot-loading')?.remove();
    state.waypoints = [{ lat: 32.0, lng: 34.9, name: 'HRTZ' }, { lat: 32.3, lng: 35.1, name: 'LLEV' }];
    syncLegs(); draw();
  });
}

// Controls under the minimum inside `root`; tick boxes are judged by their label row.
function small(page, rootSel, extra) {
  return page.evaluate(([root, skip]) => {
    const out = [];
    for (const r of document.querySelectorAll(root)) {
      for (const e of r.querySelectorAll('button, select, input, summary')) {
        if (skip && e.matches(skip)) continue;
        const b = e.getBoundingClientRect();
        if (!b.width || !b.height) continue;
        const box = e.matches('input[type=checkbox], input[type=radio]');
        const t = box ? (e.closest('label') || e) : e;
        const tb = t.getBoundingClientRect();
        const wide = e.matches('button, input[type=color], .slider-reset');   // fields may be narrow
        if (tb.height < 43.5 || (wide && tb.width < 43.5)) {
          out.push((e.id || e.className || e.tagName) + ' ' + e.tagName + ' ' + Math.round(tb.width) + 'x' + Math.round(tb.height));
        }
      }
    }
    return [...new Set(out)];
  }, [rootSel, extra || '']);
}

for (const lang of ['en', 'he']) {
  test.describe('phone ' + lang, () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

    test('every control in every section of the Menu sheet is 44px', async ({ page }) => {
      test.setTimeout(60000);
      await boot(page, lang);
      await page.locator('#deck-bar .deck-btn').nth(1).click();
      await expect(page.locator('#deck-sheet')).toBeVisible();
      const secs = await page.locator('#deck-sheet #toolbar .tb-section:not(.tb-standalone)').evaluateAll(l => l.map(s => s.dataset.sec));
      expect(secs.length).toBeGreaterThan(6);
      const bad = [];
      for (const s of secs) {
        await page.evaluate((s) => {
          const sec = document.querySelector('#deck-sheet .tb-section[data-sec="' + s + '"]');
          if (!sec.classList.contains('open')) sec.querySelector('.tb-section-head').click();
        }, s);
        bad.push(...(await small(page, '#deck-sheet .tb-section[data-sec="' + s + '"]')).map(x => s + ': ' + x));
      }
      expect(bad).toEqual([]);
    });

    test('the inspector panel controls are 44px', async ({ page }) => {
      await boot(page, lang);
      for (const sel of [{ type: 'airfield', name: 'LLHZ' }, { type: 'wp', index: 0 }, { type: 'leg', index: 0 }]) {
        await page.evaluate((sel) => {
          state.selected = sel.type === 'airfield'
            ? { type: 'airfield', index: airfields.findIndex(a => a.name === sel.name) } : sel;
          showInspector();
        }, sel);
        await expect(page.locator('#inspector')).toBeVisible();
        // The round play button is drawn 32px with a ring that makes its tap area 44; the title
        // field is the panel's own header, measured with the rest.
        expect(await small(page, '#inspector', '.atc-play')).toEqual([]);
      }
    });

    test('windows: controls are 44px', async ({ page }) => {
      test.setTimeout(90000);
      await boot(page, lang);
      const bad = [];
      for (const id of ['route-library', 'freq-table', 'alt-pairs', 'mosaic-btn', 'nav-log', 'offline-tiles-btn',
        'tool-magnifier', 'print', 'sim-trigger']) {
        await page.evaluate((id) => document.getElementById(id).click(), id);
        await page.waitForTimeout(600);
        const r = await small(page, '.modal-back, .sim-overlay:not(.hidden), #magnifier-settings:not(.hidden)');
        bad.push(...r.map(x => id + ': ' + x));
        await page.keyboard.press('Escape');
        await page.evaluate(() => {
          document.querySelectorAll('.modal-back').forEach(e => e.remove());
          document.getElementById('sim-modal')?.classList.add('hidden');
          document.getElementById('magnifier-settings')?.classList.add('hidden');
        });
      }
      expect(bad).toEqual([]);
    });

    test('the simulator and ATC radio close buttons are 44px', async ({ page }) => {
      await boot(page, lang);
      await page.evaluate(() => document.getElementById('sim-trigger').click());
      const sim = await page.locator('#sim-modal-close').boundingBox();
      expect(sim.width).toBeGreaterThanOrEqual(MIN);
      expect(sim.height).toBeGreaterThanOrEqual(MIN);
      await page.evaluate(() => { document.getElementById('sim-modal').classList.add('hidden'); window.atcRadio.open(); });
      const atc = await page.locator('#atc-modal-close').boundingBox();
      expect(atc.width).toBeGreaterThanOrEqual(MIN);
      expect(atc.height).toBeGreaterThanOrEqual(MIN);
    });

    test('the first-run notice: links, Accept and the language names', async ({ page }) => {
      await boot(page, lang);
      const r = await page.evaluate(() => {
        NavAid.showDisclaimer();
        const m = document.querySelector('.disclaimer-modal');
        const h = (e) => e.getBoundingClientRect().height;
        return {
          links: [...m.querySelectorAll('.disclaimer-links a')].map(h),
          accept: parseFloat(getComputedStyle(m.querySelector('.disclaimer-accept')).fontSize),
          options: [...m.querySelectorAll('.disclaimer-lang-select option')].map(o => o.textContent),
          select: h(m.querySelector('.disclaimer-lang-select')),
        };
      });
      expect(r.links.length).toBe(2);
      for (const h of r.links) expect(h).toBeGreaterThanOrEqual(MIN);
      expect(r.accept).toBeGreaterThanOrEqual(14);
      expect(r.select).toBeGreaterThanOrEqual(MIN);
      expect(r.options).toEqual(['עברית', 'English']);
    });

    test('the attribution toggle is 44x44', async ({ page }) => {
      await boot(page, lang);
      const b = await page.locator('.attrib-toggle').boundingBox();
      expect(b.width).toBeGreaterThanOrEqual(MIN);
      expect(b.height).toBeGreaterThanOrEqual(MIN);
    });
  });
}

test.describe('a mouse desktop keeps its dense controls', () => {
  test.use({ viewport: { width: 1280, height: 800 } });
  test('menubar controls, notice codes and no attribution toggle', async ({ page }) => {
    await boot(page, 'en');
    const r = await page.evaluate(() => {
      const h = (s) => document.querySelector(s).getBoundingClientRect().height;
      NavAid.showDisclaimer();
      return {
        menubar: document.documentElement.classList.contains('menubar'),
        toggle: getComputedStyle(document.querySelector('.attrib-toggle')).display,
        options: [...document.querySelectorAll('.disclaimer-lang-select option')].map(o => o.textContent),
        linkH: h('.disclaimer-links a'),
      };
    });
    expect(r.menubar).toBe(true);
    expect(r.toggle).toBe('none');
    expect(r.options).toEqual(['HE', 'EN']);
    expect(r.linkH).toBeLessThan(30);
  });
});
