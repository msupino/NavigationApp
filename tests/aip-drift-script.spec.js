// @ts-check
// The drift check is the alarm on the charts we ship: the CAA amends plates without notice,
// and a stale chart is worse than a missing one because it still looks authoritative. This
// covers the script's contract rather than the network -- what it reads, what it refuses to
// do, and that the workflow actually runs it.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'aip-drift.py');
const WORKFLOW = path.join(ROOT, '.github', 'workflows', 'aip-plates.yml');

test('the script watches both snapshot folders', () => {
  const src = fs.readFileSync(SCRIPT, 'utf8');
  expect(src).toContain("'byop'");
  expect(src).toContain("'byop-enr'");
  // SHA-512 is what the AIP index keys its files by; anything else cannot match.
  expect(src).toContain('sha512');
});

// It must not "fix" drift on its own: most of these plates carry hand-fitted corner
// coordinates, and replacing the PDF under an overlay without re-checking the alignment
// leaves a chart that is confidently in the wrong place.
test('the script only reports, and never writes into the snapshot folders', () => {
  const src = fs.readFileSync(SCRIPT, 'utf8');
  expect(src).not.toMatch(/shutil|urlretrieve\(.*byop|open\([^)]*byop[^)]*['"]w/);
  expect(src).toMatch(/deliberately does NOT refresh/i);
});

test('the workflow runs it, and keeps one issue rather than a pile', () => {
  const wf = fs.readFileSync(WORKFLOW, 'utf8');
  expect(wf).toContain('scripts/aip-drift.py');
  expect(wf).toContain('issues: write');
  expect(wf).toContain('gh issue edit');
  expect(wf).toContain('gh issue close');       // clean state closes it again
  expect(wf).toContain('GITHUB_STEP_SUMMARY');
});

// Both folders exist and hold what the drift check is about; an empty folder would make the
// check pass by having nothing to compare.
test('there are snapshots to check', () => {
  const plates = fs.readdirSync(path.join(ROOT, 'docs', 'byop')).filter(f => f.endsWith('.pdf'));
  const enr = fs.readdirSync(path.join(ROOT, 'docs', 'byop-enr')).filter(f => f.endsWith('.pdf'));
  expect(plates.length).toBeGreaterThan(100);
  expect(enr.length).toBeGreaterThanOrEqual(4);
});
