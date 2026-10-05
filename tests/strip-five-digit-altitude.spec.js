// @ts-check
// At airliner height the readout's altitude has five digits. With a large phone font the three
// instrument values outgrew the strip's line and the clip took the speed's leading digits:
// "451 kt" showed as "1 kt". They must all stay whole -- shrunk if need be, never cut.
const { test, expect } = require('./_setup');

for (const lang of ['he', 'en']) {
  test(`speed, altitude and heading stay whole at 34650 ft (${lang})`, async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 780 });
    await page.goto('?lang=' + lang + '&nogist');
    await page.waitForFunction(() => document.body.classList.contains('deck-on') && !!document.querySelector('.deck-strip-vals'));
    const r = await page.evaluate(async () => {
      const st = document.createElement('style');                   // a phone with a large font
      st.textContent = 'body .deck-strip .deck-strip-vals { font-size: 20px; }';
      document.head.appendChild(st);
      new Function('gpsLiveOn = true')();
      document.getElementById('gps-readout').textContent = '451 kt · 34650 ft · 125°';   // showing location
      window.dispatchEvent(new Event('resize'));
      await new Promise(res => setTimeout(res, 700));
      const v = document.querySelector('.deck-strip-vals'), line = v.parentElement;
      const vr = v.getBoundingClientRect(), lr = line.getBoundingClientRect();
      return { text: v.textContent, inside: vr.left >= lr.left - 1 && vr.right <= lr.right + 1, fits: line.scrollWidth <= line.clientWidth + 1 };
    });
    expect(r.text).toContain('451 kt');
    expect(r.text).toContain('34650 ft');
    expect(r.text).toContain('125°');
    expect(r.fits).toBe(true);
    expect(r.inside).toBe(true);
  });
}

test('a long flight drops its elapsed clock like a short one (125:30)', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await page.goto('?lang=he&nogist');
  await page.waitForFunction(() => document.body.classList.contains('deck-on') && !!document.querySelector('.deck-strip-vals'));
  const text = await page.evaluate(async () => {
    const st = document.createElement('style');
    st.textContent = 'body .deck-strip .deck-strip-vals { font-size: 20px; }';
    document.head.appendChild(st);
    new Function('gpsLiveOn = true')();
    document.getElementById('gps-readout').textContent = '3120 pts · 125:30 · 451 kt · 34650 ft · 125°';
    window.dispatchEvent(new Event('resize'));
    await new Promise(res => setTimeout(res, 700));
    return document.querySelector('.deck-strip-vals').textContent;
  });
  expect(text).not.toContain('125:30');
  expect(text).toContain('451 kt');
});
