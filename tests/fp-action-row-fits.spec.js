// @ts-check
// Reported from a phone, with a screenshot: the flight plan's action buttons can be half the
// size. They were three-line blocks eating a third of the sheet -- and the height came from
// the WRAPPING, not the padding: "Nav log (PDF)" and "Submit flight plan" are long labels in a
// row of four, and a phone with the text size turned up gave each of them three lines.
//
// So the row is not made shorter by squeezing a button; it is made shorter by letting each
// label fit on one line -- smaller type, tighter sides, and the short name on a narrow screen.
const { test, expect } = require('./_setup');

async function openPlan(page, lang) {
  await page.goto('?lang=' + (lang || 'en') + '&nogist');
  await page.waitForFunction(() => typeof draw === 'function' && typeof showFlightPlan === 'function');
  await page.evaluate(() => {
    state.waypoints = [{ lat: 32.18, lng: 34.83, name: 'LLHZ' },
                       { lat: 32.78, lng: 35.02, name: 'LLHA' }];
    syncLegs();
    draw();
    showFlightPlan();
  });
  await page.waitForSelector('.modal-btns button');
}

const row = (page) => page.evaluate(() => {
  const el = document.querySelector('.modal-btns');
  const r = el.getBoundingClientRect();
  return {
    height: Math.round(r.height),
    buttons: Array.from(el.children).map(b => {
      const q = b.getBoundingClientRect();
      // How many line boxes the label actually occupies. Measured, not inferred from the
      // height: the button has a 44px touch minimum, so its box says nothing about its text.
      const range = document.createRange();
      range.selectNodeContents(b);
      return { text: b.textContent.trim(), h: Math.round(q.height),
               lines: range.getClientRects().length };
    }),
  };
});

// 260 CSS px stands in for a phone with the text size turned up: the same content, less room.
for (const [name, width] of [['a phone', 390], ['a phone with the text size up', 260]]) {
  for (const lang of ['en', 'he']) {
    test('the action row is one rank of one-line buttons on ' + name + ' (' + lang + ')', async ({ page }) => {
      await page.setViewportSize({ width, height: 700 });
      await openPlan(page, lang);
      const got = await row(page);
      // One rank: every button is as tall as the row, so none of them wrapped it.
      for (const b of got.buttons) {
        expect(b.h, b.text + ' is taller than the row').toBe(got.height);
        expect(b.lines, b.text + ' wrapped to ' + b.lines + ' lines').toBeLessThanOrEqual(1);
      }
      // ...and the row itself is one touch target tall, not three.
      expect(got.height).toBeLessThanOrEqual(52);
      // The touch minimum is the button, not the text.
      for (const b of got.buttons) expect(b.h).toBeGreaterThanOrEqual(44);
    });
  }
}

test('the short names are only for narrow rows', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await openPlan(page, 'en');
  const labels = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.modal-btns button')).map(b => b.textContent.trim()));
  // A desktop has the room, so it says what the buttons do.
  expect(labels.some(l => /Nav log/i.test(l))).toBe(true);
  expect(labels.some(l => /Submit|FPL/i.test(l))).toBe(true);
});

test('the full name stays reachable on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openPlan(page, 'en');
  const titled = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.modal-btns button'))
      .map(b => ({ text: b.textContent.trim(), title: b.title || '' })));
  const pdf = titled.find(b => b.text === 'PDF');
  expect(pdf, 'the nav log button is not there').toBeTruthy();
  // Shortened, not unexplained.
  expect(pdf.title).toMatch(/nav log/i);
});
