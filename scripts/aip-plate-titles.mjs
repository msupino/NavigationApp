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
import { spawnSync } from 'node:child_process';
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
// A second key, for the plates whose hash no longer matches: (ICAO, annex number). The index
// groups files under a node titled "חיפה - LLHA", and our file names carry the annex in
// transliteration ("LLHA_airport_Annex Alef.pdf"). That pair identifies the plate even when our
// copy of the PDF is a revision behind -- which is the case for two thirds of what we ship, and
// is exactly when a designation is most useful: the pilot still wants to know it is תרשים השדה.
const ANNEX_WORD_TO_LETTER = {
  alef: 'א', bet: 'ב', gimel: 'ג', daled: 'ד', dalet: 'ד', he: 'ה', vav: 'ו', zayin: 'ז',
  chet: 'ח', tet: 'ט', yud: 'י', kaf: 'כ', lamed: 'ל',
};
// "LLHA_airport_Annex Yud Bet.pdf" -> "יב"; "…Annex Bet 2.pdf" -> "ב-2".
function annexKeyFromFile(file) {
  const m = String(file).match(/Annex ([A-Za-z]+(?: [A-Za-z]+)?)(?: (\d))?/i);
  if (!m) return '';
  const words = m[1].toLowerCase().split(/\s+/).map(w => ANNEX_WORD_TO_LETTER[w]);
  if (words.some(w => !w)) return '';
  return words.join('') + (m[2] ? '-' + m[2] : '');
}
// "נספח יא'-2" -> "יא-2"
function annexKeyFromTitle(annex) {
  const raw = String(annex || '').replace(/^נספח\s*/, '').replace(/['"״׳\s]/g, '');
  const m = raw.match(/^([\u05d0-\u05ea]{1,3})(?:-(\d))?/);
  return m ? m[1] + (m[2] ? '-' + m[2] : '') : '';
}
// ICAO of the node a file hangs under: its title ends with the code ("ראש פינה - LLIB").
function indexByAnnex(doc) {
  const out = new Map();
  const walk = (node) => {
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (!node || typeof node !== 'object') return;
    const title = String(node.TITLE || '');
    const icao = (title.match(/\b(LL[A-Z]{2})\b/) || [])[1];
    if (icao && Array.isArray(node.FILES)) {
      for (const f of node.FILES) {
        const parts = splitTitle(cleanText(f.TITLE));
        const key = icao + '|' + annexKeyFromTitle(parts.annex);
        if (!annexKeyFromTitle(parts.annex)) continue;
        // Only when it is unambiguous: a renumbered annex must not inherit another's name.
        if (out.has(key)) out.set(key, null);
        else out.set(key, { he: parts.title, modified: cleanDate(f.LAST_MODIFIED) });
      }
    }
    for (const v of Object.values(node)) walk(v);
  };
  walk(doc?.aip?.he);
  return out;
}

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
  // "מנחת באר-שבע - LLBS - דפי מלל": the field's name and code lead the title of every text
  // page, and both are already on the screen -- the section header IS the field. What the
  // pilot is looking for is the two words at the end.
  const coded = t.match(/^.*?\s*[-–]\s*LL[A-Z]{2}\s*[-–]\s*(.+)$/);
  if (coded) return { annex: '', title: coded[1].trim() };
  const dash = t.match(/^(.*?)\s*[-–]\s*(.+)$/);
  if (dash && /^[A-Z]{4}$/.test(dash[2].trim())) return { annex: '', title: dash[1].trim() };
  return { annex: '', title: t };
}

const sha512 = (buf) => createHash('sha512').update(buf).digest('hex');

// --- fallback: read the plate's own header ------------------------------------------------
// Two thirds of the plates we ship no longer match the index by hash -- the CAA has amended
// them since they were fetched -- and those would otherwise show a file name in the menu. The
// plate itself carries its designation in the band above the map frame: the annex number in
// one corner, the subject under it, the field's name in the other corner. Read that, and mark
// it as coming from the PDF so it is clear which titles are authoritative.
//
// Deliberately conservative: anything that looks like furniture (a frequency, an elevation, a
// coordinate, the field's own name) is dropped rather than guessed at.
// Everything below this line came off the network or out of a PDF and ends up in a checked-in
// file, in a workflow step summary and, eventually, on a button in the cockpit. Treat it as
// text and nothing else: no control characters (which would corrupt the JSON's neighbours), no
// bidi overrides (which can make a label read as something it is not), no unbounded length,
// and nothing that would be read as markdown in the step summary.
const MAX_TITLE = 120;
// An ALLOWLIST, not a blocklist: a designation is Hebrew letters, Latin letters, digits and a
// short list of punctuation that appears in real plate titles ("נספח יא'-2", "RNP Z RWY 30",
// "Aerodrome chart - ICAO"). Everything else is dropped rather than reasoned about -- control
// characters would corrupt the JSON's neighbours, bidi overrides can make a label read as
// something it is not, and markdown furniture is interpreted when the step summary renders.
const ALLOWED_CHAR = /[\u05d0-\u05ea0-9A-Za-z ()\-/.,:'"״׳&+]/;
function cleanText(value) {
  const src = String(value == null ? '' : value);
  let out = '';
  for (const ch of src) {
    if (out.length >= MAX_TITLE) break;
    if (ALLOWED_CHAR.test(ch)) out += ch;
    else if (out && !out.endsWith(' ')) out += ' ';
  }
  return out.replace(/\s+/g, ' ').trim();
}
// A date or nothing. The index prints "2026-08-06 08:45:29+00:00"; only the day is used.
function cleanDate(value) {
  const m = String(value == null ? '' : value).match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : '';
}

function pdfHeaderLines(path) {
  // -layout, not -bbox: the bbox dump gives Hebrew words in VISUAL order, so "נספח ג'" comes
  // back as "'ג חפסנ". The layout dump keeps logical order, which is what we can read.
  const out = spawnSync('pdftotext', ['-f', '1', '-l', '1', '-layout', path, '-'],
    { encoding: 'utf8', maxBuffer: 8 << 20 });
  if (out.status !== 0 || !out.stdout) return [];
  return out.stdout.split('\n').map(l => l.replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '').trim())
    .filter(Boolean).slice(0, 8);
}

const HEB = /[\u0590-\u05ff]/;
// Frequencies, elevations, coordinates, phone numbers, the tower box -- everything an IAA
// plate prints in the same band as its designation.
const FURNITURE = /(\d{3}\.\d|\bft\b|ELEV|ATIS|TWR|MHZ|VAR|\d{1,3}\s*°|QNH|GND|BRG|DIST IN|ALT IN|SCALE|CHANGES|תדרים|מגדל|טלפון|פרק|בפמ)/i;

// The designation, read off the plate itself. Only the IAA annex sheets are attempted: they
// print "נספח X" and the subject beside it, in a fixed band. An approach plate laid out in the
// Jeppesen style has no such header, and guessing at one produced lines like
// "ISRAEL 16 MAY 24 APPROACH TA 18 000" -- worse than the file name it replaced.
function designationFromPdf(path, fieldNames) {
  const lines = pdfHeaderLines(path);
  const annexLine = lines.findIndex(l => /נספח/.test(l));
  if (annexLine === -1) return null;
  const am = lines[annexLine].match(/נספח\s*[\u05d0-\u05ea]{1,3}\s*['"״׳]?(?:\s*-\s*\d)?/);
  const annex = am ? am[0].replace(/\s+/g, ' ').trim() : '';
  const parts = [];
  for (const line of lines.slice(annexLine, annexLine + 3)) {
    const rest = am ? line.replace(am[0], ' ') : line;
    for (const frag of rest.split(/\s{2,}|\|/)) {
      const f = cleanText(frag).replace(/^[-–—_\s'"״׳]+|[-–—_\s]+$/g, '');
      if (f.length < 4) continue;
      if (FURNITURE.test(f)) continue;
      if (fieldNames.some(n => n && (f.includes(n) || n.includes(f)))) continue;
      if (/^\(?LL[A-Z]{2}\)?$/.test(f)) continue;
      if (!HEB.test(f) && !/^[A-Za-z][A-Za-z0-9 ()\/-]{3,}$/.test(f)) continue;
      parts.push(f);
    }
  }
  // Two words minimum: the header band is full of stray fragments ("Dead", cut from "Dead
  // Sea"), and half a word on a button is worse than the file name it replaced. The annex
  // number alone is still worth keeping -- it is what the pilot asks for.
  const joined = cleanText(parts.slice(0, 2).join(' '));
  const title = /\s/.test(joined) ? joined : '';
  if (!annex && !title) return null;
  return { annex, title };
}

// Every plate prints its field's name in a corner; the menu shows it in the section header
// anyway, so it is dropped from the designation. Read from the dataset by the file's ICAO
// prefix, which is how the plates are named.
let _fields = null;
async function loadFields() {
  if (_fields) return _fields;
  try {
    const raw = JSON.parse(await readFile('docs/data/airfields.json', 'utf8'));
    const rows = Array.isArray(raw) ? raw : (raw.airfields || []);
    _fields = new Map(rows.map(r => [r.name, [r.he, r.en, r.name].filter(Boolean)]));
  } catch { _fields = new Map(); }
  return _fields;
}
function fieldNames(file) {
  const icao = String(file).slice(0, 4).toUpperCase();
  return (_fields && _fields.get(icao)) || [];
}

async function main() {
  await loadFields();
  const doc = await fetchIndex();
  const byHash = indexByHash(doc);
  const byAnnex = indexByAnnex(doc);
  const files = (await readdir(BYOP)).filter(f => f.toLowerCase().endsWith('.pdf')).sort();
  const titles = {};
  const stale = [];
  for (const f of files) {
    const hash = sha512(await readFile(join(BYOP, f)));
    const row = byHash.get(hash);
    if (!row) {
      // Amended upstream since we fetched it, so the hash cannot find it. Try the (ICAO,
      // annex) key next -- the CAA's own designation for that annex, even though our PDF is a
      // revision behind -- and only then fall back to reading the plate's own header.
      stale.push(f);
      const icao = String(f).slice(0, 4).toUpperCase();
      const key = annexKeyFromFile(f);
      const byKey = key ? byAnnex.get(icao + '|' + key) : null;
      if (byKey) {
        titles[f] = { annex: 'נספח ' + key.replace('-', "'-"), he: byKey.he, en: '',
          modified: '', source: 'aip-annex' };
        continue;
      }
      const own = designationFromPdf(join(BYOP, f), fieldNames(f));
      if (own) titles[f] = { annex: own.annex, he: own.title, en: '', modified: '', source: 'pdf' };
      continue;
    }
    const he = row.he ? splitTitle(row.he) : null;
    const en = row.en ? splitTitle(row.en) : null;
    titles[f] = {
      annex: cleanText(he && he.annex),
      he: cleanText(he && he.title),
      en: cleanText(en && en.title),
      modified: cleanDate(row.modified),
      source: 'aip',
    };
  }
  // One more pass at the boundary, so what reaches the disk is provably the shape declared
  // above whatever route a value took to get here.
  const safe = {};
  for (const [file, row] of Object.entries(titles)) {
    // Our own file names, nothing else. They carry spaces, plus signs and brackets --
    // "LLBG_SID_12-26-30 (Pidet+Ripud).pdf" -- so the set is explicit rather than tidy.
    if (!/^[A-Za-z0-9 _.,()+\-]+\.pdf$/.test(file)) continue;
    safe[file] = {
      annex: cleanText(row.annex),
      he: cleanText(row.he),
      en: cleanText(row.en),
      modified: cleanDate(row.modified),
      source: ['pdf', 'aip-annex'].includes(row.source) ? row.source : 'aip',
    };
  }
  await writeFile(OUT, JSON.stringify(safe, null, 1) + '\n');
  const fromPdf = Object.values(safe).filter(t => t.source === 'pdf').length;
  const byAnnexCount = Object.values(safe).filter(t => t.source === 'aip-annex').length;
  const lines = [
    `titles written for ${Object.keys(safe).length} of ${files.length} plates -> ${OUT}`
      + ` (${Object.values(safe).filter(t => t.source === 'aip').length} matched by hash, `
      + `${byAnnexCount} by annex number, ${fromPdf} read off the plate itself)`,
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
