// The deploy's minifier, as a file, for the speed budget (tests/speed-budget.spec.js) and the
// Lighthouse job (review.yml) to measure what production actually serves. The deploy itself
// does NOT run this file: it writes its own copy inline (deploy.yml, "Install the minifier"),
// because it also minifies PR branches and must never take code from a checkout. The two
// copies are kept identical by tests/speed-budget.spec.js.
// Minify one assembled site root in place: app/*.js, i18n/**/*.js, app/style.css.
// Writes through a fresh file (rm + write) because the tree is hard-linked to the checkouts.
import fs from 'node:fs';
import path from 'node:path';
import { minify } from 'terser';
import { minify as cssMinify } from 'csso';
const root = process.argv[2];
const files = [];
const walk = (d) => { if (!fs.existsSync(d)) return; for (const e of fs.readdirSync(d, { withFileTypes: true })) {
  const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else files.push(p); } };
walk(path.join(root, 'app')); walk(path.join(root, 'i18n'));
let before = 0, after = 0;
const put = (f, out) => { fs.rmSync(f); fs.writeFileSync(f, out); };
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  let out;
  if (f.endsWith('.js')) {
    const r = await minify(src, {
      ecma: 2020, module: false, toplevel: false,
      compress: { passes: 1, keep_fnames: true, keep_classnames: true, drop_console: false },
      mangle: { keep_fnames: true, keep_classnames: true },
      format: { quote_style: 3, comments: false, ascii_only: false },
    });
    out = r.code;
  } else if (f.endsWith('.css')) {
    out = cssMinify(src, { restructure: false }).css;
  } else continue;
  if (!out || out.length >= src.length) continue;
  before += src.length; after += out.length;
  put(f, out);
}
console.log(`${root}: ${Math.round(before / 1024)} KB -> ${Math.round(after / 1024)} KB`);
