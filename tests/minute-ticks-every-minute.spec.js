// @ts-check
// Every minute of a leg gets a tick: the even ones long and numbered, the odd ones shorter and
// bare. The odd tick was 4 px, and the 3.5 px route line covers the half of it next to the
// track, so it showed as a speck -- reported as "the minute marker only shows every 2 minutes".
const { test, expect } = require('./_setup');

test('a tick every minute: even long with a digit, odd shorter, clear of the route line, no digit', async ({ page }) => {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof drawMinuteMarkers === 'function' && typeof syncLegs === 'function');
  const r = await page.evaluate(() => {
    const ticks = [], digits = [];
    const lineTo = octx.lineTo.bind(octx), moveTo = octx.moveTo.bind(octx), fillText = octx.fillText.bind(octx);
    let from = null;
    octx.moveTo = (x, y) => { from = { x, y }; return moveTo(x, y); };
    octx.lineTo = (x, y) => { if (from) ticks.push(Math.hypot(x - from.x, y - from.y)); return lineTo(x, y); };
    octx.fillText = (t, x, y) => { digits.push(String(t)); return fillText(t, x, y); };
    // 7.5 minutes of leg: ticks at 1..7, digits at 2, 4, 6.
    drawMinuteMarkers({ x: 100, y: 100 }, { x: 400, y: 100 }, 7.5 / 60, '#1565c0');
    octx.moveTo = moveTo; octx.lineTo = lineTo; octx.fillText = fillText;
    return { ticks, digits, odd: tune('minuteTickOddPx'), even: tune('minuteTickEvenPx'), line: tune('routeLineWidthPx') };
  });
  expect(r.ticks.length).toBe(7);
  expect(r.digits).toEqual(['2', '4', '6']);
  const k = r.ticks[1] / r.even;                            // the size slider's scale
  r.ticks.forEach((len, i) => expect(len).toBeCloseTo(((i + 1) % 2 === 0 ? r.even : r.odd) * k, 3));
  expect(r.odd).toBeLessThan(r.even);                      // shorter than the numbered one
  expect(r.odd - r.line / 2).toBeGreaterThanOrEqual(4);    // at least 4 px of it beyond the line
});
