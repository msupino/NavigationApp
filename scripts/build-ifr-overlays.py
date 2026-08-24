#!/usr/bin/env python3
"""Georeference the IFR sheets that CAN be placed, into docs/ifr-img/ + airfields.json.

    python3 scripts/build-ifr-overlays.py            # every field's IFR plates
    python3 scripts/build-ifr-overlays.py LLBG       # one field

An approach or departure sheet is only a map where the CAA drew it as one. Most carry a
graticule -- LLBG's ILS/RNP/LOC/SID/VAC sheets do -- and those place from their own labels
like any other plate. The rest (every LLER SID and IAC, four LLBG STARs) are schematics with
no graticule at all: nothing to place them by, and a plausible-looking guess on an approach
chart is worse than not drawing it. Those are reported and skipped; they stay readable in the
charts viewer, which is where a schematic belongs.

Sheets are found by TITLE as well as by file name: LLIB files its SID and its VOR approach as
"נספח ו'" and "נספח ז'", so a name-only search misses them entirely.

The output is one line per field, ready to paste into docs/data/airfields.json:

    "ifr_overlays": [{"png": "LLBG_ILS08.png", "code": "ILS 08", "sw": [...], "ne": [...]}, …]
"""

import json, re, subprocess, sys, unicodedata

BYOP = 'docs/byop/'
TITLES = 'docs/data/plate-titles.json'
FIELDS = 'docs/data/airfields.json'
# What counts as an IFR sheet, in either language. VOR alone is not enough -- a field's
# "VOR ref" annexes are not procedures -- so it must appear with גישה (approach).
IFR = re.compile(r'ILS|SID|STAR|RNP|LOC\b|INSTRUMENT|\bIAC\b|APPROACH|תהליך גישה|מכשירים', re.I)


def sheets():
    titles = json.load(open(TITLES, encoding='utf-8'))
    fields = json.load(open(FIELDS, encoding='utf-8'))
    fields = fields[list(fields)[0]]
    out = []
    for af in fields:
        for plate in (af.get('plates') or []):
            meta = titles.get(plate, {})
            text = ((meta.get('he') or '') + ' ' + (meta.get('en') or '')).strip()
            if not (IFR.search(text) or IFR.search(plate)):
                continue
            out.append((af['name'], plate, text or plate))
    return out


def code_for(icao, plate, title):
    """A short designation for the picker: what a pilot would call the sheet."""
    stem = plate[len(icao) + 1:].rsplit('.', 1)[0]
    stem = re.sub(r'^(APPROACH|SID|STAR|IAC|VAC)_?', lambda m: m.group(1) + ' ', stem)
    stem = re.sub(r'_(V\d+_)?en$', '', stem).replace('_', ' ').strip()
    if stem.lower().startswith('airport annex'):
        # LLIB files its procedures as annexes; the title is the only designation there is.
        head = re.split(r'[-–—]', title)[0].strip()
        return unicodedata.normalize('NFC', head)[:40] or stem
    return stem[:40]


def main(argv):
    only = set(a.upper() for a in argv)
    placed, skipped = {}, []
    for icao, plate, title in sheets():
        if only and icao not in only:
            continue
        code = code_for(icao, plate, title)
        name = icao + '_' + re.sub(r'[^A-Za-z0-9]+', '', code)[:18]
        run = subprocess.run(
            ['python3', 'scripts/georef-plate.py', BYOP + plate, icao,
             '--write', '--set', 'ifr', '--name', name],
            capture_output=True, text=True)
        try:
            fit = json.loads(run.stdout.split('wrote')[0])
        except Exception:
            fit = {}
        if run.returncode != 0 or 'error' in fit:
            why = fit.get('error') or (run.stderr.strip().split('\n')[-1] if run.stderr else 'refused')
            skipped.append((icao, plate, why[:70]))
            continue
        row = {'png': name + '.png', 'code': code, 'title': title}
        for key in ('sw', 'ne', 'tl', 'tr', 'bl'):
            if key in fit:
                row[key] = fit[key]
        placed.setdefault(icao, []).append(row)

    for icao, plate, why in skipped:
        print(f'skipped {icao} {plate[:44]:46s} {why}')
    print(f'\n{sum(len(v) for v in placed.values())} sheets placed, {len(skipped)} not placeable')
    json.dump(placed, open('docs/data/ifr-overlays.json', 'w', encoding='utf-8'),
              ensure_ascii=False, indent=1)
    print('wrote docs/data/ifr-overlays.json')
    return 0


if __name__ == '__main__':
    raise SystemExit(main(sys.argv[1:]))
