// @ts-check
// Everything drawn on the map and the profile panels is tunable: colour, size, line width,
// dash, opacity, font and offset all come from tune(), so a gist can change any of it -- and a
// gist that says nothing leaves the shipped value, because each tunable's default IS the value
// that used to be written into the drawing code.
//
// This test keeps it that way. It reads the app's scripts and fails on a drawing value written
// as a literal: a colour or font assigned straight to the context, a numeric line width,
// opacity, dash or radius. The fix is a tunable (core.js registry + a menu group), not an entry
// in ALLOWED below -- that list is only for things that are not a look at all.
const { test, expect } = require('./_setup');
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'docs', 'app');

const RULES = [
  { what: 'colour assigned as a literal', re: /\b(fillStyle|strokeStyle|shadowColor)\s*=\s*(['"`])(?!transparent\2)/ },
  { what: 'line width as a number', re: /\blineWidth\s*=\s*[0-9.]+\s*;/ },
  { what: 'dash pattern as numbers', re: /\bsetLineDash\(\s*\[\s*[0-9]/ },
  { what: 'dash pattern as numbers', re: /\?\s*\[\s*[0-9.]+\s*,\s*[0-9.]+\s*\]\s*:\s*\[\]/ },
  { what: 'opacity as a number', re: /\bglobalAlpha\s*=\s*(0?\.[0-9]+|0)\s*;/ },
  { what: 'font size as a literal', re: /\bfont\s*=\s*(['"])[^'"]*\d+(\.\d+)?px/ },
  { what: 'font size as a literal', re: /\bfont\s*=\s*`[^`$]*\d+(\.\d+)?px/ },
  { what: 'opacity as a number', re: /\b(colorWithAlpha|tintFill)\([^()]*(\([^()]*\))?[^()]*,\s*[0-9.]+\s*\)/ },
  { what: 'radius as a number', re: /\.arc\([^,]+,[^,]+,\s*[0-9.]+\s*,/ },
  // A literal only as the guard behind a tunable read (tune('x') || '#fff', tn('x', '#fff')) is fine.
  { what: 'colour assigned as a literal', re: /\b(fillStyle|strokeStyle|shadowColor)\s*=[^;]*(['"])(#[0-9a-fA-F]{3,8}|rgba?\()/,
    skip: /\b(tune|tn)\(/ },
  { what: 'colour kept in a constant', re: /\bconst\s+[A-Z][A-Z0-9_]*\s*=\s*(['"])(#[0-9a-fA-F]{3,8}|rgba?\()/ },
];

// Not a look. A line ending in `// ctx reset` puts the context back after drawing; the rest
// are named here with the reason.
const ALLOWED = [
  // tintFill's fallback for a colour it cannot read, not a colour anything is drawn in.
  { file: 'core.js', match: /const DEFAULT_LABEL_FILL_COLOR = /, why: 'fallback for an unreadable colour' },
];
const RESET = /\/\/\s*ctx reset\b/;

function offenders() {
  const out = [];
  for (const f of fs.readdirSync(DIR).filter(n => n.endsWith('.js')).sort()) {
    const lines = fs.readFileSync(path.join(DIR, f), 'utf8').split('\n');
    lines.forEach((line, i) => {
      const code = line.replace(/\/\/.*$/, '');
      if (!code.trim() || /^\s*\*/.test(code) || RESET.test(line)) return;
      for (const r of RULES) {
        if (!r.re.test(code) || (r.skip && r.skip.test(code))) continue;
        const where = f + ':' + (i + 1);
        if (ALLOWED.some(a => a.file === f && a.match.test(code))) continue;
        out.push(where + '  ' + r.what + ':  ' + line.trim().slice(0, 120));
        break;
      }
    });
  }
  return out;
}

// tune() answers 0 for a key it does not know, so a typo or a key nobody registered draws at
// size 0 -- or, behind a tn(key, fallback) guard, at a value no gist can reach. Every key the
// code reads has to be in the registry.
test('every key the code reads with tune() / tn() is registered', () => {
  const core = fs.readFileSync(path.join(DIR, 'core.js'), 'utf8');
  const keys = new Set([...core.matchAll(/\n  ([A-Za-z0-9_]+):\s*\{\s*value:/g)].map(m => m[1]));
  const missing = [];
  for (const f of fs.readdirSync(DIR).filter(n => n.endsWith('.js')).sort()) {
    const src = fs.readFileSync(path.join(DIR, f), 'utf8');
    for (const m of src.matchAll(/\b(?:tune|tn)\('([A-Za-z0-9_]+)'/g)) {
      if (!keys.has(m[1]) && !missing.includes(m[1] + '  (' + f + ')')) missing.push(m[1] + '  (' + f + ')');
    }
  }
  expect(missing, 'register these in core.js (and a menu group)').toEqual([]);
});

test('no drawing value is written as a literal: each one is a tunable', () => {
  const bad = offenders();
  expect(bad, 'make these tunables (core.js registry + a menu group); default = the current value\n'
    + bad.join('\n')).toEqual([]);
});
