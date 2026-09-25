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
  let labels = [];
  let loaded = null;
  // The outlines live here, in this closure, pre-projected to Web Mercator on the unit square
  // (0..1 each way) -- NOT as Leaflet layers. Hundreds of thousands of points as layers made
  // the map object itself enormous, and anything that walks it (a test serialising `map`, a
  // debugger) choked on it. One canvas renderer draws them all on each map update.
  let rings = null;                       // { pts: Float64Array x0,y0,x1,y1,..., box: [x0,y0,x1,y1] }

  const lang = () => ((document.documentElement.lang || 'en').toLowerCase().indexOf('he') === 0 ? 'he' : 'en');
  const mercY = lat => {
    const s = Math.sin(Math.max(-85.0511, Math.min(85.0511, lat)) * Math.PI / 180);
    return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
  };

  // The renderer is Leaflet's own canvas, in its own pane: it is sized, positioned and (with
  // leaflet-rotate) rotated like every other vector layer, and its context is already
  // translated to layer pixels when it draws. Drawing there is all this has to do.
  const renderer = L.canvas({ pane: PANE, padding: 0.5 });
  function paint() {
    const ctx = renderer._ctx;
    const b = renderer._bounds;
    if (!ctx || !b) return;
    ctx.fillStyle = SEA;
    ctx.fillRect(b.min.x, b.min.y, b.max.x - b.min.x, b.max.y - b.min.y);
    if (!rings) return;
    const scale = 256 * Math.pow(2, map.getZoom());
    const o = map.getPixelOrigin();
    // Only what the canvas covers: over Israel at a flying zoom that is a handful of outlines
    // out of thousands, so a repaint on every map move costs next to nothing.
    const vx0 = (b.min.x + o.x) / scale, vy0 = (b.min.y + o.y) / scale;
    const vx1 = (b.max.x + o.x) / scale, vy1 = (b.max.y + o.y) / scale;
    ctx.beginPath();
    for (const ring of rings) {
      const [bx0, by0, bx1, by1] = ring.box;
      if (bx1 < vx0 || bx0 > vx1 || by1 < vy0 || by0 > vy1) continue;
      const r = ring.pts;
      ctx.moveTo(r[0] * scale - o.x, r[1] * scale - o.y);
      for (let i = 2; i < r.length; i += 2) ctx.lineTo(r[i] * scale - o.x, r[i + 1] * scale - o.y);
      ctx.closePath();
    }
    ctx.fillStyle = LAND;
    ctx.fill('evenodd');
    ctx.lineWidth = 0.8;
    ctx.strokeStyle = BORDER;
    ctx.stroke();
  }
  // Painted from the renderer's own draw step: on 'update' it would be wiped straight away,
  // because the renderer clears its canvas and redraws its (zero) paths after that event.
  renderer._draw = function () {
    L.Canvas.prototype._draw.call(this);
    paint();
  };
  map.addLayer(renderer);

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
      const key = lang();
      const out = [];
      for (const c of d.countries || []) {
        for (const poly of c.p) {
          for (const ring of poly) {
            const r = new Float64Array(ring.length * 2);
            const box = [Infinity, Infinity, -Infinity, -Infinity];
            for (let i = 0; i < ring.length; i++) {
              const x = (ring[i][0] + 180) / 360;
              const y = mercY(ring[i][1]);
              r[2 * i] = x; r[2 * i + 1] = y;
              if (x < box[0]) box[0] = x; if (x > box[2]) box[2] = x;
              if (y < box[1]) box[1] = y; if (y > box[3]) box[3] = y;
            }
            out.push({ pts: r, box });
          }
        }
        if (Array.isArray(c.at)) {
          const name = String(c[key] || c.en || '');
          // The name goes in as text, never as markup.
          const marker = L.marker(c.at, { pane: LABEL_PANE, interactive: false, keyboard: false,
            icon: L.divIcon({ className: 'world-label', html: '<span dir="auto"></span>', iconSize: null }) });
          marker.on('add', () => { const el = marker.getElement(); if (el && el.firstChild) el.firstChild.textContent = name; });
          labels.push({ marker, rank: Number.isFinite(c.rank) ? c.rank : 5 });
        }
      }
      rings = out;
      renderer._redraw();                 // draw now, not on the next pan
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
