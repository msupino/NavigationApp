// @ts-check
// Live ATC: the airfield panel links to LiveATC's own player for a field with a feed. A link,
// never audio in the app -- LiveATC's terms bar its streams from third-party products. The
// feeds come from the gist (`liveAtcFeeds`), so a new one needs no release. Nothing here
// follows the link: tests never load third parties.
const { test, expect } = require('./_setup');

async function openField(page, icao, lang = 'en', tun = {}) {
  await page.goto('?lang=' + lang + '&nogist');
  await page.waitForFunction(() => typeof showInspector === 'function'
    && Array.isArray(window.airfields) && airfields.length > 0
    && typeof commChangeCallSigns === 'object' && commChangeCallSigns
    && Object.keys(commChangeCallSigns).length > 0);
  await page.evaluate(([code, t]) => {
    Object.assign(NavAid.tuning, t);
    state.selected = { type: 'airfield', index: airfields.findIndex(a => a.name === code) };
    showInspector();
  }, [icao, tun]);
}

test('Herzliya links its tower feed to LiveATC, after the phone, out of the app', async ({ page }) => {
  await openField(page, 'LLHZ');
  const link = page.locator('#inspector .comm-section .live-atc-link');
  await expect(link).toHaveCount(1);
  await expect(link).toHaveAttribute('href', 'https://www.liveatc.net/hlisten.php?mount=llhz2_twr&icao=llhz');
  await expect(link).toHaveAttribute('target', '_blank');
  await expect(link).toHaveAttribute('rel', /noopener/);
  await expect(link).toContainText('Tower');
  await expect(link).toContainText('liveatc.net');
  expect(await link.getAttribute('aria-label')).toContain('on liveatc.net (opens outside NavAid)');
  // A drawn icon, not an emoji.
  await expect(link.locator('svg.nav-icon')).toHaveCount(1);
  // Thumb-sized.
  const box = await link.boundingBox();
  expect(box && box.height).toBeGreaterThanOrEqual(44);
  // After the radios and the phone: the last row of the frame.
  const last = await page.evaluate(() => {
    const rows = document.querySelectorAll('#inspector .comm-section .row');
    return rows[rows.length - 1].className;
  });
  expect(last).toContain('live-atc-row');
});

test('a field listed without a mount links to its LiveATC page', async ({ page }) => {
  await openField(page, 'LLBG');
  const link = page.locator('#inspector .live-atc-link');
  await expect(link).toHaveAttribute('href', 'https://www.liveatc.net/search/?icao=llbg');
  await expect(link).toContainText('All feeds');
});

test('a field with no feed has no Live ATC row', async ({ page }) => {
  await openField(page, 'LLES');
  await expect(page.locator('#inspector')).not.toHaveClass(/hidden/);
  await expect(page.locator('#inspector .live-atc-row')).toHaveCount(0);
});

test('the gist owns the list and the switch', async ({ page }) => {
  await openField(page, 'LLES', 'en', { liveAtcFeeds: 'LLES:lles_twr, LLES:lles_gnd' });
  await expect(page.locator('#inspector .live-atc-link')).toHaveCount(2);
  await expect(page.locator('#inspector .live-atc-link').nth(1)).toContainText('Ground');
  await openField(page, 'LLHZ', 'en', { featureLiveAtc: false });
  await expect(page.locator('#inspector')).not.toHaveClass(/hidden/);
  await expect(page.locator('#inspector .live-atc-row')).toHaveCount(0);
});

test('a mount that is not a plain name is not put into the link', async ({ page }) => {
  await openField(page, 'LLHZ', 'en', { liveAtcFeeds: 'LLHZ:"><img src=x>' });
  const link = page.locator('#inspector .live-atc-link');
  await expect(link).toHaveAttribute('href', 'https://www.liveatc.net/search/?icao=llhz');
  await expect(page.locator('#inspector img[src="x"]')).toHaveCount(0);
});

test('Hebrew labels it in Hebrew and keeps the host name left to right', async ({ page }) => {
  await openField(page, 'LLHZ', 'he');
  const row = page.locator('#inspector .live-atc-row');
  await expect(row.locator('label')).toHaveText('האזנה חיה');
  await expect(row.locator('.live-atc-role')).toHaveText('מגדל');
  await expect(row.locator('.live-atc-host')).toHaveAttribute('dir', 'ltr');
});
