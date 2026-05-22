'use strict';
/* NavAid — save/load, page setup, flight plan, PNG export, persistence.
   Shares globals with core.js; loaded after interact.js. */

// --- save / load -----------------------------------------------------
function save() {
  const data = {
    waypoints: state.waypoints.map(w => ({
      lat: w.lat, lng: w.lng, name: w.name || '',
    })),
    legs: state.legs.map(l => ({
      inboundAltitude: l.inboundAltitude,
      outboundAltitude: l.outboundAltitude,
      flightSpeed: l.flightSpeed,
      inLabel: l.inLabel,
      outLabel: l.outLabel,
    })),
    notes: state.notes.map(n => ({
      lat: n.lat, lng: n.lng, text: n.text || '', color: n.color || '',
      shape: n.shape || 'rect',
    })),
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'route-' + fileStamp() + '.json';
  a.click();
  URL.revokeObjectURL(a.href);
}
function load(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const d = JSON.parse(reader.result);
      const wps = (d.waypoints || []).map(w => ({
        lat: +w.lat, lng: +w.lng, name: w.name || '',
      }));
      const notes = (d.notes || []).map(n => ({
        lat: +n.lat, lng: +n.lng, text: n.text || '', color: n.color || '',
        shape: n.shape === 'oval' ? 'oval' : 'rect',
      }));
      if (wps.concat(notes).some(
            p => !Number.isFinite(p.lat) || !Number.isFinite(p.lng))) {
        throw new Error(S.errBadCoords);
      }
      state.waypoints = wps;
      state.legs = (d.legs || []).map(l => ({
        inboundAltitude: l.inboundAltitude ?? 2000,
        outboundAltitude: l.outboundAltitude ?? 2000,
        flightSpeed: l.flightSpeed > 0 ? l.flightSpeed : 90,
        inLabel: l.inLabel || { a: 0, p: 44 },
        outLabel: l.outLabel || { a: 0, p: -44 },
      }));
      state.notes = notes;
      syncLegs();
      state.selected = null;
      showInspector();
      fitView();
      draw();
    } catch (err) {
      alert(S.errLoadFile + err.message);
    }
  };
  reader.readAsText(file);
}

// --- print -----------------------------------------------------------

function applyPage() {
  document.getElementById('page-a3').classList.toggle('active', pageSize === 'A3');
  document.getElementById('page-a4').classList.toggle('active', pageSize === 'A4');
  draw();
}

function setPage(size) {
  if (pageSize === size) {             // same button toggles the frame off
    pageSize = null;
    applyPage();
    return;
  }
  chooseOrientation(size, orient => {
    pageOrient = orient;
    pageSize = size;
    pageOffset = { x: 0, y: 0 };          // start centred
    applyPage();
  });
}

// --- flight plan table -----------------------------------------------
function wpLabel(i) {
  const wp = state.waypoints[i];
  if (!wp) return '';
  const n = navName((wp.name || '').trim());
  return n || (S.wpPrefix + (i + 1));
}

