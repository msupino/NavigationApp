// @ts-check
// Findings from the read-only review of main @ 9899de7. Every test here fails on that
// commit: each covers a case whose sibling paths were already guarded, which is why the
// existing suites stayed green over them.
const { test, expect } = require('./_setup');
const fs = require('fs');
const path = require('path');

const wf = () => fs.readFileSync(
  path.join(__dirname, '..', '.github', 'workflows', 'deploy.yml'), 'utf8');

// --- the ring suppression must not outlive the selection ---------------------------------
// Clearing the reference on a SELECTED station drops its ring (that is the reported fix from
// #1463). But the ident was parked in a global that only a later non-empty reference reset,
// so the station stayed un-ringable for the rest of the session: tap NAT -> clear -> tap BGN
// -> tap NAT again and NAT drew no ring, with no way back except changing the reference.
async function boot(page) {
  await page.addInitScript(() => {
    try { for (const s of ['build', 'view', 'display']) localStorage.setItem('navaid.sec.' + s, '1'); } catch (e) {}
  });
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof loadVors === 'function' &&
    typeof setReferenceVor === 'function' && typeof draw === 'function');
  await page.evaluate(() => loadVors());
}

// What drawVors() resolves the ring to, expiry included.
const RING = `(() => {
  let sel = (state.selected && state.selected.type === 'vor' && vors[state.selected.index])
    ? vors[state.selected.index].ident : null;
  if (typeof vorRingSuppressed === 'function' && vorRingSuppressed(sel)) sel = null;
  const ident = sel || (typeof inspectorVorRef === 'string' && inspectorVorRef) || vorRef;
  const v = ident ? vors.find(x => x.ident === ident) : null;
  return { ident: ident || null, rings: !!(v && v.coverageNm > 0),
           suppress: (typeof vorRingSuppressIdent === 'string' ? vorRingSuppressIdent : null) };
})()`;

const selectVor = ident => `state.selected = { type: 'vor', index: vors.findIndex(v => v.ident === '${ident}') };`;

test('re-selecting a station whose reference was cleared rings it again', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(`(() => {
    ${selectVor('NAT')}
    setReferenceVor('NAT');
    const asRef = ${RING};
    setReferenceVor(null);                    // "not this one"
    const cleared = ${RING};
    ${selectVor('BGN')}                       // selection leaves NAT
    const other = ${RING};
    ${selectVor('NAT')}                       // ...and comes back to it
    const back = ${RING};
    return { asRef, cleared, other, back };
  })()`);
  expect(r.asRef.rings).toBe(true);
  // Clearing on the selected station still drops its ring — the #1463 behaviour holds.
  expect(r.cleared).toMatchObject({ ident: null, rings: false, suppress: 'NAT' });
  // Any other station rings, and answering for it expires the suppression.
  expect(r.other.ident).toBe('BGN');
  expect(r.other.rings).toBe(true);
  // Was: ident null, rings false, suppress 'NAT' — permanently un-ringable for the session.
  expect(r.back.ident).toBe('NAT');
  expect(r.back.rings).toBe(true);
  expect(r.back.suppress).toBeNull();
});

test('deselecting entirely also ends the suppression', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(`(() => {
    ${selectVor('NAT')}
    setReferenceVor('NAT'); setReferenceVor(null);
    state.selected = null;                    // tap empty map
    const none = ${RING};
    ${selectVor('NAT')}
    return { none, back: ${RING} };
  })()`);
  expect(r.none.suppress).toBeNull();
  expect(r.back.ident).toBe('NAT');
  expect(r.back.rings).toBe(true);
});

test('the suppression still holds while the station stays selected', async ({ page }) => {
  await boot(page);
  // The expiry must not undo the fix it is scoped to: without leaving the station, repeated
  // draws (which is what calls the predicate) keep the ring off.
  const r = await page.evaluate(`(() => {
    ${selectVor('NAT')}
    setReferenceVor('NAT'); setReferenceVor(null);
    const first = ${RING}, second = ${RING}, third = ${RING};
    return { first, second, third };
  })()`);
  for (const k of ['first', 'second', 'third']) {
    expect(r[k].rings, k + ' draw').toBe(false);
    expect(r[k].suppress, k + ' draw').toBe('NAT');
  }
});

