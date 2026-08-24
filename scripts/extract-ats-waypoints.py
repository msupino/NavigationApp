#!/usr/bin/env python3
"""Read every reporting point off the CAA's ATS routes sheet, into docs/data/ats-waypoints.json.

    python3 scripts/extract-ats-waypoints.py ATS.pdf

The sheet prints each point as a little box -- the designation on one line, then

    32° 21’ 17”N
    034° 31’ 24”E

-- and the PDF carries that as live text, so the coordinates are the CAA's own digits rather
than anything measured off the picture. pdftotext hands them over one word at a time
("32°", "21’", "17”N"), so each coordinate is rebuilt from the run of words sharing its
baseline, a latitude is paired with the longitude printed directly beneath it, and the
designation is the five-letter token centred above the pair.

Two things the sheet does that a naive read gets wrong, and how each is handled:

  * Some boxes belong to a NAVAID or an aerodrome, not to a reporting point, and the label
    nearest them is whatever the chart happens to draw there ("EILAT" over the RAM DVOR/DME).
    A box that lands within 0.6 nm of a published facility in airfields.json or vor.json is
    reported and left out.
  * Words from longer phrases read like designations -- TEL AVIV FIR, BEN GURION, MAHANAIM
    WEST. Those words are named in PHRASE and never taken as a point.

Every point the enlargement insets repeat is deduplicated by designation; the repeats agree
to five decimal places, which is the check that the pairing is not crossing boxes.
"""

import argparse, html, json, math, os, re, subprocess, sys

WORD = re.compile(r'<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]*)</word>')
LAT = re.compile(r"^(\d{2})°(\d{2})[’'‘]([\d.]+)[”\"]?N$")
LON = re.compile(r"^(\d{3})°(\d{2})[’'‘]([\d.]+)[”\"]?E$")
NAME = re.compile(r'^[A-Z]{5}$')
PHRASE = {'AVIV', 'WEST', 'GURION', 'EAST', 'PINA', 'ROSH', 'RAMON', 'ASAF', 'ILAN',
          'TEL', 'BEN', 'SEA', 'DEAD', 'GULF'}
FACILITY_NM = 0.6

dms = lambda d, m, s: int(d) + int(m) / 60 + float(s) / 3600
nm = lambda a, b, c, d: math.hypot((a - c) * 60, (b - d) * 60 * math.cos(math.radians(a)))


def words(pdf):
    out = subprocess.run(['pdftotext', '-bbox', '-f', '1', '-l', '1', pdf, '-'],
                         capture_output=True, text=True, check=True).stdout
    return [(html.unescape(w).strip(), float(x0), (float(y0) + float(y1)) / 2, float(x1),
             float(y1) - float(y0))
            for x0, y0, x1, y1, w in WORD.findall(out)]


def coordinates(W):
    """Every printed latitude and longitude, rebuilt from the words it was set in."""
    out = []
    for i, (w, x0, yc, x1, h) in enumerate(W):
        if '°' not in w:
            continue
        buf, bx1 = w, x1
        for j in range(i + 1, min(i + 6, len(W))):
            w2, x2, yc2, x3, _ = W[j]
            if abs(yc2 - yc) > 3 or x2 - bx1 > 14:
                break
            buf, bx1 = buf + w2, x3
            if LAT.match(buf) or LON.match(buf):
                break
        m = LAT.match(buf)
        if m:
            out.append(('lat', dms(*m.groups()), x0, yc, bx1, h)); continue
        m = LON.match(buf)
        if m:
            out.append(('lon', dms(*m.groups()), x0, yc, bx1, h))
    return out


def boxes(coords):
    """A latitude with the longitude printed directly under it, in the same box."""
    lats = [c for c in coords if c[0] == 'lat']
    lons = [c for c in coords if c[0] == 'lon']
    used, out = set(), []
    for _, lat, x0, yc, x1, h in lats:
        best = None
        for k, (_, lon, lx0, lyc, lx1, _lh) in enumerate(lons):
            if k in used:
                continue
            dy = lyc - yc
            if not 0 < dy < 3.2 * h:
                continue
            if lx1 < x0 - 12 or lx0 > x1 + 12:
                continue
            if best is None or dy < best[0]:
                best = (dy, k, lon)
        if best:
            used.add(best[1])
            out.append({'lat': lat, 'lng': best[2], 'x0': x0, 'x1': x1, 'y': yc, 'h': h})
    return out


def designation(box, W):
    cands = []
    for w, x0, y, x1, _h in W:
        if not NAME.match(w) or w in PHRASE:
            continue
        dy = box['y'] - y
        if not 0 < dy < 4.0 * box['h']:
            continue
        cx, bx = (x0 + x1) / 2, (box['x0'] + box['x1']) / 2
        if abs(cx - bx) > 45:
            continue
        cands.append((abs(cx - bx) + dy, w))
    return min(cands)[1] if cands else ''


def facilities(data_dir):
    af = json.load(open(os.path.join(data_dir, 'airfields.json'), encoding='utf-8'))
    af = af[list(af)[0]]
    vor = json.load(open(os.path.join(data_dir, 'vor.json'), encoding='utf-8'))
    vor = vor.get('vors', vor if isinstance(vor, list) else [])
    return ([(a['name'], a['lat'], a['lng']) for a in af] +
            [(v.get('ident', '?'), v['lat'], v['lng']) for v in vor])


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('pdf')
    ap.add_argument('--out', default='docs/data/ats-waypoints.json')
    ap.add_argument('--data', default='docs/data', help='where airfields.json and vor.json live')
    a = ap.parse_args()

    W = words(a.pdf)
    found = boxes(coordinates(W))
    known = facilities(a.data)

    points, skipped, repeats = {}, [], 0
    for box in found:
        name = designation(box, W)
        if not name:
            continue
        row = {'name': name, 'lat': round(box['lat'], 5), 'lng': round(box['lng'], 5)}
        hit = next(((n, d) for n, la, lo in known
                    for d in [nm(row['lat'], row['lng'], la, lo)] if d < FACILITY_NM), None)
        if hit:
            skipped.append((row, hit)); continue
        if name in points:
            was = points[name]
            if nm(was['lat'], was['lng'], row['lat'], row['lng']) > 0.05:
                print(f'{name}: two boxes {nm(was["lat"], was["lng"], row["lat"], row["lng"]):.2f} nm '
                      f'apart — refusing rather than guessing', file=sys.stderr)
                return 2
            repeats += 1
            continue
        points[name] = row

    for row, (n, d) in skipped:
        print(f'skipped {row["name"]:6s} {row["lat"]:.4f},{row["lng"]:.4f} — '
              f'that box is {n} ({d:.2f} nm)')
    print(f'{len(points)} reporting points, {repeats} inset repeats, {len(skipped)} facility boxes')

    out = {
        'source': 'CAA AIP ENR 6.1 ATS routes chart',
        'note': 'Coordinates as printed on the sheet, not measured off the picture.',
        'waypoints': [points[k] for k in sorted(points)],
    }
    with open(a.out, 'w', encoding='utf-8') as fh:
        json.dump(out, fh, ensure_ascii=False, indent=1)
        fh.write('\n')
    print(f'wrote {a.out}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
