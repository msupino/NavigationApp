# Tests — where each suite runs

Every test in this directory runs in **CI** (local Python server,
`http://127.0.0.1:8000`). A subset also runs in **e2e-deployed**
against the live GitHub Pages preview.

## CI (local) — runs every `.spec.js` file

Trigger: every push to a PR branch, `dev`, or `main`.

```yaml
# .github/workflows/ci.yml
BASE_URL="http://127.0.0.1:8000" npx playwright test
```

- Full isolation — no prior SW, no deployed state.
- Fast feedback (~5 min).
- All SW / PWA tests run here.

## e2e-deployed (remote) — excludes SW/PWA tests

Trigger: after the Deploy workflow finishes building a PR preview.

```yaml
# .github/workflows/deploy.yml
BASE_URL="$URL" EXPECTED_SHA="$SHA" npx playwright test \
  $(ls tests/*.spec.js | grep -vE 'sw\.spec|pwa\.spec')
```

Runs against `https://navaid.supino.org/pr/NNN/`.

### Excluded files

| File | Reason |
|---|---|
| `tests/bugfix-178-180-sw.spec.js` | Needs clean origin — deployed preview has a running SW |
| `tests/pwa.spec.js` | PWA install prompt / manifest tests — unreliable on deployed previews |

Exclusion pattern: `grep -vE 'sw\.spec|pwa\.spec'`. Any new file whose
name matches `sw.spec` or `pwa.spec` is automatically excluded.

### Extra checks

- **SHA verification** — `EXPECTED_SHA` env var triggers a post-test
  check in `_setup.js` that fetches `/core.js` and compares the version
  SHA. Catches tests running against the wrong deployment.
- **Retry logic** — up to 5 attempts with 5 s delay between failures.
- **GA blocking** — all GA/GTM hosts are aborted at the network level
  (`_setup.js`). On PR previews GA is skipped entirely in `index.html`.
