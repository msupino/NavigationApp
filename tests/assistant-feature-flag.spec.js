// @ts-check
// The assistant's launcher sits in the bottom-right map controls, where a thumb reaching
// for zoom or the follow lock can find it. `featureAssistant` (tuning gist, default on)
// takes the button and the panel off the map entirely — it is a planning-desk tool, and a
// cockpit may not want it on the glass at all.
const { test, expect } = require('./_setup');

const present = (page) => page.evaluate(() => ({
  fab: !!document.querySelector('.assistant-fab'),
  panel: !!document.querySelector('.assistant-panel'),
  // An empty control row left in the corner stack would still take space.
  row: !!document.querySelector('.assistant-fab-control'),
}));

test('on by default: the launcher is there', async ({ page }) => {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => !!document.querySelector('.assistant-fab'));
  const p = await present(page);
  expect(p.fab).toBe(true);
  expect(await page.evaluate(() => tune('featureAssistant'))).toBe(true);
});

test('switched off, the button and the panel go — row and all', async ({ page }) => {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => !!document.querySelector('.assistant-fab') &&
    typeof refreshAssistantFeature === 'function');
  await page.evaluate(() => { setTune('featureAssistant', false); refreshAssistantFeature(); });
  const gone = await present(page);
  expect(gone.fab).toBe(false);
  expect(gone.panel).toBe(false);
  expect(gone.row).toBe(false);
});

test('switching it back on rebuilds it', async ({ page }) => {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof refreshAssistantFeature === 'function');
  await page.evaluate(() => { setTune('featureAssistant', false); refreshAssistantFeature(); });
  expect((await present(page)).fab).toBe(false);
  await page.evaluate(() => { setTune('featureAssistant', true); refreshAssistantFeature(); });
  const back = await present(page);
  expect(back.fab).toBe(true);
  expect(back.row).toBe(true);
});

test('with it off, nothing else in the corner stack moves up wrongly', async ({ page }) => {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => !!document.querySelector('.assistant-fab') &&
    typeof refreshAssistantFeature === 'function');
  await page.evaluate(() => { setTune('featureAssistant', false); refreshAssistantFeature(); });
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
