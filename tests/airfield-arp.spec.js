// @ts-check
// Keeps `tests/_airfieldArp.js` aligned with `docs/airfields.json` (no browser).
const { test, expect } = require('./_setup');
const data = require('../docs/airfields.json');
const { arp, pairLLHZ_LLHA } = require('./_airfieldArp');

test.describe('_airfieldArp', () => {
  test('ARP objects match docs/airfields.json', () => {
    for (const code of ['LLHZ', 'LLHA', 'LLBG']) {
      const j = data.airfields.find(a => a.name === code);
      expect(j).toBeTruthy();
      expect(arp(code).lat).toBe(j.lat);
      expect(arp(code).lng).toBe(j.lng);
    }
  });

  test('pairLLHZ_LLHA preserves ICAO labels', () => {
    const p = pairLLHZ_LLHA();
    expect(p.map(w => w.name)).toEqual(['LLHZ', 'LLHA']);
  });
});
