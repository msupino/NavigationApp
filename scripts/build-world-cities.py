#!/usr/bin/env python3
"""Add major cities to docs/data/world-countries.json, the always-offline world map.

Source: Natural Earth 1:10m populated places (public domain),
https://github.com/nvkelso/natural-earth-vector/blob/master/geojson/ne_10m_populated_places.geojson

Kept: every national capital and every place of a million people or more -- about 600 -- with
its English and Hebrew name, its position (0.01 degree), whether it is a capital, and Natural
Earth's scale rank (0 = shown first), which says how far out the map shows it.

Usage: python3 scripts/build-world-cities.py path/to/ne_10m_populated_places.geojson
"""
import json
import sys

MIN_POP = 1_000_000


def main(src, dst='docs/data/world-countries.json'):
    places = json.load(open(src, encoding='utf-8'))['features']
    cities = []
    for f in places:
        p = f['properties']
        capital = p.get('ADM0CAP') == 1
        if not capital and (p.get('POP_MAX') or 0) < MIN_POP:
            continue
        en = p.get('NAME_EN') or p.get('NAME')
        cities.append({
            'en': en,
            'he': p.get('NAME_HE') or en,
            'at': [round(p['LATITUDE'], 2), round(p['LONGITUDE'], 2)],
            'rank': p.get('SCALERANK', 8),
            **({'cap': 1} if capital else {}),
        })
    # Most important first: the order they are drawn in, so a big city's name wins an overlap.
    cities.sort(key=lambda c: (c['rank'], -c.get('cap', 0), c['en']))
    world = json.load(open(dst, encoding='utf-8'))
    world['version'] = 2
    world['cities'] = cities
    world['citiesSource'] = ('Natural Earth 1:10m populated places (public domain): '
                             'national capitals and places of 1,000,000 people or more')
    with open(dst, 'w', encoding='utf-8') as fh:
        json.dump(world, fh, ensure_ascii=False, separators=(',', ':'))
    print(len(cities), 'cities')


if __name__ == '__main__':
    main(*sys.argv[1:])
