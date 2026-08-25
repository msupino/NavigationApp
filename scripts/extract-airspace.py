#!/usr/bin/env python3
"""Read the CAAI AIP's airspace sections into docs/data/airspace.json.

Sources (PDFs in docs/byop-enr/, pulled from the AIP index's own bundle):
  ENR 5.1 -- prohibited (LLP*) and restricted (LLR*) areas
  ENR 2.1 -- the Ben-Gurion TMA sectors

The AIP writes a boundary the way a controller reads it out: a list of corners,
sometimes a circle, sometimes "then a clockwise arc radius 47 NM centered on X".
This turns that prose into closed rings of lat/lng, because a route check needs
geometry rather than a description of one.

Refuses rather than guesses. An area whose boundary cannot be read exactly --
"along the Israel/Lebanon cease-fire line" is a border, not a bearing -- is
reported and left out, with its identifier printed, so nobody has to trust that
a missing area was noticed.

Usage:
    python3 scripts/extract-airspace.py            # report only
    python3 scripts/extract-airspace.py --write    # write docs/data/airspace.json
"""
import json
import math
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PDF_DIR = ROOT / 'docs' / 'byop-enr'
OUT = ROOT / 'docs' / 'data' / 'airspace.json'

ENR51 = PDF_DIR / 'ENR-5.1_prohibited-restricted-danger.pdf'
ENR21 = PDF_DIR / 'ENR-2.1_FIR-TMA.pdf'

NM_M = 1852.0
KM_M = 1000.0


# The AIP prints these tables in three columns -- boundary, vertical limits, remarks --
# and a plain text dump interleaves them: the boundary of LLR20 reads "...arc radius H24
# 1.6 NM centered on", with the remarks column spliced into the middle of a sentence. So
# read word positions instead and cut the columns apart by x before reading a word of it.
WORD = re.compile(r'<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="[\d.]+" yMax="[\d.]+">([^<]*)</word>')
COL_LIMITS_X = 270.0        # boundary column ends here
COL_REMARKS_X = 395.0       # remarks column starts here


def _unescape(w):
    return (w.replace('&amp;', '&').replace('&lt;', '<').replace('&gt;', '>')
             .replace('&quot;', '"').replace('&apos;', "'"))


def pdf_columns(path):
    """[(boundary, limits, remarks)] -- one triple per printed line, in order."""
    xml = subprocess.run(['pdftotext', '-bbox-layout', str(path), '-'],
                         capture_output=True, text=True, check=True).stdout
    rows = []
    for page in xml.split('<page ')[1:]:
        words = [(float(x), float(y), _unescape(t)) for x, y, t in WORD.findall(page)]
        lines = {}
        for x, y, t in words:
            lines.setdefault(round(y / 3), []).append((x, t))
        for key in sorted(lines):
            line = sorted(lines[key])
            left = ' '.join(t for x, t in line if x < COL_LIMITS_X)
            mid = ' '.join(t for x, t in line if COL_LIMITS_X <= x < COL_REMARKS_X)
            right = ' '.join(t for x, t in line if x >= COL_REMARKS_X)
            rows.append((left, mid, right))
    return rows


def pdf_text(path):
    """The boundary column only, one line per printed line."""
    return '\n'.join(left for left, _, _ in pdf_columns(path))


# --- coordinates -------------------------------------------------------------
# Three spellings appear, sometimes in the same document:
#   325141N 0350521E     (DDMMSS)
#   32°19'17"N 34°37'14"E
#   3306N 03506E         (DDMM, the FIR outline)
DMS = re.compile(r"(\d{2})(\d{2})(\d{2})N\s*0?(\d{2,3})(\d{2})(\d{2})E")
DMS_SYM = re.compile(r"(\d{1,2})°\s*(\d{1,2})'\s*(\d{1,2})\"?N\s*0?(\d{1,3})°\s*(\d{1,2})'\s*(\d{1,2})\"?E")
DM = re.compile(r"\b(\d{2})(\d{2})N\s*0?(\d{2,3})(\d{2})E")


