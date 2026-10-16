const { test, expect } = require('./_setup');

async function boot(page, lang = 'en') {
  await page.goto(`?lang=${lang}&nogist`);
  await page.waitForFunction(() => typeof showInspector === 'function');
  await page.evaluate(() => {
    map.setView([32.1, 34.9], 12, { animate: false });
    state.notes = [{ lat: 32.1, lng: 34.9, text: 'Check\naltitude', color: '#fff6aa', shape: 'rect' }];
    state.selected = { type: 'note', index: 0 };
    draw(); showInspector();
  });
}

for (const lang of ['en', 'he']) {
  test(`note inspector offers a localized arrow alongside rectangle and oval (${lang})`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: lang === 'he' ? 390 : 1280, height: 844 });
    await boot(page, lang);
    const options = await page.locator('#insp-body select option').allTextContents();
    expect(options).toEqual(lang === 'he' ? ['מלבן', 'אליפסה', 'חץ'] : ['Rectangle', 'Oval', 'Arrow']);
    await page.locator('#insp-body select').selectOption('arrow');
    expect(await page.evaluate(() => state.notes[0].shape)).toBe('arrow');
    if (process.env.NAVAID_CAPTURE_NOTES) {
      await page.evaluate(() => clearBootLoading());
      await page.locator('#boot-loading').waitFor({ state: 'detached' });
      await page.screenshot({ path: testInfo.outputPath('arrow-note.png') });
    }
  });
}

test('arrow notes paint and hit-test the pointed outline, including rotation and export scaling', async ({ page }) => {
  await boot(page);
  const probes = await page.evaluate(() => {
    const originalContext = octx;
    const canvas = document.createElement('canvas');
    canvas.width = 2800; canvas.height = 2000;
    const results = [];
    state.selected = null;
    try {
      octx = canvas.getContext('2d');
      const bodyWidth = noteRect(0).w;
      state.notes[0].shape = 'arrow';
      const r = noteRect(0);
      const head = r.w - bodyWidth;
      for (const rot of [0, 90, 215]) {
        state.notes[0].rot = rot;
        for (const scale of [1, 2]) {
          octx.resetTransform();
          octx.clearRect(0, 0, canvas.width, canvas.height);
          octx.scale(scale, scale);
          drawNotes();
          const angle = rot * Math.PI / 180;
          const localToMap = (x, y) => ({
            x: r.x + r.w / 2 + x * Math.cos(angle) - y * Math.sin(angle),
            y: r.y + r.h / 2 + x * Math.sin(angle) + y * Math.cos(angle),
          });
          const tip = localToMap(r.w / 2 - head / 4, 0);
          const gap = localToMap(r.w / 2 - head / 4, r.h * 0.4);
          const alpha = p => octx.getImageData(Math.round(p.x * scale), Math.round(p.y * scale), 1, 1).data[3];
          results.push({ rot, scale, head, tipAlpha: alpha(tip), gapAlpha: alpha(gap),
            tipHit: hitNote(tip.x, tip.y), gapHit: hitNote(gap.x, gap.y) });
        }
      }
    } finally { octx = originalContext; }
    return results;
  });
  for (const probe of probes) {
    expect(probe.head).toBeGreaterThan(0);
    expect(probe.tipAlpha).toBeGreaterThan(0);
    expect(probe.gapAlpha).toBe(0);
    expect(probe.tipHit).toBe(0);
    expect(probe.gapHit).toBe(-1);
  }
});

test('arrow shape, size and direction survive saved routes and reload', async ({ page }) => {
  await boot(page);
  const result = await page.evaluate(() => {
    Object.assign(state.notes[0], { shape: 'arrow', rot: 135, size: 1.5 });
    const route = serializeRoute();
    const validation = validateRoute(route);
    state.notes = [];
    applyRouteData(route);
    const applied = { ...state.notes[0] };
    draw();
    return { validation, applied };
  });
  expect(result.validation).toBeNull();
  expect(result.applied).toMatchObject({ shape: 'arrow', rot: 135, size: 1.5, text: 'Check\naltitude' });
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('navaid.route') || '{}').notes?.[0]?.shape)).toBe('arrow');
  await page.reload();
  await page.waitForFunction(() => typeof noteRect === 'function');
  expect(await page.evaluate(() => state.notes[0])).toMatchObject({ shape: 'arrow', rot: 135, size: 1.5 });
});
