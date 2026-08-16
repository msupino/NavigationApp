// @ts-check
const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  timeout: 15 * 1000,
  fullyParallel: true,
  // Worker count:
  // - EXPECTED_SHA hits one live preview origin — cap at 4 so the log keeps
  //   moving and the preview is not flooded (long “silent” stretches/timeouts).
  // - CI e2e hits a private threaded static server on a dedicated runner, so
  //   use every vCPU ('100%' = 4 on ubuntu-latest) instead of Playwright's
  //   50%-of-cores default (2 workers), which roughly halves wall-clock time.
  //   Requires the multi-threaded server in ci.yml, else extra workers starve
  //   sw.js fetches and the service-worker tests time out. Validated stable.
  // - Local dev keeps the default; '100%' on a busy 8–16 core dev box
  //   oversubscribes CPU (browsers are CPU-bound) and causes timeout flakes.
  workers: process.env.EXPECTED_SHA ? 4 : (process.env.CI ? '100%' : undefined),
  forbidOnly: !!process.env.CI,
  // CI gets a retry budget: the suite is ~1265 tests on a shared runner, where a
  // single load-dependent `page.goto` stall (15s cap) otherwise fails the whole run
  // on an unrelated spec — seen on the dev→main promo, where both failures passed
  // locally against the same commit. A genuine break still fails all attempts, and
  // `trace: 'on-first-retry'` above only becomes useful once retries exist.
  // Local stays at 0 so a real failure surfaces immediately.
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: process.env.BASE_URL || 'http://127.0.0.1:8000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    // Block SW when probing a live preview (`EXPECTED_SHA`) so cache-first
    // cannot serve pre-#418 interact.js while HTML/core match the new SHA
    // (waitForFunction on window.resetWpName would hang forever).
    // Same for offline subpath sim (`NAVAID_E2E_BLOCK_SW`).
    // Service workers are BLOCKED by default. Two reasons, and the second is the load-
    // bearing one: (a) cache-first serving of a stale build, which is why the deployed-
    // preview runs already blocked them; (b) a request made from inside a service worker
    // is NOT visible to page.route, so the fixture's tile interception (tests/_setup.js)
    // silently missed every chart tile and the suite went on hammering a third party's
    // server from CI. Specs that are ABOUT the worker opt back in with
    // `test.use({ serviceWorkers: 'allow' })`.
    serviceWorkers: 'block',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
});
