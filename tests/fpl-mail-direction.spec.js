// @ts-check
// A filed mail is Hebrew prose above a Latin ICAO block, and a plain-text mail client takes the
// whole body's direction from its first strong character. So in a Hebrew session the (FPL-...)
// lines came out right-aligned, with '-LLHZ0805)' displayed as '(LLHZ0805-'. A left-to-right
// isolate fixes that without touching the codes.
//
// The PREAMBLE needs nothing: every point in the datasets has a Hebrew name, so a Hebrew mail's
// route list is Hebrew throughout, and even an all-Latin list keeps its order — the neutrals
// between two left-to-right runs take their direction (UBA rule N1), so 'A - B - C' does not
// reverse. An earlier version of this fix wrapped the list too, on a reordering that does not
// happen.
const { test, expect } = require('./_setup');

const LRI = '⁦', FSI = '⁨', PDI = '⁩';   // U+2066, U+2068, U+2069

const RES = {
  dep: 'LLHZ', dest: 'LLHZ', dof: '260818', to: 'ais@iaa.gov.il', eetMinutes: 30,
  expandedPoints: ['SFAIM', 'APOLN', 'ARENA'],
  text: '(FPL-4XDAZ-VG\n-C172/L-S/C\n-LLHZ0805)',
};

async function boot(page, lang) {
  await page.goto('?lang=' + lang + '&nogist');
  await page.waitForFunction(() => typeof fplMailtoUrl === 'function');
}

const body = (page, lang) => page.evaluate((r) => {
  const url = fplMailtoUrl(r, { depTimeLocal: '11:05' });
  return decodeURIComponent(new URL(url).search.replace(/^\?/, '').split('&')
    .find(p => p.startsWith('body=')).slice(5).replace(/\+/g, ' '));
}, RES);

for (const lang of ['he', 'en']) {
  test(`${lang}: the ICAO block is isolated left-to-right`, async ({ page }) => {
    await boot(page, lang);
    const b = await body(page, lang);
    expect(b).toContain(LRI + '(FPL-4XDAZ-VG');
    expect(b.trimEnd().endsWith(PDI)).toBe(true);
  });

  test(`${lang}: the block itself is untouched between the isolates`, async ({ page }) => {
    await boot(page, lang);
    const b = await body(page, lang);
    const inner = b.slice(b.indexOf(LRI) + 1, b.lastIndexOf(PDI));
    // Byte for byte what ICAO defines: anything extracting from '(FPL-' to its ')' — a desk's
    // parser, a paste into a filing form — must not see a stray mark.
    expect(inner).toBe(RES.text);
    expect(inner).not.toContain(LRI);
    expect(inner).not.toContain(FSI);
    expect(inner).not.toContain(PDI);
  });

  test(`${lang}: the route list is printed plainly, in the order flown`, async ({ page }) => {
    await boot(page, lang);
    const b = await body(page, lang);
    // The names follow the session language (a Hebrew mail names the points in Hebrew), so
    // ask the app what it would print rather than hard-coding either language's spelling.
    const list = await page.evaluate((r) => r.expandedPoints.map(fplPointLabel).join(' - '), RES);
    expect(b).toContain(list);
    expect(b).not.toContain(FSI);          // no marks in the prose: nothing there needs them
  });
}

test('the subject is left alone — it is Latin throughout', async ({ page }) => {
  await boot(page, 'he');
  const subject = await page.evaluate((r) => {
    const url = fplMailtoUrl(r, { depTimeLocal: '11:05', reg: '4XDAZ' });
    return decodeURIComponent(new URL(url).search.replace(/^\?/, '').split('&')
      .find(p => p.startsWith('subject=')).slice(8).replace(/\+/g, ' '));
  }, RES);
  for (const mark of [LRI, FSI, PDI]) expect(subject).not.toContain(mark);
});
