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
  // Also accept keys whose base appears as a literal string ending in '.' —
  // covers arrow-function composers like `const keyKey = p => 'navaid.ai.key.' + p`
  // where the pattern above does not match because there is no simple assignment.
  for (const m of src.matchAll(/'(navaid\.[A-Za-z0-9.]+\.)'/g)) {
    if (!out.includes(m[1])) out.push(m[1]);
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
  [/^navaid\.notamModalSize$/,    'NOTAM sheet dimensions are device-local geometry'],
  [/^navaid\.gistCache$/,         'a copy of the remote config, refetched on every load'],
  [/^navaid\.tracks\./,          'which recorded tracks are drawn locally'],
  [/^navaid\.plateAirfield$/,     'last plate viewed, per device'],
  [/^navaid\.windField(Alt|Opacity)$/, 'transient overlay state'],
  // Whether a device speaks depends on the device, not the pilot: the phone in the
  // cockpit should talk, the desktop browser it was planned on should not start talking
  // because the phone does. It also depends on what the device can actually do -- native
  // TTS in the APK, an unreliable browser fallback elsewhere.
  [/^navaid\.voiceAlerts$/,       'speaking out loud is a property of the device you are on'],
  // Whether the map chases the aircraft depends on how the device is mounted -- a phone
  // clamped in front of you wants following, the desktop it was planned on does not.
  [/^navaid\.gpsFollow$/,         'following the aircraft is a property of the device you fly with'],
  // The route lock guards against a thumb on a kneeboard, which is a hazard of the phone in
  // the cockpit and not of the desktop the route was planned at. Syncing it would arrive as a
  // planning session that silently refuses every drag.
  [/^navaid\.editLocked$/,        'locking the route against stray taps is a property of the device you fly with'],
  // Same reason: north-up on the desktop you plan at, heading-up on the phone clamped in
  // front of you. It follows the device, not the pilot.
  [/^navaid\.headingUp$/,         'map orientation is a property of the device you fly with'],
  // navaid.ai.baseUrl decides where data is sent — same rule as aisEmail.
  // navaid.ai.panelSize is device-local geometry (panelPos is caught by /Pos$/).
  // AI keys are credentials and stay device-local. Model choices remain portable.
  [/^navaid\.ai\.baseUrl(\.|$)/,  'endpoint URL, now per provider — decides where data is sent; must not be settable via sync'],
  [/^navaid\.ai\.panelSize$/,    'assistant panel dimensions, per device'],
  [/^navaid\.ai\.key(\.|$)/,    'provider credential — settings sync must not copy secrets into Drive'],
  [/^navaid\.ai\.model\.$/,     'composed model-key base — concrete model choices are allowlisted'],
  [/^navaid\.fpl\.aisEmail$/,   'the filing destination decides where data is sent'],
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
  // Superseded when the hotspot overlay was switched off for everyone: the app only removes
  // it now, so that a device does not carry its old answer -- or sync it to a new one.
  [/^navaid\.showHotspots$/,     'pre-reset hotspot key, removed on load and never written'],
  [/^navaid\.showNotam$/,        'pre-per-chart NOTAM key, read for adoption only'],
  [/^navaid\.legLineWidth2?$/,   'superseded when the slider range narrowed; read for adoption'],
  [/^navaid\.driftLineWidth$/,   'superseded when the slider range narrowed; read for adoption'],
  // Dev-only scratch space.
  [/^navaid\.editor\./,          '?edit=1 overlay editor scratch data'],
  [/^navaid\.sim/,               'simulator link, per device'],
  [/^navaid\.gpsLiveOn$/,        'whether live location is on, per device -- resumed on reload, not synced to others'],
  [/^navaid\.followMeCode$/,     'the aircraft code typed for a follow-me link -- belongs to the aeroplane being flown from THIS device, not to the pilot account'],
  [/^navaid\.followMeSession$/,  'the live share topic and its encryption key -- a capability to watch THIS aeroplane right now, not a setting; syncing it would put two devices on one topic and hand the key to every device on the account'],
  [/^navaid\.apkReloadedForBuild$/, 'APK self-reload bookkeeping'],
  [/^navaid\.toolbarPosDesktop$/, 'panel geometry (the *Pos rule misses this suffix)'],
  [/^navaid\.wxTime$/,           'forecast valid-time pick, only reused if still offered'],
  // navaid.ifrSheet.<ICAO>: which instrument chart is drawn for that field. The key is
  // composed per airfield and the sync layer carries exact keys only, so the allowlist
  // cannot name the variants -- and which approach you last looked at is a thin thing to
  // carry between devices next to the layer being on at all, which IS synced.
  [/^navaid\.ifrSheet/,         'which IFR sheet per field, composed key, per device'],
  // sessionStorage, not a setting: these live for one tab visit.
  [/^navaid\.selected$/,         'sessionStorage — restores the selection after a reload'],
  [/^navaid\.fpOpen$/,           'sessionStorage — was the flight plan open'],
  [/^navaid\.openChartModal$/,   'sessionStorage — reopen the chart viewer after a reload'],
];

