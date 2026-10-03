// Step 2 of the aerodrome-chart georef (after scripts/georef-adc.py): screenshot the bare CVFR /
// Low Alt chart around each airfield so scripts/adc-fit-vfr.py can find its runway symbol.
// usage: node scripts/adc-vfr-capture.js <app url> <work dir with fits.jsonl/> <CVFR|"Low Alt">
// Screenshot the bare base chart around each airfield (no markers), record pixel->latlng mapping.
const { chromium } = require('/home/marco/NavigationApp/node_modules/playwright');
const fs = require('fs'); const D = process.argv[3]; const LAY = process.argv[4] || 'CVFR';
const fits = fs.readFileSync(D + 'fits.jsonl', 'utf8').trim().split('\n').map(l => JSON.parse(l));
(async () => {
  const b = await chromium.launch(); const meta = {};
  const p = await b.newPage({ viewport: { width: 800, height: 800 } });
  await p.addInitScript(() => { window.__navaidNoDisclaimer = true; });
  await p.goto(process.argv[2] + '?lang=en&nogist&deck=0');
  await p.waitForFunction(() => typeof map !== 'undefined' && typeof loadAirfields === 'function' && document.getElementById('layer-select'), null, { timeout: 60000 });
  await p.evaluate(async (lay) => { const b = document.getElementById('boot-loading'); if (b) b.remove(); document.documentElement.classList.remove('app-booting');
    const s = document.getElementById('layer-select'); s.value = lay; s.dispatchEvent(new Event('change', { bubbles: true }));
    await loadAirfields();
    const st = document.createElement('style'); st.textContent = '.leaflet-control-container,.click-hint,.leaflet-marker-pane,.leaflet-overlay-pane,.leaflet-tooltip-pane,.leaflet-shadow-pane,#toolbar,#map-legend,#map-time,#search-overlay,.toast,#mode-chip{display:none!important}'; document.head.appendChild(st);
    for (const k of ['markerPane','tooltipPane','overlayPane','shadowPane','popupPane']) if (map._panes[k]) map._panes[k].style.visibility = 'hidden'; console.log(Object.keys(map._panes).join(','));
    map.eachLayer(l => { if (l instanceof L.TileLayer) l.setOpacity(1); });
  }, LAY);
  for (const f of fits) {
    const af = await p.evaluate(n => { const a = airfields.find(a => a.name === n); return [a.lat, a.lng]; }, f.icao);
    await p.evaluate(c => map.setView(c, 14, { animate: false }), af);
    await p.waitForTimeout(3500);
    const m = await p.evaluate(() => { const a = map.containerPointToLatLng([0, 0]), b = map.containerPointToLatLng([800, 800]); return { nw: [a.lat, a.lng], se: [b.lat, b.lng] }; });
    m.af = af; meta[f.icao] = m;
    await p.locator('#map').screenshot({ path: D + 'sym-' + LAY.replace(' ', '') + '-' + f.icao + '.png' });
  }
  fs.writeFileSync(D + 'sym-' + LAY.replace(' ', '') + '.json', JSON.stringify(meta));
  await b.close();
})();
