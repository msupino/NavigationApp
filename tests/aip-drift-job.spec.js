// @ts-check
// The drift half of the AIP job answers one question: is the PDF we ship still the PDF the
// CAA serves. It answers it by exit code -- scripts/aip-drift.py exits 1 on drift -- and the
// workflow piped that answer into `tee`, whose status is always 0. So the job read "no
// drift" every day for a month while 64 of the plates we ship were stale upstream, and the
// issue that is supposed to track them was never opened. Nothing failed; the run was green
// the whole time.
//
// These tests run the step's own shell rather than reading the YAML for a pattern: a guard
// that greps for PIPESTATUS would pass on a workflow that captured the wrong element of it.
const { test, expect } = require('./_setup');
const { readFileSync, writeFileSync, mkdtempSync } = require('fs');
const { join } = require('path');
const { tmpdir } = require('os');
const { execFileSync } = require('child_process');

const root = join(__dirname, '..');
const workflow = () => readFileSync(join(root, '.github/workflows/aip-plates.yml'), 'utf8');

// Pull the shell of the step that publishes the `drifted` output, and run it against a stub
// script that exits however the test wants. Returns what the step wrote to GITHUB_OUTPUT.
function runDriftStep(scriptExitCode) {
  const wf = workflow();
  const marker = 'python3 scripts/aip-drift.py --json /tmp/drift.json | tee';
  const at = wf.indexOf(marker);
  expect(at, 'the drift step still runs aip-drift.py through tee').toBeGreaterThan(0);
  // The run block: from the pipeline down to the line that writes GITHUB_OUTPUT.
  const outAt = wf.indexOf('>> "$GITHUB_OUTPUT"', at);
  expect(outAt).toBeGreaterThan(at);
  const block = wf.slice(at, wf.indexOf('\n', outAt))
    .split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#')).join('\n');

  const dir = mkdtempSync(join(tmpdir(), 'driftstep-'));
  const out = join(dir, 'gh_output');
  writeFileSync(out, '');
  // Stand in for the real script: same shape (writes its json, prints a report), chosen exit.
  const stub = join(dir, 'aip-drift.py');
  writeFileSync(stub, `import sys\nprint('AIP index: 296 files served today')\nsys.exit(${scriptExitCode})\n`);
  const shell = [
    'set +e',
    `cd ${dir}`,
    'mkdir -p scripts && cp aip-drift.py scripts/aip-drift.py',
    `export GITHUB_OUTPUT=${out}`,
    block.replace('/tmp/drift.json', join(dir, 'drift.json')).replace('/tmp/drift.txt', join(dir, 'drift.txt')),
  ].join('\n');
  execFileSync('bash', ['-c', shell], { encoding: 'utf8' });
  return readFileSync(out, 'utf8').trim();
}

test('the step reports drift when the script says there is drift', () => {
  // The whole bug in one assertion: with `$?` after the pipe this returns drifted=0.
  expect(runDriftStep(1)).toBe('drifted=1');
});

test('the step reports no drift when the script says everything matches', () => {
  expect(runDriftStep(0)).toBe('drifted=0');
});

test('the issue is opened on drift and closed only when there is none', () => {
  const wf = workflow();
  // The value the step publishes is the script's, and the issue logic keys off it: 0 closes,
  // anything else opens or updates. Wire those two facts together so neither can drift from
  // the other unnoticed.
  expect(wf).toMatch(/drifted=\$\{PIPESTATUS\[0\]\}/);
  const closeAt = wf.indexOf('gh issue close');
  const openAt = wf.indexOf('gh issue create');
  expect(closeAt).toBeGreaterThan(0);
  expect(openAt).toBeGreaterThan(0);
  // The close path is guarded by the "no drift" branch...
  const guard = wf.lastIndexOf('steps.drift.outputs.drifted', 0 + closeAt);
  expect(guard).toBeGreaterThan(0);
  expect(guard).toBeLessThan(closeAt);
});

test('the script still exits 1 on drift, which is the contract the job depends on', () => {
  const src = readFileSync(join(root, 'scripts/aip-drift.py'), 'utf8');
  expect(src).toMatch(/return 1 if drifted else 0/);
  expect(src).toMatch(/sys\.exit\(main\(\)\)/);
});
