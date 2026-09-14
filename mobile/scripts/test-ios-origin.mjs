import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = fs.readFileSync(path.join(root, 'ios/App/App/AppDelegate.swift'), 'utf8');
const method = source.slice(source.indexOf('    static func isTrustedAppURL('), source.indexOf('    private func findBridge('));
if (!method.includes('static func')) throw new Error('Native origin policy missing');
const cases = [
  ['https://navaid.supino.org/', true],
  ['https://navaid.supino.org/?lang=he', true],
  ['capacitor://localhost/', true],
  ['capacitor://localhost/index.html?lang=he', true],
  ['https://navaid.supino.org/staging/', false],
  ['https://navaid.supino.org/pr/2286/', false],
  ['capacitor://localhost/staging/', false],
  ['capacitor://localhost/pr/2286/', false],
  ['capacitor://localhost:123/', false],
  ['capacitor://user@localhost/', false],
  ['capacitor://example.org/', false],
  ['https://navaid.supino.org.evil.example/', false],
  ['http://navaid.supino.org/', false],
];
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'navaid-ios-origin-'));
try {
  const file = path.join(temp, 'main.swift');
  fs.writeFileSync(file, 'import Foundation\nstruct Policy {\n' + method + '\n}\n' +
    cases.map(([url, expected]) => `assert(Policy.isTrustedAppURL(URL(string: ${JSON.stringify(url)})!) == ${expected}, ${JSON.stringify(url)})`).join('\n'));
  execFileSync('swift', [file], { stdio: 'inherit' });
  console.log(cases.length + ' native origin policy cases passed');
} finally { fs.rmSync(temp, { recursive: true, force: true }); }
