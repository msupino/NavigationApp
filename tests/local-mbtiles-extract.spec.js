// @ts-check
const { test, expect } = require('./_setup');
const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts/local-mbtiles-server.py');
const DOCS = path.join(ROOT, 'docs');
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
  'base64'
);
const LAYERS = ['cvfr', 'nav', 'la', 'il-hel'];
const FILES = [
  'CVFR.mbtiles',
  'Israel-Navigation.mbtiles',
  'LSA-Low-Altitude.mbtiles',
  'Israel-Helicopters.mbtiles',
];

test.setTimeout(30000);

function runPython(args, opts = {}) {
  const res = spawnSync('python3', args, {
    cwd: ROOT,
    encoding: 'utf8',
    ...opts,
  });
  expect(res.status, res.stderr || res.stdout).toBe(0);
  return res;
}

function makeFixtureMbtiles(root) {
  const mbtilesDir = path.join(root, 'mbtiles');
  fs.mkdirSync(mbtilesDir, { recursive: true });
  runPython([
    '-c',
    `
import base64
import pathlib
import sqlite3
import sys

mbtiles_dir = pathlib.Path(sys.argv[1])
png = base64.b64decode(sys.argv[2])
files = sys.argv[3:]

for filename in files:
    db_path = mbtiles_dir / filename
    con = sqlite3.connect(db_path)
    con.executescript("""
        create table metadata (name text, value text);
        create table tiles (
          zoom_level integer,
          tile_column integer,
          tile_row integer,
          tile_data blob
        );
    """)
    con.execute("insert into metadata values ('format', 'png')")
    con.execute("insert into tiles values (1, 1, 0, ?)", (png,))
    con.commit()
    con.close()
`,
    mbtilesDir,
    PNG.toString('base64'),
    ...FILES,
  ]);
  return mbtilesDir;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : null;
      server.close(() => {
        if (port) resolve(port);
        else reject(new Error('No free port returned'));
      });
    });
  });
}

function getBuffer(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode} for ${url}`));
          return;
        }
        resolve(Buffer.concat(chunks));
      });
    });
    req.on('error', reject);
  });
}

async function waitForHealth(port, child, output) {
  const url = `http://127.0.0.1:${port}/healthz`;
  for (let i = 0; i < 50; i += 1) {
    if (child.exitCode !== null) {
      throw new Error(`Server exited early:\n${output()}`);
    }
    try {
      const body = await getBuffer(url);
      if (body.toString('utf8').trim() === 'ok') return;
    } catch (e) {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Server did not become healthy:\n${output()}`);
}

test.describe('local MBTiles extraction', () => {
  test('extract-only writes XYZ tile files for every local chart layer', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'navaid-mbtiles-'));
    try {
      const mbtilesDir = makeFixtureMbtiles(root);
      const tileDir = path.join(root, 'tiles');
      const first = runPython([
        SCRIPT,
        '--docs', DOCS,
        '--mbtiles-dir', mbtilesDir,
        '--tile-dir', tileDir,
        '--extract-only',
      ]);
      expect(first.stdout).toContain('Extracted cvfr: 1 written, 0 skipped, 1 total');

      for (const layer of LAYERS) {
        const tile = fs.readFileSync(path.join(tileDir, layer, '1', '1', '1.png'));
        expect(tile.equals(PNG)).toBe(true);
      }

      const second = runPython([
        SCRIPT,
        '--docs', DOCS,
        '--mbtiles-dir', mbtilesDir,
        '--tile-dir', tileDir,
        '--extract-only',
      ]);
      expect(second.stdout).toContain('Extracted il-hel: 0 written, 1 skipped, 1 total');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('server serves extracted tile files without requiring MBTiles fallback', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'navaid-mbtiles-'));
    let child;
    try {
      const mbtilesDir = makeFixtureMbtiles(root);
      const tileDir = path.join(root, 'tiles');
      runPython([
        SCRIPT,
        '--docs', DOCS,
        '--mbtiles-dir', mbtilesDir,
        '--tile-dir', tileDir,
        '--extract-only',
      ]);
      fs.rmSync(mbtilesDir, { recursive: true, force: true });

      const port = await freePort();
      let output = '';
      child = spawn('python3', [
        SCRIPT,
        '--docs', DOCS,
        '--mbtiles-dir', mbtilesDir,
        '--tile-dir', tileDir,
        '--port', String(port),
      ], { cwd: ROOT });
      child.stdout.on('data', data => { output += data.toString(); });
      child.stderr.on('data', data => { output += data.toString(); });

      await waitForHealth(port, child, () => output);
      const tile = await getBuffer(`http://127.0.0.1:${port}/tiles/la/1/1/1.png`);
      expect(tile.equals(PNG)).toBe(true);
    } finally {
      if (child) child.kill();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
