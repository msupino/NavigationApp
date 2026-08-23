// @ts-check
// An imported library file's GPS track went into storage exactly as written, and its
// savedAt with it. Both matter beyond this device: the library is synced to Drive, so junk
// reaches every other device, and both the library sort and the Drive merge rank entries by
// that savedAt string — an unparseable one silently loses every conflict it takes part in.
const { test, expect } = require('./_setup');

async function boot(page) {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof importRouteLibraryArray === 'function' &&
    typeof sanitizeTrack === 'function' && typeof sanitizeSavedAt === 'function');
  await page.evaluate(() => localStorage.removeItem('navaid.routeLibrary'));
}

const fix = (lat, lng, t) => ({ lat, lng, t });

test('a real track is taken, and its numbers are numbers', async ({ page }) => {
  await boot(page);
  const out = await page.evaluate(() => {
    const res = importRouteLibraryArray([{ kind: 'gps', name: 'Sortie', savedAt: '2026-01-02T03:04:05Z',
      track: [{ lat: '32.1', lng: '34.9', t: '1700000000000', alt: '1200.6', acc: '5.4' }] }]);
    return { added: res.added, skipped: res.skipped, entry: res.merged[0] };
  });
  expect(out.added).toBe(1);
  expect(out.entry.track[0]).toEqual({ lat: 32.1, lng: 34.9, t: 1700000000000, alt: 1201, acc: 5 });
  expect(out.entry.savedAt).toBe('2026-01-02T03:04:05.000Z');
});

test('a track of junk is refused and counted, not stored', async ({ page }) => {
  await boot(page);
  const out = await page.evaluate(() => {
    const bad = [
      { kind: 'gps', name: 'strings', track: ['a', 'b'] },
      { kind: 'gps', name: 'nulls', track: [null] },
      { kind: 'gps', name: 'no coords', track: [{ t: 1 }] },
      { kind: 'gps', name: 'off the earth', track: [{ lat: 91, lng: 0 }] },
      { kind: 'gps', name: 'NaN', track: [{ lat: 'north', lng: 'east' }] },
    ];
    const res = importRouteLibraryArray(bad);
    return { added: res.added, skipped: res.skipped, stored: res.merged.length };
  });
  expect(out.added).toBe(0);
  expect(out.skipped).toBe(5);
  expect(out.stored).toBe(0);
});

// 2 MB of "track" is what made this worth fixing: it syncs.
test('an absurdly long track is refused', async ({ page }) => {
  await boot(page);
  const out = await page.evaluate(() => {
    const track = Array.from({ length: 20001 }, (_, i) => ({ lat: 32, lng: 34, t: i }));
    const res = importRouteLibraryArray([{ kind: 'gps', name: 'huge', track }]);
    return { added: res.added, skipped: res.skipped };
  });
  expect(out).toEqual({ added: 0, skipped: 1 });
});

test('a stamp that is not a date becomes one, so the merges can rank it', async ({ page }) => {
  await boot(page);
  const out = await page.evaluate(() => {
    const res = importRouteLibraryArray([
      { name: 'bad stamp', savedAt: 'yesterday', data: { waypoints: [], legs: [], notes: [] } },
      { name: 'no stamp', data: { waypoints: [], legs: [], notes: [] } },
    ]);
    return res.merged.map(e => e.savedAt);
  });
  for (const stamp of out) {
    expect(Number.isFinite(Date.parse(stamp))).toBe(true);
    expect(stamp).toBe(new Date(Date.parse(stamp)).toISOString());   // canonical ISO
  }
});

test('the sanitiser keeps a valid track and rejects a broken one', async ({ page }) => {
  await boot(page);
  const out = await page.evaluate(() => ({
    good: sanitizeTrack([{ lat: 32, lng: 34 }]),
    empty: sanitizeTrack([]),
    notArray: sanitizeTrack('nope'),
    partly: sanitizeTrack([{ lat: 32, lng: 34 }, { lat: 'x', lng: 34 }]),
  }));
  expect(out.good).toEqual([{ lat: 32, lng: 34 }]);
  expect(out.empty).toBeNull();
  expect(out.notArray).toBeNull();
  expect(out.partly).toBeNull();      // one bad fix condemns the file, rather than silently trimming
});
