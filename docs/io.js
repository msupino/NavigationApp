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
  a.download = 'route.json';
  a.click();
  URL.revokeObjectURL(a.href);
}
function load(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const d = JSON.parse(reader.result);
      state.waypoints = (d.waypoints || []).map(w => ({
        lat: +w.lat, lng: +w.lng, name: w.name || '',
      }));
      state.legs = (d.legs || []).map(l => ({
        inboundAltitude: l.inboundAltitude ?? 2000,
        outboundAltitude: l.outboundAltitude ?? 2000,
        flightSpeed: l.flightSpeed > 0 ? l.flightSpeed : 90,
        inLabel: l.inLabel || { a: 0, p: 44 },
        outLabel: l.outLabel || { a: 0, p: -44 },
      }));
      state.notes = (d.notes || []).map(n => ({
        lat: +n.lat, lng: +n.lng, text: n.text || '', color: n.color || '',
        shape: n.shape === 'oval' ? 'oval' : 'rect',
      }));
      syncLegs();
      state.selected = null;
      showInspector();
      fitView();
      draw();
    } catch (err) {
      alert('Could not load file: ' + err.message);
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
  const n = (wp.name || '').trim();
  return n || ('WP ' + (i + 1));
}

function showFlightPlan() {
  if (state.legs.length === 0) {
    alert('No legs yet — drop at least two waypoints first.');
    return;
  }
  const back = document.createElement('div');
  back.className = 'modal-back';
  const box = document.createElement('div');
  box.className = 'modal wide';

  const title = document.createElement('div');
  title.className = 'modal-title';
  title.textContent = 'Flight plan';
  box.appendChild(title);

  const table = document.createElement('table');
  table.className = 'flight-table';
  const headers = ['#', 'From', 'To', 'Hdg', 'Dist (NM)',
                   'Speed (kt)', 'Alt (ft)', 'Time'];
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
    inp.placeholder = 'WP ' + (wpIdx + 1);
    inp.oninput = () => {
      state.waypoints[wpIdx].name = inp.value;
      for (const o of wpInputs[wpIdx]) if (o !== inp) o.value = inp.value;
      draw();
    };
    (wpInputs[wpIdx] || (wpInputs[wpIdx] = [])).push(inp);
    td.appendChild(inp);
    return td;
  }
  // Speed / Alt cells are editable number inputs.
  function numCell(value, min, onInput) {
    const td = document.createElement('td');
    const inp = document.createElement('input');
    inp.type = 'number';
    inp.className = 'plan-num';
    inp.min = min;
    inp.value = value;
    inp.oninput = () => onInput(inp);
    td.appendChild(inp);
    return td;
  }
  const rows = [];                      // { leg, dist, timeCell }
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
    tr.appendChild(numCell(leg.inboundAltitude, -2000, inp => {
      leg.inboundAltitude = Math.round(+inp.value) || 0;
      draw();
    }));
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
  tdLabel.textContent = 'Total';
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
  const close = document.createElement('button');
  close.textContent = 'Close';
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
  title.textContent = size + ' page — orientation';
  const btns = document.createElement('div');
  btns.className = 'modal-btns';
  for (const [label, val] of [['Landscape', 'landscape'], ['Portrait', 'portrait']]) {
    const b = document.createElement('button');
    b.textContent = label;
    b.onclick = () => { back.remove(); onPick(val); };
    btns.appendChild(b);
  }
  const cancel = document.createElement('button');
  cancel.textContent = 'Cancel';
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
  const fr = pageFrameRect() || { x: 0, y: 0, w: vw(), h: vh() };
  if (fr.w < 4 || fr.h < 4) return;

  let base = null, baseName = 'map';
  for (const n in layers) {
    if (map.hasLayer(layers[n])) { base = layers[n]; baseName = n; }
  }
  if (!base || !base._url) return;

  const nw = map.containerPointToLatLng([fr.x, fr.y]);
  const se = map.containerPointToLatLng([fr.x + fr.w, fr.y + fr.h]);

  // Always export at the layer's max native zoom; only step down if the
  // region is physically too large for one canvas.
  const maxZ = base.options.maxNativeZoom || base.options.maxZoom || 13;
  let z = maxZ, nwP, seP, W, H;
  for (; z >= 9; z--) {
    nwP = map.project([nw.lat, nw.lng], z);
    seP = map.project([se.lat, se.lng], z);
    W = Math.round(seP.x - nwP.x);
    H = Math.round(seP.y - nwP.y);
    if (W <= 10000 && H <= 10000) break;
  }

  const out = document.createElement('canvas');
  out.width = W;
  out.height = H;
  const o = out.getContext('2d');
  o.fillStyle = '#231F20';
  o.fillRect(0, 0, W, H);

  const btn = document.getElementById('print');
  const btnLabel = btn.textContent;
  btn.textContent = '⏳ Saving…';
  btn.disabled = true;

  // gather the covering tiles, proxied for CORS
  const subs = base.options.subdomains || 'abc';
  const jobs = [];
  for (let tx = Math.floor(nwP.x / 256); tx <= Math.floor(seP.x / 256); tx++) {
    for (let ty = Math.floor(nwP.y / 256); ty <= Math.floor(seP.y / 256); ty++) {
      const url = L.Util.template(base._url,
        { z, x: tx, y: ty, s: subs[(tx + ty) % subs.length] });
      const img = new Image();
      img.crossOrigin = 'anonymous';
      const job = {
        img, dx: Math.round(tx * 256 - nwP.x), dy: Math.round(ty * 256 - nwP.y),
        done: new Promise(res => {
          img.onload = res;
          img.onerror = res;
          setTimeout(res, 20000);          // never hang on a stalled tile
        }),
      };
      img.src = 'https://images.weserv.nl/?url=' +
                encodeURIComponent(url.replace(/^https?:\/\//, ''));
      jobs.push(job);
    }
  }

  Promise.all(jobs.map(j => j.done)).then(() => {
    let failed = 0;
    for (const j of jobs) {
      if (j.img.naturalWidth) {
        try { o.drawImage(j.img, j.dx, j.dy, 256, 256); }
        catch (e) { failed++; }
      } else {
        failed++;
      }
    }
    // re-render the route into the export canvas. Web Mercator is a uniform
    // scale between zooms, so the on-screen projection scaled by s lines up
    // with the native-zoom tiles exactly.
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
      if (!b) { alert('PNG export failed (a map tile could not be loaded).'); return; }
      const a = document.createElement('a');
      a.href = URL.createObjectURL(b);
      a.download = 'navigation-' + (pageSize || baseName) +
                   '-' + fileStamp() + '.png';
      a.click();
      URL.revokeObjectURL(a.href);
      if (failed > 0) {
        alert(failed + ' of ' + jobs.length + ' map tiles failed to load — ' +
              'the PNG may have blank patches. Re-run the export to retry.');
      }
    }, 'image/png');
  });
}

