#!/usr/bin/env node
// Package the web app INSIDE the native app, instead of loading it from the site.
//
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
export const mobileRoot = path.resolve(scriptDir, '..');
export const repoRoot = path.resolve(mobileRoot, '..');
export const docsDir = path.join(repoRoot, 'docs');
export const wwwDir = path.join(mobileRoot, 'www');
export const configPath = path.join(mobileRoot, 'capacitor.config.json');

export const REMOTE_URL = 'https://navaid.supino.org';

// Directories the bundle deliberately leaves on the server. Every one of them is DATA the
// app fetches when a pilot asks for it, not part of the app: bundling them would add
// hundreds of megabytes to a download for imagery most flights never open, and they would
// be stale the moment a chart cycle changes. The app already fetches them over the network
// and caches what it is told to.
export const LEAVE_ON_THE_SERVER = [
  'byop',          // bring-your-own-plates uploads: the largest directory by far
  'legacy',        // the pre-rewrite app, kept for links
  'tiles',         // offline tile packs are downloaded on request, by the pilot
];

// A file the app cannot start without. If the bundle is missing one of these it is not a
// bundle, it is a broken app that would pass review and fail on a phone.
export const MUST_BUNDLE = [
  'index.html',
  'manifest.json',
  'app/core.js',
  'app/native-tiles.js',
  'app/ota.js',
  'app/ui.js',
  'app/io.js',
  'app/draw.js',
  'app/disclaimer.js',
  'i18n/he/strings.js',
  'terms.html',
  'privacy.html',
];

const skip = (rel) => LEAVE_ON_THE_SERVER.some(
  (dir) => rel === dir || rel.startsWith(dir + path.sep) || rel.startsWith(dir + '/'));

export function walk(dir, base = dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    const rel = path.relative(base, full);
    if (skip(rel)) continue;
    if (entry.isDirectory()) walk(full, base, out);
    else if (entry.isFile()) out.push({ rel, size: fs.statSync(full).size });
  }
  return out;
}

export function remoteConfig() {
  return {
    appId: 'org.supino.navaid',
    appName: 'NavAid',
    webDir: 'shell',
    ios: {
      limitsNavigationsToAppBoundDomains: true,
      includePlugins: [
        '@capacitor-community/text-to-speech',
        '@capacitor/filesystem',
        '@capacitor/share',
        '@capacitor/local-notifications',
        '@capgo/capacitor-social-login',
        '@capgo/capacitor-updater',
        '@capacitor/network',
      ],
    },
    // The updater is installed in both modes -- one plugin graph, one thing to get wrong --
    // but it acts only where there is something to update. The remote shell IS the live
    // site, so nothing here may run on its own: every decision is made in docs/app/ota.js.
    //
    // statsUrl: '' is not a formality. Left unset it defaults to Capgo's own server, and the
    // NATIVE lifecycle reports to it -- a device id, the app and OS version, every time the
    // app is backgrounded -- with autoUpdate off and this app never having talked to Capgo.
    // The plugin skips the report when the URL is empty, which is the only way to say no.
    plugins: {
      CapacitorUpdater: { autoUpdate: false, resetWhenUpdate: true, statsUrl: '' },
    },
    server: { url: REMOTE_URL, androidScheme: 'https' },
  };
}

export function embeddedConfig() {
  const config = remoteConfig();
  config.webDir = 'www';
  // Local assets are app-bound; keep bridge injection restricted in both modes.
  config.ios.limitsNavigationsToAppBoundDomains = true;
  // A bundle that never says it started is rolled back to the one before it. Ten seconds is
  // the plugin's own default and is the number docs/app/ota.js is written against: it calls
  // notifyAppReady() before anything else, so a bundle that cannot boot cannot strand a
  // pilot -- the previous one, or the one Apple reviewed, comes back on the next launch.
  config.plugins = {
    CapacitorUpdater: {
      autoUpdate: false,
      // The rollback window docs/app/ota.js is written against: it waits for the app to
      // actually be up -- chart, state, strings, boot overlay gone -- before reporting
      // health, and that has to fit inside this with room to spare on a cold device.
      appReadyTimeout: 20000,
      resetWhenUpdate: true,
      statsUrl: '',
    },
  };
  delete config.server.url;
  return config;
}

