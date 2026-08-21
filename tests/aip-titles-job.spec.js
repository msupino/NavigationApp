// @ts-check
// The daily refresh is only worth having if it cannot make things worse. Reported: the
// automatic update removed the English titles — the job had no pdftotext, so the step that
// reads a plate's own header found nothing, and the run published the gap.
const { test, expect } = require('./_setup');
const { readFileSync } = require('fs');
const { join } = require('path');

const root = join(__dirname, '..');
const titles = () => JSON.parse(readFileSync(join(root, 'docs/data/plate-titles.json'), 'utf8'));

test('the shipped titles still carry the English the CAA publishes', () => {
  const t = titles();
  const withEn = Object.values(t).filter(r => r.en);
  expect(withEn.length).toBeGreaterThanOrEqual(15);
  expect(t['LLHA_airport_Annex Zayin.pdf'].en).toBe('VISUAL CIRCUIT CHART');
});

test('the job installs the tool its own fallbacks need', () => {
  const wf = readFileSync(join(root, '.github/workflows/aip-plates.yml'), 'utf8');
  expect(wf).toMatch(/poppler-utils/);
  // ...before it runs the script, or installing it is pointless.
  expect(wf.indexOf('poppler-utils')).toBeLessThan(wf.indexOf('node scripts/aip-plate-titles.mjs'));
});

test('the script carries forward what a run cannot see for itself', () => {
  const src = readFileSync(join(root, 'scripts/aip-plate-titles.mjs'), 'utf8');
  // Reads what it published last time...
  expect(src).toMatch(/previousTitles/);
  // ...and says so when the tool is missing rather than failing silently.
  expect(src).toMatch(/pdftotext not found/);
});
