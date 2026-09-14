#!/usr/bin/env node
// Build the over-the-air bundle the embedded iOS app downloads.
//
// The App Store build carries the web app inside the binary, so a web deploy does not reach
// it. This packs the same bundle as a zip and writes the manifest docs/app/ota.js reads --
// guideline 2.5.2 permits updating the interpreted code a WebView runs, and nothing else
// here is native.
//
//   node scripts/build-ota.mjs                    # zip + manifest into build/ota
//   node scripts/build-ota.mjs --version 1.0-ab12cd
//   node scripts/build-ota.mjs --base-url https://github.com/.../releases/download/ota-1.0-ab12cd
//
// The zip is ~28 MB and is NOT committed: upload it as a release asset and commit only the
// manifest, which is what the app fetches. `mobile/appstore/README.md` has the two commands.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { copyBundle, wwwDir, walk, repoRoot } from './bundle-web.mjs';

export const outDir = path.join(repoRoot, 'build', 'ota');
export const manifestPath = path.join(repoRoot, 'docs', 'ota', 'manifest.json');

// A CRC-32 table, because a zip entry carries one and nothing in the standard library will
// produce it. Same polynomial every zip uses.
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

export function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

// A minimal zip writer: deflated entries, local headers, central directory, end record.
// A dependency would do this, and one more dependency in a release path is one more thing
// that can go wrong between a fix and a pilot's phone -- the format is forty years old and
// four fields wide.
export function zipFiles(entries) {
  const chunks = [];
  const central = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, 'utf8');
    const deflated = zlib.deflateRawSync(data, { level: 9 });
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);            // version needed
    local.writeUInt16LE(0, 6);             // flags
    local.writeUInt16LE(8, 8);             // deflate
    local.writeUInt16LE(0, 10);            // time  -- fixed, so the zip is reproducible
    local.writeUInt16LE(0x21, 12);         // date  -- 1980-01-01
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(deflated.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    chunks.push(local, nameBuf, deflated);

    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0);
    dir.writeUInt16LE(20, 4);
    dir.writeUInt16LE(20, 6);
    dir.writeUInt16LE(0, 8);
    dir.writeUInt16LE(8, 10);
    dir.writeUInt16LE(0, 12);
    dir.writeUInt16LE(0x21, 14);
    dir.writeUInt32LE(crc, 16);
    dir.writeUInt32LE(deflated.length, 20);
    dir.writeUInt32LE(data.length, 24);
    dir.writeUInt16LE(nameBuf.length, 28);
    dir.writeUInt32LE(offset, 42);
    central.push(dir, nameBuf);
    offset += local.length + nameBuf.length + deflated.length;
  }
  const centralBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...chunks, centralBuf, end]);
}

export function currentVersion() {
  try {
    return '1.0-' + execFileSync('git', ['rev-parse', '--short', 'HEAD'],
      { cwd: repoRoot, encoding: 'utf8' }).trim();
  } catch (e) { return '1.0-local'; }
}

// index.html at the ROOT of the zip: that is where the plugin looks for it, and a bundle
// nested one directory deep installs and then fails to load with nothing to say about why.
export function bundleEntries(dir = wwwDir) {
  return walk(dir).map(({ rel }) => ({
    name: rel.split(path.sep).join('/'),
    data: fs.readFileSync(path.join(dir, rel)),
  }));
}

function arg(name, fallback) {
  const at = process.argv.indexOf('--' + name);
  return at > -1 && process.argv[at + 1] ? process.argv[at + 1] : fallback;
}

function main() {
  const version = arg('version', currentVersion());
  const baseUrl = arg('base-url', 'https://github.com/msupino/NavigationApp/releases/download/ota-' + version);
  copyBundle();
  const entries = bundleEntries();
  if (!entries.some((e) => e.name === 'index.html')) {
    throw new Error('index.html is not at the root of the bundle');
  }
  const zip = zipFiles(entries);
  const name = 'navaid-' + version + '.zip';
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, name), zip);
  const manifest = {
    version,
    url: baseUrl.replace(/\/$/, '') + '/' + name,
    checksum: createHash('sha256').update(zip).digest('hex'),
    builtAt: new Date().toISOString(),
    bytes: zip.length,
  };
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  console.error('%s -- %d files, %s MB', name, entries.length, (zip.length / 1048576).toFixed(1));
  console.error('  zip:      %s', path.relative(repoRoot, path.join(outDir, name)));
  console.error('  manifest: %s (commit this)', path.relative(repoRoot, manifestPath));
  console.error('\nUpload the zip, then deploy the manifest:');
  console.error('  gh release create ota-%s %s --title "OTA %s" --notes "Web bundle for the embedded iOS app"',
    version, path.relative(repoRoot, path.join(outDir, name)), version);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main());
}
