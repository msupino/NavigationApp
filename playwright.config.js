// @ts-check
const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  timeout: 15 * 1000,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: process.env.BASE_URL || 'http://127.0.0.1:8000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    // Block SW when probing a live preview (`EXPECTED_SHA`) so cache-first
    // cannot serve pre-#418 interact.js while HTML/core match the new SHA
    // (waitForFunction on window.resetWpName would hang forever).
    // Same for offline subpath sim (`NAVAID_E2E_BLOCK_SW`).
    ...(process.env.NAVAID_E2E_BLOCK_SW === '1' || process.env.EXPECTED_SHA
      ? { serviceWorkers: 'block' }
      : {}),
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
});
