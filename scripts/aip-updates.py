#!/usr/bin/env python3
"""What the CAA changed in its AIP since the last look, sorted by what it means for NavAid.

scripts/aip-drift.py answers "is what we ship still current"; this answers the wider question
a person needs in order to know a refresh is due: what did the CAA publish, amend or withdraw
since yesterday. It compares today's index with the previous snapshot of it -- every file's
title, hash and date -- and sorts each change by what it touches:

  hours    a page airfield-hours.json was read from (re-read section 6 / AD 2.3)
  plates   a chart we ship (see aip-drift.py for which file)
  cvfr     a CVFR chart sheet
  other    everything else in the AIP

A title that keeps its name but changes hash was amended; a title that appears or disappears
was added or withdrawn. The CAA re-uploads some packs whole, so a change is reported per title,
not per byte.

Usage:
    python3 scripts/aip-updates.py --out today.json [--prev yesterday.json] [--md report.md]
Exit 0 and write nothing to --md when nothing changed or there is no previous snapshot (the
first run only records the baseline); exit 1 when something changed; exit 2 when the index
could not be read (and nothing is written, so yesterday's snapshot stays the baseline).
"""
import importlib.util
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
_spec = importlib.util.spec_from_file_location('aip_drift', ROOT / 'scripts' / 'aip-drift.py')
drift = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(drift)


def snapshot(idx):
    """title -> {hash, modified} for every file the index serves."""
    out = {}
    for h, node in drift.index_files(idx).items():
        title = ' '.join(str(node.get('TITLE', '')).split())
        if not title:
            continue
        # Titles repeat (a pack's charts share generic names); keep each distinct file.
        key = title if title not in out else '%s [%s]' % (title, h[:8])
        out[key] = {'hash': h, 'modified': str(node.get('LAST_MODIFIED', ''))[:10]}
    return out


def watched_titles():
    """Titles that matter to NavAid, by kind."""
    norm = lambda t: ' '.join(str(t).split())
    hours, plates = set(), set()
    try:
        raw = json.loads((ROOT / 'docs' / 'data' / 'airfield-hours.json').read_text(encoding='utf-8'))
        hours = {norm(v['source']['title']) for v in raw.get('fields', {}).values()}
    except Exception:
        pass
    try:
        raw = json.loads((ROOT / 'docs' / 'data' / 'plate-sources.json').read_text(encoding='utf-8'))
        plates = {norm(v.get('title', '')) for k, v in raw.items() if not k.startswith('_') and isinstance(v, dict)}
    except Exception:
        pass
    return hours, plates


def kind_of(title, hours, plates):
    base = title.split(' [')[0]
    if base in hours:
        return 'hours'
    if base in plates:
        return 'plates'
    if 'CVFR' in base.upper():
        return 'cvfr'
    return 'other'


def compare(prev, cur, hours, plates):
    changes = []
    for t, v in cur.items():
        if t not in prev:
            changes.append(('added', t, v['modified']))
        elif prev[t]['hash'] != v['hash']:
            changes.append(('amended', t, v['modified']))
    for t, v in prev.items():
        if t not in cur:
            changes.append(('withdrawn', t, v['modified']))
    return [(kind_of(t, hours, plates), what, t, when) for what, t, when in changes]


ORDER = ['hours', 'plates', 'cvfr', 'other']
HEAD = {
    'hours': 'Airfield hours pages — re-read section 6 / AD 2.3 into `docs/data/airfield-hours.json`',
    'plates': 'Charts we ship — see `python3 scripts/aip-drift.py` for the files',
    'cvfr': 'CVFR chart sheets',
    'other': 'Everything else in the AIP',
}


def markdown(changes):
    lines = []
    for k in ORDER:
        rows = sorted((c for c in changes if c[0] == k), key=lambda c: (c[1], c[2]))
        if not rows:
            continue
        lines.append('### %s (%d)' % (HEAD[k], len(rows)))
        for _, what, t, when in rows[:60]:
            lines.append('- **%s** %s%s' % (what, t, (' — %s' % when) if when else ''))
        if len(rows) > 60:
            lines.append('- … and %d more' % (len(rows) - 60))
        lines.append('')
    return '\n'.join(lines)


def selftest():
    prev = {'A': {'hash': '1', 'modified': '2026-01-01'}, 'B': {'hash': '2', 'modified': '2026-01-01'},
            'CVFR NORTH': {'hash': '3', 'modified': '2026-01-01'}}
    cur = {'A': {'hash': '1', 'modified': '2026-01-01'}, 'B': {'hash': '9', 'modified': '2026-02-01'},
           'CVFR NORTH': {'hash': '3', 'modified': '2026-01-01'}, 'D': {'hash': '4', 'modified': '2026-02-01'}}
    got = sorted(compare(prev, cur, {'B'}, set()))
    want = sorted([('hours', 'amended', 'B', '2026-02-01'), ('other', 'added', 'D', '2026-02-01')])
    cur2 = dict(cur)
    del cur2['CVFR NORTH']
    got2 = compare(prev, cur2, set(), set())
    ok = got == want and ('cvfr', 'withdrawn', 'CVFR NORTH', '2026-01-01') in got2
    print('ok' if ok else 'FAIL %r %r' % (got, got2))
    return 0 if ok else 1


def main():
    if '--selftest' in sys.argv:
        return selftest()
    arg = lambda name: sys.argv[sys.argv.index(name) + 1] if name in sys.argv else None
    try:
        cur = snapshot(drift.fetch_index())
    except Exception as e:                 # the CAA's index is down: not a change, not a baseline
        print('AIP index unreachable: %s' % e)
        return 2
    out = arg('--out')
    if out:
        Path(out).write_text(json.dumps(cur, ensure_ascii=False, indent=0, sort_keys=True) + '\n', encoding='utf-8')
    prev_path = arg('--prev')
    if not prev_path or not Path(prev_path).exists():
        print('AIP index: %d files; no previous snapshot, baseline recorded' % len(cur))
        return 0
    prev = json.loads(Path(prev_path).read_text(encoding='utf-8'))
    hours, plates = watched_titles()
    changes = compare(prev, cur, hours, plates)
    counts = {k: sum(1 for c in changes if c[0] == k) for k in ORDER}
    print('AIP index: %d files; %d changes since the last snapshot (%s)'
          % (len(cur), len(changes), ', '.join('%s %d' % (k, n) for k, n in counts.items() if n) or 'none'))
    if not changes:
        return 0
    md = markdown(changes)
    print(md)
    if arg('--md'):
        Path(arg('--md')).write_text(md, encoding='utf-8')
    return 1


if __name__ == '__main__':
    sys.exit(main())
