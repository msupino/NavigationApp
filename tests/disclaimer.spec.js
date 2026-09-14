// @ts-check
// The safety acknowledgement, opened on every launch.
//
// terms.html has said all of this since the beginning and the footer links to it, but a link
// in a footer is not an acknowledgement. An app that draws routes on aeronautical charts has
// to say in front of the pilot, before they start, that it is not certified for navigation.
//
// Every launch, the way airmap-israel opens: a pilot starting the app is about to fly, and
// "you agreed to this in March" is not what a notice about not navigating by it is for -- it
// is read at the top of the session, like a briefing, or it is decoration. So nothing is
// remembered, and a reload IS a launch: a refresh, a language switch (lang-select navigates),
// an APK picking up a new build, an embedded iOS bundle installed at startup.
const { test, expect } = require('./_setup');

// The suite switches the notice off -- it would otherwise open in every one of its specs, and
// a notice shown on every launch cannot be acknowledged away for them. These tests are about
// the notice, so they opt back in.
test.use({ acknowledgeDisclaimer: false });

const notice = (page) => page.locator('.disclaimer-back');

// The notice waits for the boot screen to come down (see below), so a spec that wants it on
// screen takes the splash away the way the app does.
async function openApp(page, q) {
  await page.goto('?lang=' + (q || 'en') + '&nogist');
  await page.waitForFunction(() => typeof clearBootLoading === 'function');
  await page.evaluate(() => clearBootLoading());
  return notice(page);
}

test('it asks, and says what it is asking', async ({ page }) => {
  await openApp(page);
  await expect(notice(page)).toBeVisible();
  const text = await notice(page).innerText();
  expect(text).toMatch(/NOT certified for navigation/i);
  expect(text).toMatch(/AIP/);
  expect(text).toMatch(/pilot in command/i);
  // The full text is one press away, in a new tab -- following a link from here would throw
  // away an unanswered acknowledgement.
  const links = notice(page).locator('a');
  await expect(links).toHaveCount(2);
  expect(await links.nth(0).getAttribute('href')).toBe('terms.html');
  expect(await links.nth(1).getAttribute('href')).toBe('privacy.html');
  for (const i of [0, 1]) {
    expect(await links.nth(i).getAttribute('target')).toBe('_blank');
    expect(await links.nth(i).getAttribute('rel')).toContain('noopener');
  }
});

// The point of the change: what a pilot sees at the top of every session.
test('every launch asks again, and nothing is stored to stop it', async ({ page }) => {
  for (const run of [1, 2, 3]) {
    await openApp(page);
    await expect(notice(page), 'launch ' + run).toBeVisible();
    await page.locator('.disclaimer-accept').click();
    await expect(notice(page)).toHaveCount(0);
  }
  // No acknowledgement is written anywhere: nothing to go stale, nothing to sync, nothing
  // that could quietly stop a pilot being told.
  const stored = await page.evaluate(() => Object.keys(localStorage)
    .filter(k => /disclaim/i.test(k)));
  expect(stored).toEqual([]);
});

// A language switch is a navigation, so it is a launch -- and the notice that opens is the
// one in the language now on screen, which is the whole reason it is worth re-reading.
test('switching language asks again, in that language', async ({ page }) => {
  await openApp(page);
  await page.locator('.disclaimer-accept').click();
  await openApp(page, 'he');
  await expect(notice(page)).toBeVisible();
  await expect(page.locator('.disclaimer-accept')).toHaveText('הבנתי');
  const text = await notice(page).innerText();
  expect(text).toMatch(/כלי תכנון בלבד/);
  expect(text).toMatch(/הטייס המפקד/);
});

