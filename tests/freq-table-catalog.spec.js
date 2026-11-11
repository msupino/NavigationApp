// @ts-check
// The Frequency table (טבלת תדרים) listed only the call-sign primary, clearance/ATIS and VORs.
// The catalog carries a secondary tower frequency for most controlled fields and ground/approach/
// TMA at Ben Gurion; the inspector shows them, so the table does too -- editable, same override
// key (<ICAO>|cat:<field>) so an edit in one appears in the other.
const { test, expect } = require('./_setup');

async function rows(page) {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof loadAirfields === 'function' && typeof loadCommChange === 'function' && typeof showFreqTableModal === 'function');
  await page.evaluate(async () => { await loadAirfields(); await loadCommChange(); showFreqTableModal(); });
  await page.waitForFunction(() => document.querySelectorAll('.charts-freq-table tbody tr').length > 10);
  return page.$$eval('.charts-freq-table tbody tr', trs => trs.map(tr => ({
    code: tr.querySelector('.charts-freq-code')?.textContent?.trim(),
    label: tr.querySelector('.charts-freq-label')?.textContent?.trim(),
    val: tr.querySelector('input')?.value,
    editable: !!tr.querySelector('input:not([disabled])'),
  })));
}

test('Herzliya secondary appears in the table, editable', async ({ page }) => {
  const r = await rows(page);
  const sec = r.find(x => x.code === 'LLHZ' && /Secondary/i.test(x.label || ''));
  expect(sec).toBeTruthy();
  expect(sec.val).toBe('129.40');
  expect(sec.editable).toBe(true);
});

test('Ben Gurion ground / approach / TMA appear in the table', async ({ page }) => {
  const r = await rows(page);
  const bg = r.filter(x => x.code === 'LLBG').map(x => x.label || '');
  for (const re of [/Secondary/i, /Ground/i, /Approach/i, /TMA/i]) {
    expect(bg.some(l => re.test(l)), re.toString()).toBe(true);
  }
});

test('an edit in the table stores under the same key the inspector uses', async ({ page }) => {
  await rows(page);
  const r = await page.evaluate(() => {
    const tr = [...document.querySelectorAll('.charts-freq-table tbody tr')]
      .find(x => x.querySelector('.charts-freq-code')?.textContent?.trim() === 'LLHZ'
        && /Secondary/i.test(x.querySelector('.charts-freq-label')?.textContent || ''));
    const inp = tr.querySelector('input');
    inp.value = '128.90'; inp.dispatchEvent(new Event('change'));
    const o = JSON.parse(localStorage.getItem('navaid.airfieldFreqOverrides') || '{}');
    return o['LLHZ|cat:secondary'];
  });
  expect(r).toBe('128.90');
});

// Guard: every frequency the call-sign catalog publishes for an airfield must show as a row in
// the table editor. Add a new field to a call sign (a second ground, a delivery freq, ...) and
// this fails until the table renders it -- the table is where a pilot corrects a stale freq, so
// a frequency the app knows but never shows is a silent gap.
test('every catalog airfield frequency is present in the table', async ({ page }) => {
  await rows(page);
  const missing = await page.evaluate(() => {
    const num = v => { const f = parseFloat(String(v || '').replace(/[^\d.]/g, '')); return isFinite(f) ? f.toFixed(2) : null; };
    const FREQ = /^\s*\d{3}(\.\d{1,3})?\s*$/;          // a VHF comm frequency, not a label or phone
    const SKIP = new Set(['label', 'he', 'en', 'phone', 'source', 'unit', 'callSigns']);
    // Every numeric value the table shows -- editable inputs and the Default column. A frequency
    // is matched anywhere it appears: a primary row reads under its call sign's own code, a
    // catalog extra under the ICAO, so per-ICAO bucketing would miss the primary. The question
    // this guards is only "is this frequency rendered at all", so a global set answers it.
    const shown = new Set();
    for (const tr of document.querySelectorAll('.charts-freq-table tbody tr')) {
      const inp = tr.querySelector('input'); if (inp && num(inp.value)) shown.add(num(inp.value));
      const tmpl = tr.querySelector('.charts-freq-template'); if (tmpl && num(tmpl.textContent)) shown.add(num(tmpl.textContent));
    }
    const out = [];
    const ids = typeof AIRFIELD_CALL_SIGN_IDS === 'object' ? AIRFIELD_CALL_SIGN_IDS : {};
    for (const [icao, csId] of Object.entries(ids)) {
      const crow = (csId && typeof commCatalogCallSignRow === 'function') ? commCatalogCallSignRow(csId) : null;
      if (!crow) continue;
      for (const [k, v] of Object.entries(crow)) {
        if (SKIP.has(k) || !FREQ.test(String(v))) continue;
        if (!shown.has(num(v))) out.push(icao + '.' + k + '=' + v);
      }
    }
    return out;
  });
  expect(missing, 'catalog freqs missing from the table: ' + missing.join(', ')).toEqual([]);
});
