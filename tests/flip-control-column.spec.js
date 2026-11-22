// @ts-check
// On a short screen (a Samsung flip in portrait, a landscape phone, split-screen) the bottom-right
// control column was a button too tall and wrapped: the audio-alerts (voice) button spilled into a
// second column LEFT of north-up (reported). It now stays a single right-edge column at flip
// heights, and a normal-height phone is untouched.
const { test, expect } = require('./_setup');

async function cols(w, h, browser) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.addInitScript(() => { window.__navaidNoDisclaimer = true; });
  await page.goto(process.env.BASE_URL + '?lang=en&nogist');
  await page.waitForFunction(() => typeof draw === 'function' && document.querySelector('.leaflet-bottom.leaflet-right'));
  const r = await page.evaluate(() => {
    if (typeof clearBootLoading === 'function') clearBootLoading();
    const bl = document.getElementById('boot-loading'); if (bl) bl.remove();
    // Production reality: ATC + assistant off via the gist.
    NavAid.tuningDefaults.featureAtcIlEmbed.value = false;
    if (NavAid.tuningDefaults.featureAssistant) NavAid.tuningDefaults.featureAssistant.value = false;
    document.querySelectorAll('.atc-fab-control, .assistant-fab-control').forEach(e => { e.style.display = 'none'; });
    draw();
    const v = document.querySelector('.voice-ctrl').getBoundingClientRect();
    const o = document.querySelector('.orient-ctrl').getBoundingClientRect();
    return { voiceLeft: Math.round(v.left), orientLeft: Math.round(o.left) };
  });
  await ctx.close();
  return r;
}

test('a flip-height screen keeps the controls in one column (voice not orphaned left of north-up)', async ({ browser }) => {
  for (const h of [580, 600, 640, 667]) {
    const r = await cols(360, h, browser);
    expect(r.voiceLeft, '360x' + h + ': voice and north-up share a column').toBe(r.orientLeft);
  }
});

test('a normal-height phone is untouched (one column, the usual spacing)', async ({ browser }) => {
  const r = await cols(390, 844, browser);
  expect(r.voiceLeft).toBe(r.orientLeft);
});
