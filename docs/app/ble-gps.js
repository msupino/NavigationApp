'use strict';

// An external GPS over Bluetooth LE, for a better position than the phone's: a receiver with a
// view of the sky from the glareshield beats a phone in a pocket. Most such units (and the
// ESP32/nRF DIY ones) speak NMEA over the Nordic UART service; this connects to one, reads its
// $..RMC / $..GGA sentences and feeds them into the same position path as the phone's own fixes
// (gps.js). While it is connected and delivering, the phone's fixes are set aside.
//
// Settings -> "Connect Bluetooth GPS". Off unless the gist turns featureBleGps on; dimmed with
// its reason outside the Android app (a browser's Web Bluetooth is not available in the app's
// WebView, and iOS is not wired).
(function () {
  const on = () => typeof tune === 'function' && tune('featureBleGps') === true;
  const str = (k, d) => (typeof S === 'object' && S && S[k]) || d;
  const plugin = () => {
    const C = window.Capacitor;
    return (C && typeof C.isNativePlatform === 'function' && C.isNativePlatform() && C.Plugins && C.Plugins.BluetoothLe) || null;
  };
  const NUS = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
  const NUS_TX = '6e400003-b5a3-f393-e0a9-e50e24dcca9e';   // the unit's notify characteristic
  const FRESH_MS = 3000;

  const dev = { id: null, name: '', lastFixAt: 0, sats: null, hdop: null, quality: null, alt: null };
  let buf = '';
  let listeners = [];

  // NMEA: ddmm.mmmm + hemisphere -> degrees.
  function coord(v, hemi) {
    if (!v) return null;
    const dot = v.indexOf('.');
    const degLen = dot - 2;
    if (degLen < 1) return null;
    const d = Number(v.slice(0, degLen)) + Number(v.slice(degLen)) / 60;
    return (hemi === 'S' || hemi === 'W') ? -d : d;
  }
  function checksumOk(line) {
    const star = line.lastIndexOf('*');
    if (star < 0) return true;                       // no checksum given: accept
    let x = 0;
    for (let i = 1; i < star; i++) x ^= line.charCodeAt(i);
    return x === parseInt(line.slice(star + 1, star + 3), 16);
  }
  // One sentence. GGA carries the fix quality, satellites, HDOP and altitude; RMC the position,
  // speed and track -- the fix is delivered on RMC, with the latest GGA's extras.
  function sentence(line) {
    if (!/^\$[A-Z]{2}(RMC|GGA)\b/.test(line) || !checksumOk(line)) return null;
    const f = line.split('*')[0].split(',');
    if (f[0].endsWith('GGA')) {
      dev.quality = Number(f[6]) || 0;
      dev.sats = f[7] ? Number(f[7]) : null;
      dev.hdop = f[8] ? Number(f[8]) : null;
      dev.alt = f[9] ? Number(f[9]) : null;            // metres above mean sea level
      return null;
    }
    if (f[2] !== 'A') return null;                      // RMC status: V = no valid fix
    const lat = coord(f[3], f[4]), lng = coord(f[5], f[6]);
    if (lat == null || lng == null) return null;
    const kt = f[7] ? Number(f[7]) : null, trk = f[8] ? Number(f[8]) : null;
    return {
      source: 'ble',
      timestamp: Date.now(),
      coords: {
        latitude: lat, longitude: lng,
        // NMEA gives HDOP, not metres; ~5 m per unit of HDOP is the usual working figure.
        accuracy: Number.isFinite(dev.hdop) ? Math.max(3, dev.hdop * 5) : 10,
        altitude: Number.isFinite(dev.alt) ? dev.alt : null,
        speed: Number.isFinite(kt) ? kt * 0.514444 : null,
        heading: Number.isFinite(trk) ? trk : null,
      },
    };
  }
  function feedText(text) {
    buf += text;
    const lines = buf.split(/\r?\n/);
    buf = lines.pop();
    if (buf.length > 512) buf = '';
    for (const l of lines) {
      const pos = sentence(l.trim());
      if (!pos) continue;
      dev.lastFixAt = Date.now();
      if (typeof onLivePosition === 'function') onLivePosition(pos);
      if (typeof onGpsPosition === 'function') onGpsPosition(pos);
    }
  }
  // The plugin hands notification values as hex ("244750..." or "24 47 50 ...").
  function hexToText(hex) {
    const h = String(hex || '').replace(/[^0-9a-f]/gi, '');
    let s = '';
    for (let i = 0; i + 1 < h.length; i += 2) s += String.fromCharCode(parseInt(h.slice(i, i + 2), 16));
    return s;
  }
  // gps.js asks this before taking one of the phone's own fixes.
  const fresh = () => !!dev.id && Date.now() - dev.lastFixAt < FRESH_MS;

  async function connect() {
    const p = plugin();
    if (!p) return;
    try {
      await p.initialize({ androidNeverForLocation: true });
      const d = await p.requestDevice({ services: [NUS] });
      if (!d || !d.deviceId) return;
      listeners.push(await p.addListener('disconnected|' + d.deviceId, () => disconnected(true)));
      await p.connect({ deviceId: d.deviceId });
      listeners.push(await p.addListener('notification|' + d.deviceId + '|' + NUS + '|' + NUS_TX,
        (e) => feedText(hexToText(e && e.value))));
      await p.startNotifications({ deviceId: d.deviceId, service: NUS, characteristic: NUS_TX });
      dev.id = d.deviceId; dev.name = d.name || '';
      if (typeof showToast === 'function') showToast((typeof S.bleGpsConnected === 'function') ? S.bleGpsConnected(dev.name) : 'Bluetooth GPS connected');
    } catch (e) {
      const msg = (e && e.message) || String(e);
      if (!/cancel/i.test(msg) && typeof showToast === 'function') showToast(str('bleGpsFailed', 'Bluetooth GPS: could not connect') + ' (' + msg + ')', { warn: true });
      disconnected(false);
    }
    refresh();
  }
  function disconnected(announce) {
    for (const l of listeners) { try { l.remove(); } catch (e) { /* gone */ } }
    listeners = [];
    const had = dev.id;
    dev.id = null; dev.name = ''; dev.lastFixAt = 0; dev.sats = dev.hdop = dev.alt = dev.quality = null;
    buf = '';
    if (announce && had && typeof showToast === 'function') showToast(str('bleGpsLost', 'Bluetooth GPS disconnected: using the phone’s GPS'), { warn: true });
    refresh();
  }
  async function disconnect() {
    const p = plugin(), id = dev.id;
    disconnected(false);
    if (p && id) { try { await p.disconnect({ deviceId: id }); } catch (e) { /* already gone */ } }
  }

  const btn = document.getElementById('ble-gps-btn');
  function refresh() {
    if (!btn) return;
    btn.hidden = !on();
    if (!on()) return;
    btn.textContent = dev.id
      ? ((typeof S.bleGpsDisconnect === 'function') ? S.bleGpsDisconnect(dev.name) : 'Disconnect Bluetooth GPS')
      : str('tbBleGps', 'Connect Bluetooth GPS');
    if (typeof setButtonWhy === 'function') setButtonWhy(btn, plugin() ? null : str('whyBleGpsApp', 'Bluetooth GPS works in the Android app'));
  }
  if (btn) btn.addEventListener('click', () => (dev.id ? disconnect() : connect()));
  refresh();
  setInterval(refresh, 5000);

  window.NavAid = window.NavAid || {};
  NavAid.bleGps = { fresh, feedText, sentence, dev, connect, disconnect, refresh };
}());
