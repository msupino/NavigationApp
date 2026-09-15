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


function pycall(expression, argv = []) {
  const code = [
    'import importlib.util, json, sys',
    'spec = importlib.util.spec_from_file_location("follow_me_tail", sys.argv[1])',
    'module = importlib.util.module_from_spec(spec)',
    'spec.loader.exec_module(module)',
    'print(json.dumps(' + expression + '))',
  ].join('\n');
  const result = spawnSync('python3', ['-c', code, script, ...argv], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr || 'Python call failed');
  return JSON.parse(result.stdout);
}

// The link carries the topic in the query and the KEY in the fragment -- which is the whole
// point: a browser never sends a fragment to a server. Other query parameters ride along
// (the app adds ?lang=), and the shell is the usual reason a pasted link arrives broken.
test('the share link is read the way the app writes it', () => {
  const live = 'https://navaid.supino.org/?follow=C5_HBowjeCw68BUFyFEeXw&lang=he' +
    '#k=rMUv4ycBO4NB7Z26dGnfiV0UK143Lhi_FxYlG6dlHDU';
  expect(pycall('module.parse_link(sys.argv[2])', [live]))
    .toEqual(['C5_HBowjeCw68BUFyFEeXw', 'rMUv4ycBO4NB7Z26dGnfiV0UK143Lhi_FxYlG6dlHDU']);
  // The key is base64url without padding; the stdlib insists on it.
  expect(pycall('len(module.b64url_decode(sys.argv[2]))',
    ['rMUv4ycBO4NB7Z26dGnfiV0UK143Lhi_FxYlG6dlHDU'])).toBe(32);
  // An unquoted link in a shell loses everything after '#'. Say which mistake this is.
  const stripped = spawnSync('python3', ['-c', [
    'import importlib.util, sys',
    'spec = importlib.util.spec_from_file_location("t", sys.argv[1])',
    'm = importlib.util.module_from_spec(spec)',
    'spec.loader.exec_module(m)',
    'm.parse_link(sys.argv[2])',
  ].join('\n'), script, 'https://navaid.supino.org/?follow=abc&lang=he'], { encoding: 'utf8' });
  expect(stripped.status).not.toBe(0);
  expect(stripped.stderr).toMatch(/QUOTE THE LINK/);
});

// The wire carries the magnetic heading the cockpit displayed, and a stationary aeroplane sends
// its compass instead of a course. Whoever reads this log out to a pilot must be reading the
// same number the pilot sees -- so this prints what arrived and computes nothing: a variation
// applied here is this machine's guess about someone else's aeroplane.
test('headings print as sent, and a compass heading is marked', () => {
  expect(pycall('module.heading_text({"mh": 299})')).toBe('299\u00b0');
  expect(pycall('module.heading_text({"mh": 299, "hc": 1})')).toBe('~299\u00b0');
  expect(pycall('module.heading_text({"mh": 358})')).toBe('358\u00b0');
  expect(pycall('module.heading_text({"mh": 365})')).toBe('005\u00b0');   // wraps
  // A true track with no magnetic heading beside it is geometry, not a readout.
  expect(pycall('module.heading_text({"trk": 304})')).toBeNull();
  expect(pycall('module.heading_text({})')).toBeNull();
});

// The plan travels on its own retained topic, and a publisher may have compressed it.
test('the shared plan is printed, compressed or not', () => {
  const plain = pycall('module.fmt_route({"from": "LLHZ", "to": "LLHA", ' +
    '"route": {"waypoints": [{"name": "LLHZ"}, {"name": "BAZRA"}, {"name": "LLHA"}]}})');
  expect(plain).toContain('LLHZ -> LLHA');
  expect(plain).toContain('3 waypoints');
  expect(plain).toContain('BAZRA');
  const gzipped = pycall([
    '(lambda body: module.fmt_route({"from": "A", "to": "B", "zf": "gzip",',
    '  "gz": __import__("base64").urlsafe_b64encode(',
    '    __import__("gzip").compress(body)).decode().rstrip("=")}))',
    '(__import__("json").dumps({"waypoints": [{"name": "X"}, {"name": "Y"}]}).encode())',
  ].join('\n'));
  expect(gzipped).toContain('A -> B');
  expect(gzipped).toContain('X Y');
  // An unreadable plan says so rather than throwing: the positions are what the link is for.
  expect(pycall('module.fmt_route({"from": "A", "to": "B", "zf": "gzip", "gz": "not-gzip"})'))
    .toMatch(/could not be read/);
});

// Anyone holding the link can encrypt -- they must, or they could not read it -- so the AES
// key alone cannot say WHO published. The signature is what attributes a packet to the
// aeroplane, and a log that printed somebody else's position as the pilot's would be worse
// than no log at all. Checked against the real signer, in the other language.
test('the tail attributes a packet to the aeroplane, or drops it', () => {
  const path = require('path');
  const sim = path.join(__dirname, '..', 'scripts', 'follow-me-simulator.py');
  const code = [
    'import importlib.util, json, os, sys',
    'def load(name, p):',
    '    spec = importlib.util.spec_from_file_location(name, p)',
    '    m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m); return m',
    'tail = load("tail", sys.argv[1])',
    'sim = load("sim", sys.argv[2])',
    'priv, pub = sim.signing_keys()',
    'other, other_pub = sim.signing_keys()',
    'key = os.urandom(32)',
    'fix = {"reg": "TEST", "lat": 32.0, "lng": 34.9, "t": 1, "seq": 2}',
    'ours = tail.unseal(key, sim.seal(key, fix, priv))',
    'theirs = tail.unseal(key, sim.seal(key, fix, other))',
    'plain = tail.unseal(key, sim.seal(key, fix))',
    'raw = tail.b64url_decode(pub)',
    'print(json.dumps({',
    '  "ours": tail.check_signature(raw, ours),',
    '  "signedByOther": tail.check_signature(raw, theirs),',
    '  "unsigned": tail.check_signature(raw, plain),',
    '  "linkKey": tail.verify_key("https://x/?follow=a#k=zz&v=" + pub) == pub,',
    '  "noKeyInOldLink": tail.verify_key("https://x/?follow=a#k=zz") == "",',
    '}))',
  ].join('\n');
  const run = spawnSync('python3', ['-c', code, script, sim], { encoding: 'utf8' });
  if (run.status !== 0) throw new Error(run.stderr || 'signature check failed to run');
  const got = JSON.parse(run.stdout);
  expect(got.ours, 'the aeroplane\'s own packet was refused').toBe(true);
  // The two cases that matter: somebody else's signature, and no signature at all -- which
  // is exactly what a follower with the AES key can produce.
  expect(got.signedByOther).toBe(false);
  expect(got.unsigned).toBe(false);
  expect(got.linkKey).toBe(true);
  expect(got.noKeyInOldLink).toBe(true);
});
