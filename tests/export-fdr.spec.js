// #701 — X-Plane FDR export. DATA rows are fixed-column; verify each value
// lands in its required position (regression: the first version shifted them).
const { test, expect } = require('./_setup');

async function boot(page) {
  await page.goto('?lang=en');
  await page.waitForFunction(() => typeof state !== 'undefined' &&
    typeof exportFdr === 'function' && typeof syncLegs === 'function');
  // Capture the generated file text instead of downloading it.
  await page.evaluate(() => {
    URL.createObjectURL = (blob) => { window.__fdrBlob = blob; return 'blob:stub'; };
    URL.revokeObjectURL = () => {};
    HTMLAnchorElement.prototype.click = function () { /* swallow download nav */ };
    window.__readFdr = async () => window.__fdrBlob ? await window.__fdrBlob.text() : null;
  });
}

test('FDR DATA rows place values in the fixed X-Plane columns', async ({ page }) => {
  await boot(page);
  const text = await page.evaluate(async () => {
    state.waypoints = [{ lat: 32.0, lng: 34.8, name: 'LLHZ' },
                       { lat: 32.5, lng: 35.0, name: 'LLIB' }];
    state.legs = []; syncLegs();
    state.legs[0].flightSpeed = 110;
    state.legs[0].inboundAltitude = 4500;
    exportFdr();
    return window.__readFdr();
  });
  expect(text).toBeTruthy();
  const lines = text.split('\n');
  // V3 header: 'A' / '3' version lines (X-Plane 12 rejects the header-less
  // legacy layout as "Old, non-supported FDR format").
  expect(lines[0]).toBe('A');
  expect(lines[1]).toBe('3');
  // No ACFT line — replays on the loaded aircraft (an unresolved .acf path
  // makes X-Plane error "unknown aircraft").
  expect(text).not.toContain('ACFT,');
  expect(text).toContain('TAIL,');

  const dataLines = lines.filter(l => l.startsWith('DATA,'));
  expect(dataLines.length).toBeGreaterThan(10);
  const cols = dataLines[0].replace(/^DATA,\s*/, '').split(',');
  // V3 compact columns (0-indexed): 0 time, 1 lon, 2 lat, 3 alt, 4 hdg, 5 pitch, 6 roll.
  expect(parseFloat(cols[1])).toBeCloseTo(34.8, 1);        // longitude
  expect(parseFloat(cols[2])).toBeCloseTo(32.0, 1);        // latitude
  expect(parseFloat(cols[3])).toBeGreaterThan(2000);       // altitude MSL ft
  // Heading (col 5, index 4) must be a valid 0–360 bearing, NOT the altitude —
  // the bug X-Plane flagged as "Out of range FDR-file heading … 2000".
  const hdg = parseFloat(cols[4]);
  expect(hdg).toBeGreaterThanOrEqual(0);
  expect(hdg).toBeLessThan(360);
  expect(hdg).toBeGreaterThan(0);
  expect(hdg).toBeLessThan(90);                            // this NE leg ≈ 13°
});

test('FDR altitude rises toward the planned leg altitude', async ({ page }) => {
  await boot(page);
  const alts = await page.evaluate(async () => {
    state.waypoints = [{ lat: 32.0, lng: 34.8, name: 'A' }, { lat: 32.6, lng: 35.1, name: 'B' }];
    state.legs = []; syncLegs();
    state.legs[0].flightSpeed = 100;
    state.legs[0].inboundAltitude = 5000;
    exportFdr();
    const text = await window.__readFdr();
    return text.split('\n').filter(l => l.startsWith('DATA,'))
      .map(l => parseFloat(l.replace(/^DATA,\s*/, '').split(',')[3]));
  });
  // Column 4 (index 3) is altitude MSL — should reach the planned 5000 ft.
  expect(Math.max(...alts)).toBeGreaterThan(4900);
  expect(Math.max(...alts)).toBeLessThan(5100);
});

test('FDR replay reaches an exact out-and-back turning waypoint', async ({ page }) => {
  await boot(page);
  const rows = await page.evaluate(async () => {
    state.waypoints = [
      { lat: 32.0, lng: 34.8, name: 'A' },
      { lat: 32.2, lng: 34.8, name: 'TURN' },
      { lat: 32.0, lng: 34.8, name: 'A' },
    ];
    state.legs = [];
    syncLegs();
    state.legs.forEach(leg => {
      leg.flightSpeed = 90;
      leg.inboundAltitude = 3000;
    });
    exportFdr();
    const text = await window.__readFdr();
    return text.split('\n').filter(line => line.startsWith('DATA,'))
      .map(line => line.replace(/^DATA,\s*/, '').split(',').map(Number));
  });

  expect(rows.length).toBeGreaterThan(900);
  expect(Math.max(...rows.map(row => row[2]))).toBeGreaterThan(32.1995);
  const last = rows[rows.length - 1];
  expect(last[1]).toBeCloseTo(34.8, 4);
  expect(last[2]).toBeCloseTo(32.0, 4);
  expect(last[0]).toBeGreaterThan(900);
  expect(rows.every(row => row.every(Number.isFinite))).toBe(true);
  expect(rows.every(row => row[4] >= 0 && row[4] < 360)).toBe(true);
});
