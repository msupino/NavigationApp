// @ts-check
// The AIP-updates job tells a person the CAA published something. Its answer is the script's
// exit code -- 1 changed, 0 nothing (or first run), 2 the index could not be read -- carried
// through `tee` by PIPESTATUS, and only a fetch that succeeded may replace yesterday's copy.
// Get either wrong and the job is silent for ever, or reports the whole AIP as new.
//
// As in aip-drift-job.spec.js, these run the step's own shell against a stub script rather
// than grepping the YAML for a pattern.
const { test, expect } = require('./_setup');
const { readFileSync, writeFileSync, mkdtempSync, existsSync, mkdirSync } = require('fs');
const { join } = require('path');
const { tmpdir } = require('os');
const { execFileSync } = require('child_process');

const root = join(__dirname, '..');
const workflow = () => readFileSync(join(root, '.github/workflows/aip-updates.yml'), 'utf8');

function compareBlock() {
  const wf = workflow();
  const at = wf.indexOf('- name: Compare today');
  expect(at, 'the compare step exists').toBeGreaterThan(0);
  const runAt = wf.indexOf('run: |', at);
  const end = wf.indexOf('\n      - name:', runAt);
  return wf.slice(runAt + 'run: |'.length, end)
    .split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#')).join('\n');
}

// Run the step with a stub script that exits `code` (and writes --out unless the fetch
// "failed"). Returns { output, saved } -- the GITHUB_OUTPUT text and the saved baseline.
function runCompare(code, { prev } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'aipupd-'));
  const out = join(dir, 'gh_output'), summary = join(dir, 'summary');
  writeFileSync(out, ''); writeFileSync(summary, '');
  mkdirSync(join(dir, 'scripts'));
  writeFileSync(join(dir, 'scripts', 'aip-updates.py'), [
    'import sys',
    "a = sys.argv",
    "o = a[a.index('--out') + 1]",
    `code = ${code}`,
    "if code != 2: open(o, 'w').write('{\"today\": 1}')",
    "print('AIP index: 296 files; 3 changes since the last snapshot (hours 1)')",
    "sys.exit(code)",
  ].join('\n'));
  if (prev) { mkdirSync(join(dir, '.aip-index')); writeFileSync(join(dir, '.aip-index', 'index.json'), prev); }
  const block = compareBlock().split('/tmp/').join(dir + '/');
  execFileSync('bash', ['-c', [`cd ${dir}`, `export GITHUB_OUTPUT=${out}`, `export GITHUB_STEP_SUMMARY=${summary}`, block].join('\n')],
    { encoding: 'utf8' });
  const saved = join(dir, '.aip-index', 'index.json');
  return { output: readFileSync(out, 'utf8').trim(), saved: existsSync(saved) ? readFileSync(saved, 'utf8') : null };
}

test('a change is reported, and today becomes the baseline', () => {
  const r = runCompare(1, { prev: '{"yesterday": 1}' });
  expect(r.output).toBe('changed=1');
  expect(r.saved).toBe('{"today": 1}');
});

test('no change is not reported; the first run only records a baseline', () => {
  expect(runCompare(0, { prev: '{"yesterday": 1}' }).output).toBe('changed=0');
  const first = runCompare(0);
  expect(first.output).toBe('changed=0');
  expect(first.saved).toBe('{"today": 1}');
});

test('an unreachable index is neither a change nor a new baseline', () => {
  const r = runCompare(2, { prev: '{"yesterday": 1}' });
  expect(r.output).toBe('changed=2');
  expect(r.saved).toBe('{"yesterday": 1}');
  // ...and the issue step runs only on exactly 1.
  expect(workflow()).toContain("if: steps.cmp.outputs.changed == '1'");
});

test('the issue is new each time and assigned, so GitHub notifies', () => {
  const wf = workflow();
  expect(wf).toContain('gh issue create');
  expect(wf).not.toContain('gh issue edit');
  expect(wf).toContain('--assignee "${{ github.repository_owner }}"');
});

test('the script sorts changes by what they touch', () => {
  const out = execFileSync('python3', [join(root, 'scripts', 'aip-updates.py'), '--selftest'], { encoding: 'utf8' });
  expect(out.trim()).toBe('ok');
});
