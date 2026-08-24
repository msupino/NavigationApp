// @ts-check
// Reported as "why this became bigger": the toolbar had grown to three rows. An unclosed
// <div> in a menu section swallowed everything after it, so #toolbar wrapped the rest of the
// page and laid itself out around it. Nothing in the app misbehaves when this happens --
// the browser silently repairs the tree its own way -- so it takes a test to notice.
const { test, expect } = require('./_setup');
const fs = require('fs');
const path = require('path');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'docs', 'index.html'), 'utf8');

// Elements the parser must see closed, in order. Void elements (input, img, br…) are not
// among them, so a plain tag-pair count is the whole check.
const PAIRED = ['div', 'label', 'select', 'button', 'span', 'table', 'ul', 'li'];

test('every container in index.html is closed', () => {
  const stack = [];
  const unclosed = [];
  const re = /<(\/?)([a-z]+)\b([^>]*)>/gi;
  let m;
  while ((m = re.exec(HTML))) {
    const [, slash, rawTag, attrs] = m;
    const tag = rawTag.toLowerCase();
    if (!PAIRED.includes(tag)) continue;
    if (attrs.trim().endsWith('/')) continue;            // self-closed, if anyone writes one
    if (!slash) {
      stack.push({ tag, at: HTML.slice(0, m.index).split('\n').length });
    } else {
      const open = stack.pop();
      if (!open || open.tag !== tag) unclosed.push({ closed: tag, open: open || null });
    }
  }
  expect(unclosed).toEqual([]);
  // Anything still open at the end is the bug this test exists for.
  expect(stack.map(s => `${s.tag} opened at line ${s.at}`)).toEqual([]);
});

// The symptom, measured: a menu bar that has swallowed the page is several rows tall.
test('the toolbar is one row tall with the menus closed', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 700 });
  await page.goto('?lang=he&nogist');                    // Hebrew: the longer labels
  await page.waitForFunction(() => !!document.getElementById('toolbar'));
  const h = await page.evaluate(() =>
    Math.round(document.getElementById('toolbar').getBoundingClientRect().height));
  expect(h).toBeLessThan(60);                            // ~35 healthy, ~105 when broken
});
