# Tests — where each suite runs

Every test in this directory runs in **CI** (local Python server,
`http://127.0.0.1:8000`). A subset also runs in **e2e-deployed** against
the byte-identical Pages artifact served locally; pull-request code is not
published under the production origin.

Default **per-test timeout** is **15s** (`playwright.config.js`). Suites that
need more (PNG export downloads, magnifier tile delays, PWA service worker
activation) call `test.describe.configure({ timeout: … })` in their spec file.
`export-png-options.spec.js` and `orient-pageexport.spec.js` both raise timeouts
for download-heavy cases (especially when `EXPECTED_SHA` is set on e2e-deployed).
For `orient-pageexport`, `test.setTimeout` in a `beforeEach` applies the budget under
`tests/_setup.js`'s `test.extend` wrapper (describe-level `configure` alone is not enough).

Share-route tests that assert post-load waypoint positions after a URL round
trip use `tests/_arpFromPage.js` (`r5ArpPairFromPage`) so expectations track the
**live** `airfields.json` in the browser (avoids stale SW / preview cache vs
fixture literals).

## Airfield ARPs in fixtures

Playwright specs that seed **LLHZ / LLHA / LLBG** coordinates import
`tests/_airfieldArp.js` (or call `pairLLHZ_LLHA()` from it) so they track
`docs/data/airfields.json`. After chart position updates, run
`node scripts/sync-airfield-test-arps.js` to regenerate `tests/_airfieldArp.js`
(the module always `require`s the JSON at runtime).

## CI (local) — runs every `.spec.js` file

Trigger: every push to a PR branch, `dev`, or `main`.

```yaml
# .github/workflows/ci.yml
BASE_URL="http://127.0.0.1:8000" npx playwright test
```

- Full isolation — no prior SW, no deployed state.
- Fast feedback (~5 min).
- All SW / PWA tests run here.

## e2e-deployed (built artifact, local server) — excludes SW/PWA tests

Trigger: a pull request. The build job assembles `_site/pr/NNN/` inside the
Pages artifact, but the Pages deploy job is explicitly skipped. The
**`e2e-deployed` job `needs: build`**, downloads/extracts that artifact, serves
it from `127.0.0.1`, verifies the rewritten `core.js` SHA, and runs the subset.

```yaml
# .github/workflows/deploy.yml
BASE_URL="http://127.0.0.1:8000/pr/$PR_NUM/" EXPECTED_SHA="$SHA" npx playwright test \
  $(ls tests/*.spec.js | grep -vE 'sw\.spec|pwa\.spec')
```

Use **`page.goto('?lang=en')`** (or `goto('.')` for the index), **not**
`page.goto('/?lang=en')` — Playwright resolves URLs that start with `/` from
the **origin root**, so `/…` ignores the `/pr/NNN/` base path and hits the wrong
site.

### Excluded files

| File | Reason |
|---|---|
| `tests/bugfix-178-180-sw.spec.js` | Needs isolated cache/SW state; covered by normal CI |
| `tests/pwa.spec.js` | PWA install/manifest and service-worker lifecycle; covered by normal CI |

Exclusion pattern: `grep -vE 'sw\.spec|pwa\.spec'`. Any new file whose
name matches `sw.spec` or `pwa.spec` is automatically excluded.

### Extra checks

- **SHA verification** — `EXPECTED_SHA` env var triggers a post-test
  check in `_setup.js` that fetches `/app/core.js` and compares the version
  SHA. Catches tests running against the wrong deployment.
- **Service workers blocked** — when `EXPECTED_SHA` is set, `playwright.config.js`
  sets `serviceWorkers: 'block'` so cache-first SW cannot serve stale JS
  while HTML/`app/core.js` match the new deploy SHA.
- **Worker cap** — with `EXPECTED_SHA`, Playwright uses **4 workers** so the
  shared artifact server is not overwhelmed.
- **Retry logic** — up to **2** full-suite attempts with 5 s delay; each run
  uses `--max-failures=20` so a broken deploy fails the job sooner instead of
  finishing all specs after many reds.
- **GA blocking** — the app has no GA/GTM runtime; `_setup.js` still aborts
  those hosts as defense in depth against regressions.

- `wiki-screenshots.spec.js` is an on-demand generator (wiki images): it skips itself unless `WIKI_IMG` is set, so it runs only from `.github/workflows/wiki-screenshots.yml`, never in CI `npm test` or e2e-deployed.