def _dms(d, m, s):
    return int(d) + int(m) / 60.0 + int(s) / 3600.0


def parse_points(text):
    """Every coordinate in `text`, in the order it is written."""
    found = []
    for m in DMS.finditer(text):
        found.append((m.start(), _dms(m.group(1), m.group(2), m.group(3)),
                      _dms(m.group(4), m.group(5), m.group(6))))
    for m in DMS_SYM.finditer(text):
        found.append((m.start(), _dms(m.group(1), m.group(2), m.group(3)),
                      _dms(m.group(4), m.group(5), m.group(6))))
    if not found:
        for m in DM.finditer(text):
            found.append((m.start(), _dms(m.group(1), m.group(2), 0),
                          _dms(m.group(3), m.group(4), 0)))
    found.sort()
    return [(round(lat, 6), round(lng, 6)) for _, lat, lng in found]


# --- arcs and circles --------------------------------------------------------
def _dest(lat, lng, bearing_deg, dist_m):
    """A point `dist_m` from (lat,lng) on `bearing_deg`. Spherical is plenty at
    these distances -- the AIP's own corners are given to the arc-second."""
    R = 6371000.0
    br = math.radians(bearing_deg)
    la1 = math.radians(lat)
    lo1 = math.radians(lng)
    la2 = math.asin(math.sin(la1) * math.cos(dist_m / R) +
                    math.cos(la1) * math.sin(dist_m / R) * math.cos(br))
    lo2 = lo1 + math.atan2(math.sin(br) * math.sin(dist_m / R) * math.cos(la1),
                           math.cos(dist_m / R) - math.sin(la1) * math.sin(la2))
    return (round(math.degrees(la2), 6), round((math.degrees(lo2) + 540) % 360 - 180, 6))


def _bearing(lat1, lng1, lat2, lng2):
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dl = math.radians(lng2 - lng1)
    y = math.sin(dl) * math.cos(p2)
    x = math.cos(p1) * math.sin(p2) - math.sin(p1) * math.cos(p2) * math.cos(dl)
    return (math.degrees(math.atan2(y, x)) + 360) % 360


def circle_ring(lat, lng, radius_m, steps=72):
    return [_dest(lat, lng, b * 360.0 / steps, radius_m) for b in range(steps)]


def arc_ring(centre, radius_m, start, end, clockwise, step_deg=2.0):
    """The points along an arc from `start` to `end` about `centre`. The AIP
    gives the two ends as ordinary corners and only names the arc between
    them, so both ends already exist in the vertex list; this fills the gap."""
    b0 = _bearing(centre[0], centre[1], start[0], start[1])
    b1 = _bearing(centre[0], centre[1], end[0], end[1])
    sweep = (b1 - b0) % 360 if clockwise else -((b0 - b1) % 360)
    n = max(2, int(abs(sweep) / step_deg))
    return [_dest(centre[0], centre[1], b0 + sweep * i / n, radius_m)
            for i in range(1, n)]


RADIUS = re.compile(r"radius\s+([\d.]+)\s*(NM|KM)", re.I)
CIRCLE = re.compile(r"A circle radius\s+([\d.]+)\s*(NM|KM)\s+centered on", re.I)
ARC = re.compile(r"(counter-clockwise|clockwise)\s+arc\s+radius\s+([\d.]+)\s*(NM|KM)\s+centered on", re.I)


def _metres(value, unit):
    return float(value) * (NM_M if unit.upper() == 'NM' else KM_M)


