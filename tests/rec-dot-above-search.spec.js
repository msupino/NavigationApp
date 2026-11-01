// @ts-check
// The recording dot is the only sign a flight is being recorded: it must not be hidden by the
// docked search card, wherever that card ends up (the gist can let it be dragged).
const { test, expect } = require('./_setup');
test('the recording dot stays visible with the search card dragged over it', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('?lang=he&nogist');
  await page.waitForFunction(() => window.NavAid && typeof updateGpsRecIndicator === 'function' && !document.getElementById('boot-loading'));
  await page.evaluate(() => { window.gpsRecording = true; updateGpsRecIndicator(); });
  const r = await page.evaluate(() => {
    const dot = document.getElementById('gps-rec-indicator');
    const card = document.getElementById('search-overlay');
    const b = dot.getBoundingClientRect();
    // Drag the card (as its saved position would) right over the dot.
    Object.assign(card.style, { left: (b.left - 20) + 'px', top: (b.top - 10) + 'px', right: 'auto', transform: 'none' });
    dot.style.pointerEvents = 'auto';                 // let elementFromPoint see it, for the check
    const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
    dot.style.pointerEvents = '';
    return { dotOnTop: dot.contains(hit), z: getComputedStyle(dot).zIndex };
  });
  expect(r).toEqual({ dotOnTop: true, z: '1550' });
});