// --- fly the route (Google Earth) -----------------------------------
// A browser cannot launch or detect a desktop app, so this writes a KML
// tour and tells the user to open it in Google Earth Pro, which flies
// the route ~5000 ft above the terrain.
function flyRoute() {
  if (state.waypoints.length < 2) {
    alert('Add at least two waypoints first.');
    return;
  }
  if (!confirm('Fly the route in Google Earth Pro (desktop).\n\n' +
      'Press OK to save the tour file (.kml), then open it in Google ' +
      'Earth — the "Fly the route" tour appears under Places; press ' +
      'play to fly the route ~5000 ft above the terrain.\n\n' +
      'No Google Earth? Free desktop app: google.com/earth/versions')) {
    return;
  }
  const AGL = 1524;                      // 5000 ft, in metres
  const wps = state.waypoints;
  const esc = s => String(s).replace(/[<>&]/g,
    c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));

  // heading at each waypoint = bearing toward the next (last reuses prev)
  const heading = i => {
    const j = Math.min(i, wps.length - 2);
    return geo(wps[j], wps[j + 1]).brg;
  };
  // KML <Camera> child order is strict — altitudeMode must come last,
  // or Google Earth ignores it and the eye ends up miles up.
  const camera = (i, pad) =>
    pad + '<Camera>\n' +
    pad + '  <longitude>' + wps[i].lng + '</longitude>\n' +
    pad + '  <latitude>' + wps[i].lat + '</latitude>\n' +
    pad + '  <altitude>' + AGL + '</altitude>\n' +
    pad + '  <heading>' + heading(i).toFixed(1) + '</heading>\n' +
    pad + '  <tilt>85</tilt>\n' +
    pad + '  <roll>0</roll>\n' +
    pad + '  <altitudeMode>relativeToGround</altitudeMode>\n' +
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
    '  <name>NavAid flythrough</name>\n' +
    camera(0, '  ') +                    // open already at the start, 5000 ft
    '  <Placemark><name>Route</name>\n' +
    '    <Style><LineStyle><color>ff3399ff</color><width>3</width></LineStyle></Style>\n' +
    '    <LineString><tessellate>1</tessellate>\n' +
    '      <coordinates>' + coords + '</coordinates>\n' +
    '    </LineString>\n  </Placemark>\n' + points + '\n' +
    '  <gx:Tour><name>Fly the route</name>\n    <gx:Playlist>\n' +
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
    state.waypoints = (d.waypoints || []).map(w => ({
      lat: +w.lat, lng: +w.lng, name: w.name || '',
    }));
    state.legs = (d.legs || []).map(l => ({
      inboundAltitude: l.inboundAltitude ?? 2000,
      outboundAltitude: l.outboundAltitude ?? 2000,
      flightSpeed: l.flightSpeed > 0 ? l.flightSpeed : 90,
      inLabel: l.inLabel || { a: 0, p: 44 },
      outLabel: l.outLabel || { a: 0, p: -44 },
    }));
    state.notes = (d.notes || []).map(n => ({
      lat: +n.lat, lng: +n.lng, text: n.text || '', color: n.color || '',
      shape: n.shape === 'oval' ? 'oval' : 'rect',
    }));
    syncLegs();
    return true;
  } catch (e) {
    return false;
  }
}