def build_ring(body):
    """A closed ring from one area's boundary prose, or (None, reason)."""
    if 'along' in body.lower() or 'border' in body.lower():
        return None, 'boundary follows a national border, not coordinates'

    circle = CIRCLE.search(body)
    if circle:
        pts = parse_points(body[circle.end():])
        if not pts:
            return None, 'circle with no centre'
        return circle_ring(pts[0][0], pts[0][1], _metres(circle.group(1), circle.group(2))), None

    # Vertices in written order, with arcs spliced in where the text names one.
    ring = []
    cursor = 0
    for arc in ARC.finditer(body):
        before = parse_points(body[cursor:arc.start()])
        ring.extend(before)
        after = parse_points(body[arc.end():])
        if not after or not ring:
            return None, 'arc without both ends'
        centre = after[0]
        nxt = after[1] if len(after) > 1 else ring[0]
        ring.extend(arc_ring(centre, _metres(arc.group(2), arc.group(3)),
                             ring[-1], nxt, arc.group(1).lower() == 'clockwise'))
        # The centre is not a corner: resume after it.
        m = DMS.search(body[arc.end():]) or DMS_SYM.search(body[arc.end():])
        cursor = arc.end() + (m.end() if m else 0)
    ring.extend(parse_points(body[cursor:]))

    # Dedupe consecutive repeats (the AIP repeats the first corner to close).
    out = []
    for p in ring:
        if not out or out[-1] != p:
            out.append(p)
    if len(out) > 2 and out[0] == out[-1]:
        out.pop()
    if len(out) < 3:
        return None, 'fewer than three corners'
    return out, None


# --- vertical limits ---------------------------------------------------------
FT = re.compile(r"(FL\s*\d+|\d[\d\s]*)\s*(FT)?\s*(ALT|AGL|AMSL)?", re.I)


def parse_level(token):
    t = token.strip().upper().replace(' ', '')
    if not t or t in ('GND', 'SFC'):
        return 0
    if t == 'UNL':
        return None
    fl = re.match(r"FL(\d+)", t)
    if fl:
        return int(fl.group(1)) * 100
    n = re.match(r"(\d+)", t)
    return int(n.group(1)) if n else None


def parse_limits(text):
    """"3000 FT ALT /0 FT" or "FL 400 /5000 FT ALT" -> (upper, lower)."""
    # LLP04 is printed "3000 FT ALT 0 FT/" -- the slash on the wrong side of the
    # lower figure. It is a typesetting slip in the source, not a different rule.
    m = re.search(r"(\d[\d ]*)\s*FT\s*(?:ALT|AGL|AMSL)?\s+(\d[\d ]*)\s*FT\s*/", text)
    if m:
        return parse_level(m.group(1)), parse_level(m.group(2))
    m = re.search(r"(FL\s*\d+|UNL|\d[\d ]*)\s*(?:FT)?\s*(?:ALT|AGL|AMSL)?\s*/\s*"
                  r"(FL\s*\d+|GND|\d[\d ]*)\s*(?:FT)?\s*(?:ALT|AGL|AMSL)?", text)
    if m:
        return parse_level(m.group(1)), parse_level(m.group(2))
    # The TMA sectors read "3 000 to 9 000 FT", and the lowest one starts at the ground.
    m = re.search(r"(GND|SFC|\d[\d ]*)\s*to\s*(\d[\d ]*)\s*FT", text, re.I)
    if m:
        return parse_level(m.group(2)), parse_level(m.group(1))
    return None, None


# --- ENR 5.1 -----------------------------------------------------------------
AREA_ID = re.compile(r"^\s{0,3}(LL[PRD]\d+)\b", re.M)


# --- remarks -----------------------------------------------------------------
# The remarks column carries three different things in one blob: what the area is for
# (TRG, PARACHUTE, FIRE...), when it is active ("H24", "Sun 04:00 (UTCW) - Thu 19:00
# (UTCW)"), and prose ("Habonim" parachuting area. Activated by NOTAM). A pilot deciding
# whether to route through wants them apart, so they are taken apart here rather than in
# the app -- one place to be wrong, and it is the place holding the source PDF.
ACTIVITY = ['TRG', 'MILOPS', 'MIL', 'PARACHUTE', 'FIRE', 'BALLOON', 'CIVIL', 'OTHER']
# "Sun 04:00 (UTCW) - Thu 19:00 (UTCW)" / "Sun SR - Sun SS" / "H24"
SCHEDULE = re.compile(
    r"(H24|(?:Sun|Mon|Tue|Wed|Thu|Fri|Sat)\s+(?:\d{1,2}:\d{2}(?:\s*\(UTCW\))?|SR|SS)"
    r"\s*-\s*(?:Sun|Mon|Tue|Wed|Thu|Fri|Sat)\s+(?:\d{1,2}:\d{2}(?:\s*\(UTCW\))?|SR|SS))")
