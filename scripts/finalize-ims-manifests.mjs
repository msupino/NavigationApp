import { existsSync, readFileSync, writeFileSync, readdirSync, unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const readJson = file => JSON.parse(readFileSync(file, 'utf8'));

function retainCompleteCandidate({ candidateFile, liveFile, entries, filter, hasPng }) {
  const candidate = readJson(candidateFile);
  const expected = entries(candidate).length;
  const kept = filter(candidate);
  const actual = entries(kept).length;
  if (expected > 0 && actual === expected) {
    writeFileSync(liveFile, JSON.stringify(kept, null, 1));
    return { status: 'updated', expected, actual };
  }
  if (!existsSync(liveFile)) {
    throw new Error(`Incomplete candidate (${actual}/${expected}) and no last-good manifest: ${liveFile}`);
  }
  // Preserving is only safe if the last-good manifest still describes files that are on
  // disk. Today the fresh download cannot clobber it (source-named PNGs never collide with
  // the previous run's), but that is a property of the naming, not of this function -- so
  // check it here rather than leave the guarantee to a caller nobody reads.
  const live = readJson(liveFile);
  const missing = entries(live).map(entry => entry.png).filter(png => !hasPng(png));
  if (missing.length) {
    throw new Error(`Last-good manifest ${liveFile} references ${missing.length} missing `
      + `PNG(s), first: ${missing[0]}`);
  }
  return { status: 'preserved', expected, actual };
}

function walkPngs(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const file = join(dir, entry.name);
    if (entry.isDirectory()) walkPngs(file, out);
    else if (entry.isFile() && entry.name.endsWith('.png')) out.push(file);
  }
  return out;
}

export { reportStatus };
export function finalizeImsManifests(rootDir, pwxCandidateFile, sigwxCandidateFile) {
  const has = png => existsSync(join(rootDir, png));
  const pwxFile = join(rootDir, 'ims/pwx.json');
  const sigwxFile = join(rootDir, 'ims/sigwx.json');

  const pwx = retainCompleteCandidate({
    candidateFile: pwxCandidateFile,
    liveFile: pwxFile,
    hasPng: has,
    entries: doc => doc.levels.flatMap(level => level.times),
    filter: doc => ({ ...doc, levels: doc.levels
      .map(level => ({ ...level, times: level.times.filter(time => has(time.png)) }))
      .filter(level => level.times.length) }),
  });
  const sigwx = retainCompleteCandidate({
    candidateFile: sigwxCandidateFile,
    liveFile: sigwxFile,
    hasPng: has,
    entries: doc => doc.times,
    filter: doc => ({ ...doc, times: doc.times.filter(time => has(time.png)) }),
  });

  const finalPwx = readJson(pwxFile);
  const finalSigwx = readJson(sigwxFile);
  const referenced = new Set([
    ...finalPwx.levels.flatMap(level => level.times.map(time => resolve(rootDir, time.png))),
    ...finalSigwx.times.map(time => resolve(rootDir, time.png)),
  ]);
  let pruned = 0;
  for (const file of [
    ...walkPngs(join(rootDir, 'ims/pwx')),
    ...walkPngs(join(rootDir, 'ims/sigwx')),
  ]) {
    if (!referenced.has(resolve(file))) {
      // A file that vanished between the walk and here is already gone; that is the
      // outcome this loop wanted, so it must not fail the run.
      try { unlinkSync(file); pruned++; } catch (e) {
        if (e.code !== 'ENOENT') throw e;
      }
    }
  }
  return { pwx, sigwx, pruned };
}

// A category that keeps its last-good manifest has NOT advanced, and every run that does so
// used to exit 0 with nothing in the annotations panel. That is how SIGWX sat frozen for ~9 h
// behind unbroken green runs (#1429): the only detector was the staleness monitor, which lags
// by hours. Preserving is the right OUTCOME and a visible one.
function reportStatus(result) {
  for (const [name, r] of [['PWX', result.pwx], ['SIGWX', result.sigwx]]) {
    if (r && r.status === 'preserved') {
      console.error('::warning::' + name + ' kept its last-good manifest (' + r.actual + '/' +
        r.expected + ' charts converted); the feed has not advanced.');
    }
  }
  const bothStuck = result.pwx && result.sigwx &&
    result.pwx.status === 'preserved' && result.sigwx.status === 'preserved';
  if (bothStuck) {
    console.error('::error::Neither chart category advanced; nothing new was published.');
  }
  return bothStuck;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [, , rootDir = 'ims', pwxCandidate = '/tmp/pwx.candidate.json',
    sigwxCandidate = '/tmp/sigwx.candidate.json'] = process.argv;
  const result = finalizeImsManifests(rootDir, pwxCandidate, sigwxCandidate);
  console.error(JSON.stringify(result));
  if (reportStatus(result)) process.exitCode = 1;
}
