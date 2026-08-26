// @ts-check
// A slider sharing its line with its own label had 24–32 px of track left to drag on a
// phone — "Wind/temp opacity" and the NOTAM timeline were the worst of them. On a touch
// screen that is not a control: a fingertip is about 45 px across. The label and the value
// keep the first line; the slider gets the next one.
const { test, expect } = require('./_setup');

const PHONE = { width: 390, height: 760 };

// Every slider that is reachable with the menus open, measured where it actually renders.
async function sliders(page, lang = 'en') {
  await page.setViewportSize(PHONE);
  await page.goto('?lang=' + lang + '&nogist');
  await page.waitForFunction(() => !!document.getElementById('toolbar-toggle'));
  return page.evaluate(async () => {
    const tb = document.getElementById('toolbar');
    if (tb.classList.contains('collapsed')) document.getElementById('toolbar-toggle').click();
    const out = [];
    for (const sec of document.querySelectorAll('.tb-section')) {
      sec.querySelector('.tb-section-head').click();
      await new Promise(r => setTimeout(r, 120));
      // Sliders that only appear once their layer is on.
      for (const cb of sec.querySelectorAll('input[type=checkbox]')) {
        if (!cb.checked) { cb.checked = true; cb.dispatchEvent(new Event('change', { bubbles: true })); }
      }
      await new Promise(r => setTimeout(r, 350));
      for (const s of sec.querySelectorAll('input[type=range]')) {
        const r = s.getBoundingClientRect();
        if (r.width > 0) out.push({ id: s.id || s.className, w: Math.round(r.width), h: Math.round(r.height) });
      }
    }
    return out;
  });
}

test('every slider on a phone is wide enough to drag', async ({ page }) => {
  const found = await sliders(page);
  expect(found.length).toBeGreaterThan(2);
  const cramped = found.filter(s => s.w < 120);
  expect(cramped).toEqual([]);
});

// 18 px of height is a line, not a target. A fingertip is ~45 px across; the track needs
// enough of a strike area that a press lands on it rather than on the row behind it.
test('and tall enough to hit', async ({ page }) => {
  const found = await sliders(page);
  const thin = found.filter(s => s.h < 24);
  expect(thin).toEqual([]);
});

test('the same holds in Hebrew, where the labels are a different length', async ({ page }) => {
  const found = await sliders(page, 'he');
  expect(found.length).toBeGreaterThan(2);
  expect(found.filter(s => s.w < 120)).toEqual([]);
});

// Desktop is unchanged: there the menu is a dropdown that sizes to its content, and the
// slider is pinned to a fixed width so it does not resize as its value label changes.
test('a desktop menu keeps its fixed-width sliders', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => !!document.getElementById('toolbar'));
  const wrapped = await page.evaluate(() => {
    const row = document.querySelector('#toolbar .navtoggle-slider');
    return row ? getComputedStyle(row).flexWrap : null;
  });
  expect(wrapped).toBe('nowrap');
});
