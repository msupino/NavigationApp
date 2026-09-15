// @ts-check
// A coordinate typed into the search box.
//
// Reported: "in the find, allow entering lat/long -- the button lat/long input is not usable".
// The go-to widget's six numeric slots are for reading a coordinate off the map and nudging it,
// not for entering one. A pilot with "N32 30 / E035 00" in front of them types it, and the box
// they are already typing in should take it.
const { test, expect } = require('./_setup');

async function boot(page) {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof parseSearchLatLng === 'function' && typeof draw === 'function');
}

const parse = (page, text) => page.evaluate(t => parseSearchLatLng(t), text);

test('the forms a coordinate actually arrives in', async ({ page }) => {
  await boot(page);
  const near = (got, lat, lng) => {
    expect(got, JSON.stringify(got)).not.toBeNull();
    expect(got.lat).toBeCloseTo(lat, 4);
    expect(got.lng).toBeCloseTo(lng, 4);
  };
  near(await parse(page, '32.5, 35.0'), 32.5, 35);            // decimal, comma
  near(await parse(page, '32.5 35.0'), 32.5, 35);             // decimal, space
  near(await parse(page, 'N32.5 E35.0'), 32.5, 35);           // decimal with hemispheres
  near(await parse(page, 'N32 30 E035 00'), 32.5, 35);        // degrees and minutes
  near(await parse(page, '3230N 03500E'), 32.5, 35);          // packed, as a flight plan writes it
  near(await parse(page, '3230N03500E'), 32.5, 35);           // ...and with no space at all
  near(await parse(page, '323030N0350030E'), 32.5083, 35.0083);   // packed, with seconds
  near(await parse(page, "N32°30' E035°00'"), 32.5, 35);      // as a chart margin prints it
  near(await parse(page, 'N32 30 30 E035 00 30'), 32.5083, 35.0083);   // seconds too
});

// The exercise's own notation, straight off the page.
test('the coordinates an exercise hands out', async ({ page }) => {
  await boot(page);
  const got = await parse(page, 'N32°30 E035°00');
  expect(got.lat).toBeCloseTo(32.5, 4);
  expect(got.lng).toBeCloseTo(35, 4);
});

test('hemispheres are honoured, in either order', async ({ page }) => {
  await boot(page);
  const south = await parse(page, 'S33 52 E151 12');
  expect(south.lat).toBeCloseTo(-33.8667, 3);
  expect(south.lng).toBeCloseTo(151.2, 3);
  // Longitude first is still a coordinate: the letters say which is which.
  const swapped = await parse(page, 'E035 00 N32 30');
  expect(swapped.lat).toBeCloseTo(32.5, 4);
  expect(swapped.lng).toBeCloseTo(35, 4);
  // A minus sign works as well as an S.
  const minus = await parse(page, '-33.8667 151.2');
  expect(minus.lat).toBeCloseTo(-33.8667, 3);
});

test('what is not a coordinate is left to the search', async ({ page }) => {
  await boot(page);
  for (const text of ['LLHZ', 'BAZRA LLHA', '', 'hello world', '32.5', '999 999', 'N32 30 E400 00']) {
    expect(await parse(page, text), text).toBeNull();
  }
});

test('typing one offers it, and taking it flies there', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => {
    if (typeof showSearchOverlay === 'function') showSearchOverlay();
    const box = document.getElementById('wp-search');
    box.value = 'N32 30 E035 00';
    box.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const row = page.locator('.wp-search-coord');
  await expect(row).toBeVisible();
  await expect(row).toContainText('Go to this coordinate');
  await row.click();
  const at = await page.evaluate(() => ({ lat: map.getCenter().lat, lng: map.getCenter().lng }));
  expect(at.lat).toBeCloseTo(32.5, 2);
  expect(at.lng).toBeCloseTo(35, 2);
});

// A route being typed as tokens must not be eaten by the coordinate reader.
test('a two-waypoint route search still searches', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => {
    if (typeof showSearchOverlay === 'function') showSearchOverlay();
    const box = document.getElementById('wp-search');
    box.value = 'LLHZ LLIB';
    box.dispatchEvent(new Event('input', { bubbles: true }));
  });
  expect(await page.locator('.wp-search-coord').count()).toBe(0);
});