QUOTED = re.compile(r'"([^"]{2,40})"')


def read_remarks(text):
    """-> (activity[], hours[], byNotam, title, prose)."""
    flat = ' '.join(text.split())
    activity = [a for a in ACTIVITY if re.search(r"\b" + a + r"\b", flat)]
    if 'MILOPS' in activity and 'MIL' in activity:
        activity.remove('MIL')                     # MILOPS already says it
    hours = []
    for m in SCHEDULE.finditer(flat):
        h = ' '.join(m.group(1).split())
        if h not in hours:
            hours.append(h)
    quoted = QUOTED.search(flat)
    prose = flat
    for token in activity:
        prose = re.sub(r"\b" + token + r"\b", ' ', prose)
    for h in hours:
        prose = prose.replace(h, ' ')
    # Removing the schedule and the activity words leaves their separators behind, and a
    # note that reads "; ; ; IDF/AF Training Areas" is a parser's leftovers, not prose.
    prose = '; '.join(p for p in (' '.join(x.split()) for x in prose.split(';'))
                      if p and re.search(r"[A-Za-z0-9]", p) and p not in ('/0', '/'))
    return {
        'activity': activity,
        'hours': hours,
        'byNotam': bool(re.search(r"activated by NOTAM", flat, re.I)),
        'title': quoted.group(1) if quoted else '',
        'prose': prose,
    }


def ring_area_nm2(ring):
    """Planar shoelace in nautical miles. Good to a fraction of a percent at this
    latitude, and it is a sense of scale rather than a survey."""
    lat0 = sum(p[0] for p in ring) / len(ring)
    k = math.cos(math.radians(lat0))
    total = 0.0
    for i in range(len(ring)):
        x1, y1 = ring[i][1] * 60 * k, ring[i][0] * 60
        x2, y2 = ring[(i + 1) % len(ring)][1] * 60 * k, ring[(i + 1) % len(ring)][0] * 60
        total += x1 * y2 - x2 * y1
    return round(abs(total) / 2, 1)


