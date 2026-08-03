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

// For the reverse direction, resolve `const FOO_KEY = 'navaid.x'` -> setItem(FOO_KEY)
// per file, and only when the const name is unique in that file — ui.js declares
// many local `const KEY`, and collapsing those by name would invent writes.
function writtenKeys() {
  const written = new Set();
  for (const f of fs.readdirSync(APP_DIR).filter(x => x.endsWith('.js'))) {
    const src = fs.readFileSync(path.join(APP_DIR, f), 'utf8');
    for (const m of src.matchAll(/localStorage\.setItem\(\s*'(navaid\.[^']+)'/g)) written.add(m[1]);
    const counts = new Map(), vals = new Map();
    for (const m of src.matchAll(/(?:const|var|let)\s+([A-Za-z_$][\w$]*)\s*=\s*'(navaid\.[^']+)'/g)) {
      counts.set(m[1], (counts.get(m[1]) || 0) + 1);
      vals.set(m[1], m[2]);
    }
    for (const m of src.matchAll(/localStorage\.setItem\(\s*([A-Za-z_$][\w$]*)\s*[,)]/g)) {
      const n = m[1];
      if (counts.get(n) === 1) written.add(vals.get(n));
    }
  }
  return written;
}

test('the allowlist still refuses secrets and panel geometry', () => {
  const keys = allowlist();
  expect(keys.some(k => k.startsWith('navaid.ai.key'))).toBe(false);
  expect(keys.some(k => /Pos$/.test(k))).toBe(false);
  expect(keys).toContain('navaid.layer');
});

test('no setting the app writes is missing from the allowlist', () => {
  const synced = new Set(allowlist());
  // Deliberately device-local, or covered by another file — reasons in gdrive.js.
  const DEVICE_LOCAL = [
    /Pos$/, /^navaid\.sec\./, /^navaid\.ai\.key/, /^navaid\.route$/, /^navaid\.routes$/,
    /^navaid\.view$/, /tile/i, /^navaid\.sync/, /^navaid\.settings/, /^navaid\.undo/,
    /Collapsed$/, /^navaid\.hint/, /TipDone$/, /^navaid\.searchShown$/, /^navaid\.theme$/,
    /^navaid\.sim/, /^navaid\.tracks\./, /^navaid\.plateAirfield$/, /^navaid\.bearing$/,
    /^navaid\.legendPillW$/, /^navaid\.corrupt/, /^navaid\.windField(Alt|Opacity)$/,
    /^navaid\.magnifier/, /^navaid\.notamViewTime$/, /^navaid\.showVor$/,
    /^navaid\.editor\./,          // ?edit=1 scratch data for the dev overlay editor
    /^navaid\.showNotam$/,         // legacy shared key: read for migration, never written
  ];
  const missing = [...writtenKeys()]
    .filter(k => !synced.has(k))
    .filter(k => !DEVICE_LOCAL.some(re => re.test(k)))
    .sort();
  // Anything here is a user setting that silently fails to follow the pilot to
  // another device. Add it to the allowlist, or to DEVICE_LOCAL with a reason.
  expect(missing).toEqual([]);
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
