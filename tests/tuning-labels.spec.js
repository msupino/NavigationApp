// @ts-check
// #1815: a maintainer should not have to read the source to know what a tuning entry
// changes. These are the mechanical parts of that: every entry labelled, no two entries
// wearing the same label, units stated where the value is otherwise a bare number, and no
// label that is only the key spelled out.
const { test, expect } = require('./_setup');

const UNIT_SUFFIX = [
  ['Ms', 'ms'], ['Sec', 's'], ['Px', 'px'], ['Mm', 'mm'], ['Ft', 'ft'],
  ['Nm', 'nm'], ['Deg', '°'], ['Kt', 'kt'], ['Fpm', 'fpm'], ['Gal', 'gal'],
  ['Gph', 'gph'], ['Min', 'min'],
];
const unitFor = (key) => (UNIT_SUFFIX.find(([suf]) => key.endsWith(suf)) || [])[1];

async function registry(page) {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => !!(window.NavAid && NavAid.tuningDefaults));
  return page.evaluate(() => Object.entries(NavAid.tuningDefaults)
    .map(([key, spec]) => ({ key, label: spec.label, type: spec.type || 'number' })));
}

test('every entry carries a label', async ({ page }) => {
  const entries = await registry(page);
  expect(entries.length).toBeGreaterThan(400);
  const missing = entries.filter(e => typeof e.label !== 'string' || !e.label.trim());
  expect(missing.map(e => e.key)).toEqual([]);
});

test('no label is a placeholder or too short to say anything', async ({ page }) => {
  const entries = await registry(page);
  const bad = entries.filter(e =>
    e.label.trim().length < 12 || /\b(tbd|todo|fixme|xxx|test|temp)\b/i.test(e.label));
  expect(bad.map(e => `${e.key}: ${e.label}`)).toEqual([]);
});

// Two entries with the same words are two rows a maintainer cannot tell apart.
test('no two entries share a label', async ({ page }) => {
  const entries = await registry(page);
  const seen = new Map();
  const dupes = [];
  for (const e of entries) {
    const k = e.label.trim().toLowerCase();
    if (seen.has(k)) dupes.push(`${seen.get(k)} / ${e.key}: ${e.label}`);
    else seen.set(k, e.key);
  }
  expect(dupes).toEqual([]);
});

// A bare number needs its unit: "Route line width" could be px, mm or points.
test('a value whose key names a unit says that unit', async ({ page }) => {
  const entries = await registry(page);
  const missing = entries.filter((e) => {
    const u = unitFor(e.key);
    if (!u) return false;
    return u === '°' ? !e.label.includes('°')
                     : !new RegExp(`[([/ ]${u}\\b`, 'i').test(e.label);
  });
  expect(missing.map(e => `${e.key}: ${e.label}`)).toEqual([]);
});

// There is deliberately NO rule that a label must differ from its key. Most keys here are
// already plain English -- windArrowColor really is "Wind arrow color", and rewording that
// to avoid an echo would cost clarity, not add it. What matters is the vocabulary below.
// The registry vocabulary is the source's, not the pilot's: these are the words that were
// found meaning nothing to a reader of the panel, so they must not creep back in.
test('labels avoid the internal vocabulary they were audited out of', async ({ page }) => {
  const entries = await registry(page);
  const jargon = entries.filter(e => /\b(alpha|cum|idx|exp|arr|frac)\b/i.test(e.label));
  expect(jargon.map(e => `${e.key}: ${e.label}`)).toEqual([]);
});