def read_enr51(rows):
    """rows = pdf_columns(ENR 5.1). An area starts where the boundary column
    opens with its identifier; its limits and remarks are the other two columns
    of the same lines, which is why the columns were kept apart."""
    areas, skipped = [], []
    kind = 'prohibited'
    blocks = []                     # (ident, kind, boundary, limits, remarks)
    for left, mid, right in rows:
        head = re.match(r"\s*(LL[PRD]\d+)\b", left)
        section = re.match(r"\s*\d+\.\s+(PROHIBITED|RESTRICTED|DANGER) AREAS", left)
        if section:
            kind = section.group(1).lower()
            continue
        if head:
            # The identifier line's tail is kept apart: when the column edge falls in
            # the wrong place, the upper figure is printed there rather than in the
            # limits column, and further down this same column is only coordinates.
            blocks.append([head.group(1), kind, left[head.end():], mid, right, left[head.end():],
                           [(mid + ' ' + right).strip()]])
            continue
        if blocks:
            blocks[-1][2] += ' ' + left
            blocks[-1][3] += ' ' + mid
            blocks[-1][4] += ' ' + right
            blocks[-1][6].append((mid + ' ' + right).strip())

    seen = set()
    for ident, kind, boundary, limits, remarks, head_line, note_lines in blocks:
        if ident in seen:           # LLP05 is printed twice; keep the first
            continue
        ring, why = build_ring(boundary)
        if ring is None:
            skipped.append((ident, why))
            continue
        seen.add(ident)
        # The column edge is not the same on every page: sometimes the upper figure
        # sits with the boundary text and only "FT ALT /0 FT" lands in the middle
        # column. Read both, from the head of the block only -- past the first line
        # the boundary column is coordinates, which no level pattern matches anyway.
        upper, lower = parse_limits(head_line + ' ' + limits)
        # Remarks straddle the same moving edge: LLR500's "Sun 04:00" prints in the
        # limits column and the rest of its schedule in the remarks one, so read both
        # and strike out the vertical limits rather than losing half a schedule.
        blob = re.sub(r"(FL\s*\d+|UNL|\d[\d ]*)\s*(?:FT)?\s*(?:ALT|AGL|AMSL)?\s*/\s*"
                      r"(FL\s*\d+|GND|\d[\d ]*)\s*(?:FT)?\s*(?:ALT|AGL|AMSL)?", ' ',
                      ' | '.join(l for l in note_lines if l.strip()))
        # What is left of a line once the vertical limits are struck out is often nothing
        # at all -- the limits are printed once and the rest of the column is blank -- so
        # drop the empty pieces before joining, or the note reads "; ; ; IDF/AF Training".
        blob = re.sub(r"\b(FT|ALT|AGL|AMSL)\b", ' ', blob)
        pieces = [' '.join(p.split()) for p in blob.split('|')]
        pieces = [p for p in pieces if p and re.search(r"[A-Za-z0-9]", p) and p not in ('/0', '/')]
        blob = '; '.join(pieces)
        r = read_remarks(blob)
        areas.append({
            'id': ident,
            'kind': kind,
            'name': (r['title'] + ' (' + ident + ')') if r['title'] else ident,
            'upperFt': upper,
            'lowerFt': lower,
            'activity': r['activity'],
            'hours': r['hours'],
            'byNotam': r['byNotam'],
            'notes': r['prose'],
            'areaNm2': ring_area_nm2(ring),
            'source': 'AIP ENR 5.1',
            'ring': ring,
        })
    return areas, skipped


# --- ENR 2.1 (TMA sectors) ---------------------------------------------------
SECTOR = re.compile(r"^\s*([A-Z][A-Za-z \-]+Sector):\s*$", re.M)


def parse_band(text):
    """The TMA sectors' own spelling: "3 000 to 9 000 FT", "GND to 9 000 FT"."""
    m = re.search(r"(GND|SFC|\d[\d ]*)\s*to\s*(\d[\d ]*)\s*FT", text, re.I)
    if not m:
        return None, None
    return parse_level(m.group(2)), parse_level(m.group(1))


# The TMA's frequencies: who to call to cross it, which is the question a controlled
# airspace raises. They are printed once for the whole TMA, above the sector list, so
# every sector carries the same set.
FREQ = re.compile(r"(\d{3}\.\d{2,3})\s*MHZ(?:\s*/\s*(\w+))?", re.I)


CONTROL = re.compile(r"((?:APP/DEP|TMA|[A-Z][A-Za-z\-]*)\s+control)")


def read_tma_stations(rows, upto):
    """Frequency, and which position answers on it.

    The position is named on its own line ("APP/DEP control", "TMA control") and its
    frequencies print beside and below it, so each frequency takes the nearest named
    position in either direction. Scraping the words next to the number instead gave
    labels like "/APP ENG", which is the table's layout rather than a call sign."""
    freqs, controls, seen = [], [], set()
    for i, (left, mid, right) in enumerate(rows[:upto]):
        line = ' '.join((left + ' ' + mid + ' ' + right).split())
        c = CONTROL.search(line)
        if c:
            controls.append((i, c.group(1)))
        for m in FREQ.finditer(line):
            mhz = m.group(1)
            if mhz in seen:
                continue
            seen.add(mhz)
            freqs.append((i, mhz, (m.group(2) or '').capitalize()))
    out = []
    for i, mhz, purpose in freqs:
        name = ''
        if controls:
            name = min(controls, key=lambda c: abs(c[0] - i))[1]
        out.append({'mhz': mhz, 'name': name, 'purpose': purpose})
    return out


