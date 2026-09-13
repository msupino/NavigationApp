// @ts-check
// Reported from the panel, with a screenshot in each theme: the Satellite heading looks
// different from the ones above it.
//
// It is the same yellow chip -- .insp-section-badge, used by Communication, Weather and the
// AD/WS block -- but it sits inside .satellite-snippet-head, whose `label` rule paints the
// muted colour meant for a plain caption in that header. An element selector beats a class
// one, so the badge's own near-black lost to it and "Satellite" came out washed against a
// yellow ground while every other heading stayed crisp.
//
// One rule for every section heading in the panel, both themes. That is the assertion here:
// not a colour literal, but that they are the SAME -- a future palette change should move
// them together or fail here.
const { test, expect } = require('./_setup');

// The badges as the panel builds them, in the containers they live in: the container is
// half of the bug, so a bare badge in a bare div would prove nothing.
const SAMPLES = {
  comm: '<div class="insp-frame-head"><span class="insp-section-badge">Communication</span></div>',
  weather: '<div class="wx-head"><span class="insp-section-badge">Weather</span></div>',
  adws: '<div class="wx-block wx-adws"><span class="wx-label">AD / WS</span></div>',
  satellite: '<div class="satellite-snippet-section"><div class="satellite-snippet-head">'
    + '<label class="insp-section-badge">Satellite</label>'
    + '<span class="satellite-expand-hint">hint</span></div></div>',
};

async function badges(page, theme) {
  return page.evaluate(([samples, want]) => {
    document.body.classList.remove('theme-light', 'theme-dark');
    document.body.classList.add(want);
    const out = {};
    for (const [key, html] of Object.entries(samples)) {
      const host = document.createElement('div');
      host.innerHTML = html;
      document.body.appendChild(host);
      const el = host.querySelector('.insp-section-badge, .wx-label');
      const cs = getComputedStyle(el);
      out[key] = { color: cs.color, background: cs.backgroundColor, weight: cs.fontWeight };
      host.remove();
    }
    return out;
  }, [SAMPLES, theme]);
}

for (const theme of ['theme-light', 'theme-dark']) {
  test('every section heading in the panel is the same chip (' + theme + ')', async ({ page }) => {
    await page.goto('?lang=en&nogist');
    await page.waitForFunction(() => typeof draw === 'function');
    const got = await badges(page, theme);
    const reference = got.comm;
    // A yellow chip with dark text, not a transparent one: if the ground ever goes away the
    // comparison below would happily pass on four invisible labels.
    expect(reference.background).not.toBe('rgba(0, 0, 0, 0)');
    for (const key of ['weather', 'adws', 'satellite']) {
      expect(got[key], key + ' heading does not match the others').toEqual(reference);
    }
  });
}

// The muted colour in that header still belongs to what it was written for.
test('the caption beside the Satellite badge keeps its own quieter colour', async ({ page }) => {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof draw === 'function');
  const got = await page.evaluate((html) => {
    const host = document.createElement('div');
    host.innerHTML = html;
    document.body.appendChild(host);
    const plain = document.createElement('label');
    plain.textContent = 'caption';
    host.querySelector('.satellite-snippet-head').appendChild(plain);
    const badge = getComputedStyle(host.querySelector('.insp-section-badge')).color;
    const caption = getComputedStyle(plain).color;
    host.remove();
    return { badge, caption };
  }, SAMPLES.satellite);
  expect(got.caption).not.toBe(got.badge);
});
