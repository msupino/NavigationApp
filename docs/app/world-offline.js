'use strict';
// A world map that is always there: country outlines and names, shipped with the app
// (data/world-countries.json, Natural Earth, public domain) and drawn under every chart. The
// charts are online tiles, so on an airliner, or anywhere outside a downloaded pack, the map
// used to be blank -- now the coastlines, the borders and the countries' names show through
// wherever a tile is missing. Nothing here is fetched from anyone else, so it works offline
// on the first flight as well as the hundredth.
//
// It is also a chart in its own right ("World (offline)" in the picker), which is the one to
// choose for a long flight: the map can zoom out to a continent on it.
(function () {
  if (typeof map === 'undefined' || !map.createPane) return;
  const PANE = 'worldBase';
  map.createPane(PANE, map._rotatePane || undefined);
  map.getPane(PANE).style.zIndex = 100;                     // under the OSM/chart underlay (150)
  map.getPane(PANE).style.pointerEvents = 'none';
  const LABEL_PANE = 'worldLabels';
  map.createPane(LABEL_PANE, map._rotatePane || undefined);
  map.getPane(LABEL_PANE).style.zIndex = 110;
  map.getPane(LABEL_PANE).style.pointerEvents = 'none';

  const SEA = '#cddbe6';
  const LAND = '#f1ede3';
  const BORDER = '#9a948a';
  const renderer = L.canvas({ pane: PANE, padding: 0.5 });
  let labels = [];
  let loaded = null;

  const lang = () => ((document.documentElement.lang || 'en').toLowerCase().indexOf('he') === 0 ? 'he' : 'en');

  // Country names thin out as the map zooms out: Natural Earth's own label rank says which
  // matter at a continent's scale (1-2) and which only close in (6+).
  function refreshLabels() {
    const z = map.getZoom();
    const maxRank = z <= 3 ? 2 : z <= 4 ? 3 : z <= 5 ? 4 : z <= 6 ? 5 : 10;
    for (const l of labels) {
      const show = l.rank <= maxRank;
      if (show && !map.hasLayer(l.marker)) l.marker.addTo(map);
      else if (!show && map.hasLayer(l.marker)) map.removeLayer(l.marker);
    }
  }

  async function load() {
    if (loaded) return loaded;
    loaded = (async () => {
      const url = (window.S && S.worldCountriesUrl) || 'data/world-countries.json?v=1';
      const d = await (await fetch(url)).json();
      // The sea first: a world-sized rectangle, so water reads as water and not as the grey
      // of an empty map.
      L.rectangle([[-85, -180], [85, 180]], { renderer, stroke: false, fillColor: SEA, fillOpacity: 1,
        interactive: false, pane: PANE }).addTo(map);
      const key = lang();
      for (const c of d.countries || []) {
        const latlngs = c.p.map(poly => poly.map(ring => ring.map(([lng, lat]) => [lat, lng])));
        L.polygon(latlngs, { renderer, pane: PANE, color: BORDER, weight: 0.8, fillColor: LAND,
          fillOpacity: 1, interactive: false, smoothFactor: 1 }).addTo(map);
        if (Array.isArray(c.at)) {
          const name = String(c[key] || c.en || '');
          // The name goes in as text, never as markup.
          const marker = L.marker(c.at, { pane: LABEL_PANE, interactive: false, keyboard: false,
            icon: L.divIcon({ className: 'world-label', html: '<span dir="auto"></span>', iconSize: null }) });
          marker.on('add', () => { const el = marker.getElement(); if (el && el.firstChild) el.firstChild.textContent = name; });
          labels.push({ marker, rank: Number.isFinite(c.rank) ? c.rank : 5 });
        }
      }
      map.on('zoomend', refreshLabels);
      refreshLabels();
      return true;
    })().catch(e => { loaded = null; console.warn('world map unavailable:', e); return false; });
    return loaded;
  }

  window.NavAid = window.NavAid || {};
  NavAid.worldOffline = { load, refreshLabels };
  load();
})();