// --- a superseded SIGWX rejection must not tear down the current overlay ------------------
// The three success handlers carry a generation guard; the map crop's `.catch` did not. So
// an OLD request failing late — slow decode, a transient CORS blip — ran removeLayers() over
// whatever the NEWER selection had already placed. The checkbox stayed on and #wx-time still
// named the new hour, so the chart just went blank with nothing to say why.
const CHART_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAMgAAACWCAIAAAAUvlBOAAABlklEQVR4nO3UsQ0AIBADsYfJGZ0luALJHiDVKWvOwHP7/SQIi4jHIiEsEsIiISwSwiIhLBLCIiEsEsIiISwSwiIhLBLCIiEsEsIiISwSwiIhLBLCIiEsEsIiISwSwiIhLBLCIiEsEsIiISwSwiIhLBLCIiEsEsIiISwSwiIhLBLCIiEsEsIiISwSwiIhLBLCIiEsEsIiISwSwiIhLBLCIiEsEsIiISwSwiIhLBLCIiEsEsIiISwSwiIhLBLCIiEsEsIiISwSwiIhLBLCIiEsEsIiISwSwiIhLBLCIiEsEsIiISwSwiIhLBLCIiEsEsIiISwSwiIhLBLCIiEsEsIiISwSwiIhLBLCIiEsEsIiISwSwiIhLBLCIiEsEsIiISyExT88FglhkRAWCWGREBYJYZEQFglhkRAWCWGREBYJYZEQFglhkRAWCWGREBYJYZEQFglhkRAWCWGREBYJYZEQFglhkRAWCWGREBYJYZEQFglhkRAWCWGREBYJYZEQFglhkRAWCWExhQve2wGshbOUjwAAAABJRU5ErkJggg==';

test('an old SIGWX request rejecting late leaves the newer overlay alone', async ({ page }) => {
  const times = [
    { valid: '12:00', day: '24/06/2026', png: 'ims/sigwx/1200.png' },
    { valid: '15:00', day: '24/06/2026', png: 'ims/sigwx/1500.png' },
  ];
  await page.route(/ims-data\/ims\/pwx\.json/, r => r.fulfill({ status: 404, body: '' }));
  await page.route(/ims-data\/ims\/sigwx\.json/, r => r.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ generatedAt: '2026-06-24T04:00:00Z', source: 'x', times }),
  }));
  // Hold whichever chart is requested FIRST, rather than assuming which time the shared
  // #wx-time dropdown seeds to (it seeds to now-Zulu, not to index 0), and answer the rest
  // normally. That first request is the one that must not be able to blank its successor.
  let held = null, heldUrl = '';
  await page.route(/ims-data\/ims\/sigwx\/.*\.png/, r => {
    if (!held) { held = r; heldUrl = r.request().url(); return; }
    r.fulfill({ status: 200, contentType: 'image/png',
      headers: { 'access-control-allow-origin': '*' },
      body: Buffer.from(CHART_PNG, 'base64') });
  });
  await page.addInitScript(() => { try { localStorage.setItem('navaid.sec.weather', '1'); } catch (e) {} });
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof map !== 'undefined' && !!document.getElementById('sigwx-ov-cb'));

  await page.locator('#sigwx-ov-cb').check();          // first chart request — held open
  await expect.poll(() => !!held, { timeout: 8000 }).toBe(true);
  // Switch to the OTHER time while the first is still in flight, and let it paint.
  const other = /1200\.png/.test(heldUrl) ? 1 : 0;
  await page.selectOption('#wx-time', { index: other });
  await expect(page.locator('img.sigwx-ov-layer')).toHaveCount(3);
  const label = await page.locator('#wx-time').inputValue();

  // Now the superseded request fails.
  await held.abort();
  await page.waitForTimeout(600);

  // Was: 3 -> 0. The overlay the pilot is looking at survives its predecessor's failure...
  await expect(page.locator('img.sigwx-ov-layer')).toHaveCount(3);
  // ...and nothing about the selection changed underneath them.
  await expect(page.locator('#sigwx-ov-cb')).toBeChecked();
  expect(await page.locator('#wx-time').inputValue()).toBe(label);
});

