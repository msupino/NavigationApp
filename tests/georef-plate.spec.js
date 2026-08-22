// @ts-check
const { test, expect } = require('./_setup');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

test('each shipped CVFR plate keeps its geographic and image proportions', () => {
  const data = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/data/airfields.json'), 'utf8'));
  const fields = data.airfields.filter(field => field.cvfr_overlay);
  const distance = (a, b) => {
    const midLat = (a[0] + b[0]) * Math.PI / 360;
    return Math.hypot((b[0] - a[0]) * 111,
      (b[1] - a[1]) * 111 * Math.cos(midLat));
  };
  for (const field of fields) {
    const overlay = field.cvfr_overlay;
    const png = fs.readFileSync(path.join(ROOT, 'docs/cvfr-img', overlay.png));
    expect(png.toString('ascii', 1, 4)).toBe('PNG');
    const imageAspect = png.readUInt32BE(16) / png.readUInt32BE(20);
    let groundAspect;
    if (overlay.sw && overlay.ne) {
      const midLat = (overlay.sw[0] + overlay.ne[0]) * Math.PI / 360;
      groundAspect = ((overlay.ne[1] - overlay.sw[1]) * Math.cos(midLat)) /
        (overlay.ne[0] - overlay.sw[0]);
    } else {
      groundAspect = distance(overlay.tl, overlay.tr) / distance(overlay.tl, overlay.bl);
    }
    const conformality = groundAspect / imageAspect;
    expect([field.name, conformality >= 0.8 && conformality <= 1.2])
      .toEqual([field.name, true]);
  }
});
