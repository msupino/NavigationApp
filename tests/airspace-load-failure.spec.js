// A dataset that fails to load must say so. The retry was already right -- `airspace` stays
// null so the next draw asks again -- but the failure itself was a console.warn: the
// checkbox stayed ticked over an empty map, which reads as "there is no restricted airspace
// here" rather than "we could not find out". That is the wrong way round for this dataset.
const { test, expect } = require('./_setup');

async function boot(page, { fail }) {
  await page.route('**/data/airspace.json**', (r) => (fail
    ? r.fulfill({ status: 503, contentType: 'text/plain', body: 'nope' })
    : r.continue()));
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof loadAirspace === 'function');
}

const toastText = (page) => page.evaluate(() => {
  const t = document.querySelector('#toast, .toast');
  return t && !t.classList.contains('hidden') ? t.textContent.trim() : '';
});

test('a failed load says so, and says what failed', async ({ page }) => {
  await boot(page, { fail: true });
  await page.evaluate(() => loadAirspace());
  await page.waitForFunction(() => {
    const t = document.querySelector('#toast, .toast');
    return !!(t && /Airspace unavailable/.test(t.textContent || ''));
  }, null, { timeout: 5000 });
  expect(await toastText(page)).toMatch(/Airspace unavailable/);
  expect(await toastText(page)).toMatch(/HTTP 503/);
});

test('it says it once per outage, not once per retry', async ({ page }) => {
  await boot(page, { fail: true });
  const shown = await page.evaluate(async () => {
    let n = 0;
    const real = window.showToast;
    window.showToast = (m) => { if (/Airspace unavailable/.test(m)) n += 1; return real && real(m); };
    for (let i = 0; i < 4; i++) await loadAirspace();
    window.showToast = real;
    return n;
  });
  expect(shown).toBe(1);
});

test('a load that succeeds says nothing', async ({ page }) => {
  await boot(page, { fail: false });
  const shown = await page.evaluate(async () => {
    let n = 0;
    const real = window.showToast;
    window.showToast = (m) => { if (/Airspace unavailable/.test(m)) n += 1; return real && real(m); };
    await loadAirspace();
    window.showToast = real;
    return { n, areas: Array.isArray(window.airspace) ? window.airspace.length : -1 };
  });
  expect(shown.n).toBe(0);
  expect(shown.areas).toBeGreaterThan(0);
});

// Ticking the layer again is a fresh question. The warning is said once per outage, and the
// flag latched for the process: the pilot saw one toast, it faded, and every later look at a
// still-broken layer was a silent empty map -- the exact misreading the toast exists to stop.
test('re-opening the layer asks again, and is answered again', async ({ page }) => {
  await boot(page, { fail: true });
  const shown = await page.evaluate(async () => {
    let n = 0;
    const real = window.showToast;
    window.showToast = (m) => { if (/Airspace unavailable/.test(m)) n += 1; return real && real(m); };
    const cb = document.getElementById('airspace-cb');
    for (const on of [true, false, true]) {
      cb.checked = on;
      cb.dispatchEvent(new Event('change', { bubbles: true }));
      await loadAirspace();
    }
    window.showToast = real;
    return n;
  });
  expect(shown).toBe(2);          // once per time the pilot asked, not once per process
});
