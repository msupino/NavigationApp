#!/usr/bin/env node
// Every plate's own designation, straight from the CAA.
//
// The chips in the airport-charts menu used to be built from the file name
// ("airport Annex Alef"), which is our storage convention and not what the plate is called.
// The CAA's own AIP app reads an index that carries each plate's designation in Hebrew (and,
// for the three international fields, English): "ראש פינה - נספח ד' הצטרפות בתקלת קשר
// מנתיבי CVFR". This pulls that index and writes the titles for the plates we actually ship.
//
// Matching is exact, not fuzzy: the index keys every file by the SHA-512 of the PDF itself,
// so hashing what we ship finds its entry with no name-guessing. A plate that does NOT match
// is one the CAA has amended since we last fetched it — reported, so the daily job can raise
// it rather than let the shipped copy quietly rot.
import { createHash } from 'node:crypto';
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

const INDEX_URL = 'https://apiaip.azurewebsites.net/getJson';
// The CAA's own app's client string. This is their public index, read once a day; identifying
// ourselves honestly as an ordinary client of it is the least we can do.
const UA = 'NavAid/1.0 (+https://navaid.supino.org) aip-plate-titles';
const BYOP = 'docs/byop';
const OUT = 'docs/data/plate-titles.json';

async function fetchIndex() {
  const res = await fetch(INDEX_URL, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
  if (!res.ok) throw new Error(`index fetch failed: ${res.status}`);
  return res.json();
}

// The tree is {aip: {he|en: {AIP: {id: {TITLE, FILES:[...], SUB: {...}}}}}}; FILES entries
// carry HASH, TITLE and LAST_MODIFIED. Flatten to hash -> {he, en, modified}.
function indexByHash(doc) {
  const out = new Map();
  const walk = (node, lang) => {
    if (Array.isArray(node)) { node.forEach(n => walk(n, lang)); return; }
    if (!node || typeof node !== 'object') return;
    // The hash is the join key and is compared against one we compute ourselves, so it has to
    // look like one: 128 hex characters, nothing else.
    if (typeof node.HASH === 'string' && /^[0-9a-f]{128}$/.test(node.HASH) && node.TITLE) {
      const row = out.get(node.HASH) || {};
      row[lang] = cleanText(node.TITLE);
      if (node.LAST_MODIFIED) row.modified = cleanDate(node.LAST_MODIFIED);
      out.set(node.HASH, row);
    }
    for (const v of Object.values(node)) walk(v, lang);
  };
  for (const lang of ['he', 'en']) walk(doc?.aip?.[lang], lang);
  return out;
}

// "ראש פינה - נספח ד' הצטרפות בתקלת קשר מנתיבי CVFR" -> {annex: "נספח ד'", title: "הצטרפות…"}
// The airfield's own name leads every domestic title and is already the section header, so it
// would only be read twice.
function splitTitle(full) {
  const t = String(full || '').replace(/\s+/g, ' ').trim();
  // The annex number is Hebrew letters -- one to three of them, since the teens are written
  // י"א / יב' / יג' -- optionally with a gershayim/geresh and a -1 suffix where one annex has
  // several parts. Matching a single letter split "נספח יא'" into "נספח י" + a title starting
  // with a stray "א'".
  const m = t.match(/^(.*?)\s*[-–]\s*(נספח\s*[\u05d0-\u05ea]{1,3}\s*['"״׳]?(?:\s*-\s*\d)?)\s*[-–]?\s*(.*)$/);
  if (m) return { annex: m[2].trim(), title: (m[3] || '').trim() || m[1].trim() };
  const dash = t.match(/^(.*?)\s*[-–]\s*(.+)$/);
  if (dash && /^[A-Z]{4}$/.test(dash[2].trim())) return { annex: '', title: dash[1].trim() };
  return { annex: '', title: t };
}

const sha512 = (buf) => createHash('sha512').update(buf).digest('hex');

// Everything below this line came off the network and ends up in a checked-in file, in a
// workflow step summary and, eventually, on a button in the cockpit. Treat it as text and
// nothing else: no control characters (which would corrupt the JSON's neighbours), no bidi
// overrides (which can make a label read as something it is not), no unbounded length, and
// nothing that would be read as markdown in the step summary.
const MAX_TITLE = 120;
function cleanText(value) {
  return String(value == null ? '' : value)
    // C0/C1 controls and the bidi overrides -- U+2066..U+2069 and U+202A..U+202E
    .replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, '')
    .replace(/[`*_<>|\\]/g, ' ')          // markdown/HTML furniture, for the step summary
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_TITLE);
}
// A date or nothing. The index prints "2026-08-06 08:45:29+00:00"; only the day is used.
function cleanDate(value) {
  const m = String(value == null ? '' : value).match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : '';
}

async function main() {
  const doc = await fetchIndex();
  const byHash = indexByHash(doc);
  const files = (await readdir(BYOP)).filter(f => f.toLowerCase().endsWith('.pdf')).sort();
  const titles = {};
  const stale = [];
  for (const f of files) {
    const hash = sha512(await readFile(join(BYOP, f)));
    const row = byHash.get(hash);
    if (!row) { stale.push(f); continue; }
    const he = row.he ? splitTitle(row.he) : null;
    const en = row.en ? splitTitle(row.en) : null;
    titles[f] = {
      annex: cleanText(he && he.annex),
      he: cleanText(he && he.title),
      en: cleanText(en && en.title),
      modified: cleanDate(row.modified),
    };
  }
  await writeFile(OUT, JSON.stringify(titles, null, 1) + '\n');
  const lines = [
    `titles written for ${Object.keys(titles).length} of ${files.length} plates -> ${OUT}`,
    stale.length
      ? `${stale.length} shipped plates are not in the current index (amended upstream since we fetched them):\n  ` + stale.join('\n  ')
      : 'every shipped plate matches the current index',
  ];
  console.log(lines.join('\n'));
  if (process.env.GITHUB_STEP_SUMMARY) {
    await writeFile(process.env.GITHUB_STEP_SUMMARY, lines.join('\n\n') + '\n', { flag: 'a' });
  }
}

main().catch(err => { console.error(err.message); process.exit(1); });
