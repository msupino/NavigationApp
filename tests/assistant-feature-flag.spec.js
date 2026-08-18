// @ts-check
// The assistant's launcher sits in the bottom-right map controls, where a thumb reaching
// for zoom or the follow lock finds it. `featureAssistant` ships OFF: the assistant is a
// planning-desk tool and the map is what a pilot is reading, so it is opted into rather
// than out of. Switching it on brings back the button and the panel.
const { test, expect } = require('./_setup');

const present = (page) => page.evaluate(() => ({
  fab: !!document.querySelector('.assistant-fab'),
  panel: !!document.querySelector('.assistant-panel'),
  // An empty control row left in the corner stack would still take space.
  row: !!document.querySelector('.assistant-fab-control'),
}));

test('off by default: nothing on the map', async ({ page }) => {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof tune === 'function' && typeof refreshAssistantFeature === 'function');
  expect(await page.evaluate(() => tune('featureAssistant'))).toBe(false);
  const p = await present(page);
  expect(p.fab).toBe(false);
  expect(p.panel).toBe(false);
  expect(p.row).toBe(false);          // no empty control row holding a slot either
});

test('switched on, the launcher appears', async ({ page }) => {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof refreshAssistantFeature === 'function');
  await page.evaluate(() => { setTune('featureAssistant', true); refreshAssistantFeature(); });
  const p = await present(page);
  expect(p.fab).toBe(true);
  expect(p.row).toBe(true);
});

test('switched off again, the button and the panel go — row and all', async ({ page }) => {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof refreshAssistantFeature === 'function');
  await page.evaluate(() => { setTune('featureAssistant', true); refreshAssistantFeature(); });
  await page.evaluate(() => { setTune('featureAssistant', false); refreshAssistantFeature(); });
  const gone = await present(page);
  expect(gone.fab).toBe(false);
  expect(gone.panel).toBe(false);
  expect(gone.row).toBe(false);
});

test('switching it back on rebuilds it', async ({ page }) => {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof refreshAssistantFeature === 'function');
  expect((await present(page)).fab).toBe(false);
  await page.evaluate(() => { setTune('featureAssistant', true); refreshAssistantFeature(); });
  const back = await present(page);
  expect(back.fab).toBe(true);
  expect(back.row).toBe(true);
});

test('with it off, the rest of the corner stack is untouched', async ({ page }) => {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof refreshAssistantFeature === 'function' &&
    !!document.querySelector('.leaflet-control-zoom'));
  const stack = await page.evaluate(() => {
    const corner = document.querySelector('.leaflet-bottom.leaflet-right');
    return {
      rows: Array.from(corner.children).map(c => c.className).join('|'),
      dial: !!document.getElementById('rotate-dial'),
      zoom: !!document.querySelector('.leaflet-control-zoom'),
    };
  });
  expect(stack.rows).not.toContain('assistant');
  expect(stack.dial).toBe(true);        // the controls that remain are untouched
  expect(stack.zoom).toBe(true);
});
