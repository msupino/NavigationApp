// NavAid's own Follow me relay: a Durable Object that speaks the small part of MQTT 3.1.1 over
// WebSocket that docs/app/followme.js uses, so the app needs no change -- the gist's
// `followMeBroker` points at it instead of the public broker.emqx.io.
//
// What the app sends, and all this answers:
//   CONNECT (clean session, optional retained Last Will)  -> CONNACK
//   PUBLISH QoS 0/1, RETAIN                               -> fan-out, retained store, PUBACK
//   SUBSCRIBE (one filter, `+` and `#` allowed)           -> SUBACK, then the retained matches
//   PINGREQ                                               -> PINGRESP
//   DISCONNECT                                            -> close without the will
// A socket that goes away without DISCONNECT gets its will published, as MQTT says.
//
// What the public broker could not: only NavAid's topics (navaid/...), packets capped in size,
// publishers rate-limited, and retained copies expire on their own (RETAINED_TTL_MS) instead of
// staying on a public relay for ever. Payloads are opaque here, as they were there: the private
// channel is AES-GCM sealed and signed on the aeroplane, the public one signed.

export const TOPIC_PREFIX = 'navaid/';
export const MAX_PACKET = 160 * 1024;          // a 64 KB route, sealed, with room to spare
export const MAX_TOPIC = 200;
export const RETAINED_TTL_MS = 24 * 3600e3;
export const RATE = { perWindow: 40, windowMs: 10000 };
// A socket's state rides in its hibernation attachment (2 KB at most): few filters, small will.
export const MAX_SUBS = 4;
export const MAX_WILL = 256;

export const T = { CONNECT: 1, CONNACK: 2, PUBLISH: 3, PUBACK: 4, SUBSCRIBE: 8, SUBACK: 9,
  UNSUBSCRIBE: 10, UNSUBACK: 11, PINGREQ: 12, PINGRESP: 13, DISCONNECT: 14 };

const te = new TextEncoder();
const td = new TextDecoder();

// --- wire helpers ------------------------------------------------------------------------------
export function encodeLength(n) {
  const out = [];
  do { let b = n % 128; n = Math.floor(n / 128); if (n > 0) b |= 0x80; out.push(b); } while (n > 0);
  return out;
}
export function readLength(buf, at) {
  let mult = 1, value = 0, i = at;
  for (let k = 0; k < 4; k++) {
    if (i >= buf.length) return null;
    const b = buf[i++];
    value += (b & 0x7f) * mult;
    if (!(b & 0x80)) return { value, next: i };
    mult *= 128;
  }
  return null;
}
function str(s) { const b = te.encode(s); return [b.length >> 8, b.length & 0xff, ...b]; }
export function packet(type, flags, body) {
  const b = body instanceof Uint8Array ? body : Uint8Array.from(body);
  const head = [(type << 4) | flags, ...encodeLength(b.length)];
  const out = new Uint8Array(head.length + b.length);
  out.set(head, 0); out.set(b, head.length);
  return out;
}
export function publishPacket(topic, payload, retain) {
  const t = str(topic);
  const out = new Uint8Array(t.length + payload.length);
  out.set(t, 0); out.set(payload, t.length);
  return packet(T.PUBLISH, retain ? 1 : 0, out);   // delivered at QoS 0
}
function readString(buf, at) {
  if (at + 2 > buf.length) return null;
  const n = (buf[at] << 8) | buf[at + 1];
  if (at + 2 + n > buf.length) return null;
  return { value: td.decode(buf.subarray(at + 2, at + 2 + n)), next: at + 2 + n };
}

// One WebSocket message may carry more than one packet; a packet is never split across two here
// (the app sends whole packets), so a truncated one is an error.
export function splitPackets(buf) {
  const out = [];
  let at = 0;
  while (at < buf.length) {
    const len = readLength(buf, at + 1);
    if (!len || len.next + len.value > buf.length) throw new Error('truncated packet');
    out.push({ type: buf[at] >> 4, flags: buf[at] & 0x0f, body: buf.subarray(len.next, len.next + len.value) });
    at = len.next + len.value;
  }
  return out;
}

