// @ts-check
// The Simulator (SimConnect) controls moved from a toolbar section to a small
// footer icon that opens a modal panel.
const { test, expect } = require('./_setup');

test('footer sim icon opens the simulator panel; Esc closes it', async ({ page }) => {
  await page.goto('?lang=en');
  await page.waitForFunction(() => typeof state !== 'undefined');

  // No simulator toolbar section anymore.
  await expect(page.locator('.tb-section[data-sec="sim"]')).toHaveCount(0);

  // Footer icon present; modal hidden initially.
  const trigger = page.locator('#sim-trigger');
  await expect(trigger).toBeVisible();
  await expect(page.locator('#sim-modal')).toBeHidden();

  // Opening reveals the sim controls.
  await trigger.click();
  await expect(page.locator('#sim-modal')).toBeVisible();
  // Three stacked buttons: connect, follow, center.
  await expect(page.locator('#sim-modal .modal.sim-modal > button:not(.sim-modal-close)')).toHaveCount(3);
  await expect(page.locator('#sim-modal #sim-connect-cb')).toBeVisible();
  await expect(page.locator('#sim-modal #sim-follow-cb')).toBeVisible();
  await expect(page.locator('#sim-modal #sim-center')).toBeVisible();
  await expect(page.locator('#sim-modal #sim-url')).toBeVisible();

  // Center is a one-shot — clicking flashes for feedback even with no live
  // aircraft (muted no-data flash).
  await page.locator('#sim-modal #sim-center').click();
  await expect(page.locator('#sim-modal #sim-center')).toHaveClass(/sim-flash/);

  // Follow is a toggle with a visible active (aria-pressed) state.
  const follow = page.locator('#sim-modal #sim-follow-cb');
  await expect(follow).toHaveAttribute('aria-pressed', 'false');
  await follow.click();
  await expect(follow).toHaveAttribute('aria-pressed', 'true');
  await follow.click();
  await expect(follow).toHaveAttribute('aria-pressed', 'false');

  // Esc closes.
  await page.keyboard.press('Escape');
  await expect(page.locator('#sim-modal')).toBeHidden();

  // Close button also works.
  await trigger.click();
  await expect(page.locator('#sim-modal')).toBeVisible();
  await page.locator('#sim-modal-close').click();
  await expect(page.locator('#sim-modal')).toBeHidden();
});

test('desktop simulator panel is draggable by its title and stays in the viewport', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('?lang=en&nogist');
  await page.locator('#sim-trigger').click();

  const box = page.locator('#sim-modal .modal.sim-modal');
  const title = page.locator('#sim-modal .sim-modal-title');
  const before = await box.boundingBox();
  const grip = await title.boundingBox();
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(grip.x + grip.width / 2 + 180, grip.y + grip.height / 2 + 90,
    { steps: 8 });
  await page.mouse.up();

  const after = await box.boundingBox();
  expect(after.x).toBeGreaterThan(before.x + 100);
  expect(after.y).toBeGreaterThan(before.y + 40);
  expect(after.x).toBeGreaterThanOrEqual(0);
  expect(after.y).toBeGreaterThanOrEqual(0);
  expect(after.x + after.width).toBeLessThanOrEqual(1280);
  expect(after.y + after.height).toBeLessThanOrEqual(800);
  await expect(page.locator('#sim-modal #sim-connect-cb')).toBeVisible();
  await expect(page.locator('#sim-modal-close')).toBeVisible();
});

test('the sim icon stays visible on a mobile viewport -- connecting one is how the watch alerts get tested there', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => !!document.getElementById('sim-trigger'));
  await expect(page.locator('#sim-trigger')).toBeVisible();
});

test('simulator URL guidance distinguishes desktop, iPad browser, and native app', async ({ page }) => {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof window.simConnectionProblem === 'function');
  const out = await page.evaluate(() => ({
    desktopLoopback: simConnectionProblem('http://localhost:2020',
      { kind: 'desktop', pageProtocol: 'https:' }),
    desktopLan: simConnectionProblem('http://192.168.1.20:2020',
      { kind: 'desktop', pageProtocol: 'https:' }),
    ipadLoopback: simConnectionProblem('http://localhost:2020',
      { kind: 'ipad', pageProtocol: 'https:' }),
    ipadHttps: simConnectionProblem('https://sim.example.test',
      { kind: 'ipad', pageProtocol: 'https:' }),
    ipadHttpLan: simConnectionProblem('http://192.168.1.20:2020',
      { kind: 'ipad', pageProtocol: 'http:' }),
    nativeHttp: simConnectionProblem('http://192.168.1.20:2020',
      { kind: 'native', pageProtocol: 'https:' }),
    nativeLoopback: simConnectionProblem('http://localhost:2020',
      { kind: 'native', pageProtocol: 'https:' }),
    invalid: simConnectionProblem('sim-pc:2020',
      { kind: 'desktop', pageProtocol: 'https:' }),
  }));
  expect(out.desktopLoopback).toBe('');
  expect(out.desktopLan).toMatch(/NavAid uses HTTPS.*bridge uses HTTP/i);
  expect(out.ipadLoopback).toMatch(/localhost means this iPad/i);
  expect(out.ipadHttps).toBe('');
  expect(out.ipadHttpLan).toBe('');
  expect(out.nativeHttp).toBe('');
  expect(out.nativeLoopback).toMatch(/localhost means this device/i);
  expect(out.invalid).toMatch(/complete HTTP or HTTPS bridge URL/i);
});

