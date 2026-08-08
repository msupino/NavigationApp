// @ts-check
// Findings from the review of main @ 83b93d3. Two are regressions in yesterday's fixes: the
// wind request identity was too weak, and the fail-closed shim check proved the wrong thing.
const { test, expect } = require('./_setup');
const fs = require('fs');
const path = require('path');

const OM_RE = /^https:\/\/api\.open-meteo\.com\//;
const wf = () => fs.readFileSync(
  path.join(__dirname, '..', '.github', 'workflows', 'deploy.yml'), 'utf8');

// --- the wind field must survive an off/on at the SAME altitude --------------------------
// Yesterday's fix made the pressure level the request's identity, which fixed off -> CHANGE
// altitude -> on. It left the same-altitude case broken: the obsolete request's level still
// matches, so its failure untoggled the control the pilot had just re-enabled, and `finally`
// then dropped the queued retry because `cb.checked` was false by then.
test('an off/on at the same altitude retries instead of reporting the old failure', async ({ page }) => {
  let n = 0;
  const gate = [];
  await page.route(OM_RE, route => { n++; gate.push(route); });   // hold every grid request
  await page.addInitScript(() => { try { localStorage.setItem('navaid.sec.weather', '1'); } catch (e) {} });
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => !!document.getElementById('windfield-cb'));

  const cb = page.locator('#windfield-cb');
  await cb.check();                                   // request 1, held
  await expect.poll(() => n, { timeout: 8000 }).toBe(1);
  await cb.uncheck();
  await cb.check();                                   // same altitude, request 1 still in flight
  await page.waitForTimeout(200);

  await gate[0].abort();                              // request 1 fails, late
  // The re-enable must win: a second request goes out for the live selection...
  await expect.poll(() => n, { timeout: 8000 }).toBe(2);
  // ...and the control the pilot just switched on stays on, with no error from the dead one.
  // Was: requests 1, checkbox off, "Wind field unavailable".
  await expect(cb).toBeChecked();
  const status = await page.locator('#windfield-status').textContent();
  expect(status || '').not.toMatch(/unavailable|failed/i);
});

test('a genuine failure of the live request still reports', async ({ page }) => {
  // The generation guard must not swallow real failures — that would trade one silent wrong
  // state for another.
  let aborted = 0;
  await page.route(OM_RE, r => { aborted++; return r.abort(); });
  await page.addInitScript(() => { try { localStorage.setItem('navaid.sec.weather', '1'); } catch (e) {} });
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => !!document.getElementById('windfield-cb'));
  // Set + dispatch rather than locator.check(): the abort fails so fast that the error
  // handler unchecks the box before check() can verify its own click, and Playwright then
  // reports "Clicking the checkbox did not change its state" -- a test artefact of correct
  // app behaviour. Every other wind-field spec drives it this way for the same reason.
  await page.evaluate(() => {
    const cb = document.getElementById('windfield-cb');
    cb.checked = true; cb.dispatchEvent(new Event('change'));
  });
  await expect.poll(() => aborted, { timeout: 15000 }).toBeGreaterThan(0);
  await expect(page.locator('#windfield-status')).toContainText(/unavailable|failed/i, { timeout: 10000 });
  await expect(page.locator('#windfield-cb')).not.toBeChecked();
});

