// @ts-check
// A PR preview is served from the production origin (navaid.supino.org/pr/<n>/), and
// localStorage is per ORIGIN, not per path — so without isolation an unreviewed branch reads
// the pilot's saved routes, their Drive/BYOK tokens and every setting from the live app, and
// can overwrite them. The Deploy workflow injects .github/preview/pr-store.js into previews
// only; this exercises that file against the real app.
const { test, expect } = require('./_setup');
const fs = require('fs');
const path = require('path');

const SHIM = fs.readFileSync(
  path.join(__dirname, '..', '.github', 'preview', 'pr-store.js'), 'utf8');
const asPreview = (num) => SHIM.replace('__PR_PREFIX__', 'pr-' + num + '.');

test('a preview cannot read or overwrite the live app\'s storage', async ({ context }) => {
  // The live app, on this origin.
  const live = await context.newPage();
  await live.goto('?lang=en&nogist');
  await live.waitForFunction(() => typeof state !== 'undefined');
  await live.evaluate(() => {
    localStorage.setItem('navaid.ai.key.anthropic', 'REAL-SECRET');
    localStorage.setItem('navaid.route', 'REAL-ROUTE');
  });

  // A preview of PR #999, same origin, different path.
  const preview = await context.newPage();
  await preview.addInitScript(asPreview(999));
  await preview.goto('?lang=en&nogist');
  await preview.waitForFunction(() => typeof state !== 'undefined');
  const seen = await preview.evaluate(() => ({
    prefix: window.__navPreviewStorePrefix,
    key: localStorage.getItem('navaid.ai.key.anthropic'),
    route: localStorage.getItem('navaid.route'),
  }));
  expect(seen.prefix).toBe('pr-999.');
  // The whole point: the pilot's key and route are invisible to the preview.
  expect(seen.key).toBeNull();
  expect(seen.route).toBeNull();

  await preview.evaluate(() => {
    localStorage.setItem('navaid.route', 'PREVIEW-ROUTE');
    localStorage.setItem('navaid.ai.key.anthropic', 'PREVIEW-KEY');
  });

  const after = await live.evaluate(() => ({
    key: localStorage.getItem('navaid.ai.key.anthropic'),
    route: localStorage.getItem('navaid.route'),
    prefixed: localStorage.getItem('pr-999.navaid.route'),
  }));
  expect(after.key).toBe('REAL-SECRET');       // untouched
  expect(after.route).toBe('REAL-ROUTE');
  expect(after.prefixed).toBe('PREVIEW-ROUTE'); // ...it went to its own namespace
});

test('a preview clearing its storage does not wipe the pilot\'s', async ({ context }) => {
  const live = await context.newPage();
  await live.goto('?lang=en&nogist');
  await live.evaluate(() => localStorage.setItem('navaid.routes', 'REAL-LIBRARY'));

  const preview = await context.newPage();
  await preview.addInitScript(asPreview(1));
  await preview.goto('?lang=en&nogist');
  const counted = await preview.evaluate(() => {
    localStorage.setItem('a', '1');
    localStorage.setItem('b', '2');
    const before = localStorage.length;
    localStorage.clear();
    return { before, after: localStorage.length };
  });
  expect(counted.before).toBeGreaterThanOrEqual(2);
  expect(counted.after).toBe(0);
  // clear() is the dangerous one: unwrapped it would take the live app's library with it.
  expect(await live.evaluate(() => localStorage.getItem('navaid.routes'))).toBe('REAL-LIBRARY');
});

test('length and key() only ever see the preview\'s own entries', async ({ context }) => {
  const live = await context.newPage();
  await live.goto('?lang=en&nogist');
  await live.evaluate(() => {
    for (let i = 0; i < 5; i++) localStorage.setItem('navaid.other' + i, String(i));
  });
  const preview = await context.newPage();
  await preview.addInitScript(asPreview(42));
  await preview.goto('?lang=en&nogist');
  const r = await preview.evaluate(() => {
    const mine = [];
    localStorage.setItem('one', '1');
    localStorage.setItem('two', '2');
    for (let i = 0; i < localStorage.length; i++) mine.push(localStorage.key(i));
    return { length: localStorage.length, mine: mine.sort() };
  });
  // Enumeration has to be namespaced too, or the app's own "scan every navaid.* key"
  // paths (settings sync, storage cleanup) would walk the live data. The preview's own
  // app writes keys as well, so what matters is that ITS keys are there under their
  // unprefixed names and NONE of the live page's are.
  expect(r.mine).toContain('one');
  expect(r.mine).toContain('two');
  expect(r.mine.filter(k => /^navaid\.other/.test(k))).toEqual([]);
  expect(r.length).toBe(r.mine.length);
});

test('the shim is inert when the build never substituted a prefix', async ({ context }) => {
  const preview = await context.newPage();
  await preview.addInitScript(SHIM);          // placeholder left as-is
  await preview.goto('?lang=en&nogist');
  const r = await preview.evaluate(() => {
    localStorage.setItem('navaid.plain', 'x');
    return { prefix: window.__navPreviewStorePrefix,
      direct: localStorage.getItem('navaid.plain') };
  });
  // A half-applied build must not silently half-isolate: with no prefix it does nothing
  // rather than inventing one, and the workflow refuses to publish such a preview.
  expect(r.prefix).toBeUndefined();
  expect(r.direct).toBe('x');
});

test('sessionStorage is namespaced too', async ({ context }) => {
  const live = await context.newPage();
  await live.goto('?lang=en&nogist');
  await live.evaluate(() => sessionStorage.setItem('navaid.fpOpen', '1'));
  const preview = await context.newPage();
  await preview.addInitScript(asPreview(7));
  await preview.goto('?lang=en&nogist');
  expect(await preview.evaluate(() => sessionStorage.getItem('navaid.fpOpen'))).toBeNull();
});
