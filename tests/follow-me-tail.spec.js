const { spawnSync } = require('child_process');
const path = require('path');
const { test, expect } = require('@playwright/test');

const script = path.join(__dirname, '..', 'scripts', 'follow-me-tail.py');

function validate(cases) {
  const code = [
    'import importlib.util, json, sys',
    'spec = importlib.util.spec_from_file_location("follow_me_tail", sys.argv[1])',
    'module = importlib.util.module_from_spec(spec)',
    'spec.loader.exec_module(module)',
    'cases = json.loads(sys.stdin.read())',
    'print(json.dumps([module.accepted_order(*case) for case in cases]))',
  ].join('; ');
  const result = spawnSync('python3', ['-c', code, script], {
    input: JSON.stringify(cases), encoding: 'utf8',
  });
  if (result.status !== 0) throw new Error(result.stderr || 'Python validation failed');
  return JSON.parse(result.stdout);
}

test('command-line Follow Me validation matches browser ordering boundaries', () => {
  const now = 2_000_000;
  const base = { lat: 32.1, lng: 34.9, t: now, seq: 12 };
  const results = validate([
    [base, 11, now],
    [{ lat: 32.1, lng: 34.9, t: now }, now - 1, now], // legacy timestamp ordering
    [base, 12, now],                                  // replay
    [{ ...base, lat: true }, 0, now],                 // bool is not a coordinate
    [{ ...base, lat: 91 }, 0, now],
    [{ ...base, t: now + 300001 }, 0, now],
  ]);
  expect(results).toEqual([12, now, null, null, null, null]);
});
