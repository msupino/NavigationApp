// Follow me: a link that shows someone where the aeroplane is, with no server of ours.
//
// Two devices that never talk to the same machine cannot see each other, so something has to
// relay. The question is whose. This uses a PUBLIC MQTT broker over WebSocket -- no account,
// no signup, nothing for us to run or pay for or keep up. The position is published to a
// topic nobody can guess, encrypted before it leaves the aeroplane, and the key travels in
// the link's FRAGMENT, which browsers never send to a server. So the broker relays bytes it
// cannot read, and a public relay stops being a privacy problem.
//
// What it is not: a tracking service. A public broker is best-effort and unauthenticated,
// there is no history, and a phone that loses signal simply stops publishing. The viewer is
// built around saying so -- see followMeAge -- because a map that quietly keeps drawing an
// aeroplane where it last was is worse than a map that admits it does not know.
//
// The MQTT client here is deliberately small and in-repo rather than a library from a CDN:
// this is 3.1.1 with QoS 0, which is a publish, a subscribe and a ping.
(function () {
  'use strict';
  const NS = (window.NavAid = window.NavAid || {});

  // --- MQTT 3.1.1 over WebSocket, the parts a position feed uses -------------
  const CONNECT = 1, CONNACK = 2, PUBLISH = 3, SUBSCRIBE = 8, PINGREQ = 12;

  function encodeLength(n) {
    const out = [];
    do {
      let b = n % 128;
      n = Math.floor(n / 128);
      if (n > 0) b |= 0x80;
      out.push(b);
    } while (n > 0);
    return out;
  }
  function encodeString(s) {
    const bytes = new TextEncoder().encode(s);
    return [bytes.length >> 8, bytes.length & 0xff, ...bytes];
  }
  function packet(type, flags, body) {
    return new Uint8Array([(type << 4) | flags, ...encodeLength(body.length), ...body]);
  }
  // Remaining-length is a varint: read it before trusting any offset into the packet.
  function readLength(buf, at) {
    let mult = 1, value = 0, i = at, b;
    do {
      if (i >= buf.length) return null;
      b = buf[i++];
      value += (b & 127) * mult;
      mult *= 128;
    } while (b & 0x80);
    return { value, next: i };
  }

  // A phone in a cockpit loses its socket: the screen locks, the cell hands over, Android
  // dozes. A feed that ends there and never comes back is worse than useless -- the pilot
  // believes they are being followed. So the client owns its socket rather than being one:
  // it reconnects with backoff until close() is called, and re-runs onOpen each time so the
  // viewer re-subscribes and the publisher resumes on the next fix.
  function mqttConnect(url, opts) {
    const o = opts || {};
    const Impl = o.WebSocketImpl || window.WebSocket;
    const client = { ws: null, onMessage: null, onOpen: null, onClose: null, ready: false };
    let ping = 0, retry = 0, timer = 0, done = false;
    let packetId = 1;

    function backoffMs() {
      // 2s, 4s, 8s... capped: a broker that is down is not helped by a faster client.
      return Math.min(30000, 2000 * Math.pow(2, Math.min(Math.max(0, retry - 1), 4)));
    }

    function open() {
      const ws = new Impl(url, 'mqtt');
      client.ws = ws;
      ws.binaryType = 'arraybuffer';

      ws.onopen = () => {
        const keepalive = 30;
        ws.send(packet(CONNECT, 0, [
          ...encodeString('MQTT'), 4, 0x02, keepalive >> 8, keepalive & 0xff,
          // A fresh client id per attempt: a broker that still holds the old session would
          // otherwise kick the reconnecting client as a duplicate.
          ...encodeString((o.clientId || 'navaid') + '-' + Math.random().toString(36).slice(2, 8)),
        ]));
        // Public brokers drop a client that goes quiet. Half the keepalive, as the spec suggests.
        ping = setInterval(() => {
          try { ws.send(new Uint8Array([PINGREQ << 4, 0])); } catch (e) { /* closing */ }
        }, keepalive * 500);
      };
      ws.onclose = () => {
        clearInterval(ping);
        client.ready = false;
        if (client.onClose) client.onClose();
        if (done) return;
        retry += 1;
        timer = setTimeout(open, backoffMs());
      };
      ws.onerror = () => { /* onclose follows */ };
      ws.onmessage = (ev) => {
        const buf = new Uint8Array(ev.data);
        if (!buf.length) return;
        const type = buf[0] >> 4;
        if (type === CONNACK) {
          client.ready = true;
          retry = 0;                                  // this attempt worked; start over if it drops
          if (client.onOpen) client.onOpen();
          return;
        }
        if (type !== PUBLISH) return;                 // SUBACK, PINGRESP: nothing to do
        const len = readLength(buf, 1);
        if (!len) return;
        const topicLen = (buf[len.next] << 8) | buf[len.next + 1];
        const topic = new TextDecoder().decode(buf.subarray(len.next + 2, len.next + 2 + topicLen));
        const payload = buf.subarray(len.next + 2 + topicLen, len.next + len.value);
        if (client.onMessage) client.onMessage(topic, payload);
      };
    }
    open();

    client.publish = (topic, payload, opts) => {
      if (!client.ready) return false;
      // Bit 0 of the PUBLISH flags is RETAIN: keep this as the topic's last known value.
      client.ws.send(packet(PUBLISH, (opts && opts.retain) ? 1 : 0, [...encodeString(topic), ...payload]));
      return true;
    };
    client.subscribe = (topic) => {
      if (!client.ready) return false;
      const id = packetId++;
      client.ws.send(packet(SUBSCRIBE, 2, [id >> 8, id & 0xff, ...encodeString(topic), 0]));
      return true;
    };
    client.close = () => {
      done = true;                                    // stop means stop: no reconnect after this
      clearInterval(ping); clearTimeout(timer);
      try { client.ws.close(); } catch (e) { /* already gone */ }
    };
    return client;
  }

  // --- the secret half ------------------------------------------------------
  // The broker is public, so the payload is encrypted before it reaches it. AES-GCM, key
  // generated on the aeroplane and never sent anywhere: it rides in the link's fragment,
  // which is not part of the request a browser makes.
  const b64url = {
    from: (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
    to: (s) => {
      const b = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
      return Uint8Array.from(b, c => c.charCodeAt(0));
    },
  };
  function randomBytes(n) { return crypto.getRandomValues(new Uint8Array(n)); }
  const importKey = (raw) => crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);

  async function seal(key, obj) {
    const iv = randomBytes(12);
    const data = new TextEncoder().encode(JSON.stringify(obj));
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data));
    const out = new Uint8Array(iv.length + ct.length);
    out.set(iv, 0); out.set(ct, iv.length);
    return out;
  }
  async function open(key, bytes) {
    if (!bytes || bytes.length < 13) return null;
    try {
      const iv = bytes.subarray(0, 12);
      const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, bytes.subarray(12));
      return JSON.parse(new TextDecoder().decode(pt));
    } catch (e) {
      // Wrong key, or something that is not ours on the same topic. Silence is right: the
      // viewer's staleness readout already says nothing is arriving.
      return null;
    }
  }

  // The code arrives from another device, over a public broker: it is text from elsewhere and
  // is never trusted as markup, whoever encrypted it.
  function escapeHtml(v) {
    return String(v).replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  const tune = (k, d) => (typeof window.tune === 'function' ? window.tune(k) : d);
  const brokerUrl = () => tune('followMeBroker', 'wss://broker.emqx.io:8084/mqtt');
  const topicFor = (id) => 'navaid/follow/' + id;

  // How old a fix has to be before the viewer stops calling it live. Not a guess about the
  // aeroplane -- a statement about what we know.
  function followMeAge(atMs, nowMs) {
    const now = Number.isFinite(nowMs) ? nowMs : Date.now();
    if (!Number.isFinite(atMs)) return null;
    return Math.max(0, Math.round((now - atMs) / 1000));
  }

  // --- publishing -----------------------------------------------------------
  // One session = one random topic and one random key, made when the pilot starts sharing
  // and thrown away when they stop. Nothing is stored: a link that outlives the flight is a
  // link that tracks you next week, and the only way to be sure it cannot is to have no
  // way to resume it.
  let session = null;

  // The aircraft's code -- 4X-CDE, or whatever the pilot types. It is a LABEL, not an
  // identity: nothing checks it, and a pilot can type any registration they like. That is
  // the honest position for a feature with no accounts, and the viewer is worded to match.
  // Required, though: an instructor following three students needs to know which dot is
  // which, and an unnamed aeroplane on a shared link is a puzzle rather than information.
  const CODE_KEY = 'navaid.followMeCode';
  function followMeCode() {
    try { return (localStorage.getItem(CODE_KEY) || '').trim(); } catch (e) { return ''; }
  }
  function followMeSetCode(code) {
    const clean = String(code || '').trim().toUpperCase().slice(0, 12);
    try { localStorage.setItem(CODE_KEY, clean); } catch (e) { /* storage unavailable */ }
    return clean;
  }

  async function followMeStart(code) {
    if (session) return session.link;
    // Refuse rather than share an anonymous dot.
    const reg = followMeSetCode(code || followMeCode());
    if (!reg) return null;
    const id = b64url.from(randomBytes(16));
    const rawKey = randomBytes(32);
    const key = await importKey(rawKey);
    const client = mqttConnect(brokerUrl(), { clientId: 'navaid-pub-' + id.slice(0, 8) });
    session = {
      id, key, client, reg, lastSentAt: 0,
      // The key is in the FRAGMENT, so it is never in a request line, a proxy log or the
      // broker's view of the world. Everything the relay sees is the id.
      link: location.origin + location.pathname + '?follow=' + id + '#k=' + b64url.from(rawKey),
    };
    return session.link;
  }
  function followMeStop() {
    if (!session) return;
    // Clear the retained position before going: a zero-length retained payload is how MQTT
    // says "there is no last known value here". Without it the broker would hand the pilot's
    // final position to anyone opening the link days later, which is the opposite of a link
    // that dies when you stop sharing.
    try { session.client.publish(topicFor(session.id), new Uint8Array(0), { retain: true }); }
    catch (e) { /* already closing: the session ends either way */ }
    session.client.close();
    session = null;
  }
  function followMeSharing() { return !!session; }

  // Called from the fix handler. Rate-limited: a public broker is a courtesy, and one
  // position a second is plenty to follow an aeroplane with.
  async function followMePublish(fix) {
    if (!session || !fix || !Number.isFinite(fix.lat) || !Number.isFinite(fix.lng)) return false;
    const every = Math.max(1, Number(tune('followMeRateSec', 2)) || 2) * 1000;
    const now = Date.now();
    if (now - session.lastSentAt < every) return false;
    session.lastSentAt = now;
    const payload = await seal(session.key, {
      // Inside the envelope: the broker relays the label without being able to read it.
      reg: session.reg,
      lat: Math.round(fix.lat * 1e5) / 1e5,
      lng: Math.round(fix.lng * 1e5) / 1e5,
      alt: Number.isFinite(fix.alt) ? Math.round(fix.alt) : null,
      trk: Number.isFinite(fix.trk) ? Math.round(fix.trk) : null,
      kt: Number.isFinite(fix.kt) ? Math.round(fix.kt) : null,
      t: now,
    });
    // Retained: the broker keeps the last one, so a viewer opening mid-flight sees where the
    // aeroplane is immediately instead of waiting for the next publish. It is cleared on stop.
    return session.client.publish(topicFor(session.id), payload, { retain: true });
  }

  // --- watching -------------------------------------------------------------
  // ?follow=<id> with the key in the fragment. The viewer holds the LAST fix and how old it
  // is, and nothing else: there is no history to replay and pretending otherwise would
  // invent a track the aeroplane may not have flown.
  let watch = null;
  function followMeWatching() { return watch ? watch.state : null; }

  async function followMeWatch(id, rawKeyB64, opts) {
    if (watch) followMeUnwatch();
    const key = await importKey(b64url.to(rawKeyB64));
    const state = { id, fix: null, at: null, connected: false };
    const client = mqttConnect(brokerUrl(), Object.assign(
      { clientId: 'navaid-sub-' + id.slice(0, 8) }, opts || {}));
    client.onOpen = () => { state.connected = true; client.subscribe(topicFor(id)); };
    client.onClose = () => { state.connected = false; };
    client.onMessage = async (topic, payload) => {
      if (topic !== topicFor(id)) return;
      if (!payload || !payload.length) return;   // the cleared retained value: sharing stopped
      const msg = await open(key, payload);
      if (!msg) return;                       // not ours, or the wrong key
      state.fix = msg;
      state.at = Date.now();
      followMeViewerDraw();
      if (typeof window.scheduleDraw === 'function') window.scheduleDraw();
    };
    watch = { client, state };
    return state;
  }
  function followMeUnwatch() {
    if (!watch) return;
    watch.client.close();
    watch = null;
  }

  // --- the viewer -----------------------------------------------------------
  // Opening ?follow=<id>#k=<key> puts the app in watching mode: one aeroplane, drawn where it
  // last said it was, with how long ago that was ALWAYS on screen. The age is the point. A
  // phone at low level loses signal constantly, and a map that keeps drawing an aeroplane at
  // its last position without saying so is not showing you where it is -- it is showing you
  // where it was, in a way that looks identical.
  let viewer = null;

  function followMeStaleSec() {
    const v = Number(tune('followMeStaleSec', 30));
    return Number.isFinite(v) && v > 0 ? v : 30;
  }

  function followMeViewerBanner() {
    let el = document.getElementById('follow-me-banner');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'follow-me-banner';
    el.className = 'follow-me-banner';
    document.body.appendChild(el);
    return el;
  }

  function followMeViewerRefresh() {
    if (!viewer) return;
    const S = window.S || {};
    const el = followMeViewerBanner();
    const st = viewer.state;
    const age = followMeAge(st.at);
    const stale = age === null || age > followMeStaleSec();
    el.classList.toggle('stale', stale);
    const reg = (st.fix && st.fix.reg) ? String(st.fix.reg) : '';
    // What a follower on the ground wants to know, in the units a pilot reads: altitude in
    // feet (the fix carries metres), speed in knots, track, and the position itself. Only
    // fields the aeroplane actually sent -- a missing altitude is left out rather than
    // rendered as zero, which would read as "on the ground".
    const f = st.fix || {};
    const bits = [];
    if (Number.isFinite(f.alt)) bits.push(Math.round(f.alt * 3.28084) + ' ft');
    if (Number.isFinite(f.kt)) bits.push(Math.round(f.kt) + ' kt');
    if (Number.isFinite(f.trk)) bits.push(String(Math.round(f.trk)).padStart(3, '0') + '\u00b0');
    if (Number.isFinite(f.lat) && Number.isFinite(f.lng)) {
      bits.push(f.lat.toFixed(4) + ', ' + f.lng.toFixed(4));
    }
    const said = age === null
      ? (S.followMeWaiting || 'Follow me: waiting for a position…')
      : ((S.followMeLastFix ? S.followMeLastFix(age) : ('Last position ' + age + 's ago'))
         + (stale ? ' · ' + (S.followMeStale || 'not moving — the feed has stopped') : ''));
    // The code leads, because on a link shared into a group chat it is the only thing that
    // says WHICH aeroplane this is. Then what it is doing, then how old that is -- the age
    // goes last because it qualifies everything before it.
    el.textContent = [reg, bits.join(' · '), said].filter(Boolean).join(' · ');
    if (viewer.marker) viewer.marker.setOpacity(stale ? 0.45 : 1);
  }

  function followMeViewerDraw() {
    if (!viewer || !viewer.state.fix || typeof L === 'undefined' || typeof map === 'undefined') return;
    const f = viewer.state.fix;
    const px = 26;
    const icon = L.divIcon({
      className: 'follow-me-mark',
      iconSize: [px, px],
      iconAnchor: [px / 2, px / 2],
      html: '<span class="follow-me-arrow" style="transform:rotate('
        + (Number.isFinite(f.trk) ? f.trk : 0) + 'deg)">\u2708</span>'
        + (f.reg ? '<span class="follow-me-label">' + escapeHtml(f.reg) + '</span>' : ''),
    });
    if (!viewer.marker) {
      viewer.marker = L.marker([f.lat, f.lng], { icon, keyboard: false, pane: 'markerPane' })
        .addTo(map);
      map.setView([f.lat, f.lng], Math.max(map.getZoom(), 10));
    } else {
      viewer.marker.setLatLng([f.lat, f.lng]);
      viewer.marker.setIcon(icon);
      // Follow the aeroplane, but never fight a viewer who has panned away to look at
      // something -- the same courtesy the pilot's own follow lock extends.
      if (viewer.follow) map.panTo([f.lat, f.lng], { animate: true });
    }
    followMeViewerRefresh();
  }

  // ?follow=<id> with #k=<key>. Returns the id when this page IS a viewer, else null.
  function followMeLinkParams(search, hash) {
    try {
      const id = new URLSearchParams(search || location.search).get('follow');
      const m = /(?:^#?|&)k=([A-Za-z0-9\-_]+)/.exec(hash || location.hash || '');
      return (id && m) ? { id, key: m[1] } : null;
    } catch (e) { return null; }
  }

  async function followMeViewerStart(opts) {
    const p = followMeLinkParams(opts && opts.search, opts && opts.hash);
    if (!p) return null;
    const state = await followMeWatch(p.id, p.key, opts);
    viewer = { state, marker: null, follow: true, timer: 0 };
    document.body.classList.add('follow-me-viewing');
    followMeViewerRefresh();
    // The age has to keep counting even when nothing arrives -- especially then.
    viewer.timer = setInterval(followMeViewerRefresh, 1000);
    if (typeof map !== 'undefined' && map && map.on) {
      map.on('dragstart', () => { if (viewer) viewer.follow = false; });
    }
    return state;
  }
  function followMeViewerStop() {
    if (!viewer) return;
    clearInterval(viewer.timer);
    if (viewer.marker && typeof map !== 'undefined') map.removeLayer(viewer.marker);
    viewer = null;
    document.body.classList.remove('follow-me-viewing');
    const el = document.getElementById('follow-me-banner');
    if (el) el.remove();
    followMeUnwatch();
  }
  function followMeViewing() { return !!viewer; }

  NS.followMe = {
    viewerStart: followMeViewerStart, viewerStop: followMeViewerStop, viewing: followMeViewing,
    viewerDraw: followMeViewerDraw, viewerRefresh: followMeViewerRefresh,
    linkParams: followMeLinkParams, staleSec: followMeStaleSec,
    start: followMeStart, stop: followMeStop, sharing: followMeSharing, publish: followMePublish,
    code: followMeCode, setCode: followMeSetCode,
    watch: followMeWatch, unwatch: followMeUnwatch, watching: followMeWatching,
    _mqtt: mqttConnect, _seal: seal, _open: open, _b64url: b64url,
    _encodeLength: encodeLength, _readLength: readLength,
    age: followMeAge, topicFor, brokerUrl, importKey, randomBytes,
  };
  window.followMeAge = followMeAge;

  // A shared link is only a link: opening it has to put the app into watching mode by itself,
  // or the person following sees an ordinary map and concludes the feature is broken.
  // Deferred until the map exists, and only when the gist offers the feature at all.
  function followMeBoot() {
    // No feature-flag check here, deliberately. This runs on DOMContentLoaded and the tuning
    // gist lands AFTER it, so tune('featureFollowMe') still answered with the baked-in false
    // and the viewer never started -- the link opened an ordinary map. Exactly the trap the
    // sharing controls document, in the one place that had no refresh to fall back on.
    //
    // And a flag is the wrong question for this end anyway. featureFollowMe decides whether
    // a pilot is OFFERED sharing; whoever opens a link with a key in it has been handed the
    // answer already, by someone who did have the feature. Refusing them because a gist
    // elsewhere has not loaded yet helps nobody.
    if (!followMeLinkParams()) return;
    followMeViewerStart().catch(() => { /* bad link: the banner says nothing arrived */ });
  }
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(followMeBoot, 0);
  } else {
    window.addEventListener('DOMContentLoaded', () => setTimeout(followMeBoot, 0));
  }
}());
