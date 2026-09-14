// @ts-check
// What a plain address opens in.
//
// NavAid is flown in Israeli airspace and read in Hebrew by most of the people who open it,
// so navaid.supino.org with nothing after it is Hebrew -- every time, not only the first.
// English is a choice the address carries (?lang=en): the language control sets it, the
// safety notice's selector sets it, and every link shared from inside the app keeps it.
//
// What this replaces is a REMEMBERED language. A stored choice made a plain address mean
// different things on different devices, and made "open navaid.supino.org" an unanswerable
// question about what a pilot would see -- including for whoever is being talked through it
// over the radio.
const { test, expect } = require('./_setup');

const shown = (page) => page.evaluate(() => ({
  lang: document.documentElement.lang,
  dir: document.documentElement.dir,
  menu: document.getElementById('lang-select').value,
  stored: localStorage.getItem('navaid.lang'),
}));

test('a plain address is Hebrew', async ({ page }) => {
  await page.goto('?nogist');
  await page.waitForFunction(() => typeof draw === 'function');
  const got = await shown(page);
  expect(got.lang).toBe('he');
  expect(got.dir).toBe('rtl');
  expect(got.menu).toBe('he');
});

test('the address decides, and English is what it says', async ({ page }) => {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof draw === 'function');
  const got = await shown(page);
  expect(got.lang).toBe('en');
  expect(got.dir).toBe('ltr');
  expect(got.menu).toBe('en');
});

// The point of the change: coming back without the parameter is Hebrew again, however the
// last visit was opened.
test('a language is not remembered between visits', async ({ page }) => {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof draw === 'function');
  expect((await shown(page)).lang).toBe('en');
  await page.goto('?nogist');
  await page.waitForFunction(() => typeof draw === 'function');
  const back = await shown(page);
  expect(back.lang, 'the last visit chose the language of this one').toBe('he');
  expect(back.dir).toBe('rtl');
});

test('a language left over from before does not resurrect itself', async ({ page }) => {
  await page.addInitScript(() => {
    try { localStorage.setItem('navaid.lang', 'en'); } catch (e) {}
  });
  await page.goto('?nogist');
  await page.waitForFunction(() => typeof draw === 'function');
  expect((await shown(page)).lang).toBe('he');
});

// The control still works -- it carries the choice in the address, which is now the only
// place a language lives.
test('the menu control switches by navigating, and the choice rides in the address', async ({ page }) => {
  await page.goto('?nogist');
  await page.waitForFunction(() => typeof draw === 'function');
  await page.selectOption('#lang-select', 'en');
  // The whole page, not just the head script that stamps <html>: the picker is synced by a
  // script further down, and reading it earlier reads the markup's default.
  await page.waitForFunction(() => document.documentElement.lang === 'en'
    && typeof draw === 'function');
  expect(new URL(page.url()).searchParams.get('lang')).toBe('en');
  expect((await shown(page)).menu).toBe('en');
});
