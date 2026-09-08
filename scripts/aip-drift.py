#!/usr/bin/env python3
"""Ask the AIP what it is serving today, and say which of our snapshots it no longer matches.

Every plate in docs/byop/ and every section in docs/byop-enr/ is a snapshot of a PDF the
CAA published. The CAA replaces those files without telling anyone, and a chart that has
moved on is worse than a missing one: it looks authoritative and is wrong.

This reports drift and refreshes nothing, for two reasons.

The first is alignment: half of these plates are georeferenced by hand -- corner
coordinates fitted to the printed graticule -- so swapping the PDF underneath an overlay
without re-checking it would put a confidently placed chart in the wrong place.

The second is that there is nothing to swap. The CAA publishes one pack per aerodrome, not
one file per plate: all 41 of our LLBG plates are pages extracted from AD 2.5. Refreshing
one means finding its page in the new pack, and the pages that would be safest to automate
-- aprons, parking, the SMAC -- are the ones with almost no extractable text, so page
matching scores 0.15 and ties between two different aprons. An automatic answer there would
be a guess wearing a hash's confidence. This says which pack changed and what came out of
it; a person opens the pack.

How it knows: the AIP's index (the same one scripts/aip-plate-titles.mjs reads) lists every
current file by SHA-512, and carries a signed link to a zip of all of them. A local file
whose hash is not in the index is not what the CAA serves now.

Usage:
    python3 scripts/aip-drift.py                 # human report, exit 1 if anything drifted
    python3 scripts/aip-drift.py --json out.json # machine-readable, for a workflow
"""
import hashlib
import json
import re
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
INDEX_URL = 'https://apiaip.azurewebsites.net/getJson'
UA = 'NavAid/1.0 (+https://navaid.supino.org) aip-drift'
WATCHED = [ROOT / 'docs' / 'byop', ROOT / 'docs' / 'byop-enr']
DERIVED_MAP = ROOT / 'docs' / 'data' / 'plate-derived.json'


def derived_sources():
    """Plates we ship that are not byte-for-byte the CAA's file -> the upstream hash.

    A rotated or otherwise reworked plate can never hash-match the index, so without this it
    is reported as drifted on every run, for ever, with the cause guessed at. What actually
    matters for those is whether the file they came FROM is still what the CAA serves.
    """
    try:
        raw = json.loads(DERIVED_MAP.read_text(encoding='utf-8'))
    except Exception:
        return {}
    return {k: v for k, v in raw.items() if not k.startswith('_') and isinstance(v, dict)}


def fetch_index():
    req = urllib.request.Request(INDEX_URL, headers={'User-Agent': UA, 'Accept': 'application/json'})
    with urllib.request.urlopen(req, timeout=90) as r:
        return json.loads(r.read().decode('utf-8'))


def index_files(idx):
    """Every {PATH, TITLE, LAST_MODIFIED} in the index, wherever it is nested."""
    out = {}

    def walk(node):
        if isinstance(node, dict):
            if 'PATH' in node and 'TITLE' in node:
                out[str(node['PATH']).replace('.pdf', '')] = node
            else:
                for v in node.values():
                    walk(v)
        elif isinstance(node, list):
            for v in node:
                walk(v)

    walk(idx)
    return out


def sha512(path):
    h = hashlib.sha512()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(1 << 20), b''):
            h.update(chunk)
    return h.hexdigest()


# "LLBG_APPROACH_ILS 08.pdf" -> LLBG. Used to group the report by aerodrome, which is also
# the unit the CAA publishes in: there is no per-plate file to fetch. Every plate we ship is
# a page extracted from that aerodrome's pack, so when a pack is amended the honest question
# is "which of our extracts came out of it", not "which file changed".
FIELD = re.compile(r'^(LL[A-Z]{2})')


def packs_by_field(entries):
    """Aerodrome -> the pack the AIP publishes for it, and when it last changed."""
    out = {}
    for e in entries.values():
        m = re.search(r'\b(LL[A-Z]{2})\b', str(e.get('TITLE', '')).upper())
        if not m:
            continue
        when = str(e.get('LAST_MODIFIED', ''))[:10]
        cur = out.get(m.group(1))
        if not cur or when > cur[1]:
            out[m.group(1)] = (str(e.get('TITLE', '')), when)
    return out


