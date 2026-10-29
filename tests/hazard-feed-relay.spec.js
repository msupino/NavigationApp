// @ts-check
// SIGMET and AIRMET from NavAid's relay (relay/edge, rebuilt every 5 minutes) when the gist's
// `hazardFeedBase` names it; the GitHub data branches when it is empty, or when the relay fails.
const { test, expect } = require('./_setup');

const SIGMET = { id: 'R1', hazard: 'TS', validFrom: 1600000000, validTo: 4100000000,
  coords: [[32.9, 35.5], [33.2, 35.5], [30.3, 34.5], [30.7, 34.4], [32.9, 35.5]], raw: 'R1' };

async function boot(page, { relay }) {
  const asked = { relay: [], github: [] };
  await page.route('https://relay.navaid.test/feeds/**', r => {
    asked.relay.push(r.request().url());
    return relay === 'ok'
      ? r.fulfill({ contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ generatedAt: null, sigmets: [SIGMET], airmets: [] }) })
      : r.fulfill({ status: 503, headers: { 'Access-Control-Allow-Origin': '*' }, body: 'down' });
  });
  await page.route('**/sigmet.json', r => {
    if (r.request().url().includes('relay.navaid.test')) return r.fallback();
    asked.github.push(r.request().url());
    return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ generatedAt: null, sigmets: [] }) });
  });
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof loadSigmets === 'function' && typeof setTune === 'function');
  return asked;
}

test('with the relay named, SIGMETs come from it', async ({ page }) => {
  const asked = await boot(page, { relay: 'ok' });
  const n = await page.evaluate(async () => {
    setTune('hazardFeedBase', 'https://relay.navaid.test/feeds/');
    return (await loadSigmets(true)).length;
  });
  expect(n).toBe(1);
  expect(asked.relay.at(-1)).toBe('https://relay.navaid.test/feeds/sigmet.json');
});

test('a failing relay falls back to the GitHub branch', async ({ page }) => {
  const asked = await boot(page, { relay: 'down' });
  const before = asked.github.length;
  const n = await page.evaluate(async () => {
    setTune('hazardFeedBase', 'https://relay.navaid.test/feeds');
    return (await loadSigmets(true)).length;
  });
  expect(n).toBe(0);
  expect(asked.relay.length).toBeGreaterThan(0);
  expect(asked.github.length).toBeGreaterThan(before);
});

test('empty (the default) reads GitHub and never the relay', async ({ page }) => {
  const asked = await boot(page, { relay: 'ok' });
  await page.evaluate(() => loadSigmets(true));
  expect(asked.relay).toEqual([]);
  expect(asked.github.length).toBeGreaterThan(0);
});
