'use strict';

// The location status line: while the phone's own position is showing (Location or a
// recording), one short line under the top strip says how good that position is -- its
// accuracy, how often fixes arrive, and in the Android app how many satellites are used of how
// many are in view. "Searching" until the first fix, "no fix for 12 s" when they stop. A tap
// opens the details: satellites per system, signal, accuracy, fix age, time to first fix.
//
// Accuracy and timing come from the fixes themselves (gps.js hands every raw fix here, before
// its own accuracy filter, so a coarse fix still shows as coarse rather than as silence). The
// satellites come only from the Android app's GnssStatus plugin
// (mobile/android/.../GnssStatusPlugin.java): browsers and iOS do not expose them, and there
// the line simply has no satellite part. The simulator is not a GPS: no line for it.
(function () {
  const str = (k, d) => (typeof S === 'object' && S && S[k]) || d;
  const on = () => typeof tune !== 'function' || tune('featureGpsStatus') !== false;
  const live = () => typeof gpsLiveOn !== 'undefined' && (gpsLiveOn || gpsRecording);

  let raw = null;            // { acc, altAcc, t, at } of the last fix received
  const arrivals = [];       // arrival times of the last few fixes, for the rate
  let gnss = null;           // the last satellite summary (Android)
  let firstFixMs = null;     // time to first fix, from the satellite engine
  let startedAt = 0;         // when this position session began
  let plugin = null, listener = null, el = null, detail = null;

  function noteFix(pos) {
    if (!pos || !pos.coords) return;
    const c = pos.coords, now = Date.now();
    raw = {
      acc: Number.isFinite(c.accuracy) ? c.accuracy : null,
      altAcc: Number.isFinite(c.altitudeAccuracy) ? c.altitudeAccuracy : null,
      t: pos.timestamp || now, at: now,
      source: pos.source || 'phone',                // 'ble': the Bluetooth GPS (ble-gps.js)
    };
    arrivals.push(now);
    while (arrivals.length > 6) arrivals.shift();
    render();
  }

  // Fixes per second over the last few arrivals; null until there are two.
  function rateHz() {
    if (arrivals.length < 2) return null;
    const span = (arrivals[arrivals.length - 1] - arrivals[0]) / 1000;
    return span > 0 ? (arrivals.length - 1) / span : null;
  }
  const fixAgeSec = () => (raw ? Math.max(0, (Date.now() - raw.at) / 1000) : null);
  const staleSec = () => {
    const s = typeof tune === 'function' ? Number(tune('gpsStaleSec')) : 20;
    return Number.isFinite(s) && s > 0 ? s : 20;
  };
  // good / fair / poor: what the accuracy means for the map, not a number to interpret.
  function quality() {
    if (!raw || raw.acc == null) return '';
    if (fixAgeSec() > staleSec()) return 'poor';
    const max = typeof gpsMaxAccM === 'function' ? gpsMaxAccM() : 100;
    if (raw.acc > max) return 'poor';                       // too coarse: the map ignores it
    return raw.acc <= 20 ? 'good' : 'fair';
  }

  // Used / in view. The line has room for numbers only (a phone fits it between the edit column
  // and the right edge); the satellite icon in front says what they count, the details spell it.
  function satsText() {
    if (!gnss || !Number.isFinite(gnss.inView)) return '';
    return gnss.used + '/' + gnss.inView;
  }
  function lineText() {
    const sats = satsText();
    const tail = sats ? ' · ' + sats : '';
    if (!raw) return str('gpsStatusSearching', 'GPS: searching for satellites…') + tail;
    const age = fixAgeSec();
    if (age > staleSec()) {
      const t = typeof S.gpsStatusNoFix === 'function' ? S.gpsStatusNoFix(Math.round(age)) : 'GPS: no fix for ' + Math.round(age) + ' s';
      return t + tail;
    }
    const parts = [];
    if (raw.source === 'ble') parts.push('BT');     // the Bluetooth GPS, not the phone's own
    if (raw.acc != null) parts.push('±' + Math.round(raw.acc) + ' m');
    const hz = rateHz();
    if (hz != null) parts.push(hz >= 0.75 ? Math.round(hz) + ' Hz' : (1 / hz).toFixed(0) + ' s');
    if (sats) parts.push(sats);
    return parts.join(' · ') || 'GPS';
  }

  function ensureEl() {
    if (el) return el;
    el = document.createElement('button');
    el.type = 'button';
    el.id = 'gps-status';
    el.setAttribute('aria-live', 'polite');
    el.dir = 'ltr';                                    // numbers and units, in either language
    // A satellite, so the bare numbers say what they are.
    el.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2"'
      + ' stroke-linecap="round" stroke-linejoin="round"><path d="M9 9 15 15M6.5 6.5l3-3 4 4-3 3zM14.5 14.5l3-3 4 4-3 3z"/>'
      + '<path d="M4 15a5 5 0 0 0 5 5"/></svg><span class="gps-status-text"></span>';
    el.title = str('gpsStatusTitle', 'Position quality — tap for details');
    el.addEventListener('click', openDetail);
    document.body.appendChild(el);
    return el;
  }
  function render() {
    const show = on() && live();
    if (!show) { if (el) el.hidden = true; return; }
    ensureEl();
    el.hidden = false;
    const t = lineText();
    el.querySelector('.gps-status-text').textContent = t;
    el.setAttribute('aria-label', str('gpsStatusDetailTitle', 'GPS position') + ': ' + t);
    el.dataset.q = quality();
    // On a computer, under the menubar's actual bottom: in flight it grows a second row.
    if (!document.body.classList.contains('deck-on')) {
      const tb = document.getElementById('toolbar');
      const r = tb && tb.getClientRects().length ? tb.getBoundingClientRect() : null;
      el.style.top = Math.round((r ? r.bottom : 54) + 8) + 'px';
    } else el.style.top = '';
    if (detail) fillDetail();
  }

  // --- details -------------------------------------------------------------------------
  // `value` is a string, or a list of parts shown with middle dots between them. Each part is
  // its own isolated run: in Hebrew a part like "גובה ±9 m" keeps its words in order next to
  // the numbers, which a single left-to-right cell scrambled.
  function row(tbody, label, value) {
    const tr = document.createElement('tr');
    const th = document.createElement('th'); th.textContent = label;
    const td = document.createElement('td');
    const wrap = document.createElement('div');
    wrap.className = 'gps-status-parts';
    // The parts follow the page: right to left in Hebrew, so the first one is read first. Each
    // pill isolates its own text, so "±9 m" and "1.0 Hz" stay as they are written.
    for (const t of (Array.isArray(value) ? value : [value])) {
      const sp = document.createElement('span');
      sp.dir = 'auto';
      sp.className = 'gps-status-part';
      sp.textContent = t;
      wrap.appendChild(sp);
    }
    td.appendChild(wrap);
    tr.append(th, td);
    tbody.appendChild(tr);
  }
  function fillDetail() {
    const body = detail.body;
    body.replaceChildren();
    const tbl = document.createElement('table');
    tbl.className = 'gps-status-table';
    const tb = document.createElement('tbody');
    const dash = '—';
    // Related numbers share a row, so the panel fits a phone without scrolling: at most seven
    // rows, where it used to take one per number and one per satellite system.
    const acc = [];
    if (raw && raw.acc != null) acc.push('\u00b1' + Math.round(raw.acc) + ' m');
    if (raw && raw.altAcc != null) acc.push(str('gpsStatusAltShort', 'alt') + ' \u00b1' + Math.round(raw.altAcc) + ' m');
    row(tb, str('gpsStatusAccuracy', 'Accuracy'), acc.length ? acc : dash);
    const fix = [];
    const age = fixAgeSec();
    fix.push(age == null ? dash : (age < 1.5 ? str('gpsStatusNow', 'now') : Math.round(age) + ' s'));
    const hz = rateHz();
    if (hz != null) fix.push(hz >= 0.75 ? hz.toFixed(1) + ' Hz' : str('gpsStatusEvery', 'every') + ' ' + (1 / hz).toFixed(0) + ' s');
    if (firstFixMs != null) fix.push(typeof S.gpsStatusFirstFix === 'function' ? S.gpsStatusFirstFix((firstFixMs / 1000).toFixed(1)) : 'first fix ' + (firstFixMs / 1000).toFixed(1) + ' s');
    row(tb, str('gpsStatusAge', 'Last fix'), fix);
    if (raw && raw.source === 'ble') {
      const b = (window.NavAid && NavAid.bleGps) ? NavAid.bleGps.dev : {};
      const src = [str('gpsStatusBle', 'Bluetooth GPS') + (b.name ? ' (' + b.name + ')' : '')];
      if (Number.isFinite(b.sats)) src.push(b.sats + ' ' + str('gpsStatusSatsWord', 'sats'));
      row(tb, str('gpsStatusSource', 'Source'), src);
    }
    if (gnss && Number.isFinite(gnss.inView)) {
      row(tb, str('gpsStatusSatellites', 'Satellites'),
        [typeof S.gpsStatusSatsOf === 'function' ? S.gpsStatusSatsOf(gnss.used, gnss.inView) : gnss.used + ' of ' + gnss.inView + ' used']
          .concat(gnss.cn0 ? [gnss.cn0 + ' dB-Hz'] : []));
      const sys = gnss.systems || {};
      const list = Object.keys(sys).sort((a, b) => (sys[b].inView - sys[a].inView)).map(k => k + ' ' + sys[k].used + '/' + sys[k].inView);
      if (list.length) row(tb, str('gpsStatusSystems', 'Systems'), list);
    }
    // The phone's pressure sensor (device-extras.js): static pressure in the cabin, so close to
    // the outside in an unpressurised aeroplane, and nothing like it in a pressurised one.
    const baro = window.NavAid && NavAid.device && NavAid.device.baro;
    if (typeof gpsAltSource === 'function') {
      const from = (typeof gpsAltFrom !== 'undefined' && gpsAltFrom === 'baro')
        ? str('tbAltSourceBaro', 'Barometer + QNH') + (typeof gpsQnh !== 'undefined' && gpsQnh && typeof fmtPressure === 'function' ? ' ' + fmtPressure(gpsQnh.hPa) : '')
        : str('tbAltSourceGps', 'GPS');
      row(tb, str('gpsStatusAltFrom', 'Altitude from'), from);
    }
    if (baro && Number.isFinite(baro.hPa)) {
      // Pressure, pressure altitude, vertical speed: one instrument, one row.
      const parts = [typeof fmtPressure === 'function' ? fmtPressure(baro.hPa, true) : baro.hPa.toFixed(1) + ' hPa',
        Math.round(baro.pAltFt).toLocaleString('en-US') + ' ft'];
      if (Number.isFinite(baro.vsFpm)) parts.push((baro.vsFpm >= 0 ? '+' : '\u2212') + Math.abs(Math.round(baro.vsFpm / 10) * 10) + ' fpm');
      row(tb, str('gpsStatusBaro', 'Barometer'), parts);
    }
    tbl.appendChild(tb);
    body.appendChild(tbl);
    if (!gnss) {
      const p = document.createElement('p');
      p.className = 'gps-status-note';
      p.textContent = str('gpsStatusNoSats', 'Satellite counts are shown in the Android app; this browser gives only the position and its accuracy.');
      body.appendChild(p);
    }
  }
  function openDetail() {
    if (detail || typeof createDraggableModal !== 'function') return;
    const m = createDraggableModal(str('gpsStatusDetailTitle', 'GPS position'), 'modal gps-status-modal', () => { detail = null; });
    const body = document.createElement('div');
    body.className = 'gps-status-body';
    m.box.appendChild(body);
    detail = { m, body };
    fillDetail();
    m.show();
  }

  // --- the Android satellite feed ----------------------------------------------------
  function gnssPlugin() {
    const C = window.Capacitor;
    return (C && typeof C.isNativePlatform === 'function' && C.isNativePlatform() && C.Plugins && C.Plugins.GnssStatus) || null;
  }
  async function startSats() {
    plugin = gnssPlugin();
    if (!plugin) return;
    try {
      listener = await plugin.addListener('gnss', (e) => {
        if (!e) return;
        if (Number.isFinite(e.firstFixMs)) firstFixMs = e.firstFixMs;
        if (e.stopped) gnss = null;
        else if (Number.isFinite(e.inView)) gnss = e;
        render();
      });
      await plugin.start();
    } catch (e) { /* no permission yet, or no GNSS: the line just has no satellite part */ }
  }
  function stopSats() {
    if (listener && typeof listener.remove === 'function') { try { listener.remove(); } catch (e) { /* gone */ } }
    listener = null;
    if (plugin) { try { plugin.stop(); } catch (e) { /* gone */ } }
    plugin = null;
  }

  // Follows the position switches without hooks in each of them: a 1 s tick while the app is
  // open notices a session starting or ending, and keeps "no fix for 12 s" counting.
  let wasLive = false;
  function tick() {
    const now = on() && live();
    if (now && !wasLive) {
      raw = null; arrivals.length = 0; gnss = null; firstFixMs = null; startedAt = Date.now();
      startSats();
    } else if (!now && wasLive) {
      stopSats();
      if (detail) { detail.m.close(); detail = null; }
    }
    wasLive = now;
    render();
  }
  setInterval(tick, 1000);

  window.NavAid = window.NavAid || {};
  NavAid.gpsStatus = { noteFix, tick, text: lineText, open: openDetail, _startedAt: () => startedAt };
}());
