// @ts-check
/**
 * `{ LLHZ, LLHA }` as `r5(lat/lng)` from the **live** page after
 * `airfields.json` has loaded. Use after share/import boot so assertions
 * match whatever ARPs the browser actually snapped to (avoids PR-preview
 * cache serving a different `airfields.json` than Node test literals).
 */
async function r5ArpPairFromPage(page) {
  await page.waitForFunction(() =>
    Array.isArray(window.airfields) &&
    window.airfields.length > 0 &&
    typeof r5 === 'function');
  return page.evaluate(() => {
    /** @param {string} code */
    const pick = code => {
      const a = airfields.find(x => x.name === code);
      return a ? { lat: r5(a.lat), lng: r5(a.lng) } : null;
    };
    return { LLHZ: pick('LLHZ'), LLHA: pick('LLHA') };
  });
}

module.exports = { r5ArpPairFromPage };
