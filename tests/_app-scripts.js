// @ts-check
// The deployed site does not load the app scripts one by one: scripts/bundle-app.mjs packs
// them into app/boot.bundle.js and app/later.bundle.js, and the loader in index.html runs each
// file from the bundle as its own inline <script data-src="app/x.js">. The source tree (and
// the local test server) loads them one by one. Specs that break, time or look for one app
// script go through here, so they test the same thing against both -- the e2e-deployed
// shards run them against the bundled site.

// Which bundle carries each phase's files (index.html: `srcs` -> boot, `later` -> later).
const PHASE_BUNDLE = { 'ui.js': 'boot.bundle.js', 'deck.js': 'boot.bundle.js',
  'traffic.js': 'later.bundle.js', 'ota.js': 'later.bundle.js' };

// Route one app script, wherever it comes from. `handler(route, bundle)` is called for the
// file's own request (bundle = null) or for the bundle that carries it, with
// bundle.withCode(code) returning that bundle with the file's text replaced -- the loader
// still runs it as that file's own script. A bundle without the file passes through.
async function routeAppScript(page, file, handler) {
  await page.route('**/' + file + '*', (route) => handler(route, null));
  await page.route('**/app/*.bundle.js*', async (route) => {
    const res = await route.fetch();
    const body = await res.text();
    if (!body.includes(JSON.stringify(file))) return route.fulfill({ response: res, body });
    const at = body.indexOf('] = [') + 4;               // the entries are a JSON array
    const end = body.lastIndexOf(';');
    const withCode = (code) => body.slice(0, at) + JSON.stringify(JSON.parse(body.slice(at, end))
      .map(([name, text]) => [name, name === file ? code : text])) + body.slice(end);
    return handler(route, { res, body, withCode });
  });
}

// Start time (ms) of the download that brought `file` (e.g. 'traffic.js'): its own request,
// or the bundle's on a bundled site. Run inside page.evaluate via resourceStartFn.
const resourceStartFn = ({ f, bundle }) => {
  const res = performance.getEntriesByType('resource');
  const e = res.find((r) => r.name.includes('/app/' + f + '?'))
    || (bundle && res.find((r) => r.name.includes('/app/' + bundle)));
  return e ? e.startTime : null;
};

// The app scripts that ran, as 'app/x.js', in document order, bundled or not.
const loadedAppScriptsFn = () => [...document.scripts]
  .map((s) => s.getAttribute('data-src') || (s.getAttribute('src') || '').split('?')[0])
  .filter((s) => s.startsWith('app/') && !/\.bundle\.js$/.test(s));

module.exports = { PHASE_BUNDLE, routeAppScript, resourceStartFn, loadedAppScriptsFn };
