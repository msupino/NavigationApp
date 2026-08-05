// Builds the IMS chart download list + the two candidate manifests that
// ims-charts.yml converts and finalizes: PWX wind/temperature overlays and SIGWX
// significant-weather pages.
//
// Extracted verbatim from ims-charts.yml's inline `node --input-type=module` heredoc,
// matching scripts/build-aviation-feeds.mjs. The heredoc piped its download list to the
// shell on stdout, which is where the bug this extraction was written for lived: the list
// was joined with '\n' and therefore not newline-terminated, so the shell's `while read`
// loop silently discarded the final line. That line is always a SIGWX chart (SIGWX is
// emitted last), so one SIGWX PNG per run was never downloaded, finalize-ims-manifests saw
// an incomplete candidate, and ims/sigwx.json was preserved instead of updated on every
// single run — the feed froze (issue #1429). The list is a file written here now, with the
// terminator the shell needs, and the pairing between manifest entries and download jobs is
// unit-testable rather than a property of a YAML string.
//
// Scheduled workflows run only from the default branch, so this code cannot be exercised
// before it reaches main. Unit coverage is the only pre-merge signal there is.
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const IMS = 'https://ims.gov.il';
const UA = { 'User-Agent': 'NavAid-ims-bot' };

// IMS pressure-level code → flight level (900/850/700/500 hPa). The app sorts these by
// code descending = FL030 → FL180 (low to high), defaulting to the lowest (FL030).
const LABELS = { '90': 'FL030', '85': 'FL050', '70': 'FL100', '50': 'FL180' };

// PWX is rendered full-page (no crop) so the chart's title band + frame show on the
// overlay; these bounds are extended to the full page so the inner map frame still aligns
// (margins L14/R14/T15/B118 @150dpi).
const PWX_BOUNDS = { s: 28.849, n: 34.075, w: 32.903, e: 37.097 };

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ims.gov.il is slow/throttly from CI IPs — undici's 10s connect timeout + no retry meant
// a single slow connect failed the whole run. Retry with backoff and a generous
// per-attempt timeout.
export function makeFetchJson({ fetchImpl = fetch, delay = sleep } = {}) {
  return async url => {
    let lastErr;
    for (let i = 0; i < 4; i++) {
      try {
        const r = await fetchImpl(url, { headers: UA, signal: AbortSignal.timeout(30000) });
        if (!r.ok) throw new Error(url + ' ' + r.status);
        return (await r.json()).data || {};
      } catch (e) { lastErr = e; await delay(3000 * (i + 1)); }
    }
    throw lastErr;
  };
}

const abs = f => (f.startsWith('http') ? f : IMS + f);

// The sanitiser collapses every run of unsafe characters to one '-', so two different
// source PDFs can reduce to the same name -- and then one silently overwrites the other,
// which is the exact mislabelling this naming exists to prevent. A collision means the
// charts cannot be told apart, so stop: the step fails, nothing is published, and every
// category keeps its complete last-good.
function makeSourceStem() {
  const stemSources = new Map();
  return f => {
    const url = abs(f);
    const name = new URL(url).pathname.split('/').pop() || 'chart';
    const stem = name.replace(/\.pdf$/i, '').replace(/[^A-Za-z0-9_-]+/g, '-');
    const seen = stemSources.get(stem);
    if (seen && seen !== url) {
      throw new Error(`chart name collision: ${stem} <- ${seen} and ${url}`);
    }
    stemSources.set(stem, url);
    return stem;
  };
}

// Every manifest entry gets exactly one download job, so an incomplete download is the only
// way a candidate can come up short. `out` is the path relative to the ims-data root, i.e.
// the manifest's `png` prefixed with the clone directory.
export async function buildImsChartJobs({ fetchJson, now = () => new Date(), log = console.error } = {}) {
  const get = fetchJson || makeFetchJson();
  const sourceStem = makeSourceStem();
  const jobs = [];
  const generatedAt = now().toISOString();

  // --- PWX wind/temperature (georeferenced map overlay) ---
  const pwx = { generatedAt, source: 'IMS wind_and_temperature_maps', run: '',
    bounds: PWX_BOUNDS, levels: [] };
  const pdata = await get(IMS + '/he/wind_and_temperature_maps');
  for (const lvl of Object.keys(pdata)) {
    if (!LABELS[lvl]) continue;
    const times = pdata[lvl] || {};
    const entry = { level: lvl, label: LABELS[lvl], times: [] };
    for (const t of Object.keys(times)) {
      const f = times[t] && times[t].file; if (!f) continue;
      // Keep the model/date-bearing source name in the path. Reusing only HHMM lets a
      // failed replacement masquerade as today's chart.
      const png = `ims/pwx/${lvl}/${sourceStem(f)}.png`;
      // Model run time is the first YYYYMMDDHHMM in the filename
      // (PWX_<run>_<lvl>_<valid>.pdf) — the cropped-off "BASED ON MODEL RUN" line. Same
      // for every chart.
      if (!pwx.run) { const mr = f.match(/_(\d{12})_/); if (mr) pwx.run = mr[1]; }
      entry.times.push({ valid: t, day: times[t].day || '', png });
      jobs.push({ url: abs(f), out: 'ims/' + png, mode: 'pwx' });
    }
    entry.times.sort((a, b) => a.valid.localeCompare(b.valid));
    if (entry.times.length) pwx.levels.push(entry);
  }
  pwx.levels.sort((a, b) => Number(a.level) - Number(b.level));

  // --- SIGWX significant weather (full-page chart, viewer only) ---
  const sigwx = { generatedAt, source: 'IMS significantly_weather_maps', times: [] };
  const sdata = await get(IMS + '/he/significantly_weather_maps');
  for (const t of Object.keys(sdata)) {
    const f = sdata[t] && sdata[t].file; if (!f) continue;
    const png = `ims/sigwx/${sourceStem(f)}.png`;
    sigwx.times.push({ valid: t, day: sdata[t].day || '', png });
    jobs.push({ url: abs(f), out: 'ims/' + png, mode: 'sigwx' });
  }
  // Order by day then valid time so the dropdown reads chronologically.
  sigwx.times.sort((a, b) => (a.day + a.valid).localeCompare(b.day + b.valid));

  log('pwx levels:', pwx.levels.map(l => l.level + '×' + l.times.length).join(' '),
    '| sigwx:', sigwx.times.length);
  return { pwx, sigwx, jobs };
}

// Tab-separated, one job per line, newline-terminated. The terminator is not cosmetic: a
// `while read` loop drops a final line that has none.
export function formatJobsTsv(jobs) {
  return jobs.map(j => [j.url, j.out, j.mode].join('\t') + '\n').join('');
}

export async function writeImsChartJobs({ pwxFile, sigwxFile, jobsFile, write = writeFileSync,
  ...opts } = {}) {
  const built = await buildImsChartJobs(opts);
  write(pwxFile, JSON.stringify(built.pwx, null, 1));
  write(sigwxFile, JSON.stringify(built.sigwx, null, 1));
  write(jobsFile, formatJobsTsv(built.jobs));
  return built;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [, , pwxFile = '/tmp/pwx.candidate.json', sigwxFile = '/tmp/sigwx.candidate.json',
    jobsFile = '/tmp/jobs.tsv'] = process.argv;
  await writeImsChartJobs({ pwxFile, sigwxFile, jobsFile });
}
