'use strict';

// ADS-B traffic from a portable receiver in the cockpit (Stratux, uAvionix SkyEcho, Sentry and
// the like), which broadcasts GDL90 over its own Wi-Fi to UDP port 4000. The Android app's Gdl90
// plugin (mobile/android/.../Gdl90Plugin.java) hands each datagram here; this splits the frames,
// checks their CRC and decodes them -- the FAA GDL90 Data Interface Specification (560-1058-00).
//
//   0x00 heartbeat          the receiver is alive (and whether it has its own GPS fix)
//   0x0A ownship report     the receiver's own position, pressure altitude
//   0x14 traffic report     every other aircraft it hears
//
// Traffic goes onto the map through the traffic layer (traffic.js, trafficSetExternal); a target
// not heard for 20 s is dropped. Off unless the gist turns featureGdl90 on. A browser cannot
// listen on UDP, so it exists in the APK only.
(function () {
  const on = () => typeof tune === 'function' && tune('featureGdl90') === true;
  const native = () => {
    const C = window.Capacitor;
    return (C && typeof C.isNativePlatform === 'function' && C.isNativePlatform() && C.Plugins && C.Plugins.Gdl90) || null;
  };
  const STALE_MS = 20000;

  // CRC-16-CCITT as GDL90 uses it (polynomial 0x1021, table-driven, LSB first in the frame).
  const CRC = new Uint16Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i << 8;
    for (let b = 0; b < 8; b++) c = (c & 0x8000) ? ((c << 1) ^ 0x1021) : (c << 1);
    CRC[i] = c & 0xffff;
  }
  function crc16(bytes) {
    let crc = 0;
    for (const b of bytes) crc = (CRC[crc >> 8] ^ ((crc << 8) & 0xffff) ^ b) & 0xffff;
    return crc;
  }

  // Frames are 0x7E ... 0x7E, with 0x7D escaping (next byte XOR 0x20). Returns the messages
  // (id byte first) whose CRC checks.
  function frames(bytes) {
    const out = [];
    let cur = null, esc = false;
    for (const b of bytes) {
      if (b === 0x7e) {
        if (cur && cur.length > 2) {
          const msg = cur.slice(0, -2), crc = cur[cur.length - 2] | (cur[cur.length - 1] << 8);
          if (crc16(msg) === crc) out.push(Uint8Array.from(msg));
        }
        cur = [];
        esc = false;
        continue;
      }
      if (!cur) continue;
      if (b === 0x7d) { esc = true; continue; }
      cur.push(esc ? b ^ 0x20 : b);
      esc = false;
    }
    return out;
  }

  const s24 = (a, b, c) => { const v = (a << 16) | (b << 8) | c; return v & 0x800000 ? v - 0x1000000 : v; };
  // Traffic and ownship reports share one layout (§3.5.1).
  function report(m) {
    if (m.length < 28) return null;
    const addr = ((m[2] << 16) | (m[3] << 8) | m[4]).toString(16).padStart(6, '0');
    const lat = s24(m[5], m[6], m[7]) * 180 / 0x800000;
    const lon = s24(m[8], m[9], m[10]) * 180 / 0x800000;
    const altRaw = (m[11] << 4) | (m[12] >> 4);
    const misc = m[12] & 0x0f;
    const hv = (m[14] << 4) | (m[15] >> 4);
    const trackValid = (misc & 0x03) !== 0;
    const callsign = String.fromCharCode(...m.slice(19, 27)).replace(/[^\x20-\x7e]/g, '').trim();
    return {
      hex: addr,
      flight: callsign,
      lat, lon,
      alt: altRaw === 0xfff ? null : altRaw * 25 - 1000,      // pressure altitude, ft
      gs: hv === 0xfff ? null : hv,                             // kt
      track: trackValid ? m[17] * 360 / 256 : null,
      type: '', squawk: '',
      _seen: Date.now(),
    };
  }

  const targets = new Map();          // hex -> latest traffic report
  const state = { heartbeatAt: 0, receiverGps: null, ownship: null, packets: 0 };
  function handle(m) {
    switch (m[0]) {
      case 0x00:
        state.heartbeatAt = Date.now();
        state.receiverGps = !!(m[1] & 0x80);
        break;
      case 0x0a: state.ownship = report(m); break;
      case 0x14: {
        const r = report(m);
        if (r && Number.isFinite(r.lat) && (r.lat || r.lon)) targets.set(r.hex, r);
        break;
      }
      default: break;
    }
  }
  function publish() {
    const now = Date.now();
    for (const [k, t] of targets) if (now - t._seen > STALE_MS) targets.delete(k);
    if (typeof window.trafficSetExternal === 'function') window.trafficSetExternal([...targets.values()], 'gdl90');
  }
  function feed(bytes) {
    state.packets++;
    for (const m of frames(bytes)) handle(m);
    publish();
  }
  function feedBase64(b64) {
    const s = atob(b64), a = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) a[i] = s.charCodeAt(i);
    feed(a);
  }

  let started = false, listener = null;
  async function sync() {
    const p = native();
    const want = on() && !!p;
    if (want === started) { if (started) publish(); return; }
    started = want;
    if (want) {
      try {
        listener = await p.addListener('packet', (e) => { if (e && e.data) feedBase64(e.data); });
        await p.start({ port: 4000 });
      } catch (e) { started = false; }
    } else {
      if (listener && listener.remove) { try { listener.remove(); } catch (e) { /* gone */ } }
      listener = null;
      if (p) { try { p.stop(); } catch (e) { /* gone */ } }
      targets.clear();
      publish();
    }
  }
  setInterval(sync, 3000);

  window.NavAid = window.NavAid || {};
  NavAid.gdl90 = { crc16, frames, report, feed, feedBase64, targets, state, sync };
}());
