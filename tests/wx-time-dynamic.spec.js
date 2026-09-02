// @ts-check
// The shared #wx-time dropdown (wind/temp PWX + significant-weather SIGWX overlays) used to
// be filled once at boot and never again, so a left-open tab only saw newly published valid
// times — or an advancing "nearest now" default — after a page reload. It now re-polls the
// feeds: NavWxTime.poll() re-fetches each manifest, ADDS new times, advances the auto-selected
// default while the pilot has not pinned one, PRUNES times no feed offers any more, and — if
// the pilot's PINNED time has aged out of every feed — releases the pin and falls back to
// nearest-now instead of leaving the overlay pointed at a chart that no longer exists.
const { test, expect } = require('./_setup');

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMCAYAAAB7P3qAAAAAAElFTkSuQmCC',
  'base64');
const BOUNDS = { s: 29.88, n: 33.82, w: 33.31, e: 36.69 };

// Freeze the clock at 12:00Z on 21/06/2026, so "nearest to now" is unambiguous.
async function freezeNoon(page) {
  await page.addInitScript(() => {
    const fixed = Date.UTC(2026, 5, 21, 12, 0);
    const RealDate = Date;
    // eslint-disable-next-line no-global-assign
    Date = class extends RealDate {
      constructor(...a) { super(...(a.length ? a : [fixed])); }
      static now() { return fixed; }
    };
  });
}

// Route the two manifests from a mutable holder so a test can change what the NEXT fetch
// returns, then trigger NavWxTime.poll() to re-read it deterministically (no 10-min wait).
async function serve(page, holder) {
  await page.route(/ims-data\/ims\/.*\.png/, r =>
    r.fulfill({ status: 200, contentType: 'image/png', body: PNG }));
  await page.route(/ims-data\/ims\/pwx\.json/, r =>
    holder.pwx
      ? r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(holder.pwx) })
      : r.fulfill({ status: 404, body: '' }));
  await page.route(/ims-data\/ims\/sigwx\.json/, r =>
    holder.sigwx
      ? r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(holder.sigwx) })
      : r.fulfill({ status: 404, body: '' }));
  await page.addInitScript(() => {
    for (const s of ['build', 'view', 'display', 'charts', 'export', 'print'])
      try { localStorage.setItem('navaid.sec.' + s, '1'); } catch (e) {}
  });
  await page.goto('?lang=en&nogist');
}

const pwxLevel = times => ({ level: '90', label: 'FL030', times });
const t = (valid, i) => ({ valid, day: '21/06/2026', png: 'ims/pwx/90/' + i + '.png' });

const labels = page => page.evaluate(() =>
  Array.from(document.querySelectorAll('#wx-time option'), o => o.textContent));
const selected = page => page.evaluate(() => {
  const s = document.getElementById('wx-time');
  return s && s.options.length ? s.options[s.selectedIndex].textContent : null;
});
const repoll = page => page.evaluate(() =>
  (typeof NavWxTime !== 'undefined') && NavWxTime.poll());

test('a re-poll adds newly published times and advances the unpinned default', async ({ page }) => {
  await freezeNoon(page);
  // First run offers only 06:00 (six hours old) — the only option, so it is selected.
  const holder = {
    pwx: { generatedAt: '2026-06-21T06:00:00Z', bounds: BOUNDS, levels: [pwxLevel([t('06:00', 'a')])] },
    sigwx: null,
  };
  await serve(page, holder);
  await page.waitForFunction(() => document.querySelectorAll('#wx-time option').length === 1);
  expect(await selected(page)).toBe('21/06/2026 06:00Z');

  // A later run publishes 12:00 (right now). Re-poll: the option appears AND, since the pilot
  // never picked a time, the default advances to the nearer one.
  holder.pwx = { generatedAt: '2026-06-21T12:00:00Z', bounds: BOUNDS,
    levels: [pwxLevel([t('06:00', 'a'), t('12:00', 'b')])] };
  await repoll(page);
  await page.waitForFunction(() => document.querySelectorAll('#wx-time option').length === 2);
  expect(await labels(page)).toEqual(['21/06/2026 06:00Z', '21/06/2026 12:00Z']);
  expect(await selected(page)).toBe('21/06/2026 12:00Z');
});

