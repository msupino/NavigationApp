// @ts-check
// The IMS chart job/manifest build (scripts/build-ims-chart-jobs.mjs), extracted from
// ims-charts.yml.
//
// The rule under test is that every manifest entry gets a download job the shell actually
// executes. When the list was piped to the shell on stdout without a trailing newline, the
// `while read` loop dropped its last line — always a SIGWX chart — so the SIGWX candidate
// was permanently one entry short, finalize-ims-manifests preserved last-good every run,
// and ims/sigwx.json froze (issue #1429). A scheduled workflow runs only from the default
// branch, so nothing could catch that before promotion; these tests can.
const { test, expect } = require('./_setup');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const pwxFile = (lvl, valid) => `/PWX/PWX_202608050912_${lvl}_${valid}.pdf`;

const PWX_DATA = {
  '90': { '12:00': { file: pwxFile('90', '202608051200'), day: '05/08/2026' },
    '18:00': { file: pwxFile('90', '202608051800'), day: '05/08/2026' } },
  '50': { '12:00': { file: pwxFile('50', '202608051200'), day: '05/08/2026' } },
  '99': { '12:00': { file: '/PWX/PWX_202608050912_99_202608051200.pdf', day: '05/08/2026' } },
};
const SIGWX_DATA = {
  '18:00': { file: '/PGX/PGX_202608050043_202608051800.pdf', day: '05/08/2026' },
  '00:00': { file: '/PGX/PGX_202608050535_202608060000.pdf', day: '06/08/2026' },
  '06:00': { file: '/PGX/PGX_202608051130_202608060600.pdf', day: '06/08/2026' },
};

const fakeFetch = (pwx = PWX_DATA, sigwx = SIGWX_DATA) => async url => ({
  ok: true, status: 200,
  json: async () => ({ data: url.includes('wind_and_temperature') ? pwx : sigwx }),
});

async function build(plan) {
  const mod = await import('../scripts/build-ims-chart-jobs.mjs');
  const built = await mod.buildImsChartJobs({
    fetchJson: mod.makeFetchJson({ fetchImpl: plan || fakeFetch(), delay: async () => {} }),
    log: () => {},
  });
  return { mod, ...built };
}

const manifestPngs = ({ pwx, sigwx }) => [
  ...pwx.levels.flatMap(l => l.times.map(t => t.png)),
  ...sigwx.times.map(t => t.png),
];

test('every manifest entry gets exactly one download job', async () => {
  const built = await build();
  expect(built.jobs.map(j => j.out).sort())
    .toEqual(manifestPngs(built).map(png => 'ims/' + png).sort());
  expect(built.jobs.filter(j => j.mode === 'sigwx')).toHaveLength(3);
  expect(built.jobs.filter(j => j.mode === 'pwx')).toHaveLength(3);   // level 99 is skipped
  for (const job of built.jobs) expect(job.url).toMatch(/^https:\/\/ims\.gov\.il\//);
});

test("the job list a shell `while read` loop consumes yields every job, last one included", async () => {
  const { mod, jobs } = await build();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'navaid-ims-jobs-'));
  const tsv = path.join(tmp, 'jobs.tsv');
  try {
    fs.writeFileSync(tsv, mod.formatJobsTsv(jobs));
    // The workflow's own loop header. Reading the file back through bash is the point:
    // a list that is not newline-terminated loses its final line here and nowhere else,
    // and the lost line is always SIGWX because SIGWX is emitted last.
    const seen = execFileSync('bash', ['-c',
      `while IFS=$'\\t' read -r url out mode; do [ -z "$url" ] && continue; echo "$out"; done < ${tsv}`,
    ], { encoding: 'utf8' }).trim().split('\n');
    expect(seen).toEqual(jobs.map(j => j.out));
    expect(seen).toContain('ims/' + jobs[jobs.length - 1].out.replace(/^ims\//, ''));
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('manifests carry the sorted, labelled shape the app reads', async () => {
  const { pwx, sigwx } = await build();
  expect(pwx.levels.map(l => l.level)).toEqual(['50', '90']);
  expect(pwx.levels.map(l => l.label)).toEqual(['FL180', 'FL030']);
  expect(pwx.run).toBe('202608050912');
  expect(pwx.bounds).toEqual({ s: 28.849, n: 34.075, w: 32.903, e: 37.097 });
  // Chart PNGs keep their model/date-bearing source name, so a failed replacement cannot
  // masquerade as today's chart by reusing HHMM.
  expect(pwx.levels[1].times.map(t => t.png)).toEqual([
    'ims/pwx/90/PWX_202608050912_90_202608051200.png',
    'ims/pwx/90/PWX_202608050912_90_202608051800.png',
  ]);
  // SIGWX reads chronologically across the day boundary: 05/08 18:00 → 06/08 00:00 → 06:00.
  expect(sigwx.times.map(t => t.day + ' ' + t.valid))
    .toEqual(['05/08/2026 18:00', '06/08/2026 00:00', '06/08/2026 06:00']);
});

test('two source PDFs that sanitise to one name fail the build instead of overwriting', async () => {
  await expect(build(fakeFetch(PWX_DATA, {
    '00:00': { file: '/PGX/PGX@202608060000.pdf', day: '06/08/2026' },
    '06:00': { file: '/PGX/PGX+202608060000.pdf', day: '06/08/2026' },
  }))).rejects.toThrow(/chart name collision/);
});

test('a chart entry with no file is skipped, not turned into a broken job', async () => {
  const { sigwx, jobs } = await build(fakeFetch(PWX_DATA, {
    '18:00': { file: '/PGX/PGX_202608050043_202608051800.pdf', day: '05/08/2026' },
    '00:00': { day: '06/08/2026' },
  }));
  expect(sigwx.times).toHaveLength(1);
  expect(jobs.filter(j => j.mode === 'sigwx')).toHaveLength(1);
});

test('a persistently failing source fails the build so nothing is published', async () => {
  const mod = await import('../scripts/build-ims-chart-jobs.mjs');
  await expect(mod.buildImsChartJobs({
    log: () => {},
    fetchJson: mod.makeFetchJson({
      fetchImpl: async () => ({ ok: false, status: 503, json: async () => ({}) }),
      delay: async () => {},
    }),
  })).rejects.toThrow(/503/);
});
