// @ts-check
// The zip the embedded app downloads, and the manifest that points at it.
//
// Written by hand rather than by a dependency: this sits between a fix and a pilot's phone,
// and the format is forty years old and four fields wide. That is only defensible if it is
// actually checked -- a zip with a wrong CRC installs and then fails to open, which on a
// phone looks like the app breaking itself.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { test, expect } = require('./_setup');

const repoRoot = path.join(__dirname, '..');

test('the zip writer produces a zip other tools agree with', async () => {
  const ota = await import('../mobile/scripts/build-ota.mjs');
  // The check value every CRC-32 implementation is tested against.
  expect(ota.crc32(Buffer.from('123456789'))).toBe(0xcbf43926);

  const zip = ota.zipFiles([
    { name: 'index.html', data: Buffer.from('<!doctype html><title>NavAid</title>') },
    { name: 'app/core.js', data: Buffer.from('var x = 1;\n'.repeat(500)) },
    { name: 'i18n/he/strings.js', data: Buffer.from('// עברית\n') },
  ]);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'navaid-ota-'));
  try {
    const file = path.join(dir, 'bundle.zip');
    fs.writeFileSync(file, zip);
    // Python's zipfile, not ours: testzip() verifies every entry's CRC against its data.
    const report = execFileSync('python3', ['-c', [
      'import json, sys, zipfile',
      'z = zipfile.ZipFile(sys.argv[1])',
      'print(json.dumps({',
      '  "bad": z.testzip(),',
      '  "names": z.namelist(),',
      '  "index": z.read("index.html").decode(),',
      '  "hebrew": z.read("i18n/he/strings.js").decode("utf-8"),',
      '  "compressed": z.getinfo("app/core.js").compress_size < z.getinfo("app/core.js").file_size,',
      '}))',
    ].join('\n'), file], { encoding: 'utf8' });
    const got = JSON.parse(report);
    expect(got.bad, 'a CRC in the zip does not match its data').toBeNull();
    // index.html at the ROOT: the plugin looks for it there, and a bundle nested one
    // directory deep installs and then fails to load with nothing to say about why.
    expect(got.names[0]).toBe('index.html');
    expect(got.index).toContain('NavAid');
    expect(got.hebrew).toContain('עברית');     // UTF-8 survives the round trip
    expect(got.compressed, 'entries are stored, not deflated').toBe(true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the same bundle twice is the same bytes', async () => {
  const ota = await import('../mobile/scripts/build-ota.mjs');
  const entries = [{ name: 'index.html', data: Buffer.from('same') }];
  // Timestamps are fixed on purpose: a manifest checksum that changes because the clock
  // moved would ship an "update" that is the bundle already running.
  expect(ota.zipFiles(entries).equals(ota.zipFiles(entries))).toBe(true);
});

test('the served manifest reads as "nothing to update" until one is published', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(repoRoot, 'docs/ota/manifest.json'), 'utf8'));
  // The client requires all three as strings, so nulls are a no-op rather than a broken
  // download -- and the file has to exist, or every launch logs a 404 at the relay.
  expect(manifest.version).toBeNull();
  expect(manifest.url).toBeNull();
  expect(manifest.checksum).toBeNull();
  expect(manifest.note, 'say why it is empty, for whoever finds it').toMatch(/build-ota/);
});

test('the OTA zip is never committed', () => {
  const ignore = fs.readFileSync(path.join(repoRoot, '.gitignore'), 'utf8');
  expect(ignore).toMatch(/^build\/$/m);
  const tracked = execFileSync('git', ['ls-files', 'build/', 'mobile/www/'],
    { cwd: repoRoot, encoding: 'utf8' }).trim();
  expect(tracked, 'a generated bundle is in the repo').toBe('');
});
