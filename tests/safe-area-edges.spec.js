// @ts-check
// Reported from an iPad: the top bar is hidden by the status bar -- the clock, the wifi and
// the battery drawn on top of it.
//
// Two faults, one behind the other. The strip applied the TOP inset to its bottom padding (a
// three-value shorthand puts the third value there), and -- the reason nothing would have
// helped -- the page never asked for the insets at all: without `viewport-fit=cover` iOS
// reports every env(safe-area-inset-*) as zero, so a page can reserve room for a status bar
// with great care and still be drawn underneath it.
//
// Headless Chrome has no cut-outs, so these assert the declarations rather than the geometry:
// what can be checked is that the app asks, and asks at the right edges.
const { test, expect } = require('./_setup');

test('the page asks for the real insets', async ({ page }) => {
  await page.goto('?lang=en&nogist');
  const content = await page.getAttribute('meta[name="viewport"]', 'content');
  expect(content).toContain('viewport-fit=cover');
});

test('every edge-anchored surface says what it keeps clear of', async ({ page }) => {
  await page.goto('?lang=en&nogist');
  const css = await page.evaluate(() => fetch('app/style.css?v=src').then(r => r.text()));
  // Every block for this selector, not the first: a selector may be declared once for layout
  // and again for the edge it has to keep clear of.
  const rule = (selector) => {
    let out = '';
    let at = css.indexOf(selector);
    while (at >= 0) {
      out += css.slice(at, css.indexOf('}', at)) + '\n';
      at = css.indexOf(selector, at + selector.length);
    }
    return out;
  };
  // The strip reserves the status bar at the TOP, and its own bottom padding is the plain one.
  const strip = rule('.deck-strip {');
  expect(strip).toMatch(/padding-top:\s*calc\([^)]*safe-area-inset-top/);
  expect(strip).toMatch(/padding-bottom:\s*6px/);
  // The deck reserves the home indicator, and both reserve the sides for landscape.
  expect(rule('.deck-bar {')).toMatch(/safe-area-inset-bottom/);
  expect(strip).toMatch(/safe-area-inset-left/);
  expect(rule('.deck-bar {')).toMatch(/safe-area-inset-left/);
  // Leaflet's own corners, and the app's top-anchored chrome.
  expect(rule('.leaflet-top {')).toMatch(/safe-area-inset-top/);
  expect(rule('#toolbar {')).toMatch(/safe-area-inset-top/);
  expect(rule('.leaflet-control.zulu-clock {')).toMatch(/safe-area-inset-top/);
});

test('the bottom inset is reserved once, not twice', async ({ page }) => {
  await page.goto('?lang=en&nogist');
  const css = await page.evaluate(() => fetch('app/style.css?v=src').then(r => r.text()));
  // With the deck on, the corner is already lifted by the deck's height plus the inset; the
  // plain rule is scoped away so the home indicator is not paid for twice.
  expect(css).toMatch(/body:not\(\.deck-on\) \.leaflet-bottom \{[^}]*safe-area-inset-bottom/);
  expect(css).toMatch(/body\.deck-on \.leaflet-bottom \{[^}]*safe-area-inset-bottom/);
});
