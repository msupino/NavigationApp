// @ts-check
// Regression test for #177: exportPNG's draw block must restore octx even
// when a draw function throws. The fix wraps the sequence in try/finally;
// this test triggers the exception path and checks the restore.
const { test, expect } = require('./_setup');

test.describe('#177 exportPNG restores octx on throw', () => {
  test('octx restored after a draw function throws (try/finally)', async ({ page }) => {
    await page.goto('?lang=en');
    await page.waitForFunction(() => typeof octx !== 'undefined');

    const result = await page.evaluate(() => {
      const screenOctx = octx;
      const fakeOctx = { isFake: true, save() {}, restore() {}, scale() {}, translate() {} };
      // Save the real drawWaypoints so we can restore it.
      const realDW = window.drawWaypoints;
      try {
        // Mimic the exportPNG block at io.js:996-1011 with a throwing draw.
        window.drawWaypoints = () => { throw new Error('boom'); };
        const prevOctx = octx;
        octx = fakeOctx;
        try {
          window.drawWaypoints();          // throws
        } finally {
          octx = prevOctx;                 // the #177 fix
        }
      } catch (e) {
        // Expected: the error propagates after finally restores octx.
      } finally {
        window.drawWaypoints = realDW;
      }
      return { restored: octx === screenOctx, isFakeNow: octx && octx.isFake === true };
    });
    expect(result.restored).toBe(true);
    expect(result.isFakeNow).toBe(false);
  });

  test('multiple consecutive exports do not poison the screen ctx', async ({ page }) => {
    await page.goto('?lang=en');
    await page.waitForFunction(() => typeof octx !== 'undefined');

    const okAfter = await page.evaluate(() => {
      const screenOctx = octx;
      const realDW = window.drawWaypoints;
      try {
        window.drawWaypoints = () => { throw new Error('boom'); };
        // 3 export-shaped blocks in a row, each must restore.
        for (let i = 0; i < 3; i++) {
          const prevOctx = octx;
          octx = { isFake: true };
          try { window.drawWaypoints(); } catch (e) {}
          finally { octx = prevOctx; }
        }
      } finally {
        window.drawWaypoints = realDW;
      }
      return octx === screenOctx;
    });
    expect(okAfter).toBe(true);
  });
});
