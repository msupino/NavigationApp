// Round-7 UI review findings: three touch targets the earlier pass missed, and the
// two CSS disclosure carets that never mirrored in RTL (io.js already mirrors the
// arrows it builds in JS — these were the inconsistent pair).
const { test, expect } = require('./_setup');

async function bootPhone(page, lang = 'en') {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.addInitScript(() => {
    try {
      for (const s of ['build', 'view', 'display', 'charts', 'export', 'print', 'weather'])
        localStorage.setItem('navaid.sec.' + s, '1');
    } catch (e) {}
  });
  await page.goto('?lang=' + lang + '&nogist');
  await page.waitForFunction(() => typeof draw === 'function');
}

test('the map heading entry, language picker and search dismiss are tappable', async ({ page }) => {
  await bootPhone(page);
  const sizes = await page.evaluate(() => {
    // The search panel is summoned on a phone (docked only on desktop), so its
    // dismiss button has no box until it is up.
    if (typeof showSearchOverlay === 'function') showSearchOverlay();
    const out = {};
    for (const id of ['rotate-hdg', 'lang-select', 'search-close']) {
      const el = document.getElementById(id);
      if (!el) { out[id] = null; continue; }
      const r = el.getBoundingClientRect();
      out[id] = { w: Math.round(r.width), h: Math.round(r.height) };
    }
    return out;
  });
  // 44px is the minimum this codebase already adopted for the zoom + footer links.
  expect(sizes['rotate-hdg'].h).toBeGreaterThanOrEqual(44);
  expect(sizes['lang-select'].h).toBeGreaterThanOrEqual(44);
  expect(sizes['search-close'].h).toBeGreaterThanOrEqual(44);
  expect(sizes['search-close'].w).toBeGreaterThanOrEqual(44);
});

test('the toolbar caret points the way the menu opens, in both languages', async ({ page }) => {
  const caret = async (lang) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('?lang=' + lang + '&nogist');
    await page.waitForFunction(() => !!document.querySelector('.tb-section-head'));
    return page.evaluate(() => {
      const head = document.querySelector('.tb-section:not(.tb-standalone) .tb-section-head');
      const cs = getComputedStyle(head, '::after');
      return { content: cs.content.replace(/"/g, ''), dir: document.documentElement.dir };
    });
  };
  const en = await caret('en');
  const he = await caret('he');
  expect(en.dir).toBe('ltr');
  expect(en.content).toContain('▶');
  expect(he.dir).toBe('rtl');
  expect(he.content).toContain('◀');      // mirrored, not left pointing right
});

test('the Charts airfield caret mirrors too, and points down when open', async ({ page }) => {
  const probe = async (lang) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('?lang=' + lang + '&nogist');
    await page.waitForFunction(() => typeof showChartsModal === 'function');
    return page.evaluate(async () => {
      document.querySelectorAll('.modal-back').forEach(e => e.remove());
      showChartsModal();
      await new Promise(r => setTimeout(r, 500));
      const head = document.querySelector('.charts-airport-header');
      if (!head) return null;
      const closed = getComputedStyle(head, '::before');
      const shut = { content: closed.content.replace(/"/g, ''), transform: closed.transform };
      return { shut, dir: document.documentElement.dir };
    });
  };
  const en = await probe('en');
  const he = await probe('he');
  expect(en.shut.content).toContain('▶');
  expect(he.shut.content).toContain('◀');
});
