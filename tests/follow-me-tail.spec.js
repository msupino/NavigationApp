const { spawnSync } = require('child_process');
const path = require('path');
const { test, expect } = require('./_setup');

const script = path.join(__dirname, '..', 'scripts', 'follow-me-tail.py');

function validate(cases) {
  const code = [
    'import importlib.util, json, sys',
    'spec = importlib.util.spec_from_file_location("follow_me_tail", sys.argv[1])',
    'module = importlib.util.module_from_spec(spec)',
    'spec.loader.exec_module(module)',
    'cases = json.loads(sys.stdin.read())',
    'def decode(message):',
    '    message = dict(message)',
    '    if message.get("t") == "__nan__": message["t"] = float("nan")',
    '    if message.get("t") == "__float2000000__": message["t"] = 2000000.0',
    '    if message.get("seq") == "__float12__": message["seq"] = 12.0',
    '    return message',
    'cases = [[decode(case[0]), *case[1:]] for case in cases]',
    'print(json.dumps([module.accepted_order(*case) for case in cases]))',
  ].join('\n');
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
    [{ ...base, t: '__nan__' }, 0, now],
    [{ ...base, seq: 9_007_199_254_740_992 }, 0, now],
    [{ ...base, seq: '__float12__' }, 11, now],
    [{ lat: 32.1, lng: 34.9, t: '__float2000000__' }, 1_999_999, now],
  ]);
  expect(results).toEqual([12, now, null, null, null, null, null, null, 12, now]);
});
