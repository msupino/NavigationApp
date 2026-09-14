import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

const app = process.argv[2];
assert(app, 'Usage: node scripts/verify-ios-app.mjs /path/to/App.app');
const config = JSON.parse(fs.readFileSync(path.join(app, 'capacitor.config.json'), 'utf8'));
assert.equal(config.webDir, 'www', 'App Store binary must use the embedded bundle');
assert.equal(config.server?.url, undefined, 'App Store binary must not load a remote app');
const privacy = fs.readFileSync(path.join(app, 'PrivacyInfo.xcprivacy'), 'utf8');
assert(privacy.includes('NSPrivacyAccessedAPITypes'), 'App privacy manifest is missing required-reason declarations');
const publicDir = path.join(app, 'public');
const html = fs.readFileSync(path.join(publicDir, 'index.html'), 'utf8');
assert(html.includes('window.__navaidEmbedded = true'), 'Missing embedded runtime marker');
assert(!['https://unpkg.com/', 'https://cdn.jsdelivr.net/'].some(url => html.includes(url)),
  'App still needs CDN dependencies');
for (const match of html.matchAll(/'(app\/[\w-]+\.js)'\s*\+\s*v/g)) {
  assert(fs.existsSync(path.join(publicDir, match[1])), 'Missing app module: ' + match[1]);
}
const manifest = JSON.parse(fs.readFileSync(path.join(publicDir, 'vendor/manifest.json'), 'utf8'));
for (const asset of manifest) {
  const data = fs.readFileSync(path.join(publicDir, 'vendor', asset.path));
  assert.equal('sha384-' + createHash('sha384').update(data).digest('base64'), asset.integrity, asset.path);
}
console.log('Embedded iOS app verified: privacy manifest, local scripts and pinned vendor assets.');
