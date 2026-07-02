// @ts-check
// The alt-pairs chart reflects the active base layer (CVFR / LSA / Heli).
const { test, expect } = require('./_setup');

test('alt-pairs heading + data follow the chosen layer', async ({ page }) => {
  await page.addInitScript(() => { try { localStorage.clear(); for (const s of ['build','view','display','charts','export','print']) localStorage.setItem('navaid.sec.'+s,'1'); } catch (e) {} });
  await page.goto('?lang=en');
  await page.waitForFunction(() => typeof map !== 'undefined' && typeof showAltitudePairsModal === 'function' && typeof layers !== 'undefined');
  const r = await page.evaluate(async () => {
    const head = () => { const h = document.querySelector('.charts-alt-title h3'); return h ? h.textContent : null; };
    const rows = () => document.querySelectorAll('.charts-alt-table tbody tr').length;
    const setL = k => { for (const n in layers) if (map.hasLayer(layers[n])) map.removeLayer(layers[n]); map.addLayer(layers[k]); };
    // reloadLayerDatasets() does not return its Promise.all chain, so
    // awaiting it is a no-op — poll until the heading actually flips instead
    // of sleeping a fixed 300ms (too short under CI load).
    const until = async cond => { const t0 = Date.now(); while (!cond() && Date.now() - t0 < 15000) await new Promise(r => setTimeout(r, 100)); };
    setL('CVFR'); legAltitudeMap = null; await loadLegAltitudes();
    showAltitudePairsModal();
    await until(() => head() && head().includes('CVFR') && rows() > 0);
    const cvfrHead = head(), cvfrRows = rows();
    // switch to Low Alt + refresh open modal
    setL('Low Alt'); reloadLayerDatasets();
    await until(() => head() && head().includes('Low Alt'));
    const lsaHead = head(), lsaRows = rows();
    return { cvfrHead, cvfrRows, lsaHead, lsaRows };
  });
  expect(r.cvfrHead).toContain('CVFR');
  expect(r.lsaHead).toContain('Low Alt');     // heading reflects layer
  expect(r.lsaRows).not.toBe(r.cvfrRows);      // data reflects layer (different leg set)
});
