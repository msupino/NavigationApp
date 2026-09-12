// @ts-check
// Reported from the phone: the follow-me icon does not do anything.
//
// It did. It opened window.prompt -- the one dialog a page does not own. A browser may
// suppress it after the pilot dismisses one, and an Android WebView shows it only if the host
// app implements onJsPrompt, which is exactly where Follow me is used. A dialog nobody sees
// is a share nobody makes.
//
// The question is asked in the app now: the stored code already in the field, the Hebrew
// reading right to left while the code stays left to right, Enter to share and Escape not to.
const { test, expect } = require('./_setup');

async function boot(page, lang) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('?lang=' + (lang || 'en') + '&nogist');
  await page.waitForFunction(() => window.NavAid && NavAid.followMe
    && typeof askFollowMeCode === 'function');
  await page.evaluate(() => {
    NavAid.tuningDefaults.featureFollowMe.value = true;
    window.gpsLiveOn = true;
    if (typeof refreshFollowMeControl === 'function') refreshFollowMeControl();
    if (typeof refreshFollowMeMapControl === 'function') refreshFollowMeMapControl();
  });
}

test('the map icon asks in the app, not through the browser', async ({ page }) => {
  const browserDialogs = [];
  page.on('dialog', d => { browserDialogs.push(d.message()); d.dismiss(); });
  await boot(page);
  await page.evaluate(() => document.getElementById('follow-me-map').click());
  await page.waitForSelector('.follow-me-ask-modal');
  expect(browserDialogs, 'it still went through window.prompt').toEqual([]);
  const got = await page.evaluate(() => {
    const input = document.querySelector('.follow-me-ask-input');
    return { dir: input.dir, focused: document.activeElement === input,
             tall: Math.round(input.getBoundingClientRect().height),
             buttons: Array.from(document.querySelectorAll('.follow-me-ask-actions button'))
               .map(b => b.textContent) };
  });
  // A registration is Latin in both languages, and the field is a finger tall.
  expect(got.dir).toBe('ltr');
  expect(got.focused).toBe(true);
  expect(got.tall).toBeGreaterThanOrEqual(44);
  expect(got.buttons).toEqual(['Cancel', 'Share']);
});

test('the stored code is already in the field', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => { NavAid.followMe.setCode('4X-CDE'); });
  await page.evaluate(() => document.getElementById('follow-me-map').click());
  await page.waitForSelector('.follow-me-ask-modal');
  expect(await page.inputValue('.follow-me-ask-input')).toBe('4X-CDE');
});

test('Enter answers it, Escape does not', async ({ page }) => {
  await boot(page);
  const answer = await page.evaluate(async () => {
    const p = askFollowMeCode('4X-ABC');
    await new Promise(r => setTimeout(r, 20));
    const input = document.querySelector('.follow-me-ask-input');
    input.value = '4X-XYZ';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    return p;
  });
  expect(answer).toBe('4X-XYZ');
  expect(await page.locator('.follow-me-ask-modal').count()).toBe(0);

  const cancelled = await page.evaluate(async () => {
    const p = askFollowMeCode('4X-ABC');
    await new Promise(r => setTimeout(r, 20));
    document.querySelector('.follow-me-ask-cancel').click();
    return p;
  });
  // Null, not an empty string: "I did not answer" and "I answered with nothing" are
  // different, and only one of them should share a link.
  expect(cancelled).toBe(null);
});

test('closing the dialog any other way is also not an answer', async ({ page }) => {
  await boot(page);
  const got = await page.evaluate(async () => {
    const p = askFollowMeCode('4X-ABC');
    await new Promise(r => setTimeout(r, 20));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    return p;
  });
  expect(got).toBe(null);
});

test('in Hebrew the sentence reads right to left and the code does not', async ({ page }) => {
  await boot(page, 'he');
  await page.evaluate(() => document.getElementById('follow-me-map').click());
  await page.waitForSelector('.follow-me-ask-modal');
  const got = await page.evaluate(() => {
    const text = document.querySelector('.follow-me-ask-text');
    const input = document.querySelector('.follow-me-ask-input');
    return { page: document.documentElement.dir,
             text: getComputedStyle(text).direction,
             input: getComputedStyle(input).direction,
             said: text.textContent };
  });
  expect(got.page).toBe('rtl');
  expect(got.text).toBe('rtl');
  expect(got.input).toBe('ltr');
  expect(got.said).toMatch(/[֐-׿]/);
});

// The dialog is read in a cockpit in both themes, and the field is the one rectangle a
// browser will happily paint white in a dark one.
for (const theme of ['light', 'dark']) {
  test('the field belongs to the dialog in ' + theme + ' mode', async ({ page }) => {
    await boot(page);
    await page.evaluate((t) => {
      document.body.classList.remove('theme-light', 'theme-dark');
      document.body.classList.add('theme-' + t);
    }, theme);
    await page.evaluate(() => document.getElementById('follow-me-map').click());
    await page.waitForSelector('.follow-me-ask-modal');
    const got = await page.evaluate(() => {
      const px = (c) => c.match(/\d+/g).slice(0, 3).map(Number);
      const lum = (c) => { const [r, g, b] = px(c); return (0.299 * r + 0.587 * g + 0.114 * b); };
      const input = getComputedStyle(document.querySelector('.follow-me-ask-input'));
      const box = getComputedStyle(document.querySelector('.follow-me-ask-modal'));
      return { field: lum(input.backgroundColor), text: lum(input.color), box: lum(box.backgroundColor) };
    });
    // The field sits on the dialog's side of the light/dark line, not the other one...
    expect(Math.abs(got.field - got.box), 'the field does not match the dialog').toBeLessThan(60);
    // ...and whatever is typed in it can be read against it.
    expect(Math.abs(got.text - got.field), 'the text is not readable in the field').toBeGreaterThan(90);
  });
}