test('a pinned time that ages out of the feed is pruned and falls back to nearest-now', async ({ page }) => {
  await freezeNoon(page);
  const holder = {
    pwx: { generatedAt: '2026-06-21T06:00:00Z', bounds: BOUNDS,
      levels: [pwxLevel([t('06:00', 'a'), t('12:00', 'b')])] },
    sigwx: null,
  };
  await serve(page, holder);
  await page.waitForFunction(() => document.querySelectorAll('#wx-time option').length === 2);

  // The pilot deliberately picks the older 06:00 (this pins the selection).
  await page.evaluate(() => {
    const s = document.getElementById('wx-time');
    const o = Array.from(s.options).find(x => x.textContent === '21/06/2026 06:00Z');
    s.value = o.value;
    s.dispatchEvent(new Event('change'));
  });
  expect(await selected(page)).toBe('21/06/2026 06:00Z');

  // A newer run drops 06:00 entirely and adds 18:00. Re-poll: 06:00 is pruned, and because
  // the pinned pick is gone from every feed the pin is released and the default re-seeds to
  // the nearest available time (12:00), not left pointing at the vanished 06:00.
  holder.pwx = { generatedAt: '2026-06-21T12:00:00Z', bounds: BOUNDS,
    levels: [pwxLevel([t('12:00', 'b'), t('18:00', 'c')])] };
  await repoll(page);
  await page.waitForFunction(() =>
    !Array.from(document.querySelectorAll('#wx-time option')).some(o => o.textContent === '21/06/2026 06:00Z'));
  expect(await labels(page)).toEqual(['21/06/2026 12:00Z', '21/06/2026 18:00Z']);
  expect(await selected(page)).toBe('21/06/2026 12:00Z');
});

test('a pinned LAST option that ages out re-seeds to nearest-now, not to options[0]', async ({ page }) => {
  // The regression the earlier test could not see: removing the selected <option> makes the
  // browser fall back to options[0] on its own, so a release that tested sel.value AFTER the
  // prune always saw an available key and never fired. Pinning the LAST option separates the
  // two outcomes -- options[0] is 06:00 (six hours stale), nearest-now is 12:00.
  await freezeNoon(page);
  const holder = {
    pwx: { generatedAt: '2026-06-21T06:00:00Z', bounds: BOUNDS,
      levels: [pwxLevel([t('06:00', 'a'), t('12:00', 'b'), t('18:00', 'c')])] },
    sigwx: null,
  };
  await serve(page, holder);
  await page.waitForFunction(() => document.querySelectorAll('#wx-time option').length === 3);

  await page.evaluate(() => {
    const s = document.getElementById('wx-time');
    const o = Array.from(s.options).find(x => x.textContent === '21/06/2026 18:00Z');
    s.value = o.value;
    s.dispatchEvent(new Event('change'));
  });
  expect(await selected(page)).toBe('21/06/2026 18:00Z');

  // 18:00 disappears from the feed; 06:00 and 12:00 remain.
  holder.pwx = { generatedAt: '2026-06-21T12:00:00Z', bounds: BOUNDS,
    levels: [pwxLevel([t('06:00', 'a'), t('12:00', 'b')])] };
  await repoll(page);
  await page.waitForFunction(() =>
    !Array.from(document.querySelectorAll('#wx-time option')).some(o => o.textContent === '21/06/2026 18:00Z'));
  // Nearest to the frozen 12:00Z now — NOT the browser's options[0] fallback (06:00).
  expect(await selected(page)).toBe('21/06/2026 12:00Z');
});

test('a feed that fails this round does not prune the times it publishes', async ({ page }) => {
  // PWX answers, SIGWX 500s. SIGWX-only times must survive: pruning on a half-answered round
  // deleted them and removed that overlay for the next ten minutes.
  await freezeNoon(page);
  const holder = {
    pwx: { generatedAt: '2026-06-21T12:00:00Z', bounds: BOUNDS, levels: [pwxLevel([t('12:00', 'b')])] },
    sigwx: { generatedAt: '2026-06-21T12:00:00Z', times: [
      { valid: '21:00', day: '21/06/2026', png: 'ims/sigwx/z.png' }] },
  };
  await serve(page, holder);
  await page.waitForFunction(() => document.querySelectorAll('#wx-time option').length === 2);
  expect(await labels(page)).toContain('21/06/2026 21:00Z');

  holder.sigwx = null;              // SIGWX fetch now fails (404 -> null)
  await repoll(page);
  // Its time is still offered: one feed failing is not evidence the other's times are gone.
  expect(await labels(page)).toContain('21/06/2026 21:00Z');
});
