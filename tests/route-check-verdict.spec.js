// @ts-check
// Reported on Megiddo to Rosh Pina: the route check's blocked legs were "not very noticeable".
// A blocking finding sat in a collapsed group, drawn almost like a warning, with no verdict.
// Now: a verdict banner first (blocked / warnings), the group holding a block opens by itself
// and is outlined, and a blocking item is tinted with a bar on its leading edge.
const { test, expect } = require('./_setup');

async function boot(page, lang) {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('?lang=' + (lang || 'en') + '&nogist');
  await page.waitForFunction(() => window.NavAid && NavAid.routeCheck && typeof applyRouteTemplate === 'function' && typeof clearBootLoading === 'function');
  await page.evaluate(async () => {
    clearBootLoading(); document.getElementById('map-tour')?.remove();
    const list = await (await fetch('data/route-templates.json')).json();
    await applyRouteTemplate((Array.isArray(list) ? list : list.templates).find(x => x.id === 'llmg-llib-north'), 90, false);
  });
}
const now = Date.now();
const stop = (leg) => ({ kind: 'airspace', severity: 'stop', leg, name: 'LLD 37', airspaceClass: 'D', lowerFt: 0, upperFt: 11000, altFt: 2500, noAltitude: false, from: now, to: now + 6e5 });
const warn = { kind: 'notam', severity: 'warn', leg: 0, id: 'A1234/26', text: 'Crane', from: now, to: now + 6e5 };
const result = (findings) => ({ from: now, to: now + 1.2e6, findings, unchecked: [], partial: [], weatherReports: [], asked: {} });

test('a blocked route says so first, opens the group that holds the block, and marks the item', async ({ page }) => {
  await boot(page);
  await page.evaluate((r) => NavAid.routeCheck.show({ result: r }), result([stop(1), stop(2), warn]));
  const banner = page.locator('.route-check-verdict-stop');
  await expect(banner).toBeVisible();
  await expect(banner).toContainText('Route blocked: 2 legs cross active airspace');
  await expect(banner.locator('.route-check-verdict-legs')).toHaveText('Afula Junction \u2192 Kfar Tavor \u00b7 Kfar Tavor \u2192 Karei Deshe');
  const group = page.locator('.route-check-group[data-type="airspace"]');
  await expect(group).toHaveJSProperty('open', true);
  await expect(group).toHaveClass(/route-check-group-stop/);
  await expect(group.locator('.route-check-item.route-check-stop').first()).toBeVisible();
  // The verdict comes before the groups.
  const firstIsVerdict = await page.evaluate(() => document.querySelector('.route-check-body > *:not(.route-check-asked)')?.classList.contains('route-check-verdict'));
  expect(firstIsVerdict).toBe(true);
});

test('warnings only: an amber count, no block; nothing: the clear line', async ({ page }) => {
  await boot(page);
  await page.evaluate((r) => NavAid.routeCheck.show({ result: r }), result([warn]));
  await expect(page.locator('.route-check-verdict-warn')).toContainText('1 warning to read before you fly');
  await expect(page.locator('.route-check-verdict-stop')).toHaveCount(0);
});

test('Hebrew: the verdict speaks Hebrew', async ({ page }) => {
  await boot(page, 'he');
  await page.evaluate((r) => NavAid.routeCheck.show({ result: r }), result([stop(1)]));
  await expect(page.locator('.route-check-verdict-stop')).toContainText('המסלול חסום');
});
