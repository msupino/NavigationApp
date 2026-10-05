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
  // The names are plain elements in a pane inside the rotating one -- above the land, under the
  // charts -- each placed at its layer point and turned back by the bearing so it reads level.
  // They were Leaflet markers, which leaflet-rotate positions for a pane OUTSIDE the rotating
  // one: in here they were turned twice, slanted and a country away from their land.
  const LABEL_PANE = 'worldLabels';
  map.createPane(LABEL_PANE, map._rotatePane || undefined);
  map.getPane(LABEL_PANE).style.zIndex = 110;
  map.getPane(LABEL_PANE).style.pointerEvents = 'none';

  // Under the outlines: Natural Earth's shaded relief (land colour, relief shading, sea), cut
  // into tiles by scripts/build-relief-tiles.py and shipped with the app -- so the world outside
  // the charts shows mountains, deserts and sea, offline, instead of two flat colours. Public
  // domain. Zooms 0-6 (11 MB in three packs); closer in, Leaflet enlarges zoom 6. `worldRelief` turns it off,
  // and then the flat land and sea come back.
  const RELIEF_PANE = 'worldRelief';
  map.createPane(RELIEF_PANE, map._rotatePane || undefined);
  map.getPane(RELIEF_PANE).style.zIndex = 95;               // under the outlines (100)
  map.getPane(RELIEF_PANE).style.pointerEvents = 'none';
  const reliefOn = () => typeof tune !== 'function' || tune('worldRelief') !== false;
  const reliefBase = () => (typeof navAssetBase === 'function' ? navAssetBase('relief') : 'relief/');
  // The tiles come in three packs (zooms 0-4, 5, 6; scripts/build-relief-tiles.py), not as
  // 5,461 files: index.json says which pack holds a zoom and where each tile starts. A pack is
  // fetched once, from the app itself, and each tile is a slice of it.
  let reliefIndex = null;
  const packs = {};
  const tileUrls = new Map();
  function reliefIndexLoad() {
    if (!reliefIndex) {
      reliefIndex = fetch(reliefBase() + 'index.json').then(r => (r.ok ? r.json() : null)).catch(() => null);
    }
    return reliefIndex;
  }
  async function reliefTileUrl(z, x, y) {
    const key = z + '/' + x + '/' + y;
    if (tileUrls.has(key)) return tileUrls.get(key);
    const idx = await reliefIndexLoad();
    const pack = idx && idx.packs.find(p => p.zooms.includes(z));
    if (!pack) return null;
    let i = 0;                                        // tiles of the pack's earlier zooms, then x-major
    for (const zz of pack.zooms) { if (zz === z) break; i += Math.pow(4, zz); }
    i += x * Math.pow(2, z) + y;
    if (!packs[pack.file]) {
      packs[pack.file] = fetch(reliefBase() + pack.file).then(r => (r.ok ? r.arrayBuffer() : null)).catch(() => null);
    }
    const buf = await packs[pack.file];
    if (!buf || i + 1 >= pack.offsets.length) return null;
    const url = URL.createObjectURL(new Blob([buf.slice(pack.offsets[i], pack.offsets[i + 1])], { type: 'image/webp' }));
    tileUrls.set(key, url);
    return url;
  }
  const ReliefLayer = L.TileLayer.extend({
    createTile(coords, done) {
      const img = document.createElement('img');
      img.alt = '';
      img.setAttribute('role', 'presentation');
      L.DomEvent.on(img, 'load', L.Util.bind(this._tileOnLoad, this, done, img));
      L.DomEvent.on(img, 'error', L.Util.bind(this._tileOnError, this, done, img));
      reliefTileUrl(coords.z, coords.x, coords.y).then((url) => {
        if (url) img.src = url; else done(new Error('no relief tile'), img);
      });
      return img;
    },
  });
  const relief = new ReliefLayer('', {
    pane: RELIEF_PANE, minZoom: 0, maxZoom: 22, maxNativeZoom: 6, noWrap: true,
    bounds: [[-85.0511, -180], [85.0511, 180]], keepBuffer: 2,
    attribution: 'Relief: Natural Earth',
  });
  function syncRelief() {
    const on = reliefOn();
    if (on && !map.hasLayer(relief)) relief.addTo(map);
    else if (!on && map.hasLayer(relief)) map.removeLayer(relief);
  }
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
    const flat = !reliefOn();          // the relief has its own land and sea
    if (flat) {
      ctx.fillStyle = SEA;
      ctx.fillRect(b.min.x, b.min.y, b.max.x - b.min.x, b.max.y - b.min.y);
    }
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
    if (flat) {
      ctx.fillStyle = LAND;
      ctx.fill('evenodd');
    }
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
  syncRelief();
  // The gist (or the tuning panel) can switch it while the app runs.
  map.on('zoomend moveend', syncRelief);

  // Country names thin out as the map zooms out: Natural Earth's own label rank says which
  // matter at a continent's scale (1-2) and which only close in (6+). Cities the same by their
  // scale rank (0 = Cairo, London; 7-8 = Haifa): the biggest from a continent's view, all of
  // them by a country's.
  function refreshLabels() {
    const z = map.getZoom();
    const maxRank = z <= 3 ? 2 : z <= 4 ? 3 : z <= 5 ? 4 : z <= 6 ? 5 : 10;
    const maxCity = z <= 3 ? 0 : z <= 4 ? 1 : z <= 5 ? 3 : z <= 6 ? 4 : 10;
    const turn = -(map.getBearing ? map.getBearing() : 0);
    for (const l of labels) {
      const show = l.city ? l.rank <= maxCity : l.rank <= maxRank;
      l.el.style.display = show ? '' : 'none';
      if (!show) continue;
      const p = map.latLngToLayerPoint(l.at);
      l.el.style.transform = 'translate3d(' + p.x + 'px,' + p.y + 'px,0) rotate(' + turn + 'deg)';
    }
  }

  async function load() {
    if (loaded) return loaded;
    loaded = (async () => {
      const url = (window.S && S.worldCountriesUrl) || 'data/world-countries.json?v=2';
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
          const el = document.createElement('div');
          el.className = 'world-label';
          const span = document.createElement('span');
          span.dir = 'auto';
          span.textContent = name;
          el.appendChild(span);
          map.getPane(LABEL_PANE).appendChild(el);
          labels.push({ el, at: L.latLng(c.at[0], c.at[1]), rank: Number.isFinite(c.rank) ? c.rank : 5 });
        }
      }
      // Major cities: a dot and a name. After the countries, so over them.
      for (const c of d.cities || []) {
        if (!Array.isArray(c.at)) continue;
        const el = document.createElement('div');
        el.className = 'world-label world-city' + (c.cap ? ' world-capital' : '');
        const span = document.createElement('span');
        span.dir = 'auto';
        span.textContent = String(c[key] || c.en || '');     // text, never markup
        el.appendChild(span);
        map.getPane(LABEL_PANE).appendChild(el);
        labels.push({ el, at: L.latLng(c.at[0], c.at[1]), rank: Number.isFinite(c.rank) ? c.rank : 8, city: true });
      }
      rings = out;
      renderer._redraw();                 // draw now, not on the next pan
      // Layer points change on a zoom or a view reset, and the counter-turn with the bearing.
      map.on('zoomend viewreset rotate', refreshLabels);
      refreshLabels();
      return true;
    })().catch(e => { loaded = null; console.warn('world map unavailable:', e); return false; });
    return loaded;
  }

  window.NavAid = window.NavAid || {};
  NavAid.worldOffline = { load, refreshLabels };
  load();
})();
