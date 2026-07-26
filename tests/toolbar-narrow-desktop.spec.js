// @ts-check
// At desktop widths the floating menu bar is a horizontal pill. On a narrow
// desktop the section heads used to run off the right edge and vanish (overflow
// is visible for the dropdowns, so there's no scrollbar to reach them). The bar
// is now capped at the viewport width and wraps onto a second row instead.
const { test, expect } = require('./_setup');

async function boot(page, w, h = 800) {
  await page.setViewportSize({ width: w, height: h });
  await page.goto('?lang=en');
  await page.waitForFunction(() => document.getElementById('toolbar'));
}

async function barState(page) {
  return page.evaluate(() => {
    const tb = document.getElementById('toolbar');
    const b = tb.getBoundingClientRect();
    const heads = [...tb.querySelectorAll('.tb-section-head')].map(e => {
      const r = e.getBoundingClientRect();
      return { left: r.left, right: r.right };
    });
    return { right: b.right, left: b.left, height: b.height, vw: window.innerWidth, heads };
  });
}

test('narrow desktop: bar stays within the viewport and every section head is reachable', async ({ page }) => {
  await boot(page, 700);
  const s = await barState(page);
  expect(s.right).toBeLessThanOrEqual(s.vw + 0.5);   // no horizontal overflow
  expect(s.height).toBeGreaterThan(48);              // wrapped onto a 2nd row
  for (const h of s.heads) {
    expect(h.left).toBeGreaterThanOrEqual(-0.5);
    expect(h.right).toBeLessThanOrEqual(s.vw + 0.5); // fully on-screen
  }
});

test('wide desktop: bar stays a single row', async ({ page }) => {
  await boot(page, 1280);
  const s = await barState(page);
  expect(s.height).toBeLessThan(48);                 // one row
  expect(s.right).toBeLessThanOrEqual(s.vw + 0.5);
});

test('narrow desktop RTL: bar stays within the viewport', async ({ page }) => {
  await page.setViewportSize({ width: 700, height: 800 });
  await page.goto('?lang=he');
  await page.waitForFunction(() => document.getElementById('toolbar'));
  const s = await barState(page);
  expect(s.left).toBeGreaterThanOrEqual(-0.5);
  expect(s.right).toBeLessThanOrEqual(s.vw + 0.5);
});

test('Information section sliders + values stay inside the menu', async ({ page }) => {
  await boot(page, 1000);
  // Open the Information (weather) section and reveal the wind-field sliders.
  // The shared look-ahead time value ("+24h · 12-31 12:00Z") is the long one
  // that used to spill outside / resize the menu.
  await page.evaluate(() => {
    const sec = document.querySelector('.tb-section[data-sec="weather"]');
    sec.classList.add('open');
    document.getElementById('windfield-controls').hidden = false;
    document.getElementById('notam-controls').hidden = false;
    document.getElementById('lookahead-time-val').textContent = '+24h · 12-31 12:00Z';
  });
  const overflow = await page.evaluate(() => {
    const body = document.querySelector('.tb-section[data-sec="weather"] .tb-section-body');
    const br = body.getBoundingClientRect();
    const bad = [];
    body.querySelectorAll('.navtoggle').forEach(row => {
      row.querySelectorAll('input[type="range"], .slider-val').forEach(el => {
        if (el.offsetParent === null) return;          // skip hidden controls
        const r = el.getBoundingClientRect();
        if (r.width === 0) return;
        // Right edge must not spill past the menu body (small tolerance).
        if (r.right > br.right + 0.5 || r.left < br.left - 0.5) {
          bad.push({ id: el.id || el.className, reason: 'box', right: r.right, bodyRight: br.right });
        }
        // The value must fit its own box (no text painting outside it).
        if (el.scrollWidth > el.clientWidth + 1) {
          bad.push({ id: el.id || el.className, reason: 'text', scrollW: el.scrollWidth, clientW: el.clientWidth });
        }
      });
    });
    return bad;
  });
  expect(overflow).toEqual([]);

  // All sliders in the menu share one width, and it doesn't change when a
  // value label grows/shrinks (e.g. dragging the NOTAM timeline).
  const widths = await page.evaluate(() => {
    const sel = '.tb-section[data-sec="weather"] .tb-section-body .navtoggle input[type="range"]';
    return [...document.querySelectorAll(sel)]
      .filter(el => el.offsetParent !== null)
      .map(el => Math.round(el.getBoundingClientRect().width));
  });
  expect(widths.length).toBeGreaterThan(1);
  expect(new Set(widths).size).toBe(1);                 // uniform width

  const before = await page.evaluate(() =>
    Math.round(document.getElementById('lookahead-time').getBoundingClientRect().width));
  await page.evaluate(() => { document.getElementById('lookahead-time-val').textContent = '0'; });
  const after = await page.evaluate(() =>
    Math.round(document.getElementById('lookahead-time').getBoundingClientRect().width));
  expect(after).toBe(before);                           // stable while value changes
});