function showFlightPlan() {
  if (state.legs.length === 0) {
    alert(S.errNoLegs);
    return;
  }
  const back = document.createElement('div');
  back.className = 'modal-back';
  const box = document.createElement('div');
  box.className = 'modal wide';

  const title = document.createElement('div');
  title.className = 'modal-title';
  title.textContent = S.flightPlan;
  box.appendChild(title);

  const table = document.createElement('table');
  table.className = 'flight-table';
  const headers = S.fpHeaders;
  const thead = document.createElement('thead');
  const trH = document.createElement('tr');
  for (const h of headers) {
    const th = document.createElement('th');
    th.textContent = h;
    trH.appendChild(th);
  }
  thead.appendChild(trH);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  // From / To cells are editable — each waypoint may appear in two rows,
  // so edits sync every input bound to the same waypoint.
  const wpInputs = {};                  // waypoint index -> [input elements]
  function nameCell(wpIdx) {
    const td = document.createElement('td');
    const inp = document.createElement('input');
    inp.type = 'text';
    inp.className = 'plan-name';
    inp.maxLength = 10;
    inp.value = (state.waypoints[wpIdx].name || '').trim();
    inp.placeholder = S.wpPrefix + (wpIdx + 1);
    inp.oninput = () => {
      state.waypoints[wpIdx].name = inp.value;
      for (const o of wpInputs[wpIdx]) if (o !== inp) o.value = inp.value;
      draw();
    };
    (wpInputs[wpIdx] || (wpInputs[wpIdx] = [])).push(inp);
    td.appendChild(inp);
    return td;
  }
  // Speed / Alt cells are editable number inputs. Commit on `change`
  // (blur / Enter), matching the inspector's number fields.
  function numCell(value, min, onCommit) {
    const td = document.createElement('td');
    const inp = document.createElement('input');
    inp.type = 'number';
    inp.className = 'plan-num';
    inp.min = min;
    inp.value = value;
    inp.onchange = () => onCommit(inp);
    td.appendChild(inp);
    return td;
  }
  const rows = [];                      // { leg, dist, timeCell }
  const altInputs = [];                 // leg index -> altitude input
  let totDistCell, totTimeCell;
  function refresh() {                  // recompute Time cells + totals
    let td = 0, th = 0;
    for (const r of rows) {
      const dur = r.leg.flightSpeed > 0 ? r.dist / r.leg.flightSpeed : 0;
      td += r.dist;
      th += dur;
      r.timeCell.textContent = dur > 0 ? toHMS(dur) : '--';
    }
    totDistCell.textContent = td.toFixed(1);
    totTimeCell.textContent = th > 0 ? toHMS(th) : '--';
  }
  for (let i = 0; i < state.legs.length; i++) {
    const A = state.waypoints[i], B = state.waypoints[i + 1];
    const leg = state.legs[i];
    const { dist, brg } = geo(A, B);
    const tr = document.createElement('tr');
    tr.appendChild(planCell(String(i + 1)));
    tr.appendChild(nameCell(i));
    tr.appendChild(nameCell(i + 1));
    tr.appendChild(planCell(pad3(toMagnetic(brg)) + '°M'));
    tr.appendChild(planCell(dist.toFixed(1)));
    tr.appendChild(numCell(leg.flightSpeed, 1, inp => {
      const v = +inp.value;
      if (v > 0) { leg.flightSpeed = v; refresh(); draw(); }
    }));
    const altCell = numCell(leg.inboundAltitude, -2000, inp => {
      const oldVal = leg.inboundAltitude;
      leg.inboundAltitude = Math.round(+inp.value) || 0;
      propagateAlt(i, 'inboundAltitude', leg.inboundAltitude, oldVal);
      for (let k = 0; k < altInputs.length; k++) {
        if (altInputs[k]) altInputs[k].value = state.legs[k].inboundAltitude;
      }
      draw();
    });
    altInputs[i] = altCell.querySelector('.plan-num');
    tr.appendChild(altCell);
    const timeCell = planCell('');
    tr.appendChild(timeCell);
    rows.push({ leg, dist, timeCell });
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);

  const tfoot = document.createElement('tfoot');
  const trF = document.createElement('tr');
  const tdLabel = document.createElement('td');
  tdLabel.colSpan = 4;
  tdLabel.textContent = S.fpTotal;
  trF.appendChild(tdLabel);
  totDistCell = planCell('');
  trF.appendChild(totDistCell);
  trF.appendChild(planCell(''));        // Speed column
  trF.appendChild(planCell(''));        // Alt column
  totTimeCell = planCell('');
  trF.appendChild(totTimeCell);
  tfoot.appendChild(trF);
  table.appendChild(tfoot);
  refresh();
  box.appendChild(table);

  const btns = document.createElement('div');
  btns.className = 'modal-btns';
  const printBtn = document.createElement('button');
  printBtn.textContent = S.fpPrint;
  printBtn.onclick = () => {
    const cleanup = () => {
      document.body.classList.remove('printing-plan');
      window.removeEventListener('afterprint', cleanup);
    };
    window.addEventListener('afterprint', cleanup, { once: true });
    document.body.classList.add('printing-plan');
    window.print();
    setTimeout(cleanup, 4000);           // belt-and-braces for Safari
  };
  btns.appendChild(printBtn);
  const close = document.createElement('button');
  close.textContent = S.fpClose;
  close.className = 'modal-cancel';
  close.onclick = () => back.remove();
  btns.appendChild(close);
  box.appendChild(btns);

  back.appendChild(box);
  back.onclick = e => { if (e.target === back) back.remove(); };
  document.body.appendChild(back);
}

function planCell(text) {
  const td = document.createElement('td');
  td.textContent = text;
  return td;
}

