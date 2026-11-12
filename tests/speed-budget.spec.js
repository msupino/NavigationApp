// @ts-check
// Guards against a speed regression, on what does not depend on the machine's speed: the bytes
// a first view must download before the chart can draw, the network going quiet after boot (a
// page that never does made PageSpeed give up: "RPC::DEADLINE_EXCEEDED"), and no layout shift
// while the app loads. The timing side (a Lighthouse score floor) is the `lighthouse` job in
// review.yml, on the median of three runs.
//
// Raising a budget is allowed -- it is one deliberate line in the PR, next to the reason.
const { test, expect } = require('./_setup');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const DOCS = path.join(ROOT, 'docs');

// KB, gzipped after the deploy's own minification -- what production sends before the first
// tile is asked for. 480 KB on 2026-11-01; 500.4 KB on 2026-11-12 after steady growth (date
// format, the extra airfield frequencies, and the Settings > Storage window, whose code only
// runs when that window is opened, not at boot). Raised to leave ~2% of room again.
const CRITICAL_PATH_BUDGET_KB = 512;

// The first phase of the loader (index.html `var srcs = [...]`): our own files only -- the
// pinned CDN libraries change only with a version bump and its new SRI hash.
function criticalPathFiles() {
  const html = fs.readFileSync(path.join(DOCS, 'index.html'), 'utf8');
  const list = /var srcs = \[([\s\S]*?)\];/.exec(html);
  if (!list) throw new Error('index.html: the loader list (var srcs = [...]) was not found');
  const files = [];
  for (const m of list[1].matchAll(/^\s*'([^']+)'(?:\s*\+\s*window\.__navLang\s*\+\s*'([^']+)')?/gm)) {
    if (/^https?:/.test(m[1])) continue;
    // 'i18n/' + window.__navLang + '/strings.js': Hebrew, the larger of the two.
    files.push(m[2] ? m[1] + 'he' + m[2] : m[1]);
  }
  return files.concat(['app/style.css']);
}

function minifiedCopy() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'navaid-budget-'));
  for (const d of ['app', 'i18n', 'data']) fs.cpSync(path.join(DOCS, d), path.join(dir, d), { recursive: true });
  execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'minify-site.mjs'), dir], { stdio: 'pipe' });
  return dir;
}

test('the deploy and the budget minify with the same code', () => {
  const yaml = require('yaml');
  const wf = yaml.parse(fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'deploy.yml'), 'utf8'));
  const step = Object.values(wf.jobs).flatMap(j => j.steps || []).find(s => s.name === 'Install the minifier');
  expect(step, 'deploy.yml: the "Install the minifier" step').toBeTruthy();
  const inline = step.run.split("cat > minify.mjs <<'MINIFY'\n")[1].split(/^\s*MINIFY\s*$/m)[0];
  const strip = (s) => s.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('//')).join('\n');
  expect(strip(fs.readFileSync(path.join(ROOT, 'scripts', 'minify-site.mjs'), 'utf8'))).toBe(strip(inline));
  // ...and the same versions.
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).devDependencies;
  expect(step.run).toContain('terser@' + pkg.terser);
  expect(step.run).toContain('csso@' + pkg.csso);
});

test('the first view downloads no more than its budget', () => {
  const files = criticalPathFiles();
  expect(files.length, 'loader list parsed').toBeGreaterThan(15);
  const dir = minifiedCopy();
  try {
    const sizes = files.map(f => [f, zlib.gzipSync(fs.readFileSync(path.join(dir, f)), { level: 9 }).length]);
    const total = sizes.reduce((a, [, n]) => a + n, 0) / 1024;
    const top = sizes.sort((a, b) => b[1] - a[1]).slice(0, 6).map(([f, n]) => f + ' ' + Math.round(n / 1024) + ' KB').join(', ');
    console.log(`critical path: ${total.toFixed(1)} KB gzipped (budget ${CRITICAL_PATH_BUDGET_KB} KB); largest: ${top}`);
    expect(total, `critical path ${total.toFixed(1)} KB > budget ${CRITICAL_PATH_BUDGET_KB} KB (largest: ${top})`)
      .toBeLessThanOrEqual(CRITICAL_PATH_BUDGET_KB);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// After boot, with nobody touching it, the page settles: the feeds it polls do so every few
// minutes, not every second, and nothing large (a chart download) starts on its own.
test('the network goes quiet after boot', async ({ page }) => {
  test.setTimeout(45000);
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => window.NavAid && NavAid.followMe && document.readyState === 'complete');
  await page.waitForTimeout(3000);                    // let the boot's own fetches finish
  const seen = [];
  page.on('request', r => seen.push(r.url()));
  await page.waitForTimeout(12000);
  console.log(`requests in a quiet 12 s: ${seen.length}` + (seen.length ? ' -- ' + seen.slice(0, 8).join(' ') : ''));
  expect(seen.length, seen.slice(0, 20).join('\n')).toBeLessThanOrEqual(QUIET_MAX_REQUESTS);
});
const QUIET_MAX_REQUESTS = 5;

for (const vp of [{ name: 'phone', width: 412, height: 823, mobile: true }, { name: 'desktop', width: 1350, height: 940, mobile: false }]) {
  test.describe(vp.name, () => {
    test.use({ viewport: { width: vp.width, height: vp.height }, isMobile: vp.mobile, hasTouch: vp.mobile });
    test(`no layout shift while the app loads (${vp.name})`, async ({ page }) => {
      // Slowed down like a phone (and a CI runner): paints then land between the loader's
      // scripts, which is where a control shows before it is moved.
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
      await page.addInitScript(() => {
        window.__cls = 0; window.__shifts = [];
        new PerformanceObserver((list) => {
          for (const e of list.getEntries()) {
            if (e.hadRecentInput) continue;
            window.__cls += e.value;
            window.__shifts.push(e.value.toFixed(4) + ' ' + (e.sources || []).map(s => s.node && (s.node.id || s.node.className)).join('|'));
          }
        }).observe({ type: 'layout-shift', buffered: true });
      });
      await page.goto('?lang=en&nogist');
      await page.waitForFunction(() => window.NavAid && NavAid.followMe && document.readyState === 'complete');
      await page.waitForTimeout(1000);
      const r = await page.evaluate(() => ({ cls: window.__cls, shifts: window.__shifts }));
      console.log(`${vp.name} CLS ${r.cls.toFixed(4)} ${r.shifts.join('; ')}`);
      expect(r.cls, r.shifts.join('\n')).toBeLessThan(0.01);
    });
  });
}
