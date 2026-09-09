#!/usr/bin/env python3
"""Record which published chart each plate we ship IS, by name.

The problem this solves. The AIP index keys every file by the SHA-512 of the PDF, and that
is the only handle we have on a plate: our filenames are our own invention and the CAA has
never seen them. The hash works right up until the moment it matters -- the CAA amends the
chart, the hash changes, and the link between "LLBG_Ground_GA Apron.pdf" and the chart it is
a copy of is gone. What is left is a file with a name we made up and no way to ask for its
replacement.

That is not hypothetical. Refreshing 40 plates by hand meant rendering each one and reading
the title printed on it, because nothing in the repo recorded what they were. It also turned
up filenames that say the wrong thing outright: `LLBG_Ground_GA Apron.pdf` is the APRON V
docking chart, and `LLER_ADC_3_en.pdf` is Apron V while `LLER_ADC_V1_en.pdf` is the aerodrome
chart.

The fix is to write the answer down while it is still knowable. A plate whose hash is in
today's index resolves to exactly one entry, with no guessing, so this records that entry's
TITLE alongside our filename. When the CAA next amends it the hash is useless but the title
still is: the drift report can say WHICH chart changed, and a refresh can look the title up
and fetch what the index serves for it now.

Titles are the CAA's own words and the only identifier they keep stable across amendments;
the index's CAT_ID groups a whole aerodrome (44 files under one id at Ben Gurion) and PATH is
just the hash again.

Usage:
    python3 scripts/aip-plate-sources.py            # refresh docs/data/plate-sources.json
    python3 scripts/aip-plate-sources.py --check    # exit 1 if it is out of date, write nothing
"""
import hashlib
import json
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
INDEX_URL = 'https://apiaip.azurewebsites.net/getJson'
UA = 'NavAid/1.0 (+https://navaid.supino.org) aip-plate-sources'
WATCHED = [ROOT / 'docs' / 'byop', ROOT / 'docs' / 'byop-enr']
OUT = ROOT / 'docs' / 'data' / 'plate-sources.json'

NOTE = ('What each plate we ship IS, in the CAA index\'s own words. Written by '
        'scripts/aip-plate-sources.py from a file whose hash matched the index, so every '
        'entry is a fact rather than a guess. The title is what survives an amendment: the '
        'hash changes, our filename means nothing to the CAA, the title stays.')


def fetch_index():
    req = urllib.request.Request(INDEX_URL, headers={'User-Agent': UA, 'Accept': 'application/json'})
    with urllib.request.urlopen(req, timeout=90) as r:
        return json.loads(r.read().decode('utf-8'))


def index_by_hash(idx):
    """SHA-512 -> {title, modified}. FILES entries live at every depth of the tree."""
    out = {}

    def walk(node):
        if isinstance(node, dict):
            files = node.get('FILES')
            if isinstance(files, list):
                for f in files:
                    h = str(f.get('HASH') or '')
                    if h:
                        out[h] = {'title': ' '.join(str(f.get('TITLE', '')).split()),
                                  'modified': str(f.get('LAST_MODIFIED', ''))[:10]}
            for k, v in node.items():
                if k != 'FILES' and isinstance(v, (dict, list)):
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


def build(current):
    """Our plates that match the index today -> what the CAA calls them."""
    known, unresolved = {}, []
    for folder in WATCHED:
        if not folder.exists():
            continue
        for pdf in sorted(folder.glob('*.pdf')):
            rel = str(pdf.relative_to(ROOT))
            hit = current.get(sha512(pdf))
            if hit:
                known[rel] = {'title': hit['title'], 'modified': hit['modified']}
            else:
                unresolved.append(rel)
    return known, unresolved


def main():
    idx = fetch_index()
    current = index_by_hash(idx)
    known, unresolved = build(current)

    # Keep what earlier runs recorded for plates that have since drifted -- that entry is the
    # whole point. Dropping it on the run after an amendment would throw the answer away at
    # exactly the moment it becomes useful.
    previous = {}
    if OUT.exists():
        try:
            previous = {k: v for k, v in json.loads(OUT.read_text(encoding='utf-8')).items()
                        if not k.startswith('_') and isinstance(v, dict)}
        except Exception:
            previous = {}
    carried = 0
    for rel in unresolved:
        if rel in previous and rel not in known:
            known[rel] = dict(previous[rel], stale=True)
            carried += 1

    doc = {'_note': NOTE}
    doc.update({k: known[k] for k in sorted(known)})
    text = json.dumps(doc, ensure_ascii=False, indent=1) + '\n'

    print('index: %d files; ours: %d named, %d unresolved (%d carried from a previous run)'
          % (len(current), len(known) - carried, len(unresolved), carried))
    for rel in unresolved:
        if rel not in known:
            print('  no name yet: %s' % Path(rel).name)

    if '--check' in sys.argv:
        same = OUT.exists() and OUT.read_text(encoding='utf-8') == text
        print('up to date' if same else 'OUT OF DATE: run scripts/aip-plate-sources.py')
        return 0 if same else 1
    OUT.write_text(text, encoding='utf-8')
    print('wrote %s' % OUT.relative_to(ROOT))
    return 0


if __name__ == '__main__':
    sys.exit(main())