test('native iOS polls an HTTP LAN bridge through CapacitorHttp', async ({ page }) => {
  await page.addInitScript(() => {
    window.__nativeHttpRequests = [];
    window.Capacitor = {
      isNativePlatform: () => true,
      getPlatform: () => 'ios',
      Plugins: {
        CapacitorHttp: {
          get: async options => {
            window.__nativeHttpRequests.push(options);
            return {
              status: 200,
              data: { latitude: 32.1, longitude: 34.8, altitude: 1000, heading: 90, ias: 110 },
            };
          },
        },
      },
    };
  });
  await page.goto('?lang=en&nogist');
  await page.locator('#sim-trigger').click();
  await page.locator('#sim-url').fill('http://192.168.1.20:2020');
  await page.locator('#sim-connect-cb').click();
  await expect(page.locator('#sim-connect-cb')).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => page.evaluate(() => window.__nativeHttpRequests.length)).toBeGreaterThan(0);
  const request = await page.evaluate(() => window.__nativeHttpRequests[0]);
  expect(request).toMatchObject({
    url: 'http://192.168.1.20:2020',
    connectTimeout: 900,
    readTimeout: 900,
    responseType: 'json',
  });
  await page.locator('#sim-connect-cb').click();
});

test('an iPad on an HTTP NavAid page is guided to the Mac LAN address, not localhost', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'platform', { value: 'MacIntel', configurable: true });
    Object.defineProperty(navigator, 'maxTouchPoints', { value: 5, configurable: true });
  });
  await page.goto('?lang=en&nogist');
  await page.locator('#sim-trigger').click();
  await expect(page.locator('#sim-url-help')).toContainText('Mac’s HTTP LAN address');
  await expect(page.locator('#sim-url-help')).toContainText('http://192.168.1.20:2020');
});

test('an invalid simulator URL shows a clear error and never starts polling', async ({ page }) => {
  await page.goto('?lang=en&nogist');
  await page.locator('#sim-trigger').click();
  await page.locator('#sim-url').fill('sim-pc:2020');
  await page.locator('#sim-connect-cb').click();
  await expect(page.locator('#sim-status')).toContainText('complete HTTP or HTTPS bridge URL');
  await expect(page.locator('#sim-connect-cb')).toHaveAttribute('aria-pressed', 'false');
  const state = await page.evaluate(() => ({ simOn, aircraft: window.simAircraft || null }));
  expect(state.simOn).toBe(false);
  expect(state.aircraft).toBeNull();
});

test('editing a connected simulator to an unusable URL disconnects with the specific error', async ({ page }) => {
  await page.goto('?lang=en&nogist');
  await page.locator('#sim-trigger').click();
  await page.locator('#sim-url').fill('http://localhost:2020');
  await page.locator('#sim-connect-cb').click();
  await expect(page.locator('#sim-connect-cb')).toHaveAttribute('aria-pressed', 'true');

  // The local test server is HTTP, so use an invalid scheme to exercise the real input
  // handler's disconnect path. The pure-validator test above separately pins the exact
  // HTTPS/HTTP mixed-content message and each platform distinction.
  await page.locator('#sim-url').fill('ftp://sim-pc.local:2020');
  await page.locator('#sim-url').press('Tab');
  await expect(page.locator('#sim-connect-cb')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#sim-status')).toContainText('complete HTTP or HTTPS bridge URL');
  expect(await page.evaluate(() => simOn)).toBe(false);
});

// Reported from the installed APK: the sim button was invisible AND untappable there,
// while the same build id at the same width in Chrome on the same phone drew it. It was
// the only footer button using an inline <svg>; the two GPS buttons beside it use emoji
// glyphs and rendered in both. On mobile its text label is hidden, so a glyph that does
// not paint leaves a blank ~16px at the edge of the row -- nothing to see, nothing to
// hit. This pins the icon to a real rendered glyph and to the same shape its siblings
// use, rather than markup that can silently paint nothing.
test('the footer sim icon draws a glyph, like its GPS siblings', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 808 });
  await page.goto('?lang=he');
  await page.waitForFunction(() => !!document.getElementById('sim-trigger'));
  const out = await page.evaluate(() => {
    const btn = document.getElementById('sim-trigger');
    const icon = btn.querySelector('.footer-link-icon');
    const r = btn.getBoundingClientRect();
    const ir = icon ? icon.getBoundingClientRect() : null;
    return {
      iconTag: icon ? icon.tagName : null,
      text: icon ? icon.textContent.trim() : '',
      btnW: Math.round(r.width),
      iconW: ir ? Math.round(ir.width) : 0,
      // Same element shape as the buttons that are known to render in the APK.
      gpsIconTags: [...document.querySelectorAll('#gps-record .footer-link-icon, #gps-live .footer-link-icon')]
        .map(e => e.tagName),
    };
  });
  expect(out.iconTag).toBe('SPAN');
  expect(out.gpsIconTags).toEqual(['SPAN', 'SPAN']);
  expect(out.text.length).toBeGreaterThan(0);
  // The label is hidden at this width, so the icon IS the button: it has to carry
  // real width, not collapse to padding.
  expect(out.iconW).toBeGreaterThan(8);
  expect(out.btnW).toBeGreaterThan(20);
});