// --- the preview shim must be injected, and must run first --------------------------------
test('the shim gate proves injection and placement, not mere presence', () => {
  const y = wf();
  // A presence grep accepted a branch-planted tag: `<HEAD><script src="evil.js"></script>
  // <script src="pr-store.js"></script>` passed while the lowercase-only sed had done
  // nothing and evil.js ran first against the live origin's storage.
  expect(y, 'still greps for the bare tag').not.toMatch(/grep -q '<script src="pr-store\.js"><\/script>'/);
  // Injection is now case-insensitive and attribute-tolerant, against the real head element.
  expect(y).toMatch(/perl -0pi -e 's\/\(<head\\b\[\^>\]\*>\)/);
  // A branch cannot forge the marker: any copy in its own HTML is stripped first.
  expect(y).toMatch(/navaid-pr-store-injected.*-->\/\/gi/);
  // ...and nothing executable may precede the shim.
  expect(y).toMatch(/<\(script\|iframe\|object\|embed\)/);
  expect(y).toMatch(/executable element\(s\) precede the storage shim/);
});

// --- a key must never reach another provider's proxy --------------------------------------
test('one provider\'s key is never sent to another provider\'s proxy', async ({ page }) => {
  // The real send path, not a storage read: configure a DeepSeek proxy, then use OpenRouter
  // with its own key, and capture where the credential actually goes. Both reviews
  // reproduced `Authorization: Bearer OPENROUTER-SECRET` arriving at the DeepSeek proxy.
  const sent = [];
  await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, route => {
    const req = route.request();
    if (req.method() === 'POST') {
      sent.push({ url: req.url(), auth: (req.headers()['authorization'] || '') });
    }
    return route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ choices: [{ message: { content: 'ok' } }] }) });
  });
  await page.addInitScript(() => {
    // A proxy the pilot configured for DeepSeek, once, some time ago. Written in BOTH
    // shapes: the legacy global is what the old build reads, and is the shape an existing
    // install actually has on disk — without it this test would pass on the broken build too.
    localStorage.setItem('navaid.ai.baseUrl', 'https://deepseek-proxy.example/v1');
    localStorage.setItem('navaid.ai.baseUrl.deepseek', 'https://deepseek-proxy.example/v1');
    localStorage.setItem('navaid.ai.key.deepseek', 'DEEPSEEK-SECRET');
    // ...and today they are on OpenRouter, with a different key and no proxy of its own.
    localStorage.setItem('navaid.ai.provider', 'openrouter');
    localStorage.setItem('navaid.ai.key.openrouter', 'OPENROUTER-SECRET');
  });
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => !!(window.NavAid && NavAid.assistant));
  await page.evaluate(() => NavAid.assistant.send('hello'));
  await expect.poll(() => sent.length, { timeout: 10000 }).toBeGreaterThan(0);

  const leaked = sent.filter(s => /deepseek-proxy\.example/.test(s.url));
  expect(leaked, 'the OpenRouter key was posted to the DeepSeek proxy: ' +
    JSON.stringify(leaked)).toEqual([]);
  // It goes to OpenRouter's own endpoint, carrying only OpenRouter's key.
  expect(sent.some(s => /openrouter/i.test(s.url))).toBe(true);
  expect(sent.some(s => /DEEPSEEK-SECRET/.test(s.auth))).toBe(false);
});

test('a legacy global Base URL is dropped, never re-pointed at a provider', async ({ page }) => {
  // Migrating it onto whichever provider happens to be active was my first instinct and is
  // wrong for exactly the case this fixes: a proxy set for DeepSeek, with the pilot now on
  // OpenRouter, would have been inherited by OpenRouter -- the leak, carried across the
  // upgrade. The stored value does not say who it belonged to, so it goes.
  for (const active of ['openrouter', 'deepseek', 'gemini']) {
    await page.addInitScript(p => {
      localStorage.setItem('navaid.ai.baseUrl', 'https://proxy.example/v1');
      localStorage.setItem('navaid.ai.provider', p);
    }, active);
    await page.goto('?lang=en&nogist');
    await page.waitForFunction(() => !!(window.NavAid && NavAid.assistant));
    const r = await page.evaluate(() => ({
      legacy: localStorage.getItem('navaid.ai.baseUrl'),
      ds: localStorage.getItem('navaid.ai.baseUrl.deepseek'),
      or: localStorage.getItem('navaid.ai.baseUrl.openrouter'),
    }));
    expect(r.legacy, 'active=' + active).toBeNull();
    expect(r.ds, 'active=' + active).toBeNull();
    expect(r.or, 'active=' + active).toBeNull();
  }
});

test('proxy endpoints stay out of the Drive sync allowlist', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'docs', 'app', 'gdrive.js'), 'utf8');
  const list = src.slice(src.indexOf('navaid.ai.provider'), src.indexOf('navaid.ai.provider') + 900);
  // A synced proxy URL would carry a synced key to a host the other device never agreed to.
  expect(list).not.toMatch(/'navaid\.ai\.baseUrl/);
  expect(src).toMatch(/navaid\.ai\.baseUrl\.<provider> excluded/);
});

