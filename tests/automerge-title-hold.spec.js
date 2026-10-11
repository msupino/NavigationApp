// @ts-check
// #2589 was renamed "... - DONT MERGE" after auto-merge had been armed, and merged anyway:
// nothing read the title. The Draft + auto-merge workflow now refuses to arm such a PR,
// disarms it (and puts it back to draft) when the title is edited, and its watcher re-reads
// the title on every poll. This runs the workflow's own pattern, the way grep does.
const { test, expect } = require('./_setup');
const { readFileSync } = require('fs');
const { join } = require('path');
const { execFileSync } = require('child_process');

const wf = readFileSync(join(__dirname, '..', '.github/workflows/draft-auto-merge.yml'), 'utf8');
const pattern = (/grep -qiE "([^"]+)"/.exec(wf) || [])[1];
const holds = (title) => {
  try { execFileSync('bash', ['-c', 'printf "%s" "$T" | grep -qiE "$P"'], { env: { ...process.env, T: title, P: pattern } }); return true; }
  catch (e) { return false; }
};

test('the not-to-merge pattern is the same in all three places', () => {
  expect(pattern).toBeTruthy();
  const uses = wf.split('grep -qiE "' + pattern + '"').length - 1;
  expect(uses).toBe(3);                         // hold-on-title, the arming guard, the watcher
  expect(wf).toMatch(/types: \[opened, ready_for_review, edited\]/);
  expect(wf).toMatch(/gh pr merge "\$PR" --disable-auto/);
});

test('titles that say not to merge are held; ordinary titles are not', () => {
  for (const t of ['Route templates - DONT MERGE', "Fix: don't merge yet", 'DO NOT MERGE: test',
    'Do-not-merge experiment', 'WIP: offline packs', '[wip] tour']) expect(holds(t), t).toBe(true);
  for (const t of ['Swipe to dismiss', 'Wipe the cache', 'Settings: aircraft fuel',
    'Merge dev into main', 'Dont-panic button']) expect(holds(t), t).toBe(false);
});
