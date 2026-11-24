// The native app embeds ATC-IL's own radio page. Tests stub the remote page and never request audio.
const { test, expect } = require('./_setup');

async function boot(page, lang = 'en') {
  await page.route('https://www.atc-il.live/**', route => route.fulfill({
    status: 200,
    contentType: 'text/html',
    body: '<!doctype html><html><body><button>ATC-IL test control</button></body></html>',
  }));
  await page.goto(`?lang=${lang}&nogist`);
  await page.waitForFunction(() => !!(window.atcRadio && document.getElementById('tool-atc-radio')));
}

async function enableNativeEmbed(page) {
  await page.evaluate(() => {
    window.Capacitor = { isNativePlatform: () => true };
    NavAid.tuning.featureAtcIlEmbed = true;
    refreshAtcRadioFeature();
  });
}

test('ordinary browsers do not offer or load the ATC radio', async ({ page }) => {
  await boot(page);
  await expect(page.locator('#tool-atc-radio')).toBeHidden();
  await page.evaluate(() => window.atcRadio.open());
  await expect(page.locator('#atc-modal')).toHaveClass(/hidden/);
  await expect(page.locator('#atc-il-frame')).toHaveAttribute('src', 'about:blank');
});

test('the native app opens ATC-IL in a visible frame with an external fallback', async ({ page }) => {
  await boot(page);
  await enableNativeEmbed(page);
  await page.locator('#tool-atc-radio').click();
  await expect(page.locator('#atc-modal')).not.toHaveClass(/hidden/);
  await expect(page.locator('#atc-il-frame')).toHaveAttribute('src', 'https://www.atc-il.live/');
  await expect(page.frameLocator('#atc-il-frame').getByRole('button', { name: 'ATC-IL test control' })).toBeVisible();
  await expect(page.locator('.atc-open-provider')).toHaveAttribute('href', 'https://www.atc-il.live/');
  await expect(page.locator('#tool-atc-radio')).toHaveAttribute('aria-expanded', 'true');
});

test('closing the panel keeps the provider page loaded; Stop unloads it', async ({ page }) => {
  await boot(page);
  await enableNativeEmbed(page);
  await page.evaluate(() => window.atcRadio.open());
  await page.locator('#atc-modal-close').click();
  await expect(page.locator('#atc-modal')).toHaveClass(/hidden/);
  await expect(page.locator('#atc-il-frame')).toHaveAttribute('src', 'https://www.atc-il.live/');
  await page.evaluate(() => window.atcRadio.stop());
  await expect(page.locator('#atc-il-frame')).toHaveAttribute('src', 'about:blank');
});

test('the app feature switch hides and unloads the embedded page', async ({ page }) => {
  await boot(page);
  await enableNativeEmbed(page);
  await page.evaluate(() => window.atcRadio.open());
  await page.evaluate(() => {
    NavAid.tuning.featureAtcIlEmbed = false;
    refreshAtcRadioFeature();
  });
  await expect(page.locator('#tool-atc-radio')).toBeHidden();
  await expect(page.locator('#atc-il-frame')).toHaveAttribute('src', 'about:blank');
});

test('the Hebrew note and external fallback are localized', async ({ page }) => {
  await boot(page, 'he');
  await enableNativeEmbed(page);
  await page.evaluate(() => window.atcRadio.open());
  await expect(page.locator('#atc-modal-title')).toHaveText('רדיו בקרה');
  await expect(page.locator('.atc-open-provider')).toHaveText('פתיחת ATC-IL בנפרד');
});
