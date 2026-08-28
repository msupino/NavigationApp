// Follow me: a link that shows someone where the aeroplane is, with no server of ours.

// Two devices need a relay. This uses a PUBLIC MQTT broker over WebSocket, with no NavAid
// account or server. Positions use an unguessable topic and browser-side encryption.
// The key is in the link fragment, which browsers do not send to a server.

// The broker cannot read positions, but the test relay has no availability promise.
// The URL is a bearer capability. Its symmetric key can also create valid-looking packets.
// This accepted limit is disclosed before sharing; this is not authenticated safety tracking.

// What it is not: a tracking service. A public broker is best-effort and unauthenticated,
// there is no history, and a phone that loses signal simply stops publishing. The viewer is
// built around saying so -- see followMeAge -- because a map that quietly keeps drawing an
// aeroplane where it last was is worse than a map that admits it does not know.

// The MQTT client here is deliberately small and in-repo rather than a library from a CDN:
// positions use QoS 0; retained cleanup uses QoS 1 so Stop can wait for broker acknowledgement.
(function () {
  'use strict';
  const NS = (window.NavAid = window.NavAid || {});

  // --- MQTT 3.1.1 over WebSocket, the parts a position feed uses -------------
  const CONNECT = 1, CONNACK = 2, PUBLISH = 3, PUBACK = 4, SUBSCRIBE = 8, PINGREQ = 12;

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
  function encodeBytes(value) {
    const bytes = value || new Uint8Array(0);
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
    const client = {
      ws: null, onMessage: null, onOpen: null, onClose: null, onPublishAck: null, ready: false,
    };
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
        const will = o.will && o.will.topic ? o.will : null;
        // A retained empty Last Will removes the last position if the app crashes or the
        // device disappears without completing Stop. Will QoS 0 is enough for this fallback;
        // deliberate Stop separately waits for a QoS 1 PUBACK.
        const connectFlags = 0x02 | (will ? 0x04 | (will.retain ? 0x20 : 0) : 0);
        const connectPayload = [
          // A fresh client id per attempt: a broker that still holds the old session would
          // otherwise kick the reconnecting client as a duplicate.
          ...encodeString((o.clientId || 'navaid') + '-' + Math.random().toString(36).slice(2, 8)),
        ];
        if (will) connectPayload.push(...encodeString(will.topic), ...encodeBytes(will.payload));
        ws.send(packet(CONNECT, 0, [
          ...encodeString('MQTT'), 4, connectFlags, keepalive >> 8, keepalive & 0xff,
          ...connectPayload,
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
        if (type === PUBACK) {
          const len = readLength(buf, 1);
          if (!len || len.value !== 2 || len.next + 1 >= buf.length) return;
          const id = (buf[len.next] << 8) | buf[len.next + 1];
          if (client.onPublishAck) client.onPublishAck(id);
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
      const qos = opts && opts.qos === 1 ? 1 : 0;
      // Bit 0 is RETAIN; QoS 1 occupies bit 1 and adds a packet id after the topic.
      const id = qos ? packetId++ : 0;
      if (packetId > 0xffff) packetId = 1;
      client.ws.send(packet(PUBLISH, (opts && opts.retain ? 1 : 0) | (qos << 1), [
        ...encodeString(topic), ...(qos ? [id >> 8, id & 0xff] : []), ...payload,
      ]));
      return qos ? id : true;
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

  // --- the session that survives a restart -----------------------------------
  // A phone dies mid-flight -- the app is force-quit, Android reclaims it, the battery goes
  // -- and the pilot starts it again. Without this the link everyone already has is dead,
  // and nobody re-shares a link at 2000 feet. So the topic and key are kept on the device.
  //
  // ONLY on the device: they are a capability to watch this aeroplane, not a preference, so
  // they are never synced to Drive (settings-sync-allowlist.spec.js holds this). And by
  // default they expire: a link that outlives the flight it was shared for is a link that
  // tracks you next week.
  const SESSION_KEY = 'navaid.followMeSession';
  const resumeMs = () => Math.max(1, Number(tune('followMeResumeHr', 12)) || 12) * 3600000;
  const persistLink = () => tune('featureFollowMePersist', false) === true;

  function rawSession() {
    try {
      const raw = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
      if (!raw || !raw.id || !raw.k || !raw.reg) return null;
      // A key of the wrong size is a key from a broken write, not a session.
      if (b64url.to(raw.k).length !== 32) return null;
      raw.seq = Number.isSafeInteger(raw.seq) && raw.seq >= 0 ? raw.seq : 0;
      raw.pendingStop = raw.pendingStop === true;
      raw.on = raw.on === true;
      return raw;
    } catch (e) {
      return null;
    }
  }
  function storedSession() {
    const raw = rawSession();
    try {
      if (!raw) return null;
      // A pending Stop owns the capability until it can clear the broker. Expiry must not
      // make that cleanup impossible; it is never eligible for ordinary sharing reuse.
      if (raw.pendingStop) return raw;
      if (!persistLink() && !(Date.now() - Number(raw.at) < resumeMs())) return null;
      return raw;
    } catch (e) {
      return null;                                  // storage off, or something not ours
    }
  }
  function saveSession(o) {
    try { localStorage.setItem(SESSION_KEY, JSON.stringify(o)); } catch (e) { /* storage off */ }
  }
  function clearSession() {
    try { localStorage.removeItem(SESSION_KEY); } catch (e) { /* storage off */ }
  }

  function refreshSessionControls() {
    if (typeof window.refreshFollowMeControl === 'function') window.refreshFollowMeControl();
    if (typeof window.refreshFollowMeMapControl === 'function') window.refreshFollowMeMapControl();
  }

  function sessionRecord(s, on, pendingStop) {
    return {
      id: s.id, k: s.rawKeyB64, reg: s.reg, at: s.lastActiveAt,
      seq: s.seq, on: on === true, pendingStop: pendingStop === true,
    };
  }

  function sessionAuthorized(s) {
    const stored = rawSession();
    return !!(s && stored && stored.on && !stored.pendingStop &&
      stored.id === s.id && stored.k === s.rawKeyB64);
  }

  function withFollowMeLock(action) {
    const locks = navigator.locks;
    if (locks && typeof locks.request === 'function') {
      return locks.request('navaid-follow-me-session', { mode: 'exclusive' }, action);
    }
    // Older embedded WebViews have no Web Locks. The shared-storage checks still fence
    // ordinary event ordering there; current browser and native runtimes take the lock.
    return Promise.resolve().then(action);
  }

  function relinquishPublisher(s) {
    if (!s || session !== s) return;
    s.status = 'stopping';
    clearTimeout(s.clearAckTimer);
    s.client.close();
    if (s.resolveConnected) s.resolveConnected(false);
    if (s.resolveStop) s.resolveStop({ pending: true });
    session = null;
    refreshSessionControls();
  }

  function finishStop(s) {
    if (!s || session !== s) return;
    clearTimeout(s.clearAckTimer);
    s.client.close();
    if (s.resolveConnected) s.resolveConnected(false);
    if (persistLink()) saveSession(sessionRecord(s, false, false));
    else clearSession();
    session = null;
    refreshSessionControls();
    if (s.resolveStop) s.resolveStop({ pending: false });
  }

  function clearRetainedAndFinish(s) {
    if (!s || session !== s || !s.client.ready || s.clearPacketId) return false;
    let packetId = null;
    try {
      packetId = s.client.publish(
        topicFor(s.id), new Uint8Array(0), { retain: true, qos: 1 });
    } catch (e) { packetId = null; }
    if (!Number.isInteger(packetId) || packetId < 1) return false;
    s.clearPacketId = packetId;
    clearTimeout(s.clearAckTimer);
    s.clearAckTimer = setTimeout(() => {
      if (session !== s || s.status !== 'stopping' || s.clearPacketId !== packetId) return;
      // A silent broker is not confirmation. Closing forces the reconnect path to retry.
      s.clearPacketId = null;
      try { s.client.ws.close(); } catch (e) { /* onclose/reconnect handles it */ }
    }, 10000);
    return true;
  }

  async function openPublisher(raw, reg, pendingStop) {
    const id = raw.id;
    const rawKey = b64url.to(raw.k);
    const key = await importKey(rawKey);
    const client = mqttConnect(brokerUrl(), {
      clientId: 'navaid-pub-' + id.slice(0, 8),
      will: { topic: topicFor(id), payload: new Uint8Array(0), retain: true },
    });
    const s = {
      id, key, client, reg, rawKeyB64: raw.k, lastActiveAt: Number(raw.at) || Date.now(),
      seq: Number.isSafeInteger(raw.seq) ? raw.seq : 0,
      lastSentAt: 0, status: pendingStop ? 'stopping' : 'connecting', everConnected: false,
      resolveStop: null, stopPromise: null, clearPacketId: null, clearAckTimer: 0,
      resolveConnected: null, connectedPromise: null,
      link: location.origin + location.pathname + '?follow=' + id + '#k=' + raw.k,
    };
    s.connectedPromise = new Promise(resolve => { s.resolveConnected = resolve; });
    session = s;
    client.onOpen = () => {
      if (session !== s) return;
      s.everConnected = true;
      if (s.status === 'stopping') {
        clearRetainedAndFinish(s);
        return;
      }
      s.status = 'connected';
      if (s.resolveConnected) {
        s.resolveConnected(true);
        s.resolveConnected = null;
      }
      refreshSessionControls();
    };
    client.onClose = () => {
      if (session !== s) return;
      clearTimeout(s.clearAckTimer);
      s.clearPacketId = null;
      if (s.status === 'stopping') return;
      s.status = s.everConnected ? 'reconnecting' : 'connecting';
      refreshSessionControls();
    };
    client.onPublishAck = (packetId) => {
      if (session === s && s.status === 'stopping' && packetId === s.clearPacketId) {
        clearTimeout(s.clearAckTimer);
        finishStop(s);
      }
    };
    refreshSessionControls();
    return s;
  }

  async function followMeStart(code) {
    if (session && sessionAuthorized(session)) {
      return session.status === 'stopping' ? null : session.link;
    }
    if (session) relinquishPublisher(session);
    // Refuse rather than share an anonymous dot.
    const reg = followMeSetCode(code || followMeCode());
    if (!reg) return null;
    return withFollowMeLock(async () => {
      if (session && sessionAuthorized(session)) {
        return session.status === 'stopping' ? null : session.link;
      }
      if (session) relinquishPublisher(session);
      // Re-read only after acquiring the device-wide lifecycle lock. Stop may have changed
      // consent while WebCrypto or another tab delayed this Start request.
      const prev = storedSession();
      if (prev && prev.pendingStop) return null;
      // Same aeroplane, same link: this makes a restart survivable. A different code gets
      // a new topic and key, so followers of the previous aircraft cannot inherit it.
      const reuse = !!(prev && prev.reg === reg);
      const id = reuse ? prev.id : b64url.from(randomBytes(16));
      const rawKeyB64 = reuse ? prev.k : b64url.from(randomBytes(32));
      const s = await openPublisher({
        id, k: rawKeyB64, at: Date.now(), seq: reuse ? prev.seq : 0,
      }, reg, false);
      // `on` is the consent a restart reads back. Persist it inside the same lock as Stop.
      saveSession(sessionRecord(s, true, false));
      return s.link;
    });
  }
  function followMeStop() {
    if (!session) return Promise.resolve({ pending: false });
    const s = session;
    if (s.status === 'stopping') return s.stopPromise || Promise.resolve({ pending: true });
    // Clear the retained position before going: a zero-length retained payload is how MQTT
    // says "there is no last known value here". Without it the broker would hand the pilot's
    // final position to anyone opening the link days later, which is the opposite of a link
    // that dies when you stop sharing.
    s.status = 'stopping';
    s.stopPromise = new Promise(resolve => { s.resolveStop = resolve; });
    refreshSessionControls();
    // Serialize the consent change and tombstone behind any publish already at its final
    // send boundary. Other tabs then see pendingStop before they can enter that boundary.
    withFollowMeLock(() => {
      if (session !== s) return;
      saveSession(sessionRecord(s, false, true));
      // If disconnected, mqttConnect keeps retrying. Its next CONNACK runs the same clear.
      clearRetainedAndFinish(s);
    }).catch(() => { /* keep stopping; a later reconnect/storage event can retry */ });
    return s.stopPromise;
  }

  // Throw the stored link away and, if sharing, come back on a fresh one. The escape hatch
  // for a persistent link that has been passed further than the pilot meant it to go.
  async function followMeNewLink() {
    const reg = followMeCode();
    const wasSharing = !!session;
    if (wasSharing) await followMeStop();
    clearSession();
    return wasSharing ? followMeStart(reg) : null;
  }

  // Called on boot. Resumes only what this device was already doing: a stored session marked
  // `on`, inside its window. Anything else -- a deliberate stop, an expired link, a device
  // that never shared -- starts nothing.
  async function followMeResume() {
    if (session) return null;
    const prev = storedSession();
    if (!prev) return null;
    if (prev.pendingStop) {
      await openPublisher(prev, prev.reg, true);
      return null;
    }
    if (prev.on !== true) return null;
    const link = await followMeStart(prev.reg);
    const s = session;
    if (!link || !s) return null;
    const connected = s.status === 'connected' ? true : await s.connectedPromise;
    return connected ? link : null;
  }
  function followMeSharing() { return !!session && session.status !== 'stopping'; }
  function followMeStatus() { return session ? session.status : 'idle'; }

  // Called from the fix handler. Rate-limited: a public broker is a courtesy, and one
  // position a second is plenty to follow an aeroplane with.
  async function followMePublish(fix) {
    if (!session || session.status === 'stopping' || !fix ||
        !Number.isFinite(fix.lat) || !Number.isFinite(fix.lng)) return false;
    const s = session;
    // localStorage is shared by same-origin tabs. A Stop or replacement session in another
    // tab revokes this publisher immediately, even before its storage event is delivered.
    if (!sessionAuthorized(s)) {
      relinquishPublisher(s);
      return false;
    }
    const every = Math.max(1, Number(tune('followMeRateSec', 2)) || 2) * 1000;
    const now = Date.now();
    if (now - s.lastSentAt < every) return false;
    s.lastSentAt = now;
    s.lastActiveAt = now;
    s.seq = Math.max(s.seq + 1, now);
    const payload = await seal(s.key, {
      // Inside the envelope: the broker relays the label without being able to read it.
      reg: s.reg,
      lat: Math.round(fix.lat * 1e5) / 1e5,
      lng: Math.round(fix.lng * 1e5) / 1e5,
      alt: Number.isFinite(fix.alt) ? Math.round(fix.alt) : null,
      trk: Number.isFinite(fix.trk) ? Math.round(fix.trk) : null,
      kt: Number.isFinite(fix.kt) ? Math.round(fix.kt) : null,
      t: now,
      seq: s.seq,
    });
    // Stop can run while WebCrypto is yielding. Never let that older operation publish a
    // retained fix after the tombstone, or publish into a new session that replaced it.
    return withFollowMeLock(() => {
      if (session !== s || s.status === 'stopping' || !sessionAuthorized(s)) {
        relinquishPublisher(s);
        return false;
      }
      saveSession(sessionRecord(s, true, false));
      // This callback has no yield: retained send is ordered before a later Stop tombstone.
      return s.client.publish(topicFor(s.id), payload, { retain: true });
    });
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
    const state = { id, fix: null, at: null, connected: false, lastOrder: -1 };
    const client = mqttConnect(brokerUrl(), Object.assign(
      { clientId: 'navaid-sub-' + id.slice(0, 8) }, opts || {}));
    client.onOpen = () => { state.connected = true; client.subscribe(topicFor(id)); };
    client.onClose = () => { state.connected = false; };
    client.onMessage = async (topic, payload) => {
      if (topic !== topicFor(id)) return;
      if (!payload || !payload.length) return;   // the cleared retained value: sharing stopped
      const msg = await open(key, payload);
      if (!msg) return;                       // not ours, or the wrong key
      const now = Date.now();
      // `seq` was added after the first Follow Me release. During a rolling cache update,
      // an older publisher can still send timestamp-only packets to a newer viewer. Its
      // millisecond timestamp is monotonic enough for that compatibility window and still
      // prevents an older retained packet replacing a newer one.
      const order = msg.seq == null ? msg.t : msg.seq;
      if (!Number.isFinite(msg.lat) || msg.lat < -90 || msg.lat > 90 ||
          !Number.isFinite(msg.lng) || msg.lng < -180 || msg.lng > 180 ||
          !Number.isFinite(msg.t) || msg.t <= 0 || msg.t > now + 300000 ||
          !Number.isSafeInteger(order) || order < 0 || order <= state.lastOrder) return;
      state.lastOrder = order;
      state.fix = msg;
      state.at = msg.t;
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
    // Following an aircraft is not route onboarding. Drop any intro that was painted before
    // this async viewer started, and begin with route edits locked just like a live own-ship.
    if (typeof dismissRoutePriming === 'function') dismissRoutePriming();
    window.editUnlockOverride = false;
    document.body.classList.add('follow-me-viewing');
    if (typeof refreshEditLockControl === 'function') refreshEditLockControl();
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
    window.editUnlockOverride = false;
    document.body.classList.remove('follow-me-viewing');
    if (typeof refreshEditLockControl === 'function') refreshEditLockControl();
    const el = document.getElementById('follow-me-banner');
    if (el) el.remove();
    followMeUnwatch();
  }
  function followMeViewing() { return !!viewer; }

  NS.followMe = {
    viewerStart: followMeViewerStart, viewerStop: followMeViewerStop, viewing: followMeViewing,
    viewerDraw: followMeViewerDraw, viewerRefresh: followMeViewerRefresh,
    linkParams: followMeLinkParams, staleSec: followMeStaleSec,
    start: followMeStart, stop: followMeStop, sharing: followMeSharing, status: followMeStatus,
    publish: followMePublish,
    code: followMeCode, setCode: followMeSetCode,
    newLink: followMeNewLink, resume: followMeResume, _stored: storedSession,
    watch: followMeWatch, unwatch: followMeUnwatch, watching: followMeWatching,
    _mqtt: mqttConnect, _seal: seal, _open: open, _b64url: b64url,
    _encodeLength: encodeLength, _readLength: readLength,
    age: followMeAge, topicFor, brokerUrl, importKey, randomBytes,
  };
  window.followMeAge = followMeAge;

  window.addEventListener('storage', (event) => {
    if (event.key === SESSION_KEY && session && !sessionAuthorized(session)) {
      relinquishPublisher(session);
    }
  });

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
    if (followMeLinkParams()) {
      followMeViewerStart().catch(() => { /* bad link: the banner says nothing arrived */ });
      return;
    }
    // Not a viewer: this device may have been sharing when the app stopped running.
    followMeResume().then((link) => {
      if (!link) return;
      if (typeof window.refreshFollowMeControl === 'function') window.refreshFollowMeControl();
      if (typeof window.refreshFollowMeMapControl === 'function') window.refreshFollowMeMapControl();
      // Say so. Sharing that restarts itself invisibly is the kind of surprise this whole
      // feature is written to avoid.
      const S = window.S || {};
      if (typeof window.showToast === 'function') {
        window.showToast(S.followMeResumed || 'Follow me: still sharing — the same link as before still works.');
      }
    }).catch(() => { /* nothing stored, or storage is off */ });
  }
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(followMeBoot, 0);
  } else {
    window.addEventListener('DOMContentLoaded', () => setTimeout(followMeBoot, 0));
  }
}());