test('the only way out is the acknowledgement', async ({ page }) => {
  await openApp(page);
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

// Found in review: the notice was shown on `load`, and #boot-loading is still up then --
// fixed, opaque, z-index 6000, above this notice, and it comes down only when the first chart
// tiles paint. So the notice was created BEHIND the splash: invisible, and clickable through
// it, because the splash drops pointer events as soon as the map is ready. An acknowledgement
// that can be recorded by a tap on a screen which never showed the words is worth nothing.
test('the notice waits for the boot screen, and cannot be tapped through it', async ({ page }) => {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof draw === 'function');
  const during = await page.evaluate(() => {
    const splash = document.getElementById('boot-loading');
    return {
      splash: !!splash,
      z: splash ? getComputedStyle(splash).zIndex : null,
      notice: !!document.querySelector('.disclaimer-back'),
    };
  });
  expect(during.splash, 'this test is about the splash still being up').toBe(true);
  expect(Number(during.z)).toBeGreaterThan(3200);       // above the notice, which is the bug
  expect(during.notice, 'the notice was painted behind the boot screen').toBe(false);

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

// Belt and braces: a boot screen that never goes must not take the notice with it. The cap is
// twenty seconds in the app; the wait takes one so this can ask in a second.
test('a boot screen that never clears does not swallow the notice', async ({ page }) => {
  await page.goto('?lang=en&nogist');
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

test('a pilot can ask for it again', async ({ page }) => {
  await openApp(page);
  await page.locator('.disclaimer-accept').click();
  await expect(notice(page)).toHaveCount(0);
  await page.evaluate(() => NavAid.showDisclaimer());
  await expect(notice(page)).toBeVisible();
  // ...and asking twice does not stack two of them.
  await page.evaluate(() => NavAid.showDisclaimer());
  await expect(notice(page)).toHaveCount(1);
});

test('the gist can withdraw it', async ({ page }) => {
  await openApp(page);
  await page.locator('.disclaimer-accept').click();
  const shown = await page.evaluate(() => {
    NavAid.tuningDefaults.featureDisclaimer.value = false;
    return !!NavAid.maybeShowDisclaimer();
  });
  expect(shown).toBe(false);
});

// The suite's own switch, and the only thing that turns the notice off for a test run. If it
// stops working, three thousand specs meet a modal before the chart -- fail here instead,
// where the reason is written down.
test('the suite switch is what keeps the notice out of every other spec', async ({ page }) => {
  const fs = require('fs');
  const path = require('path');
  const setup = fs.readFileSync(path.join(__dirname, '_setup.js'), 'utf8');
  expect(setup, 'the fixture no longer suppresses the notice')
    .toContain('__navaidNoDisclaimer');
  await openApp(page);
  await expect(notice(page), 'this spec opts out, so it must be here').toBeVisible();
  const suppressed = await page.evaluate(() => {
    window.__navaidNoDisclaimer = true;
    return !!NavAid.maybeShowDisclaimer();
  });
  expect(suppressed).toBe(false);
});

// Asked for: the notice carries the language control, and as a dropdown -- the same shape
// the menu uses. The notice is the first thing the app puts on screen, so the menu's own
// control sits behind it: a pilot who reads the other language better had to dismiss a
// safety notice to go and find the switch that changes the language it was written in.
test('the notice carries a language dropdown, set to the language on screen', async ({ page }) => {
  await openApp(page);
  const select = notice(page).locator('.disclaimer-lang-select');
  await expect(select).toHaveCount(1);
  // HE and EN: two letters that read the same in both alphabets, because the reader this
  // control exists for is the one who cannot read the page it is sitting on. The language's
  // own name is on the option for whoever wants it spelt out.
  await expect(select.locator('option')).toHaveText(['HE', 'EN']);
  await expect(select.locator('option').nth(0)).toHaveAttribute('title', 'עברית');
  await expect(select.locator('option').nth(1)).toHaveAttribute('aria-label', 'English');
  await expect(select).toHaveValue('en');
  await expect(select).toHaveAttribute('aria-label', 'Language / שפה');
});

test('choosing Hebrew reopens the notice in Hebrew', async ({ page }) => {
  await openApp(page);
  await notice(page).locator('.disclaimer-lang-select').selectOption('he');
  // A navigation: wait for the app on the other side before touching its boot screen.
  await page.waitForFunction(() => document.documentElement.lang === 'he'
    && typeof clearBootLoading === 'function');
  await page.evaluate(() => clearBootLoading());
  await expect(notice(page)).toBeVisible();
  await expect(page.locator('.disclaimer-accept')).toHaveText('הבנתי');
  await expect(notice(page).locator('.disclaimer-lang-select')).toHaveValue('he');
  expect(new URL(page.url()).searchParams.get('lang')).toBe('he');
});

// A follower arrived on ?follow=<id>#k=<key>. A language switch that dropped either would
// take the aeroplane away from them to answer a question about words.
test('switching language keeps the link that was opened', async ({ page }) => {
  await page.goto('?lang=en&nogist&follow=TOPIC123#k=SECRETKEY&v=PUB');
  await page.waitForFunction(() => typeof clearBootLoading === 'function');
  await page.evaluate(() => clearBootLoading());
  await expect(notice(page)).toBeVisible();
  await notice(page).locator('.disclaimer-lang-select').selectOption('he');
  await page.waitForFunction(() => document.documentElement.lang === 'he');
  const url = new URL(page.url());
  expect(url.searchParams.get('follow')).toBe('TOPIC123');
  expect(url.searchParams.get('lang')).toBe('he');
  expect(url.hash).toBe('#k=SECRETKEY&v=PUB');
});

test('choosing the language already on screen does not navigate', async ({ page }) => {
  await openApp(page);
  const before = page.url();
  await notice(page).locator('.disclaimer-lang-select').selectOption('en');
  await page.waitForTimeout(150);
  expect(page.url()).toBe(before);
  await expect(notice(page)).toBeVisible();
});

// The control on the notice is the APP's language control, not the notice's: what it picks
// is what the map, the menu and every panel are in, on this visit and the next one. And with
// nothing chosen yet, that is Hebrew.
test('the notice opens in Hebrew by default, and its choice is the app\'s language', async ({ page }) => {
  await page.goto('?nogist');                 // a first-time visitor: no ?lang at all
  await page.waitForFunction(() => typeof clearBootLoading === 'function');
  const first = await page.evaluate(() => ({
    html: document.documentElement.lang,
    dir: document.documentElement.dir,
    menu: document.getElementById('lang-select').value,
  }));
  expect(first.html, 'a first visit is not in Hebrew').toBe('he');
  expect(first.dir).toBe('rtl');
  expect(first.menu).toBe('he');

  await page.evaluate(() => clearBootLoading());
  await expect(notice(page)).toBeVisible();
  await expect(notice(page).locator('.disclaimer-lang-select')).toHaveValue('he');
  await notice(page).locator('.disclaimer-lang-select').selectOption('en');
  await page.waitForFunction(() => document.documentElement.lang === 'en');

  // The whole interface followed it, not just the notice.
  const picked = await page.evaluate(() => ({
    stored: localStorage.getItem('navaid.lang'),
    menu: document.getElementById('lang-select').value,
    dir: document.documentElement.dir,
  }));
  expect(picked.stored).toBe('en');
  expect(picked.menu, 'the menu still says the old language').toBe('en');
  expect(picked.dir).toBe('ltr');

  // ...and it is still English next time, with no ?lang to carry it.
  await page.goto('?nogist');
  await page.waitForFunction(() => typeof clearBootLoading === 'function');
  expect(await page.evaluate(() => document.documentElement.lang)).toBe('en');
  expect(await page.evaluate(() => document.getElementById('lang-select').value)).toBe('en');
});
