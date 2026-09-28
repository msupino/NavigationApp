// The CVFR chart, inside the APK, for the zooms a pilot actually flies it at.
//
// A pilot who opens the app for the first time in the aeroplane, or whose phone never sat on
// Wi-Fi long enough for the offline download, still gets the chart. z7-z12 (~2,800 tiles,
// ~25 MB) is the chart from "all of Israel" down to the 1:250,000 print read comfortably on a
// phone; z13 (4x that again) stays a Wi-Fi download (Extra layers -> Download charts for
// offline).
//
// Only the native package carries them -- `npm run embed`, never the over-the-air zip. On first
// launch docs/app/native-tiles.js copies them into the same on-device store the offline
// download fills, so an update bundle that replaces www/ does not take the chart with it.
//
// Tiles are fetched from our mirror once and kept in mobile/.chart-cache (not committed), so
// rebuilding the APK does not download them again.
import fs from 'node:fs';
import path from 'node:path';
import { mobileRoot } from './bundle-web.mjs';

// Same box as FM_BOUNDS in docs/app/core.js: what the published chart tiles cover.
export const CVFR = {
  name: 'CVFR',
  base: 'https://navaid-tiles.supino.org/CVFR',
  bounds: { south: 28.3, west: 33.75, north: 34.3, east: 36.5625 },
  minZoom: 7,
  maxZoom: 12,
};
const cacheDir = path.join(mobileRoot, '.chart-cache');

// Same tiles offline-tiles.js offlineTileList() lists.
export function tileList(bounds, zMin, zMax) {
  const out = [];
  const yFrac = (lat) => {
    const r = lat * Math.PI / 180;
    return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2;
  };
  for (let z = zMin; z <= zMax; z++) {
    const n = 2 ** z;
    const x0 = Math.max(0, Math.floor((bounds.west + 180) / 360 * n));
    const x1 = Math.min(n - 1, Math.floor((bounds.east + 180) / 360 * n));
    const y0 = Math.max(0, Math.floor(yFrac(bounds.north) * n));
    const y1 = Math.min(n - 1, Math.floor(yFrac(bounds.south) * n));
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) out.push({ z, x, y });
  }
  return out;
}

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const isPng = (data) => data.length > PNG.length && data.subarray(0, PNG.length).equals(PNG);
const readOrNull = (file) => {
  try { return fs.readFileSync(file); } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchTile(chart, { z, x, y }) {
  // Numbers only, from tileList(): the cache path cannot be steered anywhere else.
  if (![z, x, y].every(Number.isInteger)) throw new Error('bad tile coordinates');
  const rel = `${z}/${x}/${y}.png`;
  const hit = path.join(cacheDir, chart.name, rel);
  const cached = readOrNull(hit);
  if (cached) return cached;
  if (readOrNull(hit + '.none')) return null;
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      const res = await fetch(`${chart.base}/${rel}`);
      fs.mkdirSync(path.dirname(hit), { recursive: true });
      // No tile there (sea, the edge of the chart): the app shows nothing there either.
      if (res.status === 404) { fs.writeFileSync(hit + '.none', 'none'); return null; }
      // The mirror rate-limits a burst: back off and try again rather than fail the build.
      if (res.status === 429 || res.status >= 500) throw new Error('HTTP ' + res.status);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = Buffer.from(await res.arrayBuffer());
      // Only a PNG goes into the app: an error page served with a 200 would otherwise be
      // packed as a chart tile.
      if (!isPng(data)) throw new Error('not a PNG');
      fs.writeFileSync(hit, data);
      return data;
    } catch (e) {
      if (attempt === 5) throw new Error(`${chart.base}/${rel}: ${e.message}`);
      await sleep(1000 * 2 ** attempt);
    }
  }
  return null;
}

export async function bundleCharts(wwwDir, chart = CVFR) {
  const tiles = tileList(chart.bounds, chart.minZoom, chart.maxZoom);
  const outDir = path.join(wwwDir, 'charts', chart.name.toLowerCase());
  fs.rmSync(outDir, { recursive: true, force: true });
  const kept = [];
  let bytes = 0;
  let next = 0;
  const worker = async () => {
    while (next < tiles.length) {
      const t = tiles[next++];
      const data = await fetchTile(chart, t);
      if (!data) continue;
      const dest = path.join(outDir, `${t.z}/${t.x}/${t.y}.png`);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, data);
      kept.push(`${t.z}/${t.x}/${t.y}`);
      bytes += data.length;
    }
  };
  await Promise.all(Array.from({ length: 8 }, worker));
  kept.sort();
  fs.writeFileSync(path.join(outDir, 'index.json'), JSON.stringify({
    chart: chart.name, base: chart.base, minZoom: chart.minZoom, maxZoom: chart.maxZoom, tiles: kept,
  }) + '\n');
  return { tiles: kept.length, bytes };
}