def classify(rel, own_hash, current, derived):
    """current | reworked | drifted, for one shipped plate.

    `reworked` is the narrow case: we changed the file ourselves and the file we changed is
    STILL what the CAA serves. The moment the source hash leaves the index the answer goes
    back to `drifted` -- otherwise this map would hide a stale chart behind our own edit,
    which is worse than the mislabelled report it exists to fix.
    """
    if own_hash in current:
        return 'current'
    d = derived.get(rel)
    if d and d.get('source') in current:
        return 'reworked'
    return 'drifted'


def selftest():
    """Offline checks for classify(). Run by tests/aip-drift-derived.spec.js."""
    cur = {'aaa': 1, 'bbb': 1}
    der = {'x.pdf': {'source': 'bbb'}, 'y.pdf': {'source': 'gone'}}
    cases = [
        ('plain file, hash published', ('p.pdf', 'aaa', cur, der), 'current'),
        ('plain file, hash gone', ('p.pdf', 'zzz', cur, der), 'drifted'),
        ('derived, source published', ('x.pdf', 'zzz', cur, der), 'reworked'),
        ('derived, source amended away', ('y.pdf', 'zzz', cur, der), 'drifted'),
        ('derived but byte-identical', ('x.pdf', 'aaa', cur, der), 'current'),
        ('no derived map at all', ('x.pdf', 'zzz', cur, {}), 'drifted'),
    ]
    bad = 0
    for label, args, want in cases:
        got = classify(*args)
        ok = got == want
        bad += 0 if ok else 1
        print('%-4s %-32s -> %s' % ('ok' if ok else 'FAIL', label, got))
    return 1 if bad else 0


def main():
    if '--selftest' in sys.argv:
        return selftest()
    idx = fetch_index()
    current = index_files(idx)
    derived = derived_sources()
    fresh, drifted, reworked = [], [], []

    for folder in WATCHED:
        if not folder.exists():
            continue
        for pdf in sorted(folder.glob('*.pdf')):
            rel = str(pdf.relative_to(ROOT))
            kind = classify(rel, sha512(pdf), current, derived)
            (fresh if kind == 'current' else reworked if kind == 'reworked' else drifted).append(rel)

    by_field = {}
    for rel in drifted:
        name = Path(rel).name
        m = FIELD.match(name)
        by_field.setdefault(m.group(1) if m else 'other', []).append(name)

    packs = packs_by_field(current)
    print('AIP index: %d files served today' % len(current))
    print('snapshots: %d current, %d drifted%s'
          % (len(fresh), len(drifted),
             (', %d reworked from a source that is still published' % len(reworked)) if reworked else ''))
    for rel in reworked:
        d = derived.get(rel, {})
        print('  ok     %-38s %s' % (Path(rel).name[:38], d.get('transform', 'derived locally')))
    for field in sorted(by_field):
        names = by_field[field]
        pack = packs.get(field)
        if pack:
            where = '  <- %s, amended %s' % (pack[0][:44], pack[1])
        elif any(field in str(e.get('TITLE', '')).upper() or field in str(e.get('TITLE', ''))
                 for e in current.values()):
            # The index has files for this aerodrome, just not one titled as a pack. Saying
            # "withdrawn?" here reads as a fact about the aerodrome and is not one: Arad was
            # reported withdrawn for as long as this line existed while the AIP carried three
            # of its annexes.
            where = '  <- published per file, no single pack'
        else:
            where = '  <- nothing for this aerodrome in the index'
        print('  %-6s %2d%s' % (field, len(names), where))
        print('         %s' % (', '.join(n[:40] for n in names[:4])
                               + ('' if len(names) <= 4 else ', …')))

    if '--json' in sys.argv:
        out = Path(sys.argv[sys.argv.index('--json') + 1])
        out.write_text(json.dumps({
            'indexFiles': len(current),
            'current': len(fresh),
            'drifted': sorted(drifted),
            'byField': {k: sorted(v) for k, v in by_field.items()},
            'packs': {k: {'title': v[0], 'amended': v[1]} for k, v in packs.items()},
        }, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
        print('wrote %s' % out)

    # Exit 1 on drift so a workflow can act on it, and 0 when everything matches.
    return 1 if drifted else 0


if __name__ == '__main__':
    sys.exit(main())
