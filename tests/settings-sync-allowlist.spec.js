// Guard the Drive settings allowlist against DRIFT, which is what the existing
// gdrive-settings-sync spec cannot see: it asserts only exclusions (no API keys,
// no *Pos), so a key that the app stopped writing kept being synced while the
// live key it was renamed to was left behind. Two had already drifted this way:
// navaid.legLineWidth (bumped to legLineWidth2 when the slider range changed) and
// navaid.showNotam (split per chart into navaid.showNotam.<prefix>).
const { test, expect } = require('./_setup');
const fs = require('fs');
const path = require('path');

const APP_DIR = path.join(__dirname, '..', 'docs', 'app');
// gdrive.js holds the allowlist itself, so including it would let every entry
// prove its own aliveness — the check has to read the REST of the app.
const appSources = (opts) => fs.readdirSync(APP_DIR)
  .filter(f => f.endsWith('.js'))
  .filter(f => !(opts && opts.excludeAllowlistFile && f === 'gdrive.js'))
  .map(f => fs.readFileSync(path.join(APP_DIR, f), 'utf8'))
  .join('\n');

function allowlist() {
  const src = fs.readFileSync(path.join(APP_DIR, 'gdrive.js'), 'utf8');
  const start = src.indexOf('GDRIVE_SETTINGS_KEYS = [');
  const body = src.slice(start, src.indexOf('];', start));
  // Skip comment lines: they quote key names while explaining them.
  return body.split('\n')
    .filter(l => !l.trim().startsWith('//'))
    .flatMap(l => [...l.matchAll(/'([^']+)'/g)].map(m => m[1]));
}

// A key is alive if its exact literal appears in app source outside a comment:
// a rename leaves the old literal with no occurrence at all, which is precisely
// how navaid.legLineWidth (bumped to ...Width2) and navaid.showNotam (split per
// chart) stayed in this list while the live keys went unsynced. Deliberately does
// NOT accept a mention inside a comment, and does not try to prove the occurrence
// is a write — that is the next test's job.
function sourceLines() {
  return appSources({ excludeAllowlistFile: true })
    .split('\n').filter(l => !l.trim().startsWith('//'));
}

// Some keys have no literal anywhere because they are composed at runtime from a
// base plus the chart prefix (navaid.showNotam.<cvfr|lsa|heli|last>). Accept those
// when the BASE literal exists and the source visibly appends to it.
function composedBases() {
  const src = appSources({ excludeAllowlistFile: true });
  const out = [];
  const names = new Map();
  for (const m of src.matchAll(/(?:const|var|let)\s+([A-Za-z_$][\w$]*)\s*=\s*'(navaid\.[^']+)'/g)) {
    names.set(m[1], m[2]);
  }
  for (const [name, base] of names) {
    if (new RegExp(name + "\\s*\\+\\s*'\\.").test(src)) out.push(base + '.');
  }
  return out;
}

test('every synced key is one the app still uses', () => {
  const lines = sourceLines();
  const bases = composedBases();
  const dead = allowlist().filter(k =>
    !lines.some(l => l.includes("'" + k + "'")) &&
    !bases.some(b => k.startsWith(b)));
  // Synced to Drive, written by nothing: the pilot's real setting is left behind
  // under its new name and silently stops following them between devices.
  expect(dead).toEqual([]);
});

