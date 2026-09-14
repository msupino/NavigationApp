#!/usr/bin/env node
// Take the screenshots App Store Connect asks for, from the real app.
//
// Apple requires one set at the largest iPhone size and one at the largest iPad size, and
// rejects anything off by a pixel. Doing this by hand on a device means a simulator, a
// route built by hand, and six careful taps per size -- every time the listing changes. So
// it is a script: the same route, the same layers, the same panels, every time.
//
//   node scripts/appstore-screenshots.mjs                       # against a local server
//   node scripts/appstore-screenshots.mjs --base https://navaid.supino.org
//   node scripts/appstore-screenshots.mjs --device iphone       # one device only
//
// Start a local server first if you are not using --base:
//   cd docs && python3 -m http.server 8000
//
// Real chart imagery comes from OUR mirror (navaid-tiles.supino.org), never from
// flight-maps.com -- whose server it is, is the point. A screenshot with grey squares
// where the chart should be is not a screenshot, so this is the one thing here that does
// hit the network on purpose.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(repoRoot, 'build', 'appstore-screenshots');

// Apple's required sizes, in CSS pixels at the device's own scale factor. A 6.9" iPhone
// wants 1320x2868 px, which is 440x956 at 3x; a 13" iPad wants 2064x2752, which is
// 1032x1376 at 2x. Playwright renders at deviceScaleFactor, so the PNG comes out at the
// pixel size Apple checks.
export const DEVICES = {
  iphone: { label: 'iphone-6.9', width: 440, height: 956, scale: 3, isMobile: true,
            pixels: '1320x2868' },
  ipad: { label: 'ipad-13', width: 1032, height: 1376, scale: 2, isMobile: false,
          pixels: '2064x2752' },
};

// One route, drawn the same way every time: a real CVFR cross-country a reviewer can
// recognise, long enough to fill a navigation log and cross airspace worth showing.
const ROUTE = [
  { lat: 32.17944, lng: 34.83444, name: 'LLHZ' },
  { lat: 32.35, lng: 34.86, name: 'HADRA' },
  { lat: 32.60, lng: 34.92, name: 'BOREN' },
  { lat: 32.80833, lng: 35.04278, name: 'LLHA' },
];

export const SHOTS = [
  { name: '1-chart', what: 'the route on the CVFR chart' },
  { name: '2-plan', what: 'the navigation log and the terrain profile' },
  { name: '3-layers', what: 'NOTAM and weather on the chart' },
  { name: '4-location', what: 'live position and the data strip' },
];

function arg(name, fallback) {
  const at = process.argv.indexOf('--' + name);
  return at > -1 && process.argv[at + 1] ? process.argv[at + 1] : fallback;
}

async function shoot(chromium, deviceKey, base) {
  const device = DEVICES[deviceKey];
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: device.width, height: device.height },
    deviceScaleFactor: device.scale,
    isMobile: device.isMobile,
    hasTouch: device.isMobile,
    locale: 'en-GB',
  });
  // The safety notice opens on every launch and would sit over every screenshot. A store
  // listing shows the app, not its front door -- the notice is in the review notes, and a
  // reviewer meets it on the first launch of the build itself.
  await context.addInitScript(() => { window.__navaidNoDisclaimer = true; });
  const page = await context.newPage();
  const written = [];

  await page.goto(base + '?lang=en', { waitUntil: 'load' });
  await page.waitForFunction(() => typeof draw === 'function' && typeof syncLegs === 'function');
  await page.evaluate((route) => {
    const boot = document.getElementById('boot-loading');
    if (boot) boot.remove();
    document.documentElement.classList.remove('app-booting');
    state.waypoints = route.map((w) => ({ lat: w.lat, lng: w.lng, name: w.name }));
    syncLegs();
    draw();
    if (typeof fitRoute === 'function') fitRoute();
  }, ROUTE);
  await page.waitForTimeout(2500);          // let the chart tiles land

  const save = async (name) => {
    const file = path.join(outDir, device.label + '-' + name + '.png');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    await page.screenshot({ path: file });
    written.push(file);
  };

  await save('1-chart');

  await page.evaluate(() => { if (typeof showFlightPlan === 'function') showFlightPlan(); });
  await page.waitForTimeout(1200);
  await save('2-plan');
  await page.evaluate(() => { if (typeof closeFlightPlan === 'function') closeFlightPlan(); });

  await page.evaluate(() => {
    for (const id of ['notam-cb', 'airfield-wind-cb']) {
      const cb = document.getElementById(id);
      if (cb && !cb.checked) cb.click();
    }
  });
  await page.waitForTimeout(2000);
  await save('3-layers');

  // A position, without asking a laptop for one: the same shape a fix has.
  await page.evaluate(() => {
    if (typeof startLiveLocation !== 'function') return;
    navigator.geolocation.watchPosition = (cb) => {
      cb({ coords: { latitude: 32.35, longitude: 34.86, accuracy: 8,
                     heading: 12, speed: 46.3, altitude: 457 }, timestamp: Date.now() });
      return 1;
    };
    navigator.geolocation.clearWatch = () => {};
    startLiveLocation();
  });
  await page.waitForTimeout(1500);
  await save('4-location');

  await browser.close();
  return written;
}

async function main() {
  const { chromium } = await import('playwright');
  const base = arg('base', 'http://127.0.0.1:8000/');
  const only = arg('device', null);
  const keys = only ? [only] : Object.keys(DEVICES);
  for (const key of keys) {
    if (!DEVICES[key]) throw new Error('unknown device: ' + key + ' (have: '
      + Object.keys(DEVICES).join(', ') + ')');
  }
  for (const key of keys) {
    const files = await shoot(chromium, key, base.endsWith('/') ? base : base + '/');
    console.error('%s (%s px):', DEVICES[key].label, DEVICES[key].pixels);
    for (const file of files) console.error('  ' + path.relative(repoRoot, file));
  }
  console.error('\nUpload these in App Store Connect -> Media Manager.');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(String(error && error.message || error)); process.exit(1); });
}
