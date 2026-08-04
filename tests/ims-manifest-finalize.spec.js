const { test, expect } = require('./_setup');
const fs = require('fs');
const os = require('os');
const path = require('path');

const put = (file, value = '') => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value));
};

test('partial IMS conversion preserves its whole last-good category and prunes orphans', async () => {
  const { finalizeImsManifests } = await import('../scripts/finalize-ims-manifests.mjs');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'navaid-ims-'));
  const root = path.join(tmp, 'ims-root');
  const pwxCandidate = path.join(tmp, 'pwx.json');
  const sigCandidate = path.join(tmp, 'sig.json');
  try {
    put(path.join(root, 'ims/pwx/old.png'));
    put(path.join(root, 'ims/pwx/orphan.png'));
    put(path.join(root, 'ims/sigwx/new.png'));
    put(path.join(root, 'ims/pwx/new-a.png')); // new-b intentionally failed
    put(path.join(root, 'ims/pwx.json'), { generatedAt: 'old-pwx', levels: [
      { level: '50', times: [{ valid: '12:00', png: 'ims/pwx/old.png' }] },
    ] });
    put(path.join(root, 'ims/sigwx.json'), { generatedAt: 'old-sig', times: [] });
    put(pwxCandidate, { generatedAt: 'new-pwx', levels: [
      { level: '50', times: [
        { valid: '12:00', png: 'ims/pwx/new-a.png' },
        { valid: '15:00', png: 'ims/pwx/new-b.png' },
      ] },
    ] });
    put(sigCandidate, { generatedAt: 'new-sig', times: [
      { valid: '12:00', png: 'ims/sigwx/new.png' },
    ] });

    const result = finalizeImsManifests(root, pwxCandidate, sigCandidate);
    expect(result.pwx.status).toBe('preserved');
    expect(result.sigwx.status).toBe('updated');
    expect(JSON.parse(fs.readFileSync(path.join(root, 'ims/pwx.json'))).generatedAt)
      .toBe('old-pwx');
    expect(JSON.parse(fs.readFileSync(path.join(root, 'ims/sigwx.json'))).generatedAt)
      .toBe('new-sig');
    expect(fs.existsSync(path.join(root, 'ims/pwx/old.png'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'ims/pwx/new-a.png'))).toBe(false);
    expect(fs.existsSync(path.join(root, 'ims/pwx/orphan.png'))).toBe(false);
    expect(fs.existsSync(path.join(root, 'ims/sigwx/new.png'))).toBe(true);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('complete IMS candidate replaces last-good and removes its old PNG', async () => {
  const { finalizeImsManifests } = await import('../scripts/finalize-ims-manifests.mjs');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'navaid-ims-'));
  const root = path.join(tmp, 'ims-root');
  const pwxCandidate = path.join(tmp, 'pwx.json');
  const sigCandidate = path.join(tmp, 'sig.json');
  try {
    put(path.join(root, 'ims/pwx/old.png'));
    put(path.join(root, 'ims/pwx/new.png'));
    put(path.join(root, 'ims/sigwx/new.png'));
    put(path.join(root, 'ims/pwx.json'), { generatedAt: 'old', levels: [
      { level: '50', times: [{ png: 'ims/pwx/old.png' }] },
    ] });
    put(path.join(root, 'ims/sigwx.json'), { generatedAt: 'old', times: [] });
    put(pwxCandidate, { generatedAt: 'new', levels: [
      { level: '50', times: [{ png: 'ims/pwx/new.png' }] },
    ] });
    put(sigCandidate, { generatedAt: 'new', times: [
      { png: 'ims/sigwx/new.png' },
    ] });

    const result = finalizeImsManifests(root, pwxCandidate, sigCandidate);
    expect(result.pwx.status).toBe('updated');
    expect(fs.existsSync(path.join(root, 'ims/pwx/old.png'))).toBe(false);
    expect(fs.existsSync(path.join(root, 'ims/pwx/new.png'))).toBe(true);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('failed PWX and partial SIGWX candidates preserve both last-good manifests', async () => {
  const { finalizeImsManifests } = await import('../scripts/finalize-ims-manifests.mjs');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'navaid-ims-'));
  const root = path.join(tmp, 'ims-root');
  const pwxCandidate = path.join(tmp, 'pwx.json');
  const sigCandidate = path.join(tmp, 'sig.json');
  try {
    put(path.join(root, 'ims/pwx/old.png'));
    put(path.join(root, 'ims/sigwx/old.png'));
    put(path.join(root, 'ims/sigwx/partial.png'));
    put(path.join(root, 'ims/pwx.json'), { generatedAt: 'old-pwx', levels: [
      { level: '50', times: [{ png: 'ims/pwx/old.png' }] },
    ] });
    put(path.join(root, 'ims/sigwx.json'), { generatedAt: 'old-sig', times: [
      { png: 'ims/sigwx/old.png' },
    ] });
    put(pwxCandidate, { generatedAt: 'new-pwx', levels: [
      { level: '50', times: [{ png: 'ims/pwx/missing.png' }] },
    ] });
    put(sigCandidate, { generatedAt: 'new-sig', times: [
      { png: 'ims/sigwx/partial.png' },
      { png: 'ims/sigwx/missing.png' },
    ] });

    const result = finalizeImsManifests(root, pwxCandidate, sigCandidate);
    expect(result.pwx.status).toBe('preserved');
    expect(result.sigwx.status).toBe('preserved');
    expect(JSON.parse(fs.readFileSync(path.join(root, 'ims/pwx.json'))).generatedAt)
      .toBe('old-pwx');
    expect(JSON.parse(fs.readFileSync(path.join(root, 'ims/sigwx.json'))).generatedAt)
      .toBe('old-sig');
    expect(fs.existsSync(path.join(root, 'ims/pwx/old.png'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'ims/sigwx/old.png'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'ims/sigwx/partial.png'))).toBe(false);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('a last-good manifest whose PNGs are gone is refused, not preserved', async () => {
  const { finalizeImsManifests } = await import('../scripts/finalize-ims-manifests.mjs');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'navaid-ims-'));
  const root = path.join(tmp, 'ims-root');
  const pwxCandidate = path.join(tmp, 'pwx.json');
  const sigCandidate = path.join(tmp, 'sig.json');
  try {
    // The candidate is incomplete, so PWX falls to its last-good -- but that manifest points
    // at a PNG nothing has on disk. Preserving it would publish a manifest of 404s and call
    // the run a success; the guarantee that the fresh download cannot clobber the previous
    // run's files belongs to the naming scheme, not to this function, so it is checked here.
    put(path.join(root, 'ims/pwx/present.png'));
    put(path.join(root, 'ims/pwx.json'), { generatedAt: 'old-pwx', levels: [
      { level: '50', times: [
        { valid: '12:00', png: 'ims/pwx/present.png' },
        { valid: '15:00', png: 'ims/pwx/deleted.png' },
      ] },
    ] });
    put(path.join(root, 'ims/sigwx.json'), { generatedAt: 'old-sig', times: [] });
    put(pwxCandidate, { generatedAt: 'new-pwx', levels: [
      { level: '50', times: [{ valid: '12:00', png: 'ims/pwx/never-converted.png' }] },
    ] });
    put(sigCandidate, { generatedAt: 'new-sig', times: [] });

    expect(() => finalizeImsManifests(root, pwxCandidate, sigCandidate))
      .toThrow(/missing PNG/i);
    // ...and it failed before deleting anything.
    expect(fs.existsSync(path.join(root, 'ims/pwx/present.png'))).toBe(true);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