// --- the weather feed must not gate itself off the air ------------------------------------
test('the WX gate clears with the coverage the world actually supplies', async () => {
  const { wxPublishable, buildAviationFeeds } = await import('../scripts/build-aviation-feeds.mjs');
  // Ground truth, observed from AWC: of the 13 ids the workflow requests, five ever report
  // (LLBG, LLER, LLHA, LLHZ, LLIB) — the others are military or small fields that never file.
  // The last-good wx.json carries exactly those five. A gate measured against the REQUESTED
  // list needed 8 and froze the live feed for 12.6h while the workflow reported success
  // (issue #1472); a gate measured against the baseline publishes.
  expect(wxPublishable({ metarsOk: true, tafsOk: true,
    stations: { LLBG: {}, LLER: {}, LLHA: {}, LLHZ: {}, LLIB: {} }, baseline: 5 })).toBe(true);

  // End to end, with the real shapes: 13 requested, 5 returned, 5 in the last-good file.
  const five = ['LLBG', 'LLER', 'LLHA', 'LLHZ', 'LLIB'];
  const wrote = [];
  const res = await buildAviationFeeds({
    firs: ['LLLL'], bbox: { s: 28, n: 35, w: 32, e: 38 },
    ids: ['LLBG', 'LLHA', 'LLOV', 'LLER', 'LLES', 'LLEK', 'LLIB', 'LLMG',
      'LLNV', 'LLRD', 'LLRM', 'LLBS', 'LLHZ'],
    prevUrl: 'https://prev.example/wx.json',
    fetchImpl: async (url) => {
      const body = /prev\.example/.test(url)
        ? { stations: Object.fromEntries(five.map(id => [id, {}])) }
        : (/isigmet/.test(url) ? []
          : five.map(id => ({ icaoId: id, rawOb: id + ' 011200Z', rawTAF: 'TAF ' + id })));
      return { ok: true, status: 200, json: async () => body };
    },
    write: f => wrote.push(f), log: () => {}, warn: () => {},
  });
  expect(res.wx, 'the feed gated itself off the air again').toBe('published');
  expect(res.stations).toBe(5);
  expect(wrote).toContain('wx/wx.json');
});

test('a genuine collapse still withholds the feed', async () => {
  const { buildAviationFeeds } = await import('../scripts/build-aviation-feeds.mjs');
  const wrote = [];
  const res = await buildAviationFeeds({
    firs: ['LLLL'], bbox: { s: 28, n: 35, w: 32, e: 38 }, ids: ['LLBG', 'LLER', 'LLHA'],
    prevUrl: 'https://prev.example/wx.json',
    fetchImpl: async (url) => {
      const body = /prev\.example/.test(url)
        ? { stations: { LLBG: {}, LLER: {}, LLHA: {}, LLHZ: {}, LLIB: {} } }   // normally 5
        : (/isigmet/.test(url) ? [] : [{ icaoId: 'LLBG', rawOb: 'LLBG 011200Z' }]);  // now 1
      return { ok: true, status: 200, json: async () => body };
    },
    write: f => wrote.push(f), log: () => {}, warn: () => {},
  });
  // The property the gate was added for survives: 1 of a normal 5 is a truncated response,
  // and publishing it would blank the rest under a fresh generatedAt.
  expect(res.wx).toBe('skipped');
  expect(wrote).not.toContain('wx/wx.json');
});

test('the shim stays first after every injection, checked on the assembled document', () => {
  const y = wf();
  // The published preview for this very PR came out as
  //     <head><script src="preview-shared.js"></script><!-- marker --><script src="pr-store.js">
  // because the shared-dirs injection ran AFTER the placement check and inserted at <head>.
  // Workflow-generated, so nothing was exploitable — but it broke the invariant the check
  // exists to hold, and re-running that check on the published file would have refused it.
  expect(y, 'preview-shared.js still injected at <head>')
    .not.toMatch(/0,\/<head>\/s\/\/<head>\\n\s*<script src="preview-shared\.js">/);
  // It now goes after the shim...
  expect(y).toMatch(/s\/\(<script src="pr-store\\\.js"><\\\/script>\)\/\$1/);
  // ...and placement is re-verified on the finished document, after every head injection.
  expect(y).toMatch(/precede the storage shim in the assembled preview/);
  const checks = y.match(/precede the storage shim/g) || [];
  expect(checks.length).toBeGreaterThanOrEqual(2);
});