// Modal: pick Landscape or Portrait (named buttons, not OK/Cancel).
function chooseOrientation(size, onPick) {
  const back = document.createElement('div');
  back.className = 'modal-back';
  const box = document.createElement('div');
  box.className = 'modal';
  const title = document.createElement('div');
  title.className = 'modal-title';
  title.textContent = size + S.pageOrientation;
  const btns = document.createElement('div');
  btns.className = 'modal-btns';
  for (const [label, val] of [[S.landscape, 'landscape'], [S.portrait, 'portrait']]) {
    const b = document.createElement('button');
    b.textContent = label;
    b.onclick = () => { back.remove(); onPick(val); };
    btns.appendChild(b);
  }
  const cancel = document.createElement('button');
  cancel.textContent = S.cancel;
  cancel.className = 'modal-cancel';
  cancel.onclick = () => back.remove();
  btns.appendChild(cancel);
  box.append(title, btns);
  back.appendChild(box);
  back.onclick = e => { if (e.target === back) back.remove(); };
  document.body.appendChild(back);
}

// Timestamp for unique download names — avoids browser " (1)" suffixes.
function fileStamp() {
  return new Date().toISOString().slice(0, 19)
    .replace(/[-:]/g, '').replace('T', '-');
}

// Save the framed map + route as a PNG, rendered at the highest practical
// native tile zoom (not the on-screen zoom) for maximum quality. flight-maps
// tiles are not CORS-enabled, so each tile is fetched through the weserv image
// proxy (which adds Access-Control-Allow-Origin) to keep the canvas untainted.
function exportPNG() {
  // Export matches the screen view exactly, including map bearing.
  // Tiles are fetched north-up (axis-aligned) for a bounding box that covers
  // all 4 frame corners, composited onto an intermediate canvas, then drawn
  // onto the output canvas with the bearing rotation applied.  The route
  // overlay uses normal screen coords (which already encode bearing via
  // latLngToContainerPoint) so the same scale/translate works for any bearing.
  NavAid.exporting = true;
  const exportBearing = map.getBearing ? map.getBearing() : 0;

  const fr = pageFrameRect() || { x: 0, y: 0, w: vw(), h: vh() };
  if (fr.w < 4 || fr.h < 4) { NavAid.exporting = false; return; }

  let base = null, baseName = 'map';
  for (const n in layers) {
    if (map.hasLayer(layers[n])) { base = layers[n]; baseName = n; }
  }
  if (!base || !base._url) { NavAid.exporting = false; return; }

  // Geographic centre of the frame (stays constant regardless of bearing).
  const frameCenterLL = map.containerPointToLatLng([fr.x + fr.w / 2, fr.y + fr.h / 2]);

  // All 4 frame corners → axis-aligned lat/lng bounding box for tile fetching.
  const c0 = map.containerPointToLatLng([fr.x,          fr.y         ]);
  const c1 = map.containerPointToLatLng([fr.x + fr.w,   fr.y         ]);
  const c2 = map.containerPointToLatLng([fr.x + fr.w,   fr.y + fr.h  ]);
  const c3 = map.containerPointToLatLng([fr.x,          fr.y + fr.h  ]);
  const bbNWll = { lat: Math.max(c0.lat, c1.lat, c2.lat, c3.lat),
                   lng: Math.min(c0.lng, c1.lng, c2.lng, c3.lng) };
  const bbSEll = { lat: Math.min(c0.lat, c1.lat, c2.lat, c3.lat),
                   lng: Math.max(c0.lng, c1.lng, c2.lng, c3.lng) };

  // Zoom down until the bounding box fits in one canvas.
  const maxZ = base.options.maxNativeZoom || base.options.maxZoom || 13;
  let z = maxZ, bbNWP, bbSEP, Wbb, Hbb;
  for (z = maxZ; z >= 9; z--) {
    bbNWP = map.project([bbNWll.lat, bbNWll.lng], z);
    bbSEP = map.project([bbSEll.lat, bbSEll.lng], z);
    Wbb = Math.round(bbSEP.x - bbNWP.x);
    Hbb = Math.round(bbSEP.y - bbNWP.y);
    if (Wbb <= 10000 && Hbb <= 10000) break;
  }

  // Output canvas: same physical size as the frame at the chosen tile zoom.
  const tilePerScreen = Math.pow(2, z - map.getZoom());
  const W = Math.round(fr.w * tilePerScreen);
  const H = Math.round(fr.h * tilePerScreen);

  // Intermediate canvas: north-up tile composite covering the bounding box.
  const tileCanvas = document.createElement('canvas');
  tileCanvas.width  = Wbb;
  tileCanvas.height = Hbb;
  const tc = tileCanvas.getContext('2d');
  tc.fillStyle = '#231F20';
  tc.fillRect(0, 0, Wbb, Hbb);

  const out = document.createElement('canvas');
  out.width  = W;
  out.height = H;
  const o = out.getContext('2d');
  o.fillStyle = '#231F20';
  o.fillRect(0, 0, W, H);

  const btn = document.getElementById('print');
  const btnLabel = btn.textContent;
  btn.textContent = S.saving;
  btn.disabled = true;

  // Gather the covering tiles. CORS-capable layers (OSM, Esri) are fetched
  // directly; flight-maps.com tiles need the weserv proxy to add CORS headers.
  const subs = base.options.subdomains || 'abc';
  const corsOk = base.options.corsOk;
  const jobs = [];
  for (let tx = Math.floor(bbNWP.x / 256); tx <= Math.floor(bbSEP.x / 256); tx++) {
    for (let ty = Math.floor(bbNWP.y / 256); ty <= Math.floor(bbSEP.y / 256); ty++) {
      const url = L.Util.template(base._url,
        { z, x: tx, y: ty, s: subs[(tx + ty) % subs.length] });
      const img = new Image();
      img.crossOrigin = 'anonymous';
      const job = {
        img,
        dx: Math.round(tx * 256 - bbNWP.x),
        dy: Math.round(ty * 256 - bbNWP.y),
        done: new Promise(res => {
          img.onload = res;
          img.onerror = res;
          setTimeout(res, 20000);
        }),
      };
      img.src = corsOk ? url
        : 'https://images.weserv.nl/?url=' +
          encodeURIComponent(url.replace(/^https?:\/\//, ''));
      jobs.push(job);
    }
  }

  Promise.all(jobs.map(j => j.done)).then(() => {
    let failed = 0;
    for (const j of jobs) {
      if (j.img.naturalWidth) {
        try { tc.drawImage(j.img, j.dx, j.dy, 256, 256); }
        catch (e) { failed++; }
      } else {
        failed++;
      }
    }

    // Draw the tile canvas onto the output, rotated by the map bearing so the
    // result matches the screen view.  The frame centre in tile-canvas space
    // maps to the output centre; rotation is clockwise by exportBearing.
    const fcP = map.project([frameCenterLL.lat, frameCenterLL.lng], z);
    const fcx = fcP.x - bbNWP.x;
    const fcy = fcP.y - bbNWP.y;
    o.save();
    o.translate(W / 2, H / 2);
    o.rotate(exportBearing * Math.PI / 180);
    o.translate(-fcx, -fcy);
    o.drawImage(tileCanvas, 0, 0);
    o.restore();

    // Route overlay: screen coords already encode bearing, so the standard
    // scale/translate maps them correctly onto the rotated tile output.
    const s = W / fr.w;
    const prevOctx = octx;
    octx = o;
    o.save();
    o.scale(s, s);
    o.translate(-fr.x, -fr.y);
    drawNavWaypoints();
    drawLegs();
    drawWaypoints();
    drawNotes();
    o.restore();
    octx = prevOctx;

    out.toBlob(b => {
      btn.textContent = btnLabel;
      btn.disabled = false;
      NavAid.exporting = false;
      if (!b) { alert(S.errPngFail); return; }
      const a = document.createElement('a');
      a.href = URL.createObjectURL(b);
      a.download = 'navigation-' + (pageSize || baseName) +
                   '-' + fileStamp() + '.png';
      a.click();
      URL.revokeObjectURL(a.href);
      if (failed > 0) alert(S.errTilesFail(failed, jobs.length));
    }, 'image/png');
  });
}

// --- fly the route (Google Earth) -----------------------------------
// A browser cannot launch or detect a desktop app, so this writes a KML
// tour and tells the user to open it in Google Earth Pro, which flies
// the route at the per-leg altitudes set in the flight plan.
function flyRoute() {
  if (state.waypoints.length < 2) {
    alert(S.errNeedWps);
    return;
  }
  if (!confirm(S.flyConfirm)) {
    return;
  }
  const wps = state.waypoints;
  // Camera flythrough height per waypoint (metres MSL): the leg flown
  // along it; the last waypoint reuses the last leg. inboundAltitude is feet.
  const altM = i => {
    const leg = state.legs[Math.min(i, state.legs.length - 1)];
    return Math.max(0, Math.round((leg ? leg.inboundAltitude : 2000) * 0.3048));
  };
  const esc = s => String(s).replace(/[<>&]/g,
    c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));

  // heading at each waypoint = bearing toward the next (last reuses prev)
  const heading = i => {
    const j = Math.min(i, wps.length - 2);
    return geo(wps[j], wps[j + 1]).brg;
  };
  // KML <Camera> child order is strict — altitudeMode must come last,
  // or Google Earth ignores it and the eye ends up miles up.
  // absolute = altitude is metres above mean sea level (MSL).
  const camera = (i, pad) =>
    pad + '<Camera>\n' +
    pad + '  <longitude>' + wps[i].lng + '</longitude>\n' +
    pad + '  <latitude>' + wps[i].lat + '</latitude>\n' +
    pad + '  <altitude>' + altM(i) + '</altitude>\n' +
    pad + '  <heading>' + heading(i).toFixed(1) + '</heading>\n' +
    pad + '  <tilt>85</tilt>\n' +
    pad + '  <roll>0</roll>\n' +
    pad + '  <altitudeMode>absolute</altitudeMode>\n' +
    pad + '</Camera>\n';
  const flyTo = (i, dur, mode) =>
    '    <gx:FlyTo>\n' +
    '      <gx:duration>' + dur.toFixed(1) + '</gx:duration>\n' +
    '      <gx:flyToMode>' + mode + '</gx:flyToMode>\n' +
    camera(i, '      ') +
    '    </gx:FlyTo>\n';

  let tour = flyTo(0, 4, 'bounce');
  for (let i = 1; i < wps.length; i++) {
    const leg = state.legs[i - 1];
    const { dist } = geo(wps[i - 1], wps[i]);
    const durH = leg && leg.flightSpeed > 0 ? dist / leg.flightSpeed : 0;
    tour += flyTo(i, Math.max(4, Math.min(45, durH * 60 * 4)), 'smooth');
  }

  const coords = wps.map(w => w.lng + ',' + w.lat + ',0').join(' ');
  const points = wps.map((w, i) =>
    '  <Placemark><name>' + esc(wpLabel(i)) + '</name>' +
    '<Point><coordinates>' + w.lng + ',' + w.lat + ',0</coordinates></Point>' +
    '</Placemark>').join('\n');

  const kml =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<kml xmlns="http://www.opengis.net/kml/2.2" ' +
    'xmlns:gx="http://www.google.com/kml/ext/2.2">\n<Document>\n' +
    '  <name>' + S.kmlDocName + '</name>\n' +
    camera(0, '  ') +                    // open already at the start, 5000 ft
    '  <Placemark><name>' + S.kmlRouteName + '</name>\n' +
    '    <Style><LineStyle><color>ff3399ff</color><width>3</width></LineStyle></Style>\n' +
    '    <LineString><tessellate>1</tessellate>\n' +
    '      <coordinates>' + coords + '</coordinates>\n' +
    '    </LineString>\n  </Placemark>\n' + points + '\n' +
    '  <gx:Tour><name>' + S.kmlTourName + '</name>\n    <gx:Playlist>\n' +
    tour + '    </gx:Playlist>\n  </gx:Tour>\n' +
    '</Document>\n</kml>\n';

  const blob = new Blob([kml],
    { type: 'application/vnd.google-earth.kml+xml' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'navaid-flythrough-' + fileStamp() + '.kml';
  a.click();
  URL.revokeObjectURL(a.href);
}

// --- route persistence ----------------------------------------------
const STORE_KEY = 'navaid.route';
let persistTimer = null;
function persist() {
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    try {
      // center / zoom are not restored (load fits the route) — not saved.
      localStorage.setItem(STORE_KEY, JSON.stringify({
        waypoints: state.waypoints,
        legs: state.legs,
        notes: state.notes,
      }));
    } catch (e) { /* storage unavailable */ }
  }, 500);
}
function restoreRoute() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return false;
    const d = JSON.parse(raw);
    const wps = (d.waypoints || []).map(w => ({
      lat: +w.lat, lng: +w.lng, name: w.name || '',
    }));
    const notes = (d.notes || []).map(n => ({
      lat: +n.lat, lng: +n.lng, text: n.text || '', color: n.color || '',
      shape: n.shape === 'oval' ? 'oval' : 'rect',
    }));
    if (wps.concat(notes).some(
          p => !Number.isFinite(p.lat) || !Number.isFinite(p.lng))) {
      return false;                       // corrupt cache — start empty
    }
    state.waypoints = wps;
    state.legs = (d.legs || []).map(l => ({
      inboundAltitude: l.inboundAltitude ?? 2000,
      outboundAltitude: l.outboundAltitude ?? 2000,
      flightSpeed: l.flightSpeed > 0 ? l.flightSpeed : 90,
      inLabel: l.inLabel || { a: 0, p: 44 },
      outLabel: l.outLabel || { a: 0, p: -44 },
    }));
    state.notes = notes;
    syncLegs();
    return true;
  } catch (e) {
    return false;
  }
}

