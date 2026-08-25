#!/usr/bin/env python3
"""Read the coordinate boxes printed on the instrument plates into their overlay rows.

    python3 scripts/extract-plate-points.py

Most approach and departure sheets print a few positions in full -- the field, a VOR/DME, an
IAF, a missed-approach point -- as a name over "32° 21' 17"N / 034° 31' 24"E". Those are the
CAA's own digits, so a point read from them is exact, and a pilot can select it on the map
and put it in a route while the sheet is showing.

Only a few per sheet: unlike the enroute chart, a plate names most of its fixes without
giving their coordinates, and a fix with no printed position is not invented here. Sheets
that print none at all simply get no points.

The reading itself is the enroute extractor's -- same boxes, same split-across-words
coordinates -- so there is one implementation of that and this file only decides what to do
with the result.
"""

import importlib.util, json, math, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location('ats', os.path.join(HERE, 'extract-ats-waypoints.py'))
ats = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ats)

OVERLAYS = 'docs/data/ifr-overlays.json'
FIELDS = 'docs/data/airfields.json'
NAME = re.compile(r'^[A-Z][A-Z0-9]{3,5}$')
# Words that belong to a longer name on the sheet and are not a fix's designation: a box
# beside "BEN GURION" or "ROSH PINA" was coming out as GURION and ROSH.
PHRASE = {'GURION', 'ROSH', 'PINA', 'AVIV', 'WEST', 'EAST', 'RAMON', 'ASAF', 'ILAN', 'BEN',
          'TEL', 'SHEBA', 'BEER'}
FACILITY_NM = 0.6


# The two fields that file their procedures as Hebrew annexes: the designation the builder
# derived says what the sheet IS, and the file name says nothing, so the link is written down.
BY_HAND = {
    ('LLHZ', 'ATS departure'): 'LLHZ_airport_Annex Chet.pdf',
    ('LLIB', 'SID 15/33'): 'LLIB_airport_Annex Vav.pdf',
    ('LLIB', 'VOR approach'): 'LLIB_airport_Annex Zayin.pdf',
}


def source_pdf(icao, code, plates):
    """The plate a shipped overlay was built from, by the designation the builder gave it."""
    named = BY_HAND.get((icao, code))
    if named:
        return 'docs/byop/' + named
    want = re.sub(r'[^A-Za-z0-9]+', '', code).lower()
    for p in plates:
        if not p.startswith(icao):
            continue
        stem = re.sub(r'[^A-Za-z0-9]+', '', p[len(icao) + 1:-4]).lower()
        if want and (want in stem or stem in want):
            return 'docs/byop/' + p
    return None


def facilities():
    """Published aerodromes and navaids, to name a box that sits on one."""
    af = json.load(open(FIELDS, encoding='utf-8'))
    af = af[list(af)[0]]
    vor = json.load(open('docs/data/vor.json', encoding='utf-8'))
    vor = vor.get('vors', vor if isinstance(vor, list) else [])
    return ([(a['name'], a['lat'], a['lng']) for a in af] +
            [(v.get('ident', '?'), v['lat'], v['lng']) for v in vor])


def candidates(box, W):
    """Every designation that could belong to this box, best first."""
    out = []
    for w, x0, y, x1, _h in W:
        if not NAME.match(w) or w in PHRASE:
            continue
        dy = box['y'] - y
        if not 0 < dy < 6.5 * box['h']:
            continue
        cx, bx = (x0 + x1) / 2, (box['x0'] + box['x1']) / 2
        if abs(cx - bx) > 60:
            continue
        out.append((abs(cx - bx) + dy, w))
    out.sort()
    return out


def name_for(box, W):
    """The designation over the box, if the sheet prints one.

    Wider than the enroute reading: a plate sets these boxes among procedure text, so the
    name can sit a little further off than it does on the sheet's tidy enroute grid. Still
    centred on the box and still above it -- a name found beside or below it would as often
    be the next fix along.
    """
    best = None
    for w, x0, y, x1, _h in W:
        if not NAME.match(w) or w in PHRASE:
            continue
        dy = box['y'] - y
        if not 0 < dy < 6.5 * box['h']:
            continue
        cx, bx = (x0 + x1) / 2, (box['x0'] + box['x1']) / 2
        if abs(cx - bx) > 60:
            continue
        score = abs(cx - bx) + dy
        if best is None or score < best[0]:
            best = (score, w)
    return best[1] if best else ''


nm = lambda a, b, c, d: math.hypot((a - c) * 60, (b - d) * 60 * math.cos(math.radians(a)))


def main():
    overlays = json.load(open(OVERLAYS, encoding='utf-8'))
    fields = json.load(open(FIELDS, encoding='utf-8'))
    fields = fields[list(fields)[0]]
    plates = {a['name']: (a.get('plates') or []) for a in fields}
    known = facilities()
    total, sheets = 0, 0
    for icao, rows in overlays.items():
        for row in rows:
            pdf = source_pdf(icao, row['code'], plates.get(icao, []))
            if not pdf or not os.path.exists(pdf):
                print(f'{icao} {row["code"]}: source plate not found'); continue
            W = ats.words(pdf)
            found = []
            # A designation belongs to ONE position. Taking each box's nearest name on its
            # own gave a sheet two BENQOs -- the label sat between two boxes and won both --
            # so the names are handed out best-match first, and a box whose name has already
            # gone takes its next choice or none.
            boxes = ats.boxes(ats.coordinates(W))
            claims = []
            for i, box in enumerate(boxes):
                lat, lng = round(box['lat'], 5), round(box['lng'], 5)
                # A box printed on a published aerodrome or navaid IS that facility -- the
                # words around it are its long name ("BEN GURION"), not a designation.
                near = min(((nm(lat, lng, la, lo), ident) for ident, la, lo in known),
                           default=(99, ''))
                if near[0] < FACILITY_NM:
                    claims.append((-1.0, i, near[1]))          # a facility is not a guess
                    continue
                for score, name in candidates(box, W):
                    claims.append((score, i, name))
            claims.sort()
            taken_name, taken_box = set(), {}
            for _score, i, name in claims:
                if i in taken_box or name in taken_name:
                    continue
                taken_box[i] = name
                taken_name.add(name)
            for i, box in enumerate(boxes):
                found.append({'name': taken_box.get(i, ''),
                              'lat': round(box['lat'], 5), 'lng': round(box['lng'], 5)})
            named = [p for p in found if p['name']]
            # A box with no designation is a position with nothing to call it: it would show
            # on the map as an unlabelled dot the pilot cannot check against the chart, so
            # it is dropped rather than shown anonymously.
            if named:
                row['points'] = named
                total += len(named); sheets += 1
            else:
                row.pop('points', None)
            print(f'{icao} {row["code"][:26]:28s} {len(found):2d} boxes, {len(named):2d} named')
    json.dump(overlays, open(OVERLAYS, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print(f'\n{total} points on {sheets} sheets -> {OVERLAYS}')


if __name__ == '__main__':
    raise SystemExit(main())
