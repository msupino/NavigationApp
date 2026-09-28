// Settings in force from the first line of the app (core.js __navaidTuneBoot). The built-in
// defaults mirror the live gist, which switches some features off; a spec about one of those
// asks for it here, before the page loads.
async function bootTunes(page, tunes) {
  await page.addInitScript((t) => { window.__navaidTuneBoot = Object.assign(window.__navaidTuneBoot || {}, t); }, tunes);
}
module.exports = { bootTunes };
