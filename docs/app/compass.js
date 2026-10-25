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
    const C = 160, R = 132;
    const pol = (r, d) => { const a = d * Math.PI / 180; return [C + r * Math.sin(a), C - r * Math.cos(a)]; };
    const p = [];
    p.push('<svg viewBox="0 0 320 320" class="compass-rose" aria-hidden="true" focusable="false">');
    p.push('<g class="compass-card">');
    p.push(`<circle cx="${C}" cy="${C}" r="${R + 22}" class="compass-face"/>`);
    p.push(`<circle cx="${C}" cy="${C}" r="${R}" class="compass-ring"/>`);
    for (let d = 0; d < 360; d += 5) {
      const L = d % 30 === 0 ? 16 : d % 10 === 0 ? 11 : 6;
      const [x1, y1] = pol(R, d), [x2, y2] = pol(R - L, d);
      p.push(`<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" class="compass-tick${d % 30 === 0 ? ' major' : ''}"/>`);
    }
    for (let d = 30; d < 360; d += 30) {
      if (d % 90 === 0) continue;
      const [x, y] = pol(R - 30, d);
      p.push(`<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" class="compass-num" transform="rotate(${d} ${x.toFixed(1)} ${y.toFixed(1)})">${String(d / 10)}</text>`);
    }
    for (const [d, l] of [[0, 'N'], [90, 'E'], [180, 'S'], [270, 'W']]) {
      const [x, y] = pol(R - 32, d);
      p.push(`<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" class="compass-card-letter${d === 0 ? ' north' : ''}" transform="rotate(${d} ${x.toFixed(1)} ${y.toFixed(1)})">${l}</text>`);
    }
    // North half of the needle red, the rest grey: points at magnetic north as the card turns.
    const [nx, ny] = pol(R - 52, 0), [sx, sy] = pol(R - 52, 180);
    p.push(`<polygon points="${C - 9},${C} ${nx.toFixed(1)},${ny.toFixed(1)} ${C + 9},${C}" class="compass-needle-n"/>`);
    p.push(`<polygon points="${C - 9},${C} ${sx.toFixed(1)},${sy.toFixed(1)} ${C + 9},${C}" class="compass-needle-s"/>`);
    p.push('</g>');
    // The lubber line and a small aircraft: the way the phone's top is pointing.
    p.push(`<polygon points="${C},${C - R - 20} ${C - 9},${C - R - 36} ${C + 9},${C - R - 36}" class="compass-lubber"/>`);
    p.push(`<path d="M${C} ${C - 22} l4 14 h14 l0 6 l-14 4 l-2 14 l6 4 v4 l-8 -2 l-8 2 v-4 l6 -4 l-2 -14 l-14 -4 l0 -6 h14 z" class="compass-plane"/>`);
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
  // iOS asks; everything else just listens.
  const needsPermission = () => !!(window.DeviceOrientationEvent && typeof window.DeviceOrientationEvent.requestPermission === 'function');
  function askPermission() {
    return window.DeviceOrientationEvent.requestPermission().then(r => r === 'granted').catch(() => false);
  }

  // --- the window -------------------------------------------------------------------------
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
    body.append(read, status, start, note);
    m.box.appendChild(body);
    const card = body.querySelector('.compass-card');
    const deg = read.querySelector('.compass-deg');
    const say = (t) => { status.textContent = t || ''; status.hidden = !t; };
    say('');
    onReading = (h) => {
      card.setAttribute('transform', 'rotate(' + (-h).toFixed(1) + ' 160 160)');
      const n = Math.round(h) % 360;
      deg.textContent = String(n === 0 ? 360 : n).padStart(3, '0') + '°';
      m.box.dataset.heading = String(n);
      say('');
    };
    const begin = () => {
      listen();
      // Nothing within a few seconds: this device has no compass (a computer), or it is off.
      setTimeout(() => { if (open === m && !lastAt) say(str('compassNoSensor', 'No compass reading on this device.')); }, 3000);
    };
    if (needsPermission()) {
      start.hidden = false;
      say(str('compassAsk', 'iPhone asks before an app reads the compass.'));
      start.addEventListener('click', () => {
        askPermission().then(ok => {
          if (open !== m) return;
          if (ok) { start.hidden = true; say(''); begin(); }
          else say(str('compassDenied', 'Compass access was refused. Allow Motion & Orientation for NavAid in Settings.'));
        });
      });
    } else begin();
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
    let timer = null, sx = 0, sy = 0;
    const cancel = () => { if (timer) { clearTimeout(timer); timer = null; } };
    dial.addEventListener('pointerdown', (e) => {
      cancel();
      if (!feat()) return;
      sx = e.clientX; sy = e.clientY;
      const ms = typeof tune === 'function' ? tune('compassHoldMs') : 550;
      timer = setTimeout(() => {
        timer = null;
        if (typeof window.rotDialCancelGesture === 'function') window.rotDialCancelGesture();
        if (navigator.vibrate) { try { navigator.vibrate(15); } catch (err) { /* no motor */ } }
        showCompass();
      }, ms);
    });
    dial.addEventListener('pointermove', (e) => {
      const px = typeof tune === 'function' ? tune('rotDragPx') : 6;
      if (timer && Math.hypot(e.clientX - sx, e.clientY - sy) >= px) cancel();
    });
    dial.addEventListener('pointerup', cancel);
    dial.addEventListener('pointercancel', cancel);
    // A computer's right click is the same request.
    dial.addEventListener('contextmenu', (e) => { if (!feat()) return; e.preventDefault(); cancel(); showCompass(); });
  }
  wireDial();

  window.NavAid = window.NavAid || {};
  NavAid.compass = { show: showCompass, close, feed, isOpen: () => !!open, wireDial };
})();