// gdrive.js minus the allowlist array itself. The aliveness checks must not read the array
// (every entry would prove its own aliveness), but the sweep below MUST read the rest of the
// file: gdrive.js owns all the sync bookkeeping keys, so excluding it wholesale exempted the
// one file most likely to add a device-local key from the rule it is supposed to obey.
function allowlistFileOutsideTheArray() {
  const src = fs.readFileSync(path.join(APP_DIR, 'gdrive.js'), 'utf8');
  const start = src.indexOf('GDRIVE_SETTINGS_KEYS = [');
  if (start === -1) return src;
  const end = src.indexOf('];', start);
  return src.slice(0, start) + src.slice(end);
}

// Every navaid.* literal the app mentions, wherever it appears.
function allKeyLiterals() {
  const src = appSources({ excludeAllowlistFile: true }) + '\n'
    + allowlistFileOutsideTheArray();
  const out = new Set();
  for (const line of src.split('\n')) {
    if (line.trim().startsWith('//') || line.trim().startsWith('*')) continue;
    for (const m of line.matchAll(/'(navaid\.[A-Za-z0-9._]+)'/g)) {
      // 'navaid.supino.org' is the production HOSTNAME, not a storage key -- the sweep looks
      // for navaid.* string literals and cannot tell the two apart by shape alone.
      if (/\.(org|com|net|io|dev)$/.test(m[1])) continue;
      out.add(m[1]);
    }
  }
  return [...out];
}

test('the allowlist syncs AI choices but excludes credentials, baseUrl and panel geometry', () => {
  const keys = allowlist();
  expect(keys).toContain('navaid.ai.provider');
  expect(keys).toContain('navaid.ai.model.anthropic');
  expect(keys.some(k => k.startsWith('navaid.ai.key.'))).toBe(false);
  expect(keys).not.toContain('navaid.ai.baseUrl');
  expect(keys.some(k => /Pos$/.test(k))).toBe(false);
  expect(keys).toContain('navaid.layer');
});

// The FPL profile is synced as a block of composed navaid.fpl.<field> keys, so no
// literal exists for the sweep above to see — dropping the wrong field back in would
// go unnoticed. aisEmail is the address the plan is FILED to (fplBuild prefers it over
// the published FPL_FILE_TO), so a settings blob that could set it would send the plan
// somewhere other than AIS while the pilot believes it was filed. Assert it by name.
test('flight-plan profile syncs but the filing destination does not', () => {
  const src = fs.readFileSync(path.join(APP_DIR, 'gdrive.js'), 'utf8');
  const m = src.match(/\.\.\.\[([^\]]+)\]\.map\(f => 'navaid\.fpl\.' \+ f\)/);
  expect(m).not.toBeNull();
  const fields = [...m[1].matchAll(/'([^']+)'/g)].map(x => x[1]);
  expect(fields).toContain('pic');
  expect(fields).toContain('license');
  expect(fields).toContain('replyTo');
  expect(fields).not.toContain('aisEmail');
});

test('the sweep reads the allowlist file too, minus the array', () => {
  // Excluding gdrive.js wholesale made the sweep blind to every key defined in the file that
  // owns the sync bookkeeping -- delete the /^navaid\\.settings/ declaration and the suite
  // stayed green. These keys exist only there.
  const seen = allKeyLiterals();
  for (const k of ['navaid.settingsSnapshot', 'navaid.settingsSnapKeys',
    'navaid.settingsSyncedAt', 'navaid.syncSettings']) {
    expect(seen, k).toContain(k);
  }
  // ...and the array's own entries are still NOT read from there, or every stale entry in it
  // would prove its own aliveness.
  // Pinned to the whole array, not just "more than zero": a helper that cut only PART of it
  // would leak the rest into the sweep, where those entries would prove their own aliveness.
  const outside = allowlistFileOutsideTheArray();
  const leaked = allowlist().filter(k => outside.includes("'" + k + "'"));
  expect(leaked).toEqual([]);
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
  expect(prefixes.sort()).toEqual(['ats', 'cvfr', 'heli', 'lsa']);
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
