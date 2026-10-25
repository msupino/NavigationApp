'use strict';

// Digital compass: press and hold the map's rotation dial (bottom right) and a large compass
// opens over the map, turning with the phone -- the heading the phone's top points at, read
// MAGNETIC like every heading on the chart's kites, in three digits. Asked for "a compass at
// the bottom of the page that shows the direction when pressed"; the dial already sits there,
// so it is the dial's long press rather than one more button.
//
// The phone's own sensor, through the web's orientation events:
//   iOS      deviceorientation with webkitCompassHeading (magnetic, clockwise from north).
//            Needs DeviceOrientationEvent.requestPermission() from a tap -- a long press's
//            timer is not one -- so the compass asks with a Start button when iOS wants it.
//   Android  deviceorientationabsolute: alpha counter-clockwise from magnetic north.
// The screen's own rotation is added, so the reading is where the top of the SCREEN points.
// A phone compass is thrown off by the airframe, the radios and a magnet in a phone case: the
// window says so, and the compass is never used to draw or fly anything.
(function () {
  const str = (k, d) => (typeof S === 'object' && S && S[k]) || d;
  const feat = () => typeof tune !== 'function' || tune('featureCompass') !== false;

  // --- the rose ---------------------------------------------------------------------------
  // Drawn once; the card turns under a fixed lubber line, as a real compass card does.
  function roseSvg() {
    // The picture asked for, as a card: coloured main points (N red, E yellow, S blue, W green),
    // grey points between them, a three-digit heading every 10°, the four in-between directions
    // with their headings, and the directions' names in the interface language.
    const C = 180, R = 150;
    const pol = (r, d) => { const a = d * Math.PI / 180; return [C + r * Math.sin(a), C - r * Math.cos(a)]; };
    const f = (n) => n.toFixed(1);
    const p = [];
    // Left to right: in a Hebrew page "045°" came out as "°045".
    p.push('<svg viewBox="0 0 360 360" class="compass-rose" direction="ltr" aria-hidden="true" focusable="false">');
    p.push('<g class="compass-card">');
    p.push(`<circle cx="${C}" cy="${C}" r="${R + 28}" class="compass-face"/>`);
    for (const r of [44, 78, 112]) p.push(`<circle cx="${C}" cy="${C}" r="${r}" class="compass-guide"/>`);
    p.push(`<circle cx="${C}" cy="${C}" r="${R}" class="compass-ring"/>`);
    for (let d = 0; d < 360; d += 1) {
      const L = d % 10 === 0 ? 12 : d % 5 === 0 ? 8 : 4;
      const [x1, y1] = pol(R, d), [x2, y2] = pol(R - L, d);
      p.push(`<line x1="${f(x1)}" y1="${f(y1)}" x2="${f(x2)}" y2="${f(y2)}" class="compass-tick${d % 10 === 0 ? ' major' : d % 5 ? ' minor' : ''}"/>`);
    }
    // Headings outside the ring, every 10°, upright to the card (they turn with it).
    for (let d = 0; d < 360; d += 10) {
      if (d % 90 === 0) continue;
      const [x, y] = pol(R + 14, d);
      p.push(`<text x="${f(x)}" y="${f(y)}" class="compass-num" transform="rotate(${d} ${f(x)} ${f(y)})">${String(d).padStart(3, '0')}</text>`);
    }
    const point = (deg, len, half, c1, c2) => {
      const [tx, ty] = pol(len, deg), [lx, ly] = pol(half, deg - 90), [rx, ry] = pol(half, deg + 90);
      p.push(`<polygon points="${C},${C} ${f(lx)},${f(ly)} ${f(tx)},${f(ty)}" fill="${c1}" class="compass-pt"/>`);
      p.push(`<polygon points="${C},${C} ${f(tx)},${f(ty)} ${f(rx)},${f(ry)}" fill="${c2}" class="compass-pt"/>`);
    };
    for (let d = 22.5; d < 360; d += 45) point(d, 62, 6, '#e6e6e6', '#9a9a9a');
    for (const d of [45, 135, 225, 315]) point(d, 82, 9, '#d0d0d0', '#3a3a3a');
    const MAIN = { 0: ['#ff5a5a', '#c62828'], 90: ['#ffd54a', '#e0a400'], 180: ['#5aa0ff', '#1e63d6'], 270: ['#6fd36f', '#1b7a2e'] };
    for (const d of [0, 90, 180, 270]) point(d, 100, 13, MAIN[d][0], MAIN[d][1]);
    p.push(`<circle cx="${C}" cy="${C}" r="12" class="compass-hub"/>`);
    // Main directions: the letter at the ring and the name under it.
    const NAME = { 0: str('compassN', 'North'), 90: str('compassE', 'East'), 180: str('compassS', 'South'), 270: str('compassW', 'West') };
    for (const [d, l] of [[0, 'N'], [90, 'E'], [180, 'S'], [270, 'W']]) {
      const [x, y] = pol(R - 25, d), [nx, ny] = pol(R - 47, d);
      p.push(`<text x="${f(x)}" y="${f(y)}" class="compass-card-letter" fill="${MAIN[d][1]}" transform="rotate(${d} ${f(x)} ${f(y)})">${l}</text>`);
      p.push(`<text x="${f(nx)}" y="${f(ny)}" class="compass-card-name" transform="rotate(${d} ${f(nx)} ${f(ny)})">${NAME[d]}</text>`);
    }
    // In-between directions: the letters and their heading.
    const INTER = { 45: ['NE', '#e8770e'], 135: ['SE', '#1e63d6'], 225: ['SW', '#2e9e3e'], 315: ['NW', '#7b2fbf'] };
    for (const d of [45, 135, 225, 315]) {
      const [x, y] = pol(R - 40, d);
      p.push(`<text x="${f(x)}" y="${f(y)}" class="compass-inter" fill="${INTER[d][1]}" transform="rotate(${d} ${f(x)} ${f(y)})">`
        + `<tspan x="${f(x)}" dy="-6">${INTER[d][0]}</tspan><tspan x="${f(x)}" dy="15" class="compass-inter-deg">${String(d).padStart(3, '0')}°</tspan></text>`);
    }
    p.push('</g>');
    // The lubber line and the aircraft: the way the phone's top points. Fixed at the top with the
    // card turning (heading up); turning over a still card (north up).
    p.push('<g class="compass-ac">');
    p.push(`<polygon points="${C},${C - R + 2} ${C - 10},${C - R - 20} ${C + 10},${C - R - 20}" class="compass-lubber"/>`);
    p.push(`<path d="M${C} ${C - 24} l4 15 h15 l0 6 l-15 4 l-2 15 l7 4 v4 l-9 -2 l-9 2 v-4 l7 -4 l-2 -15 l-15 -4 l0 -6 h15 z" class="compass-plane"/>`);
    p.push('</g>');
    p.push('</svg>');
    return p.join('');
  }

  // --- the sensor -------------------------------------------------------------------------
  let listening = false, onReading = null, smooth = null, lastAt = 0;
  const screenAngle = () => {
    const o = window.screen && window.screen.orientation;
    if (o && Number.isFinite(o.angle)) return o.angle;
    return Number.isFinite(window.orientation) ? window.orientation : 0;
  };
  const wrap = (v) => ((v % 360) + 360) % 360;
  function feed(raw) {
    if (!Number.isFinite(raw)) return;
    const h = wrap(raw + screenAngle());
    // Low-pass on the circle: the shortest way round, so 359 -> 1 does not swing through 180.
    if (smooth == null) smooth = h;
    else {
      const k = Math.max(0.05, Math.min(1, typeof tune === 'function' ? tune('compassSmoothing') : 0.25));
      let d = h - smooth; if (d > 180) d -= 360; if (d < -180) d += 360;
      smooth = wrap(smooth + d * k);
    }
    lastAt = Date.now();
    if (onReading) onReading(smooth);
  }
  function onRelative(e) {
    if (typeof e.webkitCompassHeading === 'number' && e.webkitCompassHeading >= 0) feed(e.webkitCompassHeading);
    else if (e.absolute === true && e.alpha != null) feed(360 - e.alpha);
  }
  function onAbsolute(e) { if (e.alpha != null) feed(360 - e.alpha); }
  function listen() {
    if (listening) return;
    listening = true;
    window.addEventListener('deviceorientationabsolute', onAbsolute, true);
    window.addEventListener('deviceorientation', onRelative, true);
  }
  function stop() {
    listening = false; smooth = null; lastAt = 0; onReading = null;
    window.removeEventListener('deviceorientationabsolute', onAbsolute, true);
    window.removeEventListener('deviceorientation', onRelative, true);
  }
  const isIos = () => /iPhone|iPad|iPod/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  // iOS asks; everything else just listens.
  const needsPermission = () => !!(window.DeviceOrientationEvent && typeof window.DeviceOrientationEvent.requestPermission === 'function');
  function askPermission() {
    return window.DeviceOrientationEvent.requestPermission().then(r => r === 'granted').catch(() => false);
  }

  // --- the window -------------------------------------------------------------------------
  // Heading up (the card turns, the aircraft points up) or north up (N stays up, the aircraft
  // turns to the heading). Kept on this device.
  const MODE_KEY = 'navaid.compassMode';
  const getMode = () => { try { return localStorage.getItem(MODE_KEY) === 'north' ? 'north' : 'heading'; } catch (e) { return 'heading'; } };
  const setMode = (m) => { try { localStorage.setItem(MODE_KEY, m); } catch (e) { /* storage off */ } };
  // What the number is: the phone's sensor read magnetic (as the kites' headings are), the same
  // sensor turned to true with the app's magnetic variation, or the GPS track -- the direction of
  // movement from the fixes, which metal and radios cannot bend; shown magnetic. Kept on this device.
  const SOURCE_KEY = 'navaid.compassSource';
  const getSource = () => { try { const v = localStorage.getItem(SOURCE_KEY); return v === 'true' || v === 'gps' ? v : 'mag'; } catch (e) { return 'mag'; } };
  const setSource = (v) => { try { localStorage.setItem(SOURCE_KEY, v); } catch (e) { /* storage off */ } };
  // The GPS track while a fresh fix says the aircraft is moving, true degrees; null otherwise.
  function gpsTrackTrue() {
    const own = typeof gpsOwn !== 'undefined' ? gpsOwn : null;
    const t = (k, d) => (typeof tune === 'function' ? tune(k) : d);
    if (!own || !Number.isFinite(own.hdg) || own.hdgCompass) return null;
    if (!own.t || Date.now() - own.t > t('compassGpsMaxAgeS', 5) * 1000) return null;
    const kt = typeof gpsLastGS !== 'undefined' ? gpsLastGS : null;
    if (!(kt >= t('compassGpsMinKt', 5))) return null;
    return own.hdg;
  }
  const mag = (tr) => (typeof toMagnetic === 'function' ? toMagnetic(tr) : tr);
  const tru = (mg) => (typeof fromMagnetic === 'function' ? fromMagnetic(mg) : mg);
  let open = null;
  function close() { if (open) open.close(); }
  function showCompass() {
    if (open) return open;
    if (!feat() || typeof createDraggableModal !== 'function') return null;
    const m = createDraggableModal(str('compassTitle', 'Compass'), 'modal compass-modal', () => { stop(); open = null; });
    open = m;
    if (typeof addModalCloseX === 'function') addModalCloseX(m.box, m.close);
    const body = document.createElement('div');
    body.className = 'compass-body';
    body.innerHTML = roseSvg();
    const read = document.createElement('div');
    read.className = 'compass-readout';
    read.dir = 'ltr';
    read.innerHTML = '<span class="compass-deg">---°</span><span class="compass-ref">' + (str('compassMag', 'MAG')) + '</span>';
    const status = document.createElement('p');
    status.className = 'compass-status';
    const start = document.createElement('button');
    start.type = 'button';
    start.className = 'compass-start';
    start.textContent = str('compassStart', 'Start the compass');
    start.hidden = true;
    const note = document.createElement('p');
    note.className = 'compass-note';
    note.textContent = str('compassNote', 'The phone’s own compass: metal, radios and a magnet in the case throw it off. A cross-check, not a heading to fly.');
    // The two ways up, as one segmented switch.
    const modes = document.createElement('div');
    modes.className = 'compass-modes';
    modes.setAttribute('role', 'group');
    modes.setAttribute('aria-label', str('compassModeLabel', 'Compass orientation'));
    const modeBtn = (m, label) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.mode = m;
      b.textContent = label;
      b.addEventListener('click', () => { setMode(m); paintModes(); if (lastHeading != null) paint(lastHeading); });
      return b;
    };
    modes.append(modeBtn('heading', str('compassHeadingUp', 'Heading up')), modeBtn('north', str('compassNorthUp', 'North up')));
    const paintModes = () => {
      const cur = getMode();
      for (const b of modes.children) b.setAttribute('aria-pressed', String(b.dataset.mode === cur));
      m.box.dataset.compassMode = cur;
    };
    paintModes();
    // Where the number comes from, as a second switch.
    const sources = document.createElement('div');
    sources.className = 'compass-modes compass-sources';
    sources.setAttribute('role', 'group');
    sources.setAttribute('aria-label', str('compassSourceLabel', 'Heading from'));
    const srcBtn = (v, label) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.source = v;
      b.textContent = label;
      b.addEventListener('click', () => { setSource(v); paintSources(); refresh(); });
      return b;
    };
    sources.append(srcBtn('mag', str('compassSrcMag', 'Magnetic')), srcBtn('true', str('compassSrcTrue', 'True')),
      srcBtn('gps', str('compassSrcGps', 'GPS track')));
    const paintSources = () => {
      const cur = getSource();
      for (const b of sources.children) b.setAttribute('aria-pressed', String(b.dataset.source === cur));
      m.box.dataset.compassSource = cur;
    };
    paintSources();
    body.append(modes, sources, read, status, start, note);
    m.box.appendChild(body);
    const card = body.querySelector('.compass-card');
    const ac = body.querySelector('.compass-ac');
    let lastHeading = null;
    const deg = read.querySelector('.compass-deg');
    const ref = read.querySelector('.compass-ref');
    const say = (t) => { status.textContent = t || ''; status.hidden = !t; };
    say('');
    const REF = { mag: str('compassMag', 'MAG'), true: str('compassTrue', 'TRUE'), gps: str('compassGpsRef', 'GPS TRK') };
    const blank = () => { deg.textContent = '---°'; delete m.box.dataset.heading; };
    // The sensor's magnetic reading, kept so a switch of source repaints at once.
    let lastMag = null;
    const paint = (h) => {
      lastHeading = h;
      const north = getMode() === 'north';
      card.setAttribute('transform', 'rotate(' + (north ? 0 : -h).toFixed(1) + ' 180 180)');
      ac.setAttribute('transform', 'rotate(' + (north ? h : 0).toFixed(1) + ' 180 180)');
      const n = Math.round(h) % 360;
      deg.textContent = String(n === 0 ? 360 : n).padStart(3, '0') + '°';
      m.box.dataset.heading = String(n);
    };
    const refresh = () => {
      const src = getSource();
      ref.textContent = REF[src];
      if (src === 'gps') {
        const tr = gpsTrackTrue();
        if (tr == null) { blank(); say(str('compassGpsWait', 'GPS track needs Location on and the aircraft moving.')); return; }
        say(''); paint(mag(tr)); return;
      }
      if (lastMag == null) { blank(); return; }
      say(''); paint(src === 'true' ? tru(lastMag) : lastMag);
    };
    onReading = (h) => { lastMag = h; if (getSource() !== 'gps') refresh(); };
    // The GPS track has no event of its own here: look once a second while the window is open.
    const gpsTimer = setInterval(() => { if (open !== m) { clearInterval(gpsTimer); return; } if (getSource() === 'gps') refresh(); }, 1000);
    refresh();
    const begin = () => {
      listen();
      // Nothing within a few seconds: this device has no compass (a computer), or it is off --
      // unless it is waiting for the Start tap, which says so itself.
      setTimeout(() => { if (open === m && !lastAt && start.hidden && getSource() !== 'gps') say(str('compassNoSensor', 'No compass reading on this device.')); }, 3000);
    };
    // Some browsers want the request from a tap (iOS Safari; Chrome on Android now has the call
    // too, but answers it without asking -- and showed the iPhone message, reported). So: listen
    // straight away everywhere, ask on the finger lifting from the hold (wireDial), and offer
    // Start only if no reading has come and the browser does want a tap.
    const ask = () => askPermission().then(ok => {
      if (open !== m) return ok;
      if (ok) { start.hidden = true; say(''); }
      else { start.hidden = false; say(str('compassDenied', 'Compass access was refused. Allow Motion & Orientation for NavAid in Settings.')); }
      return ok;
    });
    m.askFromGesture = ask;
    start.addEventListener('click', ask);
    begin();
    if (needsPermission()) {
      setTimeout(() => {
        if (open !== m || lastAt) return;
        start.hidden = false;
        say(isIos() ? str('compassAsk', 'iPhone asks before an app reads the compass.')
                    : str('compassAskBrowser', 'This browser asks before it lets a page read the compass.'));
      }, 1200);
    }
    m.show();
    return m;
  }

  // --- the dial's long press --------------------------------------------------------------
  // A hold on the dial that does not move: a tap still steps the chart and a drag still turns
  // it, so the long press is new and takes nothing away. The dial is told not to act on the
  // release that ends the hold.
  let wiredDial = null;
  function wireDial() {
    const dial = document.getElementById('rotate-dial');
    if (!dial || dial === wiredDial) return;
    wiredDial = dial;
    let timer = null, sx = 0, sy = 0, held = false;
    const cancel = () => { if (timer) { clearTimeout(timer); timer = null; } };
    dial.addEventListener('pointerdown', (e) => {
      cancel();
      held = false;
      if (!feat()) return;
      sx = e.clientX; sy = e.clientY;
      // The same slop the dial uses: a finger's drift neither cancels the hold nor turns the map.
      const t = (k, d) => (typeof tune === 'function' ? tune(k) : d);
      slop = e.pointerType === 'touch' ? Math.max(t('rotDragPx', 8), t('touchDragPx', 10), t('compassHoldSlopPx', 18)) : t('rotDragPx', 8);
      const ms = typeof tune === 'function' ? tune('compassHoldMs') : 550;
      timer = setTimeout(() => {
        timer = null;
        held = true;
        if (typeof window.rotDialCancelGesture === 'function') window.rotDialCancelGesture();
        if (navigator.vibrate) { try { navigator.vibrate(15); } catch (err) { /* no motor */ } }
        showCompass();
      }, ms);
    });
    let slop = 6;
    dial.addEventListener('pointermove', (e) => {
      const px = slop;
      if (timer && Math.hypot(e.clientX - sx, e.clientY - sy) >= px) cancel();
    });
    dial.addEventListener('pointerup', () => {
      cancel();
      // The lift that ends the hold is the tap iOS wants before the compass may be read.
      if (held && open && open.askFromGesture && needsPermission()) open.askFromGesture();
      held = false;
    });
    dial.addEventListener('pointercancel', cancel);
    // A computer's right click is the same request.
    dial.addEventListener('contextmenu', (e) => { if (!feat()) return; e.preventDefault(); cancel(); showCompass(); });
  }
  wireDial();

  window.NavAid = window.NavAid || {};
  NavAid.compass = { show: showCompass, close, feed, isOpen: () => !!open, wireDial };
})();