test('multi-open dropdowns get distinct columns (Extra layers ≠ Charts overlap)', async ({ page }) => {
  // Opening two sections at once (here Extra layers + Charts) must tile them
  // into separate columns; a missing offset once let the Extra-layers menu
  // land on top of Charts and swallow #notam-list-btn clicks.
  await boot(page, 1280);
  await page.evaluate(() => {
    for (const sec of ['charts', 'weather']) {
      const el = document.querySelector('.tb-section[data-sec="' + sec + '"]');
      el.classList.add('open');
      el.querySelector('.tb-section-head')?.setAttribute('aria-expanded', 'true');
    }
    const tb = document.getElementById('toolbar');
    tb.classList.add('multi-open');
    tb.dataset.openCount = '2';
  });
  const rects = await page.evaluate(() => {
    const r = sec => {
      const b = document.querySelector('.tb-section[data-sec="' + sec + '"] .tb-section-body')
        .getBoundingClientRect();
      return { left: b.left, right: b.right };
    };
    return { charts: r('charts'), weather: r('weather') };
  });
  // The two bodies must not horizontally overlap.
  const overlap = Math.min(rects.charts.right, rects.weather.right) -
    Math.max(rects.charts.left, rects.weather.left);
  expect(overlap).toBeLessThanOrEqual(0);
});

test('a section restored open at boot is clamped into the viewport', async ({ page }) => {
  // Mark the Print section open BEFORE the app loads, so the boot restore path
  // (classList.add('open'), which never goes through setSectionOpen) is used.
  await page.addInitScript(() => {
    try { localStorage.setItem('navaid.sec.print', '1'); } catch (e) { /* */ }
  });
  await boot(page, 760);
  await page.waitForFunction(() => document.querySelector('[data-sec="print"].open'));
  const r = await page.evaluate(() => {
    const body = document.querySelector('[data-sec="print"] .tb-section-body');
    const b = body.getBoundingClientRect();
    return { left: b.left, right: b.right, vw: window.innerWidth, w: b.width };
  });
  // Whatever the nudge, the restored-open dropdown must be fully on screen —
  // previously it was never clamped at boot, so it could sit off the edge with
  // its buttons unreachable until the section was closed and reopened.
  expect(r.right).toBeLessThanOrEqual(r.vw + 1);
  expect(r.left).toBeGreaterThanOrEqual(-1);
});

test('a dropdown nudge does not survive a resize', async ({ page }) => {
  await boot(page, 760);
  await page.locator('[data-sec="print"] .tb-section-head').click();
  await expect(page.locator('[data-sec="print"]')).toHaveClass(/open/);
  // Plant an obviously stale nudge, then resize. Nothing outside setSectionOpen
  // used to clear it, so the open dropdown kept a translateX computed for the old
  // viewport (and for the old toolbar layout after a desktop<->mobile switch).
  await page.evaluate(() => {
    document.querySelector('[data-sec="print"] .tb-section-body').style.transform =
      'translateX(-9999px)';
  });
  await page.setViewportSize({ width: 1400, height: 800 });
  await page.waitForFunction(() =>
    document.querySelector('[data-sec="print"] .tb-section-body').style.transform
      !== 'translateX(-9999px)');
  const r = await page.evaluate(() => {
    const body = document.querySelector('[data-sec="print"] .tb-section-body');
    const b = body.getBoundingClientRect();
    return { transform: body.style.transform, left: b.left, right: b.right, vw: window.innerWidth };
  });
  // Recomputed for the new viewport, and fully on screen.
  expect(r.transform).not.toBe('translateX(-9999px)');
  expect(r.right).toBeLessThanOrEqual(r.vw + 1);
  expect(r.left).toBeGreaterThanOrEqual(-1);
});
