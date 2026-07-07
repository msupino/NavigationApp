/* NavAid — terrain elevation grid for minimum-safe-altitude (MSA / terrain
 * clearance), issue #673.
 *
 * SAFETY: this is a planning aid only, NOT a terrain-avoidance system. MSA is
 * computed from a coarse elevation grid plus a fixed clearance buffer; it can
 * be wrong or incomplete. Always verify against current official charts.
 *
 * DATA: docs/data/terrain.json. Until a real DEM is supplied the bundled file
 * has `"coverage": false`, so the app shows no MSA at all (never a false
 * "safe" value). Expected format:
 *   {
 *     "coverage": true,
 *     "units": "m",                 // "m" or "ft" — elevation units of `data`
 *     "south": 29.4, "west": 34.2,  // grid bounding box (deg, WGS84)
 *     "north": 33.4, "east": 35.9,
 *     "rows": R, "cols": C,         // grid dimensions
 *     "data": [[...C...], ...R...]  // MAX elevation per cell; row 0 = NORTH
 *   }                               // edge, column 0 = WEST edge.
 */
var terrainGrid = null;             // null = not loaded; {coverage:false} = none
var TERRAIN_URL = (typeof window !== 'undefined' && window.S && window.S.terrainUrl) ||
  'data/terrain.json?v=1';
const M_TO_FT = 3.28084;

function loadTerrain() {
  if (terrainGrid !== null) return Promise.resolve(terrainGrid);
  return fetch(TERRAIN_URL).then(r => (r.ok ? r.json() : null)).then(j => {
    terrainGrid = (j && j.coverage && Array.isArray(j.data) &&
      j.rows > 0 && j.cols > 0) ? j : { coverage: false };
    return terrainGrid;
  }).catch(() => { terrainGrid = { coverage: false }; return terrainGrid; });
}
function terrainHasCoverage() { return !!(terrainGrid && terrainGrid.coverage); }

// Max terrain elevation (ft) of the grid cell containing lat/lng, or null when
// out of coverage.
function terrainMaxAtLatLng(lat, lng) {
  const g = terrainGrid;
  if (!g || !g.coverage) return null;
  if (lat < g.south || lat > g.north || lng < g.west || lng > g.east) return null;
  const latStep = (g.north - g.south) / g.rows;
  const lngStep = (g.east - g.west) / g.cols;
  let r = Math.floor((g.north - lat) / latStep);   // row 0 = north edge
  let c = Math.floor((lng - g.west) / lngStep);     // col 0 = west edge
  r = Math.max(0, Math.min(g.rows - 1, r));
  c = Math.max(0, Math.min(g.cols - 1, c));
  // Clamp to the ACTUAL array too: if data is ragged / doesn't match rows×cols,
  // index the nearest real cell rather than reading past the end (undefined →
  // null, which made MSA silently vanish for edge legs).
  if (!Array.isArray(g.data) || !g.data.length) return null;
  if (r > g.data.length - 1) r = g.data.length - 1;
  const row = g.data[r] || [];
  if (c > row.length - 1) c = row.length - 1;
  const v = row[c];
  if (v == null || !Number.isFinite(v)) return null;
  return g.units === 'm' ? v * M_TO_FT : v;
}

// Max terrain elevation (ft) sampled along the great-circle-ish straight leg
// A→B, or null when the route leaves coverage.
function terrainMaxAlongLeg(a, b) {
  if (!a || !b || !terrainHasCoverage()) return null;
  const N = 64;
  let max = null;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const e = terrainMaxAtLatLng(a.lat + (b.lat - a.lat) * t, a.lng + (b.lng - a.lng) * t);
    if (e != null) max = (max == null) ? e : Math.max(max, e);
  }
  return max;
}

// Minimum safe altitude (ft) for leg i = round((maxTerrain + buffer)/100)*100,
// or null when terrain coverage is unavailable for the leg.
// Round to the NEAREST 100 ft (not up) so the coarse grid + buffer don't push
// MSA a full 100 ft above the charted altitude on a single foot of terrain
// (e.g. 501 ft terrain + 1000 buffer = 1501 → 1500, not 1600).
function legMsaFt(i) {
  if (typeof state === 'undefined' || !state.waypoints) return null;
  const A = state.waypoints[i], B = state.waypoints[i + 1];
  const t = terrainMaxAlongLeg(A, B);
  if (t == null) return null;
  return Math.round((t + tune('msaBufferFt')) / 100) * 100;
}

if (typeof window !== 'undefined') {
  window.loadTerrain = loadTerrain;
  window.terrainHasCoverage = terrainHasCoverage;
  window.terrainMaxAtLatLng = terrainMaxAtLatLng;
  window.terrainMaxAlongLeg = terrainMaxAlongLeg;
  window.legMsaFt = legMsaFt;
}
