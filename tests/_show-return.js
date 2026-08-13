// The return path ships OFF (featureShowReturn). Tests that exercise the control, its B
// shortcut or its cheat-sheet row have to ask for the feature rather than inherit it --
// the same way hide-leg-kite and the flight-plan return-toggle test do.
async function enableShowReturn(page) {
  await page.evaluate(() => {
    const orig = window.tune;
    if (!window.__origTuneShowReturn) window.__origTuneShowReturn = orig;
    window.tune = (k) => (k === 'featureShowReturn' ? true : window.__origTuneShowReturn(k));
    if (typeof refreshShowReturnFeature === 'function') refreshShowReturnFeature();
  });
}
module.exports = { enableShowReturn };
