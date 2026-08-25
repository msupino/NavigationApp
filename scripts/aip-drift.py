#!/usr/bin/env python3
"""Ask the AIP what it is serving today, and say which of our snapshots it no longer matches.

Every plate in docs/byop/ and every section in docs/byop-enr/ is a snapshot of a PDF the
CAA published. The CAA replaces those files without telling anyone, and a chart that has
moved on is worse than a missing one: it looks authoritative and is wrong.

This reports drift. It deliberately does NOT refresh anything. Half of these plates are
georeferenced by hand -- corner coordinates fitted to the printed graticule -- so swapping
the PDF underneath an overlay without re-checking its alignment would put a confidently
placed chart in the wrong place. Refreshing is a decision, taken per file, with the
alignment checked; this is the alarm that says a decision is due.

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


# "LLBG_APPROACH_ILS 08.pdf" -> LLBG. Used only to group the report.
FIELD = re.compile(r'^(LL[A-Z]{2})')


def main():
    idx = fetch_index()
    current = index_files(idx)
    fresh, drifted = [], []

    for folder in WATCHED:
        if not folder.exists():
            continue
        for pdf in sorted(folder.glob('*.pdf')):
            rel = str(pdf.relative_to(ROOT))
            if sha512(pdf) in current:
                fresh.append(rel)
            else:
                drifted.append(rel)

    by_field = {}
    for rel in drifted:
        name = Path(rel).name
        m = FIELD.match(name)
        by_field.setdefault(m.group(1) if m else 'other', []).append(name)

    print('AIP index: %d files served today' % len(current))
    print('snapshots: %d current, %d drifted' % (len(fresh), len(drifted)))
    for field in sorted(by_field):
        names = by_field[field]
        print('  %-6s %2d  %s' % (field, len(names), ', '.join(n[:44] for n in names[:4])
                                  + ('' if len(names) <= 4 else ', …')))

    if '--json' in sys.argv:
        out = Path(sys.argv[sys.argv.index('--json') + 1])
        out.write_text(json.dumps({
            'indexFiles': len(current),
            'current': len(fresh),
            'drifted': sorted(drifted),
            'byField': {k: sorted(v) for k, v in by_field.items()},
        }, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
        print('wrote %s' % out)

    # Exit 1 on drift so a workflow can act on it, and 0 when everything matches.
    return 1 if drifted else 0


if __name__ == '__main__':
    sys.exit(main())
