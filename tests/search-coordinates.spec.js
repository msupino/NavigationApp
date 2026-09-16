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

// Asked for: flying there and leaving no handle on the point is not enough. A coordinate off an
// exercise or a clearance has to be LOOKABLE at -- where it falls, what is around it -- and then
// go on the route, like any other point on the chart.
test('taking a coordinate opens the inspector on it', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => {
    if (typeof showSearchOverlay === 'function') showSearchOverlay();
    const box = document.getElementById('wp-search');
    box.value = 'N32 30 E035 00';
    box.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.locator('.wp-search-coord').click();
  await expect(page.locator('#inspector')).toBeVisible();
  const seen = await page.evaluate(() => ({
    sel: state.selected,
    title: document.getElementById('insp-title').value,
    text: document.querySelector('#inspector').textContent,
  }));
  expect(seen.sel.type).toBe('coord');
  expect(seen.sel.lat).toBeCloseTo(32.5, 4);
  expect(seen.title).toBe('Coordinate');
  expect(seen.text).toMatch(/32°30/);        // where it is, in the app's own notation
});

test('and it carries the same Add to route every chart point has', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => {
    if (typeof showSearchOverlay === 'function') showSearchOverlay();
    const box = document.getElementById('wp-search');
    box.value = '32.5 35.0';
    box.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.locator('.wp-search-coord').click();
  await page.locator('#insp-add-to-route').click();
  const route = await page.evaluate(() => state.waypoints.map(w => ({ lat: w.lat, lng: w.lng })));
  expect(route).toHaveLength(1);
  expect(route[0].lat).toBeCloseTo(32.5, 4);
  expect(route[0].lng).toBeCloseTo(35, 4);
  // The selection moves to the waypoint it just made, as adding from any other point does.
  expect(await page.evaluate(() => state.selected.type)).toBe('wp');
});

// A second coordinate replaces the first: the panel is about the point you just asked for.
test('a coordinate selection survives a redraw and yields to the next one', async ({ page }) => {
  await boot(page);
  const pick = async (text) => {
    await page.evaluate((t) => {
      if (typeof showSearchOverlay === 'function') showSearchOverlay();
      const box = document.getElementById('wp-search');
      box.value = t;
      box.dispatchEvent(new Event('input', { bubbles: true }));
    }, text);
    await page.locator('.wp-search-coord').click();
  };
  await pick('32.5 35.0');
  await page.evaluate(() => draw());
  expect(await page.evaluate(() => state.selected.lat)).toBeCloseTo(32.5, 4);
  await pick('33.0 35.4');
  expect(await page.evaluate(() => state.selected.lat)).toBeCloseTo(33.0, 4);
});

// An airfield found by name opens its panel. Everything a pilot searches a field FOR is in there
// -- frequencies, plates, wind, density altitude -- and flying the map to a triangle left them to
// find it again with a tap they had just made with the keyboard.
test('a searched airfield opens its inspector', async ({ page }) => {
  await boot(page);
  await page.waitForFunction(() => Array.isArray(window.airfields) && airfields.length > 0);
  await page.evaluate(() => {
    showSearchOverlay();
    const box = document.getElementById('wp-search');
    box.value = 'LLHZ';
    box.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.locator('.wp-search-item').first().click();
  await expect(page.locator('#inspector')).toBeVisible();
  const seen = await page.evaluate(() => ({
    sel: state.selected && state.selected.type,
    name: airfields[state.selected.index].name,
    title: document.getElementById('insp-title').value,
    centred: Math.round(map.getCenter().lat * 100) / 100,
  }));
  expect(seen.sel).toBe('airfield');
  expect(seen.name).toBe('LLHZ');
  expect(seen.title).toMatch(/LLHZ/);
  expect(seen.centred).toBeCloseTo(32.18, 1);
});

// A nav waypoint is a point on the chart whose own label says what it is: the flash answers
// "where is it", and opening a panel over the map would be answering a question nobody asked.
test('a searched nav waypoint still just flies there', async ({ page }) => {
  await boot(page);
  await page.waitForFunction(() => Array.isArray(window.navWP) && navWP.length > 0);
  await page.evaluate(() => {
    showSearchOverlay();
    const box = document.getElementById('wp-search');
    box.value = 'BAZRA';
    box.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.locator('.wp-search-item').first().click();
  expect(await page.evaluate(() => state.selected)).toBeNull();
  await expect(page.locator('#inspector')).toBeHidden();
});

// Route building is not looking something up: the token is replaced and nothing flies or opens.
test('route building does not open a panel', async ({ page }) => {
  await boot(page);
  await page.waitForFunction(() => Array.isArray(window.airfields) && airfields.length > 0);
  await page.evaluate(() => {
    showSearchOverlay();
    const box = document.getElementById('wp-search');
    box.value = 'BAZRA LLHZ';
    box.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.locator('.wp-search-item').first().click();
  expect(await page.evaluate(() => state.selected)).toBeNull();
  await expect(page.locator('#inspector')).toBeHidden();
  expect(await page.evaluate(() => document.getElementById('wp-search').value)).toMatch(/^BAZRA /);
});
