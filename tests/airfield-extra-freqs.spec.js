// @ts-check
// The comm catalog carries more than Primary/Clearance/ATIS -- a secondary tower frequency for
// most controlled fields, and ground/approach/TMA at Ben Gurion. The inspector shows every one,
// editable like the primary (its own key in the Drive-synced airfieldFreqOverrides map).
const { test, expect } = require('./_setup');

async function comm(page, icao) {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof loadAirfields === 'function' && typeof loadCommChange === 'function' && typeof showInspector === 'function');
  return page.evaluate(async (ic) => {
    await loadAirfields(); await loadCommChange();
    state.selected = { type: 'airfield', index: airfields.findIndex(a => a.name === ic) };
    showInspector();
    return [...document.querySelectorAll('#insp-body .comm-section .row')].map(r => {
      const label = r.querySelector('label')?.textContent?.trim();
      const inp = r.querySelector('input');
      return { label, value: inp ? inp.value : (r.querySelector('.val')?.textContent || '').trim(), editable: !!inp };
    });
  }, icao);
}

test('Haifa shows an editable Secondary (127.80) after the primary', async ({ page }) => {
  const rows = await comm(page, 'LLHA');
  const sec = rows.find(r => r.label === 'Secondary');
  expect(sec).toBeTruthy();
  expect(sec.value).toBe('127.80');
  expect(sec.editable).toBe(true);
});

test('Ben Gurion shows the full set: secondary, ground W/E, approach, TMA', async ({ page }) => {
  const rows = await comm(page, 'LLBG');
  const labels = rows.map(r => r.label);
  for (const l of ['Secondary', 'Ground W', 'Ground E', 'Approach', 'Approach 2', 'TMA', 'TMA 2']) {
    expect(labels).toContain(l);
  }
  expect(rows.find(r => r.label === 'Secondary').value).toBe('132.10');
  expect(rows.find(r => r.label === 'TMA').value).toBe('119.50');
});

test('editing a secondary stores an override under its own key and resets back', async ({ page }) => {
  await comm(page, 'LLHA');
  const r = await page.evaluate(async () => {
    const row = [...document.querySelectorAll('#insp-body .comm-section .row')].find(x => x.querySelector('label')?.textContent?.trim() === 'Secondary');
    const inp = row.querySelector('input');
    inp.value = '128.25'; inp.dispatchEvent(new Event('change'));
    const stored = JSON.parse(localStorage.getItem('navaid.airfieldFreqOverrides') || '{}');
    const key = Object.keys(stored).find(k => k.includes('cat:secondary'));
    const afterEdit = { key, val: stored[key] };
    row.querySelector('.commchange-freq-reset').click();
    const after = JSON.parse(localStorage.getItem('navaid.airfieldFreqOverrides') || '{}');
    return { afterEdit, resetGone: !Object.keys(after).some(k => k.includes('cat:secondary')), inpAfter: inp.value };
  });
  expect(r.afterEdit.key).toBe('LLHA|cat:secondary');
  expect(r.afterEdit.val).toBe('128.25');
  expect(r.resetGone).toBe(true);
  expect(r.inpAfter).toBe('127.80');
});