// MQTT topic filter match: `+` one level, `#` the rest.
export function topicMatches(filter, topic) {
  const f = filter.split('/'), t = topic.split('/');
  for (let i = 0; i < f.length; i++) {
    if (f[i] === '#') return true;
    if (i >= t.length) return false;
    if (f[i] !== '+' && f[i] !== t[i]) return false;
  }
  return f.length === t.length;
}
export const validTopic = (t) => typeof t === 'string' && t.startsWith(TOPIC_PREFIX)
  && t.length <= MAX_TOPIC && !/[+#\u0000]/.test(t);
export const validFilter = (f) => typeof f === 'string' && f.startsWith(TOPIC_PREFIX)
  && f.length <= MAX_TOPIC && !/\u0000/.test(f)
  && f.split('/').every((lvl, i, all) => (lvl !== '#' || i === all.length - 1)
    && (lvl.length === 1 || !/[+#]/.test(lvl)));

// --- the Durable Object ------------------------------------------------------------------------
// One instance holds every connection (WebSocket Hibernation, so idle sockets cost nothing) and
// the retained store, keyed `r:<topic>` -> { p: base64 payload, at: ms }.
export class Broker {
  constructor(ctx, env) { this.ctx = ctx; this.env = env; }

  async fetch(request) {
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('MQTT over WebSocket only', { status: 426 });
    const protocols = (request.headers.get('Sec-WebSocket-Protocol') || '').split(',').map(s => s.trim());
    if (!protocols.includes('mqtt')) return new Response('subprotocol mqtt required', { status: 400 });
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ connected: false, subs: [], will: null, sent: [] });
    return new Response(null, { status: 101, webSocket: client, headers: { 'Sec-WebSocket-Protocol': 'mqtt' } });
  }

  state(ws) { return ws.deserializeAttachment() || { connected: false, subs: [], will: null, sent: [] }; }
  save(ws, s) { ws.serializeAttachment(s); }
  drop(ws, why) { try { ws.close(1008, why); } catch (e) { /* gone */ } }

  async webSocketMessage(ws, message) {
    if (typeof message === 'string') return this.drop(ws, 'binary only');
    const buf = new Uint8Array(message);
    if (buf.length > MAX_PACKET) return this.drop(ws, 'packet too large');
    let packets;
    try { packets = splitPackets(buf); } catch (e) { return this.drop(ws, 'malformed'); }
    for (const p of packets) {
      const s = this.state(ws);
      if (!s.connected && p.type !== T.CONNECT) return this.drop(ws, 'CONNECT first');
      switch (p.type) {
        case T.CONNECT: await this.onConnect(ws, s, p); break;
        case T.PUBLISH: await this.onPublish(ws, s, p); break;
        case T.SUBSCRIBE: await this.onSubscribe(ws, s, p); break;
        case T.UNSUBSCRIBE: this.onUnsubscribe(ws, s, p); break;
        case T.PINGREQ: ws.send(new Uint8Array([T.PINGRESP << 4, 0])); break;
        case T.DISCONNECT: s.will = null; this.save(ws, s); try { ws.close(1000, 'bye'); } catch (e) { /* gone */ } return;
        default: return this.drop(ws, 'unsupported packet');
      }
    }
  }

  async onConnect(ws, s, p) {
    const b = p.body;
    const proto = readString(b, 0);
    if (!proto || proto.value !== 'MQTT' || b[proto.next] !== 4) return this.drop(ws, 'MQTT 3.1.1 only');
    const flags = b[proto.next + 1];
    let at = proto.next + 4;                     // level, flags, keepalive (2)
    const id = readString(b, at);
    if (!id) return this.drop(ws, 'malformed CONNECT');
    at = id.next;
    let will = null;
    if (flags & 0x04) {
      const wt = readString(b, at);
      if (!wt || wt.next + 2 > b.length) return this.drop(ws, 'malformed will');
      const wl = (b[wt.next] << 8) | b[wt.next + 1];
      if (wt.next + 2 + wl > b.length || wl > MAX_WILL) return this.drop(ws, 'malformed will');
      const payload = b.subarray(wt.next + 2, wt.next + 2 + wl);
      if (validTopic(wt.value)) will = { topic: wt.value, p: b64(payload), retain: !!(flags & 0x20) };
    }
    s.connected = true; s.will = will;
    this.save(ws, s);
    ws.send(new Uint8Array([T.CONNACK << 4, 2, 0, 0]));
  }

  allow(ws, s) {
    const now = Date.now();
    s.sent = (s.sent || []).filter(t => now - t < RATE.windowMs);
    if (s.sent.length >= RATE.perWindow) return false;
    s.sent.push(now);
    return true;
  }

  async onPublish(ws, s, p) {
    const qos = (p.flags >> 1) & 3, retain = p.flags & 1;
    const t = readString(p.body, 0);
    if (!t || qos > 1) return this.drop(ws, 'malformed PUBLISH');
    let at = t.next, id = 0;
    if (qos === 1) { id = (p.body[at] << 8) | p.body[at + 1]; at += 2; }
    if (!validTopic(t.value)) return this.drop(ws, 'topic not allowed');
    if (!this.allow(ws, s)) return this.drop(ws, 'rate limit');
    this.save(ws, s);
    const payload = p.body.subarray(at);
    await this.deliver(t.value, payload, !!retain);
    if (qos === 1) ws.send(new Uint8Array([T.PUBACK << 4, 2, id >> 8, id & 0xff]));
  }

  async deliver(topic, payload, retain) {
    if (retain) {
      // An empty retained payload clears the stored copy (Stop, and the Last Will).
      if (payload.length === 0) await this.ctx.storage.delete('r:' + topic);
      else {
        await this.ctx.storage.put('r:' + topic, { p: b64(payload), at: Date.now() });
        await this.ensureSweep();
      }
    }
    const out = publishPacket(topic, payload, false);
    for (const other of this.ctx.getWebSockets()) {
      const os = this.state(other);
      if (os.connected && os.subs.some(f => topicMatches(f, topic))) {
        try { other.send(out); } catch (e) { /* closing */ }
      }
    }
  }

  async onSubscribe(ws, s, p) {
    const b = p.body;
    const id = (b[0] << 8) | b[1];
    const codes = [];
    const added = [];
    let at = 2;
    while (at < b.length) {
      const f = readString(b, at);
      if (!f || f.next >= b.length) return this.drop(ws, 'malformed SUBSCRIBE');
      at = f.next + 1;                           // requested QoS byte
      if (validFilter(f.value) && (s.subs.includes(f.value) || s.subs.length < MAX_SUBS)) {
        if (!s.subs.includes(f.value)) s.subs.push(f.value);
        added.push(f.value);
        codes.push(0);
      } else codes.push(0x80);
    }
    this.save(ws, s);
    ws.send(packet(T.SUBACK, 0, [id >> 8, id & 0xff, ...codes]));
    // The retained copies a new subscriber is owed, oldest-safe: expired ones are not handed out.
    const now = Date.now();
    for (const f of added) {
      const cut = f.search(/[+#]/);              // the literal part before the first wildcard
      const entries = cut >= 0
        ? await this.ctx.storage.list({ prefix: 'r:' + f.slice(0, cut) })
        : new Map([['r:' + f, await this.ctx.storage.get('r:' + f)]]);
      for (const [key, v] of entries) {
        if (!v) continue;
        const topic = key.slice(2);
        if (!topicMatches(f, topic) || now - v.at > RETAINED_TTL_MS) continue;
        ws.send(publishPacket(topic, unb64(v.p), true));
      }
    }
  }

  onUnsubscribe(ws, s, p) {
    const b = p.body;
    const id = (b[0] << 8) | b[1];
    let at = 2;
    while (at < b.length) {
      const f = readString(b, at);
      if (!f) break;
      s.subs = s.subs.filter(x => x !== f.value);
      at = f.next;
    }
    this.save(ws, s);
    ws.send(new Uint8Array([T.UNSUBACK << 4, 2, id >> 8, id & 0xff]));
  }

  async webSocketClose(ws) { await this.gone(ws); }
  async webSocketError(ws) { await this.gone(ws); }
  async gone(ws) {
    const s = this.state(ws);
    if (s.will) {
      const w = s.will;
      s.will = null; s.connected = false;
      this.save(ws, s);
      await this.deliver(w.topic, unb64(w.p), w.retain);
    }
  }

  // Retained copies age out: a share that never sent its Stop (a dead phone) does not keep its
  // last position on the relay for ever.
  async ensureSweep() {
    if ((await this.ctx.storage.getAlarm()) == null) await this.ctx.storage.setAlarm(Date.now() + 3600e3);
  }
  async alarm() {
    const now = Date.now();
    let left = 0;
    for (const [key, v] of await this.ctx.storage.list({ prefix: 'r:' })) {
      if (!v || now - v.at > RETAINED_TTL_MS) await this.ctx.storage.delete(key);
      else left++;
    }
    if (left) await this.ctx.storage.setAlarm(now + 3600e3);
  }
}

function b64(bytes) { let s = ''; for (const c of bytes) s += String.fromCharCode(c); return btoa(s); }
function unb64(s) { return Uint8Array.from(atob(s), c => c.charCodeAt(0)); }