// For the reverse direction, do NOT try to trace which keys reach a setItem call.
// The previous version resolved literals and `const FOO_KEY =` aliases, and missed
// every key handed to a HELPER as an argument — wireColorPicker(el, tuneKeys,
// 'navaid.waypointColor') writes inside the helper, so the key was invisible and
// two colour settings sat unsynced while this test passed green.
//
// The rule is now blunt on purpose: EVERY `navaid.*` string literal in app source
// must be either synced or listed below with a reason. A blunt rule cannot be
// out-manoeuvred by a new indirection; the cost is that read-only legacy keys need
// an explicit entry, which is a feature — it forces a decision to be written down.
const NOT_A_SYNCED_SETTING = [
  // Device-local by nature: geometry, per-device UI state, local caches.
  [/Pos$/,                        'panel geometry is per device'],
  [/^navaid\.sec\./,             'toolbar section expand/collapse'],
  [/Collapsed$/,                  'toolbar collapse state'],
  [/^navaid\.legendPillW$/,       'measured pixel width, recomputed on load'],
  [/^navaid\.bearing$/,           'map rotation, per device'],
  [/^navaid\.view$/,              'last map centre/zoom, per device'],
  [/^navaid\.theme$/,             'light/dark follows the screen you are on'],
  [/^navaid\.searchShown$/,       'docked-search dismissal, per screen size'],
  [/^navaid\.magnifier/,          'loupe state, per device'],
  [/^navaid\.notamViewTime$/,     'transient timeline scrub'],
  [/^navaid\.tracks\./,          'which recorded tracks are drawn locally'],
  [/^navaid\.plateAirfield$/,     'last plate viewed, per device'],
  [/^navaid\.windField(Alt|Opacity)$/, 'transient overlay state'],
  // Secrets, and anything that decides WHERE data is sent: never leave the device.
  [/^navaid\.ai\./,              'API keys and assistant endpoint — never synced'],
  [/^navaid\.fpl\.aisEmail$/,    'the address the flight plan is filed to — a synced blob must not be able to redirect it'],
  // Covered by another mechanism.
  [/^navaid\.route$/,            'the working route; the library covers saved ones'],
  [/^navaid\.routes$/,           'the route library, synced as its own file'],
  [/^navaid\.undo/,              'undo stack, in-memory lifetime'],
  [/tile/i,                       'offline tile cache lives on the device'],
  [/^navaid\.sync/,              'sync opt-in flag itself'],
  [/^navaid\.settings/,          'sync bookkeeping'],
  [/^navaid\.corrupt/,           'corrupt-blob recovery marker'],
  // One-time hints: showing them again on a new device is correct.
  [/^navaid\.hint/,              'one-time hint, per device'],
  [/TipDone$/,                    'one-time tip, per device'],
  // Legacy keys that are READ for migration and never written.
  [/^navaid\.showVor$/,          'pre-split VOR key, read once then removed'],
  [/^navaid\.showNotam$/,        'pre-per-chart NOTAM key, read for adoption only'],
  [/^navaid\.legLineWidth2?$/,   'superseded when the slider range narrowed; read for adoption'],
  [/^navaid\.driftLineWidth$/,   'superseded when the slider range narrowed; read for adoption'],
  // Dev-only scratch space.
  [/^navaid\.editor\./,          '?edit=1 overlay editor scratch data'],
  [/^navaid\.sim/,               'simulator link, per device'],
  [/^navaid\.apkReloadedForBuild$/, 'APK self-reload bookkeeping'],
  [/^navaid\.toolbarPosDesktop$/, 'panel geometry (the *Pos rule misses this suffix)'],
  [/^navaid\.wxTime$/,           'forecast valid-time pick, only reused if still offered'],
  // sessionStorage, not a setting: these live for one tab visit.
  [/^navaid\.selected$/,         'sessionStorage — restores the selection after a reload'],
  [/^navaid\.fpOpen$/,           'sessionStorage — was the flight plan open'],
  [/^navaid\.openChartModal$/,   'sessionStorage — reopen the chart viewer after a reload'],
];

// Every navaid.* literal the app mentions, wherever it appears.
function allKeyLiterals() {
  const src = appSources({ excludeAllowlistFile: true });
  const out = new Set();
  for (const line of src.split('\n')) {
    if (line.trim().startsWith('//') || line.trim().startsWith('*')) continue;
    for (const m of line.matchAll(/'(navaid\.[A-Za-z0-9._]+)'/g)) out.add(m[1]);
  }
  return [...out];
}

test('the allowlist still refuses secrets and panel geometry', () => {
  const keys = allowlist();
  expect(keys.some(k => k.startsWith('navaid.ai.key'))).toBe(false);
  expect(keys.some(k => /Pos$/.test(k))).toBe(false);
  expect(keys).toContain('navaid.layer');
});

