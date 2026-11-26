#!/usr/bin/env node
// Fewer requests for the deployed site: pack the app scripts that index.html's loader lists into
// two downloads, app/boot.bundle.js (the first phase, `srcs`) and app/later.bundle.js (`later`).
//
// Why: Google's renderer caps the resources it fetches for one page. With ~44 scripts it skipped
// some ("Other error" on app/draw.js and app/terrain.js in Search Console), so the crawled page
// was the boot-error overlay. A phone on a slow link pays a round trip for each of them too.
//
// What does NOT change: each file still runs as its own classic <script>, in the same order. A
// bundle carries the files as TEXT; the loader (docs/index.html, runBundle) gives each its own
// inline script element. Concatenating them into one script would not be the same program: a
// throw in one file would stop all the files after it, and function declarations would be
// hoisted across files, so a `typeof later === 'function'` at load time would change answer.
//
//   node scripts/bundle-app.mjs <site-root>        (deploy.yml, after the minifier)
//
// Run from main's copy by the deploy, never from a pull request's checkout. A root whose
// index.html loader cannot run bundles (no runBundle) is left exactly as it is.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const LOCAL = /^\s*'((?:app|data)\/[A-Za-z0-9_./-]+\.js)'\s*\+\s*v\s*,?\s*(?:\/\/.*)?$/;

// The entries of one `var <name> = [ ... ];` array in the loader, and where they sit.
function listEntries(html, name) {
  const start = html.indexOf('var ' + name + ' = [');
  if (start < 0) return null;
  const end = html.indexOf('];', start);
  if (end < 0) return null;
  const lines = html.slice(start, end).split('\n');
  const files = [];
  for (const line of lines) {
    const m = line.match(LOCAL);
    if (m) files.push(m[1]);
  }
  return { start, end, files };
}

export function bundleSource(id, entries) {
  // One statement per file: the loader runs them in this order. sourceURL names each file in
  // a stack trace and in the devtools' source list, as if it had been loaded on its own.
  let out = '(window.__navaidBundles = window.__navaidBundles || {})[' + JSON.stringify(id) + '] = [\n';
  out += entries.map(([name, code]) =>
    '[' + JSON.stringify(name) + ',' + JSON.stringify(code + '\n//# sourceURL=' + name + '\n') + ']').join(',\n');
  return out + '\n];\n';
}

// Rewrite one loader array: its local entries, which are contiguous, become the one bundle.
function rewriteList(html, name, bundleFile) {
  const at = listEntries(html, name);
  if (!at || !at.files.length) return { html, files: [] };
  const block = html.slice(at.start, at.end);
  const lines = block.split('\n');
  const idx = lines.map((l, i) => (LOCAL.test(l) ? i : -1)).filter((i) => i >= 0);
  const first = idx[0], lastIdx = idx[idx.length - 1];
  // Contiguous -- comments and blank lines may sit between them, another script may not, or the
  // order between a bundled file and an unbundled one (a CDN library, the strings) would change.
  for (let i = first; i <= lastIdx; i++) {
    if (LOCAL.test(lines[i]) || /^\s*(?:\/\/.*)?$/.test(lines[i])) continue;
    throw new Error(`${name}: local scripts are not contiguous in the loader; not bundling`);
  }
  const indent = lines[first].match(/^\s*/)[0];
  const comma = /,\s*(?:\/\/.*)?$/.test(lines[lastIdx]) ? ',' : '';
  lines.splice(first, lastIdx - first + 1, `${indent}'${bundleFile}' + v${comma}`);
  return { html: html.slice(0, at.start) + lines.join('\n') + html.slice(at.end), files: at.files };
}

// Pure: index.html text + a reader for files -> the new index.html and the bundles to write.
export function planBundles(indexHtml, read) {
  if (!/function runBundle\b/.test(indexHtml)) return null;     // loader cannot run them
  const out = {};
  let html = indexHtml;
  for (const [list, id] of [['srcs', 'boot'], ['later', 'later']]) {
    const file = `app/${id}.bundle.js`;
    const r = rewriteList(html, list, file);
    if (!r.files.length) continue;
    out[file] = bundleSource(id, r.files.map((f) => [f, read(f)]));
    html = r.html;
  }
  return { indexHtml: html, bundles: out };
}

export function bundleRoot(root) {
  const indexPath = path.join(root, 'index.html');
  if (!fs.existsSync(indexPath)) return { skipped: 'no index.html' };
  const plan = planBundles(fs.readFileSync(indexPath, 'utf8'),
    (f) => fs.readFileSync(path.join(root, f), 'utf8'));
  if (!plan) return { skipped: 'loader has no runBundle' };
  // rm + write: the tree is hard-linked to the checkouts, and writing through a link would
  // edit them.
  const put = (p, s) => { fs.rmSync(p, { force: true }); fs.writeFileSync(p, s); };
  for (const [file, src] of Object.entries(plan.bundles)) put(path.join(root, file), src);
  put(indexPath, plan.indexHtml);
  return { bundles: Object.keys(plan.bundles).map((f) => f + ' ' + Math.round(plan.bundles[f].length / 1024) + ' KB') };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = process.argv[2];
  if (!root) { console.error('usage: bundle-app.mjs <site-root>'); process.exit(2); }
  const r = bundleRoot(root);
  console.log(root + ': ' + (r.skipped ? 'not bundled (' + r.skipped + ')' : r.bundles.join(', ')));
}
