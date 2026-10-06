'use strict';

// The phone's own hardware, in the Android app: each piece behind its own gist switch, so they
// can be chosen one by one. In a browser most of them fall back to the web's own version or do
// nothing; none of them is needed for the app to work.
//
//   featureKeepAwake         the screen stays on while a position shows (native; the web Wake
//                            Lock in gps.js covers browsers)
//   featureHaptics           the phone vibrates with every in-flight alert
//   featureBrightness        Settings -> Screen brightness, for the cockpit at night
//   featureBarometer         the pressure sensor: pressure altitude and vertical speed
//   featureBatteryWarn       a warning when the battery runs low in flight (off by default)
//   featureFullscreenFlight  the Android status bar hidden while a position shows (off by default)
//
// The ADS-B receiver (gdl90.js) and the Bluetooth GPS (ble-gps.js) have their own files.
(function () {
  const feat = (k) => typeof tune !== 'function' || tune(k) === true;
  const str = (k, d) => (typeof S === 'object' && S && S[k]) || d;
  const native = (name) => {
    const C = window.Capacitor;
    return (C && typeof C.isNativePlatform === 'function' && C.isNativePlatform() && C.Plugins && C.Plugins[name]) || null;
  };
  const flying = () => typeof gpsLiveOn !== 'undefined' && !!(gpsLiveOn || gpsRecording);
  const call = (p, fn, arg) => { try { const r = p && p[fn] && p[fn](arg); if (r && r.catch) r.catch(() => {}); } catch (e) { /* plugin gone */ } };

  // --- keep awake ---------------------------------------------------------------------
  let awake = false;
  function syncAwake() {
    const want = feat('featureKeepAwake') && flying();
    if (want === awake) return;
    awake = want;
    call(native('KeepAwake'), want ? 'keepAwake' : 'allowSleep');
  }

  // --- haptics ------------------------------------------------------------------------
  // A warning pattern for an alert: felt in a pocket, or over engine noise that drowns the voice.
  function haptic(kind) {
    if (!feat('featureHaptics')) return false;
    const h = native('Haptics');
    if (h) { call(h, 'notification', { type: kind === 'alert' ? 'WARNING' : 'SUCCESS' }); return true; }
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      try { return navigator.vibrate(kind === 'alert' ? [180, 90, 180] : 60); } catch (e) { return false; }
    }
    return false;
  }

  // --- brightness ---------------------------------------------------------------------
  // The pilot's own setting, kept on this device: null = the phone's own (system) brightness.
  // Native sets the screen itself; a browser cannot, so there a dark veil over the page does
  // the same job -- and it also goes below the screen's own minimum, which is what a night
  // cockpit wants.
  const BRIGHT_KEY = 'navaid.brightness';
  function brightness() {
    try { const v = localStorage.getItem(BRIGHT_KEY); return v === null ? null : Math.max(0, Math.min(1, Number(v) / 100)); } catch (e) { return null; }
  }
  function veil(v) {
    let el = document.getElementById('dim-veil');
    const op = v == null ? 0 : (1 - v) * 0.8;
    if (!op) { if (el) el.remove(); return; }
    if (!el) { el = document.createElement('div'); el.id = 'dim-veil'; el.setAttribute('aria-hidden', 'true'); document.body.appendChild(el); }
    el.style.opacity = op.toFixed(2);
  }
  function applyBrightness() {
    const on = feat('featureBrightness');
    const v = on ? brightness() : null;
    const sb = native('ScreenBrightness');
    if (sb) {
      call(sb, 'setBrightness', { brightness: v == null ? -1 : Math.max(0.01, v) });
      veil(v != null && v < 0.05 ? v / 0.05 * 0.3 + 0.7 : null);   // below the screen's floor: a light veil on top
    } else veil(v);
    const range = document.getElementById('brightness-range');
    const out = document.getElementById('brightness-val');
    if (range) range.value = String(Math.round((v == null ? 1 : v) * 100));
    if (out) out.textContent = v == null ? str('tbBrightnessAuto', 'System') : Math.round(v * 100) + '%';
    const row = document.getElementById('brightness-row'), sys = document.getElementById('brightness-system');
    if (row) row.hidden = !on;
    if (sys) sys.hidden = !on;
  }
  function setBrightness(pct) {
    try {
      if (pct == null) localStorage.removeItem(BRIGHT_KEY);
      else localStorage.setItem(BRIGHT_KEY, String(Math.round(pct)));
    } catch (e) { /* storage off: applies until reload */ }
    applyBrightness();
  }
  const range = document.getElementById('brightness-range');
  if (range) range.addEventListener('input', () => setBrightness(Number(range.value)));
  const sysBtn = document.getElementById('brightness-system');
  if (sysBtn) sysBtn.addEventListener('click', () => setBrightness(null));

  // --- battery ------------------------------------------------------------------------
  let warnedAt = 1;                 // the lowest level already warned about this flight
  let batteryAt = 0;
  async function batteryLevel() {
    const d = native('Device');
    if (d) { const b = await d.getBatteryInfo(); return { level: b.batteryLevel, charging: !!b.isCharging }; }
    if (navigator.getBattery) { const b = await navigator.getBattery(); return { level: b.level, charging: b.charging }; }
    return null;
  }
  async function checkBattery() {
    if (!feat('featureBatteryWarn') || !flying()) { warnedAt = 1; return; }
    if (Date.now() - batteryAt < 60000) return;
    batteryAt = Date.now();
    let b = null;
    try { b = await batteryLevel(); } catch (e) { b = null; }
    if (!b || !Number.isFinite(b.level) || b.charging) return;
    for (const step of [0.1, 0.2]) {
      if (b.level <= step && warnedAt > step) {
        warnedAt = step;
        const msg = typeof S.batteryLow === 'function' ? S.batteryLow(Math.round(b.level * 100)) : 'Battery ' + Math.round(b.level * 100) + '%: plug the phone in';
        if (typeof showToast === 'function') showToast(msg, { warn: true });
        haptic('alert');
        break;
      }
    }
  }

  // --- full screen in flight ----------------------------------------------------------
  let barHidden = false;
  function syncStatusBar() {
    const want = feat('featureFullscreenFlight') && flying();
    if (want === barHidden) return;
    barHidden = want;
    call(native('StatusBar'), want ? 'hide' : 'show');
  }

  // --- barometer ----------------------------------------------------------------------
  // Pressure altitude from the standard atmosphere, and vertical speed as the slope of the last
  // ten seconds of it (a least-squares fit, so one noisy reading does not swing the needle).
  const baro = { hPa: null, pAltFt: null, vsFpm: null, at: 0, available: null };
  const hist = [];
  let baroOn = false, baroListener = null;
  const pressureAltFt = (hPa) => 145366.45 * (1 - Math.pow(hPa / 1013.25, 0.190284));
  function notePressure(hPa, t) {
    if (!Number.isFinite(hPa) || hPa <= 0) return;
    const at = Number.isFinite(t) ? t : Date.now();
    baro.hPa = hPa; baro.pAltFt = pressureAltFt(hPa); baro.at = at;
    hist.push({ t: at, ft: baro.pAltFt });
    while (hist.length && at - hist[0].t > 10000) hist.shift();
    if (hist.length >= 3) {
      const n = hist.length, mt = hist.reduce((a, p) => a + p.t, 0) / n, mf = hist.reduce((a, p) => a + p.ft, 0) / n;
      let num = 0, den = 0;
      for (const p of hist) { num += (p.t - mt) * (p.ft - mf); den += (p.t - mt) * (p.t - mt); }
      baro.vsFpm = den > 0 ? num / den * 60000 : null;
    }
  }
  async function syncBaro() {
    const want = feat('featureBarometer') && flying();
    const p = native('Barometer');
    if (want === baroOn || !p) { if (!p) baroOn = false; return; }
    baroOn = want;
    if (want) {
      try {
        const a = await p.isAvailable();
        baro.available = !!(a && a.available);
        if (!baro.available) return;
        baroListener = await p.addListener('pressure', (e) => notePressure(e && e.hPa, e && e.t));
        await p.start();
      } catch (e) { baro.available = false; }
    } else {
      if (baroListener && baroListener.remove) { try { baroListener.remove(); } catch (e) { /* gone */ } }
      baroListener = null;
      call(p, 'stop');
      baro.hPa = baro.pAltFt = baro.vsFpm = null; hist.length = 0;
    }
  }

  // --- the clock ----------------------------------------------------------------------
  function tick() {
    syncAwake();
    syncStatusBar();
    syncBaro();
    checkBattery();
  }
  setInterval(tick, 2000);
  applyBrightness();

  window.NavAid = window.NavAid || {};
  NavAid.device = { haptic, baro, notePressure, pressureAltFt, setBrightness, applyBrightness, tick, checkBattery };
}());