// The FPL profile is synced as a block of composed navaid.fpl.<field> keys, so no
// literal exists for the sweep above to see — dropping the wrong field back in would
// go unnoticed. aisEmail is the address the plan is FILED to (fplBuild prefers it over
// the published FPL_FILE_TO), so a settings blob that could set it would send the plan
// somewhere other than AIS while the pilot believes it was filed. Assert it by name.
test('the address a flight plan is filed to is never synced', () => {
  // The block is written as ...['reg', ...].map(f => 'navaid.fpl.' + f), so allowlist()
  // sees the bare field names, not composed keys — asserting on 'navaid.fpl.aisEmail'
  // would pass whether or not the field is there. Read the field list itself.
  const src = fs.readFileSync(path.join(APP_DIR, 'gdrive.js'), 'utf8');
  const m = src.match(/\.\.\.\[([^\]]+)\]\.map\(f => 'navaid\.fpl\.' \+ f\)/);
  expect(m).not.toBeNull();
  const fields = [...m[1].matchAll(/'([^']+)'/g)].map(x => x[1]);
  // aisEmail is the address the plan is FILED to (fplBuild prefers p.aisEmail over the
  // published FPL_FILE_TO). Synced, a settings blob could send the plan somewhere other
  // than AIS while the pilot believes it was filed — and nothing would alert if the
  // flight went down.
  expect(fields).not.toContain('aisEmail');
  // replyTo is deliberately still synced: it is the pilot's own address and a wrong one
  // cannot misdirect the plan, only cost them their copy. Asserted so the fix is not
  // "applied" by dropping every address.
  expect(fields).toContain('replyTo');
  // The rest of the profile is meant to travel — catch the fix being "applied" by
  // deleting the whole block.
  expect(fields).toContain('reg');
});

test('every navaid.* key in the app is synced or declared device-local', () => {
  const synced = new Set(allowlist());
  const undeclared = allKeyLiterals()
    .filter(k => !synced.has(k))
    .filter(k => !NOT_A_SYNCED_SETTING.some(([re]) => re.test(k)))
    .sort();
  // Anything here is a setting that silently fails to follow the pilot to another
  // device. Either add it to GDRIVE_SETTINGS_KEYS, or add it to
  // NOT_A_SYNCED_SETTING with the reason it should stay on this device.
  expect(undeclared).toEqual([]);
});

test('every chart variant of a per-chart setting is synced', () => {
  // Per-chart keys are composed as base + '.' + layerDataPrefix(), so no literal
  // exists for the checks above to see: dropping one from the allowlist would go
  // unnoticed. Derive the variants from the authoritative prefix map instead.
  const draw = fs.readFileSync(path.join(APP_DIR, 'draw.js'), 'utf8');
  const m = draw.match(/_PREFIX_LAYER_NAME\s*=\s*\{([^}]+)\}/);
  expect(m).not.toBeNull();
  const prefixes = [...m[1].matchAll(/(\w+)\s*:/g)].map(x => x[1]);
  expect(prefixes.sort()).toEqual(['cvfr', 'heli', 'lsa']);
  // Only bases appended with the CHART prefix, not every composed key: plenty of
  // keys are built from a base (navaid.sec., navaid.ai.key.) with no chart variants.
  const src = appSources({ excludeAllowlistFile: true });
  const names = new Map();
  for (const c of src.matchAll(/(?:const|var|let)\s+([A-Za-z_$][\w$]*)\s*=\s*'(navaid\.[^']+)'/g)) {
    names.set(c[1], c[2]);
  }
  const chartBases = [];
  for (const c of src.matchAll(/([A-Za-z_$][\w$]*)\s*\+\s*'\.'\s*\+\s*(\w+)/g)) {
    const base = names.get(c[1]);
    // The appended variable must be the chart prefix, i.e. assigned from layerDataPrefix().
    const isPrefixVar = new RegExp('\\b' + c[2] + '\\s*=\\s*\\(?[^;]*layerDataPrefix').test(src);
    if (base && isPrefixVar && !chartBases.includes(base + '.')) chartBases.push(base + '.');
  }
  expect(chartBases.length).toBeGreaterThan(0);   // the NOTAM pref at minimum
  const synced = new Set(allowlist());
  const missing = [];
  for (const base of chartBases) {
    for (const p of [...prefixes, 'last']) {
      if (!synced.has(base + p)) missing.push(base + p);
    }
  }
  expect(missing).toEqual([]);
});