def read_enr21(rows):
    text = '\n'.join(left for left, _, _ in rows)
    areas, skipped = [], []
    tma = text.find('2.               TMA')
    if tma < 0:
        tma = text.find('TMA')
    body = text[tma:]
    marks = [(m.start(), m.group(1).strip()) for m in SECTOR.finditer(body)]
    # Everything printed above the first sector heading is the TMA's own header block.
    first_sector_line = next((i for i, (left, _, _) in enumerate(rows)
                              if SECTOR.match(left.strip() + '\n')), len(rows))
    # ...starting at the "2. TMA" heading: everything above it belongs to the FIR and its
    # sectors, whose frequencies are a different answer to a different question.
    tma_line = next((i for i, (left, _, _) in enumerate(rows)
                     if re.match(r"^\s*2\.\s+TMA\s*$", left)), 0)
    stations = read_tma_stations(rows[tma_line:first_sector_line], first_sector_line - tma_line)
    for i, (pos, name) in enumerate(marks):
        end = marks[i + 1][0] if i + 1 < len(marks) else len(body)
        chunk = body[pos:end]
        ring, why = build_ring(chunk)
        if ring is None:
            skipped.append(('Ben-Gurion TMA / ' + name, why))
            continue
        # Only the "2 000 to 8 000 FT" form here. The generic reader would otherwise
        # find the page footer's "AIRAC AMDT 003/2023" and report a sector running from
        # 2023 ft to 3 ft, which is both wrong and the kind of wrong that looks like data.
        upper, lower = parse_band(chunk)
        # A label on a chart has to fit on a chart: "BG TMA W" beats a truncated
        # "LLBG-TMA-WESTERNSECTO", which is what a sliced identifier looks like.
        words = [w for w in name.replace('Sector', '').split() if w]
        short = 'BG TMA ' + ''.join(w[0] for w in words).upper()
        areas.append({
            'id': 'LLBG-TMA-' + re.sub(r'[^A-Za-z]', '', name).upper()[:12],
            'short': short,
            'kind': 'tma',
            'name': 'Ben-Gurion TMA — ' + name,
            'upperFt': upper,
            'lowerFt': lower,
            'activity': [],
            'hours': ['H24'],
            'byNotam': False,
            'notes': '',
            'areaNm2': ring_area_nm2(ring),
            'source': 'AIP ENR 2.1',
            'stations': stations,
            'ring': ring,
        })
    return areas, skipped


def main():
    write = '--write' in sys.argv
    for p in (ENR51, ENR21):
        if not p.exists():
            print('missing: %s' % p, file=sys.stderr)
            return 2

    p_areas, p_skip = read_enr51(pdf_columns(ENR51))
    t_areas, t_skip = read_enr21(pdf_columns(ENR21))
    areas = p_areas + t_areas
    skipped = p_skip + t_skip

    by_kind = {}
    for a in areas:
        by_kind[a['kind']] = by_kind.get(a['kind'], 0) + 1
    print('read %d areas: %s' % (len(areas), by_kind))
    if skipped:
        print('left out (%d):' % len(skipped))
        for ident, why in skipped:
            print('  %-28s %s' % (ident, why))

    missing_limits = [a['id'] for a in areas if a['upperFt'] is None and a['lowerFt'] is None]
    if missing_limits:
        print('no vertical limits read: %s' % ', '.join(missing_limits))

    if write:
        doc = {
            'version': 1,
            'source': ('CAAI AIP ENR 5.1 (prohibited / restricted, 22 FEB 2024) and '
                       'ENR 2.1 (FIR, TMA, 06 AUG 2026), read by scripts/extract-airspace.py. '
                       'Areas whose boundary the AIP describes in prose rather than coordinates '
                       '(national borders) are deliberately absent -- see the script.'),
            'generatedBy': 'scripts/extract-airspace.py',
            'areas': areas,
        }
        OUT.write_text(json.dumps(doc, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
        print('wrote %s' % OUT.relative_to(ROOT))
    return 0


if __name__ == '__main__':
    sys.exit(main())