export function writeConfig(config) {
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
}

const vendorDir = path.join(mobileRoot, 'vendor');
const vendorAssets = JSON.parse(fs.readFileSync(path.join(vendorDir, 'manifest.json'), 'utf8'));

export function validateVendorAssets(index = fs.readFileSync(path.join(docsDir, 'index.html'), 'utf8')) {
  for (const asset of vendorAssets) {
    const data = fs.readFileSync(path.join(vendorDir, asset.path));
    const actual = 'sha384-' + createHash('sha384').update(data).digest('base64');
    if (actual !== asset.integrity) throw new Error('Vendor integrity mismatch: ' + asset.path);
    if (index.includes(asset.url) && !index.includes(asset.integrity)) {
      throw new Error('Vendor asset differs from the pinned web dependency: ' + asset.url);
    }
  }
  embeddedIndex(index);
}

export function embeddedIndex(index) {
  for (const asset of vendorAssets) index = index.replaceAll(asset.url, 'vendor/' + asset.path);
  if (['https://unpkg.com/', 'https://cdn.jsdelivr.net/'].some(url => index.includes(url))) {
    throw new Error('Unbundled CDN dependency in index.html');
  }
  return index.replace('<head>', '<head>\n  <script>window.__navaidEmbedded = true;</script>');
}

export function copyBundle() {
  validateVendorAssets();
  const files = walk(docsDir);
  fs.rmSync(wwwDir, { recursive: true, force: true });
  for (const { rel } of files) {
    const dest = path.join(wwwDir, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(path.join(docsDir, rel), dest);
  }
  const missing = MUST_BUNDLE.filter((rel) => !fs.existsSync(path.join(wwwDir, rel)));
  if (missing.length) {
    throw new Error('bundle is missing files the app cannot start without: ' + missing.join(', '));
  }
  fs.cpSync(vendorDir, path.join(wwwDir, 'vendor'), { recursive: true });
  fs.writeFileSync(path.join(wwwDir, 'index.html'), embeddedIndex(fs.readFileSync(path.join(docsDir, 'index.html'), 'utf8')));
  const bundled = walk(wwwDir);
  const manifest = {
    builtAt: new Date().toISOString(),
    files: bundled.length,
    bytes: bundled.reduce((sum, f) => sum + f.size, 0),
    leftOnTheServer: LEAVE_ON_THE_SERVER,
    source: REMOTE_URL,
  };
  fs.writeFileSync(path.join(wwwDir, 'bundle-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  return manifest;
}

function human(bytes) {
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function main(argv) {
  const args = new Set(argv.slice(2));
  if (args.has('--remote')) {
    writeConfig(remoteConfig());
    console.error('capacitor.config.json -> self-updating remote shell (' + REMOTE_URL + ')');
    console.error('Run `npm run sync` to push it into the native projects.');
    return 0;
  }
  if (args.has('--check')) {
    validateVendorAssets();
    const files = walk(docsDir);
    const bytes = files.reduce((sum, f) => sum + f.size, 0);
    console.error('Would bundle %d files, %s (leaving %s on the server).',
      files.length, human(bytes), LEAVE_ON_THE_SERVER.join(', '));
    const missing = MUST_BUNDLE.filter((rel) => !fs.existsSync(path.join(docsDir, rel)));
    if (missing.length) {
      console.error('MISSING from docs/: ' + missing.join(', '));
      return 1;
    }
    return 0;
  }
  const manifest = copyBundle();
  console.error('Bundled %d files, %s into mobile/www.', manifest.files, human(manifest.bytes));
  if (args.has('--embed')) {
    writeConfig(embeddedConfig());
    console.error('capacitor.config.json -> embedded build (no server.url).');
    console.error('Build and test this embedded binary before App Store submission.');
  } else {
    console.error('Config untouched: add --embed to point the native app at it.');
  }
  console.error('Run `npm run sync` to push it into the native projects.');
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv));
}
