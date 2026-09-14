// @ts-check
// The safety acknowledgement: shown once, before the chart is used.
//
// terms.html has said all of this since the beginning and the footer links to it, but a link
// in a footer is not an acknowledgement. An app that draws routes on aeronautical charts has
// to say in front of the pilot, before they start, that it is not certified for navigation.
// Apple's reviewers look for it on an aviation app; it belongs in the app either way, so it
// is the web app that carries it and not the native shell.
const { test, expect } = require('./_setup');
test.use({ acknowledgeDisclaimer: false });

// The fixture acknowledges the notice for the whole suite. These tests are about the first
// run, so they start from a browser that has never seen it.
// Once per test, not once per navigation: a reload has to find whatever the first run
// stored, which is the whole point of several of these.
async function fresh(page) {
  await page.addInitScript(() => {
    try {
      if (sessionStorage.getItem('__disclaimerCleared')) return;
      sessionStorage.setItem('__disclaimerCleared', '1');
      localStorage.removeItem('navaid.disclaimerAck');
    } catch (e) {}
  });
}

const boot = (page, q) => page.goto('?lang=en&nogist' + (q || ''));
const notice = (page) => page.locator('.disclaimer-back');

test('the first run asks, and says what it is asking', async ({ page }) => {
  await fresh(page);
  await boot(page);
  await expect(notice(page)).toBeVisible();
  const text = await notice(page).innerText();
  expect(text).toMatch(/NOT certified for navigation/i);
  expect(text).toMatch(/AIP/);
  expect(text).toMatch(/pilot in command/i);
  // The full text is one press away, in a new tab -- following a link from here would
  // throw away an unanswered acknowledgement.
  const links = notice(page).locator('a');
  await expect(links).toHaveCount(2);
  expect(await links.nth(0).getAttribute('href')).toBe('terms.html');
  expect(await links.nth(1).getAttribute('href')).toBe('privacy.html');
  for (const i of [0, 1]) {
    expect(await links.nth(i).getAttribute('target')).toBe('_blank');
    expect(await links.nth(i).getAttribute('rel')).toContain('noopener');
  }
});

test('the only way out is the acknowledgement', async ({ page }) => {
  await fresh(page);
  await boot(page);
  await expect(notice(page)).toBeVisible();
  // No close X, and neither Escape nor the backdrop dismisses it: a notice with another way
  // out is one that gets dismissed without being read.
  await expect(notice(page).locator('.modal-close-x')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(notice(page)).toBeVisible();
  await notice(page).click({ position: { x: 5, y: 5 } });
  await expect(notice(page)).toBeVisible();
  await page.locator('.disclaimer-accept').click();
  await expect(notice(page)).toHaveCount(0);
});

test('it is asked once, not at every launch', async ({ page }) => {
  await fresh(page);
  await boot(page);
  await page.locator('.disclaimer-accept').click();
  await expect(notice(page)).toHaveCount(0);
  const stored = await page.evaluate(() => localStorage.getItem('navaid.disclaimerAck'));
  expect(stored).toBe(await page.evaluate(() => NavAid.disclaimerVersion));
  await boot(page);
  await page.waitForFunction(() => window.NavAid && NavAid.disclaimerAccepted);
  await expect(notice(page)).toHaveCount(0);
});

test('a changed notice is put in front of everyone again', async ({ page }) => {
  // An acknowledgement of an older wording. Staged from an init script rather than written
  // before a reload: the suite's fixture re-acknowledges the CURRENT version on every
  // navigation, and init scripts run in the order they were added, so this one wins.
  await page.addInitScript(() => {
    try { localStorage.setItem('navaid.disclaimerAck', '2001-01-01'); } catch (e) {}
  });
  await boot(page);
  await expect(notice(page)).toBeVisible();
  await page.locator('.disclaimer-accept').click();
  await expect(notice(page)).toHaveCount(0);
});

test('a pilot can ask for it again after acknowledging', async ({ page }) => {
  await fresh(page);
  await boot(page);
  await page.locator('.disclaimer-accept').click();
  await expect(notice(page)).toHaveCount(0);
  await page.evaluate(() => NavAid.showDisclaimer());
  await expect(notice(page)).toBeVisible();
  // ...and asking twice does not stack two of them.
  await page.evaluate(() => NavAid.showDisclaimer());
  await expect(notice(page)).toHaveCount(1);
});

test('the gist can withdraw it, and the acknowledgement still works', async ({ page }) => {
  await fresh(page);
  await boot(page);
  await expect(notice(page)).toBeVisible();
  await page.locator('.disclaimer-accept').click();
  const shownWithFeatureOff = await page.evaluate(() => {
    localStorage.removeItem('navaid.disclaimerAck');
    NavAid.tuningDefaults.featureDisclaimer.value = false;
    return !!NavAid.maybeShowDisclaimer();
  });
  expect(shownWithFeatureOff).toBe(false);
});

test('Hebrew asks in Hebrew', async ({ page }) => {
  await fresh(page);
  await page.goto('?lang=he&nogist');
  await expect(notice(page)).toBeVisible();
  const text = await notice(page).innerText();
  expect(text).toMatch(/כלי תכנון בלבד/);
  expect(text).toMatch(/הטייס המפקד/);
  await expect(page.locator('.disclaimer-accept')).toHaveText('הבנתי');
});

// The suite pre-acknowledges the notice in tests/_setup.js with a literal version string.
// If the notice changes and that literal does not, every spec in the suite meets a modal
// before the chart -- 3,500 confusing failures for one stale string. Fail here instead,
// where the reason is written down.
test('the fixture acknowledges the version the app is actually asking about', async ({ page }) => {
  const fs = require('fs');
  const path = require('path');
  const setup = fs.readFileSync(path.join(__dirname, '_setup.js'), 'utf8');
  const m = setup.match(/navaid\.disclaimerAck',\s*'([^']+)'/);
  expect(m, 'the fixture no longer pre-acknowledges the notice').not.toBeNull();
  await boot(page);
  await page.waitForFunction(() => window.NavAid && NavAid.disclaimerVersion);
  expect(await page.evaluate(() => NavAid.disclaimerVersion)).toBe(m[1]);
});
