// @ts-check
// Wiki edits that go through review land as format-patch files under wiki-patches/ and are
// pushed to <repo>.wiki.git by .github/workflows/wiki-patches.yml. These pins keep that path
// trusted (never run for pull-request code, which would hand the wiki token to a branch) and
// keep each patch a real mail-format commit `git am` can apply.
const { test, expect } = require('./_setup');
const { readFileSync, readdirSync } = require('fs');
const { join } = require('path');

const root = join(__dirname, '..');
const wf = () => readFileSync(join(root, '.github/workflows/wiki-patches.yml'), 'utf8');

// The wiki follows main: a patch goes in when the code it documents is live -- on a push to main,
// or dispatched by Draft + auto-merge after it merges into main (a bot merge starts no workflow).
test('the wiki-patch workflow runs only from main, never for a pull request', () => {
  const src = wf();
  expect(src).toMatch(/push:\s*\n\s*branches: \[main\]/);
  expect(src).not.toMatch(/pull_request/);
  // Applied-already patches are skipped, so re-runs are no-ops: by the subject git am keeps, and
  // by reversing the patch as the fallback.
  expect(src).toMatch(/git mailinfo/);
  expect(src).toMatch(/git apply --reverse --check/);
  // ...but a subject alone does not skip a patch that still applies: a new patch can reuse a
  // subject already in the wiki's history, and it was skipped unapplied.
  expect(src).toMatch(/git apply --check "\$p"[^\n]*\\\n\s*&& ! \{ \[ "\$seen" = 1 \] && git apply --reverse --check/);
  expect(src).toMatch(/persist-credentials: false/);
  const auto = readFileSync(join(root, '.github/workflows/draft-auto-merge.yml'), 'utf8');
  expect(auto).toMatch(/\$BASE" = "main"[\s\S]*?gh workflow run "Apply wiki patches" --ref main/);
});

test('every wiki patch is a format-patch commit that touches wiki pages only', () => {
  const files = readdirSync(join(root, 'wiki-patches')).filter(f => f.endsWith('.patch'));
  expect(files.length).toBeGreaterThan(0);
  for (const f of files) {
    const p = readFileSync(join(root, 'wiki-patches', f), 'utf8');
    expect(p, f).toMatch(/^From [0-9a-f]{40} /);
    expect(p, f).toMatch(/^Subject: /m);
    // Paths in a wiki patch are wiki pages (or its img/ and files/), never app code.
    for (const m of p.matchAll(/^diff --git a\/(\S+) b\//gm)) {
      expect(m[1], f).toMatch(/^(?:[\w.-]+\.md|img\/\S+|files\/\S+)$/);
    }
  }
});

test('the Hebrew formula blocks carry no Hebrew inside the left-to-right code', () => {
  // Hebrew words in an LTR <pre> are reordered by the bidi algorithm -- the TAS and density
  // altitude formulas on Planning-Form-he and Inspector-he rendered garbled.
  const p = readFileSync(join(root, 'wiki-patches/2026-10-15-hebrew-formula-blocks.patch'), 'utf8');
  const added = p.split('\n').filter(l => /^\+(PA|ISA|DA|σ)\s/.test(l));
  // 3 on Planning-Form-he, 2 on Inspector-he (its ISA line had no Hebrew and is unchanged).
  expect(added.length).toBe(5);
  for (const line of added) expect(line).not.toMatch(/[֐-׿]/);
});
