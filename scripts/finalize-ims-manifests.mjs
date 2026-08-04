import { existsSync, readFileSync, writeFileSync, readdirSync, unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const readJson = file => JSON.parse(readFileSync(file, 'utf8'));

function retainCompleteCandidate({ candidateFile, liveFile, entries, filter }) {
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

export function finalizeImsManifests(rootDir, pwxCandidateFile, sigwxCandidateFile) {
  const has = png => existsSync(join(rootDir, png));
  const pwxFile = join(rootDir, 'ims/pwx.json');
  const sigwxFile = join(rootDir, 'ims/sigwx.json');

  const pwx = retainCompleteCandidate({
    candidateFile: pwxCandidateFile,
    liveFile: pwxFile,
    entries: doc => doc.levels.flatMap(level => level.times),
    filter: doc => ({ ...doc, levels: doc.levels
      .map(level => ({ ...level, times: level.times.filter(time => has(time.png)) }))
      .filter(level => level.times.length) }),
  });
  const sigwx = retainCompleteCandidate({
    candidateFile: sigwxCandidateFile,
    liveFile: sigwxFile,
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
      unlinkSync(file);
      pruned++;
    }
  }
  return { pwx, sigwx, pruned };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [, , rootDir = 'ims', pwxCandidate = '/tmp/pwx.candidate.json',
    sigwxCandidate = '/tmp/sigwx.candidate.json'] = process.argv;
  const result = finalizeImsManifests(rootDir, pwxCandidate, sigwxCandidate);
  console.error(JSON.stringify(result));
}
