// @ts-check
// `featureAssistant` ships OFF (docs/app/core.js): the assistant is a planning-desk tool
// and the map is what a pilot reads, so it is opted into. Specs that exercise it -- or that
// assert where its launcher sits in the corner stack -- switch it on here.
//
// Called AFTER the page has loaded and then rebuilt explicitly, rather than racing the
// build from an init script: the launcher is created on DOMContentLoaded, so a tune set a
// moment too late would leave the spec with no button and no clue why.
async function enableAssistant(page) {
  await page.waitForFunction(() => typeof setTune === 'function' &&
    typeof refreshAssistantFeature === 'function');
  await page.evaluate(() => {
    setTune('featureAssistant', true);
    refreshAssistantFeature();
  });
  await page.waitForSelector('.assistant-fab', { state: 'attached' });
}

module.exports = { enableAssistant };
