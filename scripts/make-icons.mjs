#!/usr/bin/env node
// Draws every NavAid icon from one description of the mark, so the favicon, the PWA icons,
// the Android launcher and the splash screen cannot drift apart. Run after editing the mark:
//
//   node scripts/make-icons.mjs
//
// Rasterising is done by the Playwright Chromium we already carry for the tests -- no
// ImageMagick or librsvg on the machine required.
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const INK = '#f4f1ec';          // the aircraft
const GROUND = '#231F20';       // the square behind it
const LEG = '#3c6d99';          // the leg flown so far
const FIX = '#7fb2e5';          // the fix it left

// NavAid's aircraft, seen from above, in a 64-unit box.
const AIRCRAFT = 'M32 8c2.2 0 3.4 2.6 3.4 6.6v9.2l21.2 12.8v5.4L35.4 33v11.8l6.6 5v4.6L32 52'
  + 'l-10 2.4v-4.6l6.6-5V33L7.4 42V36.6l21.2-12.8v-9.2C28.6 10.6 29.8 8 32 8z';

// The mark itself: a departure fix, the leg climbing away from it, and the aircraft flying
// it. `scale` shrinks the drawing about the centre so the same mark fits inside Android's
// adaptive-icon safe zone and a maskable circle.
const mark = (scale = 1, ink = INK) => `
  <g transform="translate(32 32) scale(${scale}) translate(-32 -32)">
    <path d="M13 49 C24 49 27 32 36 27" fill="none" stroke="${LEG}" stroke-width="3"
          stroke-linecap="round" stroke-dasharray="5 4.5"/>
    <circle cx="13" cy="49" r="4" fill="${FIX}"/>
    <g transform="translate(44 21) rotate(58) scale(0.55) translate(-32 -32)">
      <path fill="${ink}" d="${AIRCRAFT}"/>
    </g>
  </g>`;

const svg = ({ scale = 1, ground = GROUND, radius = 14, ink = INK }) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">`
  + (ground ? `<rect width="64" height="64" rx="${radius}" fill="${ground}"/>` : '')
  + mark(scale, ink) + `</svg>`;

// A round launcher icon is the same mark on a circle.
const roundSvg = () => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">`
  + `<circle cx="32" cy="32" r="32" fill="${GROUND}"/>` + mark(0.86) + `</svg>`;

// The splash is the mark on plain ground, sized to the short edge.
const splashSvg = (w, h) => {
  const s = Math.round(Math.min(w, h) * 0.46);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">`
    + `<rect width="${w}" height="${h}" fill="${GROUND}"/>`
    + `<g transform="translate(${(w - s) / 2} ${(h - s) / 2}) scale(${s / 64})">`
    + mark(1, INK).replace(/<rect[^>]*>/, '') + `</g></svg>`;
};

const MIPMAP = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };
const SPLASH = {
  'drawable': [480, 320],
  'drawable-land-mdpi': [480, 320], 'drawable-port-mdpi': [320, 480],
  'drawable-land-hdpi': [800, 480], 'drawable-port-hdpi': [480, 800],
  'drawable-land-xhdpi': [1280, 720], 'drawable-port-xhdpi': [720, 1280],
  'drawable-land-xxhdpi': [1600, 960], 'drawable-port-xxhdpi': [960, 1600],
  'drawable-land-xxxhdpi': [1920, 1280], 'drawable-port-xxxhdpi': [1280, 1920],
};

async function png(page, markup, w, h, out) {
  await page.setViewportSize({ width: w, height: h });
  await page.setContent(`<style>html,body{margin:0;padding:0;background:transparent}
    svg{display:block;width:${w}px;height:${h}px}</style>${markup}`);
  await mkdir(dirname(out), { recursive: true });
  await page.screenshot({ path: out, omitBackground: true });
}

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });

// The favicon is the vector itself -- no raster to keep in step.
await writeFile(join(ROOT, 'docs/favicon.svg'), svg({}) + '\n');

// PWA icons are declared "any maskable", so the mark sits inside the safe circle.
for (const size of [192, 512]) {
  await png(page, svg({ scale: 0.78, radius: 0 }), size, size,
    join(ROOT, `docs/assets/icon-${size}.png`));
}

// Xcode derives every iPhone and iPad launcher size from this universal source.
// Use the same mask-safe artwork as the PWA icons so native packaging cannot drift.
await png(page, svg({ scale: 0.78, radius: 0 }), 1024, 1024,
  join(ROOT, 'mobile/ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png'));

const res = join(ROOT, 'mobile/android/app/src/main/res');
for (const [density, size] of Object.entries(MIPMAP)) {
  await png(page, svg({}), size, size, join(res, `mipmap-${density}/ic_launcher.png`));
  await png(page, roundSvg(), size, size, join(res, `mipmap-${density}/ic_launcher_round.png`));
  // The adaptive foreground is drawn on Android's own background colour, and only its
  // middle two thirds is guaranteed to survive the launcher's mask.
  await png(page, svg({ scale: 0.62, ground: null }), size, size,
    join(res, `mipmap-${density}/ic_launcher_foreground.png`));
}

for (const [dir, [w, h]] of Object.entries(SPLASH)) {
  await png(page, splashSvg(w, h), w, h, join(res, `${dir}/splash.png`));
}

await browser.close();
console.log('icons written');
