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
  // Open the Information (weather) section and reveal the wind-field + NOTAM
  // timeline sliders. The NOTAM time value ("+72h · 12:00Z") is the long one
  // that used to spill outside the menu.
  await page.evaluate(() => {
    const sec = document.querySelector('.tb-section[data-sec="weather"]');
    sec.classList.add('open');
    document.getElementById('windfield-controls').hidden = false;
    document.getElementById('notam-controls').hidden = false;
    document.getElementById('notam-time-val').textContent = '+72h · 12:00Z';
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
    Math.round(document.getElementById('notam-time').getBoundingClientRect().width));
  await page.evaluate(() => { document.getElementById('notam-time-val').textContent = '0'; });
  const after = await page.evaluate(() =>
    Math.round(document.getElementById('notam-time').getBoundingClientRect().width));
  expect(after).toBe(before);                           // stable while value changes
});
