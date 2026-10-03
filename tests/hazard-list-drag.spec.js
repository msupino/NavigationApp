// @ts-check
// The NOTAM, SIGMET and AIRMET lists move by their title, like the flight plan, and open again
// where they were left.
const { test, expect } = require('./_setup');

const AIRMET = 'LLLL AIRMET 20 VALID 021626/021900 LLBD- LLLL TEL AVIV FIR MOD TURB OBS WI N3310 E03556 - N3310 E03527 - N3240 E03444 - N3310 E03556 FL040/240 NC=';
const SIGMET = 'LCCC SIGMET T05 VALID 021700/022100 LCLK- LCCC NICOSIA FIR EMBD TS OBS NE OF LINE N3450 E03000 - N3525 E03255 TOP FL360 MOV NE 20KT NC=';

function openList([kind, airmet, sigmet]) {
  const now = Date.now();
  if (kind === 'notam') {
    showNotamModal([{ id: 'A0001/26', icao: 'LLHZ', text: 'RWY 11/29 CLSD.',
      start: new Date(now - 36e5).toISOString(), end: new Date(now + 36e5).toISOString(), geom: null }]);
  } else if (kind === 'sigmet') {
    showSigmetDecoded([{ id: 'T05', firId: 'LCCC', hazard: 'TS', raw: sigmet,
      validFrom: now / 1000 - 600, validTo: now / 1000 + 3600, coords: [] }]);
  } else {
    showAirmetDecoded([{ id: 'a', hazard: 'TURB', raw: airmet,
      validFrom: new Date(now - 6e5).toISOString(), validTo: new Date(now + 6e5).toISOString(), coords: [] }]);
  }
}

for (const kind of ['notam', 'sigmet', 'airmet']) {
  test(`the ${kind} list moves by its title and reopens there`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('?lang=en&nogist');
    await page.waitForFunction(() => typeof showNotamModal === 'function' && typeof showAirmetDecoded === 'function');
    const open = () => page.evaluate(openList, [kind, AIRMET, SIGMET]);
    await open();
    const box = page.locator('.modal-back .notam-modal');
    const title = box.locator('h3');
    await expect(title).toHaveClass(/modal-drag-handle/);
    const before = await box.boundingBox();
    const t = await title.boundingBox();
    await page.mouse.move(t.x + 20, t.y + t.height / 2);
    await page.mouse.down();
    await page.mouse.move(t.x - 80, t.y + t.height / 2 + 60, { steps: 5 });
    await page.mouse.up();
    const after = await box.boundingBox();
    expect(after.x).toBeCloseTo(before.x - 100, 0);
    expect(after.y).toBeCloseTo(before.y + 60, 0);
    // Close and reopen: it comes back where it was left.
    await page.keyboard.press('Escape');
    await expect(box).toHaveCount(0);
    await open();
    const again = await box.boundingBox();
    expect(again.x).toBeCloseTo(after.x, 0);
    expect(again.y).toBeCloseTo(after.y, 0);
  });
}

for (const kind of ['notam', 'sigmet', 'airmet']) {
  test(`the ${kind} list resizes from its corner grip and reopens at that size`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('?lang=en&nogist');
    await page.waitForFunction(() => typeof showNotamModal === 'function' && typeof attachResizeGrip === 'function');
    const open = () => page.evaluate(openList, [kind, AIRMET, SIGMET]);
    await open();
    const box = page.locator('.modal-back .notam-modal');
    const before = await box.boundingBox();
    const g = await box.locator('.resize-grip').boundingBox();
    await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2);
    await page.mouse.down();
    // The NOTAM list opens at its tallest; the short SIGMET / AIRMET lists have room to grow.
    const dy = kind === 'notam' ? -40 : 70;
    await page.mouse.move(g.x + g.width / 2 + 90, g.y + g.height / 2 + dy, { steps: 5 });
    await page.mouse.up();
    const after = await box.boundingBox();
    // The top-left stays put; right and bottom follow the pointer 1:1.
    expect(after.x).toBeCloseTo(before.x, -0.5);
    expect(after.y).toBeCloseTo(before.y, -0.5);
    expect(after.width).toBeCloseTo(before.width + 90, -0.5);
    expect(after.height).toBeCloseTo(before.height + dy, -0.5);
    await page.keyboard.press('Escape');
    await expect(box).toHaveCount(0);
    await open();
    const again = await box.boundingBox();
    expect(again.width).toBeCloseTo(after.width, -0.5);
    expect(again.height).toBeCloseTo(after.height, -0.5);
  });
}
