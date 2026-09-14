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

// Found in review: the notice was shown on `load`, and #boot-loading is still up then --
// fixed, opaque, z-index 6000, above this notice, and it comes down only when the first chart
// tiles paint. So the notice was created BEHIND the splash: invisible, and clickable through
// it, because the splash drops pointer events as soon as the map is ready. An acknowledgement
// that can be recorded by a tap on a screen which never showed the words is worth nothing.
test('the notice waits for the boot screen, and cannot be tapped through it', async ({ page }) => {
  await fresh(page);
  await boot(page);
  // The app is up -- `load` has long fired -- and the splash is still there.
  await page.waitForFunction(() => typeof draw === 'function');
  const during = await page.evaluate(() => {
    const splash = document.getElementById('boot-loading');
    return {
      splash: !!splash,
      z: splash ? getComputedStyle(splash).zIndex : null,
      notice: !!document.querySelector('.disclaimer-back'),
      accepted: localStorage.getItem('navaid.disclaimerAck'),
    };
  });
  expect(during.splash, 'this test is about the splash still being up').toBe(true);
  expect(Number(during.z)).toBeGreaterThan(3200);       // above the notice, which is the bug
  expect(during.notice, 'the notice was painted behind the boot screen').toBe(false);
  // Nothing can have been acknowledged while there was nothing to read.
  expect(during.accepted).toBeNull();

  // The splash comes down the way the app takes it down.
  await page.evaluate(() => clearBootLoading());
  await expect(notice(page)).toBeVisible();
  // ...and now the button is the topmost thing where it is drawn.
  const reachable = await page.evaluate(() => {
    const btn = document.querySelector('.disclaimer-accept');
    const r = btn.getBoundingClientRect();
    const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return !!top && (top === btn || btn.contains(top));
  });
  expect(reachable).toBe(true);
});

// Belt and braces: a boot screen that never goes must not take the notice with it. The cap
// is twenty seconds in the app; the wait takes one so this can ask the question in a second.
test('a boot screen that never clears does not swallow the notice', async ({ page }) => {
  await fresh(page);
  await boot(page);
  await page.waitForFunction(() => window.NavAid && NavAid.whenBootScreenGone);
  const got = await page.evaluate(() => new Promise((resolve) => {
    const splashUp = !!document.getElementById('boot-loading');
    const started = Date.now();
    NavAid.whenBootScreenGone(
      () => resolve({ splashUp, ran: true, waited: Date.now() - started,
                      stillUp: !!document.getElementById('boot-loading') }),
      300);
    setTimeout(() => resolve({ splashUp, ran: false }), 3000);
  }));
  expect(got.splashUp, 'this test is about a splash that is still there').toBe(true);
  expect(got.ran, 'the wait never ended').toBe(true);
  expect(got.stillUp, 'it gave up while the splash was still up, which is the point').toBe(true);
  expect(got.waited).toBeGreaterThanOrEqual(250);
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