// --- the wind field must not commit a superseded altitude ---------------------------------
test('a request from an older altitude is not rendered under the new label', async ({ page }) => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'docs', 'app', 'ui.js'), 'utf8');
  const i = src.indexOf('async function addLayer()');
  expect(i).toBeGreaterThan(-1);
  const block = src.slice(i, i + 4200);
  // off -> change altitude -> on, all before the first request settles: the altitude handler
  // returns early while unchecked, and the enable handler no-opped while busy, so the old
  // level's data was committed under the new label with nothing left to correct it.
  expect(block, 'no level check before committing store').toMatch(/lv !== level\(\)/);
  expect(block).toMatch(/store = \{ g, times, sp, di/);
  expect(block.indexOf('lv !== level()')).toBeLessThan(block.indexOf('store = { g, times'));
  // Re-enabling mid-flight has to queue rather than do nothing.
  const onchange = src.slice(src.indexOf('cb.onchange = () => {', i), src.indexOf('cb.onchange = () => {', i) + 700);
  expect(onchange).toMatch(/busy\)\s*refetchPending = true/);
});

// --- preview image dedup has to work under the shallow checkout it runs in ----------------
test('the image comparison does not need a merge base', () => {
  const y = wf();
  // Production is a shallow actions/checkout and each preview branch is fetched --depth 1,
  // so `origin/main...origin/$BRANCH` exited 128 ("no merge base") for every set. With
  // 2>/dev/null that read as "branch modified it", so the ~12 MB saving never happened and
  // previews kept inflating the single Pages artifact.
  expect(y, 'triple-dot comparison still present').not.toMatch(/git diff --quiet "origin\/main\.\.\.origin\/\$BRANCH"/);
  expect(y).toMatch(/git diff --quiet origin\/main origin\/"\$BRANCH" -- "docs\/\$d"/);
  // A git ERROR must not be silently read as "identical" — that would drop images the
  // preview still needs. Explicit exit codes: 0 same, 1 differs, anything else is a problem.
  expect(y).toMatch(/rc=0; git diff/);
  expect(y).toMatch(/elif \[ "\$rc" = "1" \]/);
  expect(y).toMatch(/git diff failed \(rc=\$rc\)/);
});

// --- both preview injections must fail closed ---------------------------------------------
test('a preview is refused when its isolation shim cannot be injected', () => {
  const y = wf();
  // The sed matches literal lowercase "<head>". A branch with "<HEAD>", an attributed head
  // tag, or no head at all sailed through `|| true` and was published with NO shim — the
  // ordinary preview then read and wrote the live app's storage, which is exactly what
  // copying the shim from main was meant to prevent.
  expect(y).toMatch(/if ! grep -q '<script src="pr-store\.js"><\/script>' "\$STAGING\/index\.html"; then/);
  expect(y).toMatch(/could not inject pr-store\.js/);
  // ...and the shared-image tag, where a miss is worse: the directories are already gone, so
  // the preview 404s its overlays instead of falling back to the deployed root.
  expect(y).toMatch(/if ! grep -q '<script src="preview-shared\.js"><\/script>' "\$STAGING\/index\.html"; then/);
  expect(y).toMatch(/could not inject preview-shared\.js/);
  // Both refusals drop the staging tree rather than publishing a half-built preview.
  const refusals = y.match(/skipping its preview/g) || [];
  expect(refusals.length).toBeGreaterThanOrEqual(3);
});
