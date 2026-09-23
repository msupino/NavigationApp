// @ts-check
// The airfield panel offers the tower's phone as a link that dials it.
//
// The call-sign catalog has carried a phone number for most fields all along; only the
// parking-request form used it, as text to copy by hand. A pilot who needs the tower on the
// phone -- a clearance by phone, a closed field, a dead radio -- is holding a phone.
const { test, expect } = require('./_setup');

async function openField(page, icao, lang = 'en') {
  await page.goto('?lang=' + lang + '&nogist');
  await page.waitForFunction(() => typeof showInspector === 'function'
    && Array.isArray(window.airfields) && airfields.length > 0
    && typeof commChangeCallSigns === 'object' && commChangeCallSigns
    && Object.keys(commChangeCallSigns).length > 0);
  await page.evaluate((code) => {
    state.selected = { type: 'airfield', index: airfields.findIndex(a => a.name === code) };
    showInspector();
  }, icao);
}

test('a field whose tower has a number shows it as a tel: link', async ({ page }) => {
  await openField(page, 'LLHZ');                      // Herzliya: 09-9719554 in the catalog
  const link = page.locator('#inspector .tower-phone');
  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute('href', 'tel:099719554');
  await expect(link).toContainText('09-9719554');
});

test('the frequencies stay together, with the phone after them', async ({ page }) => {
  await openField(page, 'LLHZ');
  const order = await page.evaluate(() => [...document.querySelectorAll('#inspector .comm-section .row')]
    .map(r => r.classList.contains('tower-phone-row') ? 'phone' : 'freq'));
  // Every frequency row comes before the phone: nothing that is not a radio sits among them.
  expect(order[order.length - 1]).toBe('phone');
  expect(order.filter(x => x === 'phone')).toHaveLength(1);
});

test('a field with no call sign gets no phone row, not an empty one', async ({ page }) => {
  await openField(page, 'LLES');                      // mapped to no call sign
  // The panel really is open on that field -- otherwise "no phone row" proves nothing.
  await expect(page.locator('#inspector')).not.toHaveClass(/hidden/);
  await expect(page.locator('#inspector .comm-section, #inspector .row').first()).toBeVisible();
  await expect(page.locator('#inspector .tower-phone-row')).toHaveCount(0);
});

test('in Hebrew the number still reads left to right', async ({ page }) => {
  await openField(page, 'LLHZ', 'he');
  const link = page.locator('#inspector .tower-phone');
  await expect(link).toHaveAttribute('dir', 'ltr');
  await expect(page.locator('#inspector .tower-phone-row label')).toHaveText('טלפון מגדל');
  // Read the glyphs in screen order: the text content can be right while the display is not.
  const visual = await link.evaluate((a) => {
    const node = [...a.childNodes].find(n => n.nodeType === 3);
    const chars = [];
    for (let i = 0; i < node.length; i++) {
      const r = document.createRange(); r.setStart(node, i); r.setEnd(node, i + 1);
      chars.push({ c: node.data[i], x: r.getBoundingClientRect().left });
    }
    return chars.sort((p, q) => p.x - q.x).map(o => o.c).join('').replace(/^☎\s*/, '');
  });
  expect(visual).toBe('09-9719554');
});
