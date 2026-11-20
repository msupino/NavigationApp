// @ts-check
// relay/edge/broker.mjs: NavAid's own Follow me relay, a Durable Object speaking the slice of
// MQTT 3.1.1 that docs/app/followme.js uses. Run in Node with a fake Durable Object context and
// fake sockets -- nothing goes to the network.
const { test, expect } = require('./_setup');
const path = require('path');

const load = () => import(path.join(__dirname, '..', 'relay', 'edge', 'broker.mjs'));
const te = new TextEncoder();
const str = (s) => { const b = te.encode(s); return [b.length >> 8, b.length & 0xff, ...b]; };
const len = (n) => { const o = []; do { let b = n % 128; n = Math.floor(n / 128); if (n) b |= 0x80; o.push(b); } while (n); return o; };
const pkt = (type, flags, body) => Uint8Array.from([(type << 4) | flags, ...len(body.length), ...body]).buffer;

// The packets exactly as followme.js builds them.
const CONNECT = (will) => pkt(1, 0, [...str('MQTT'), 4, 0x02 | (will ? 0x04 | 0x20 : 0), 0, 30,
  ...str('navaid-x'), ...(will ? [...str(will), 0, 0] : [])]);
const PUBLISH = (topic, payload, { retain = false, qos = 0, id = 1 } = {}) =>
  pkt(3, (retain ? 1 : 0) | (qos << 1), [...str(topic), ...(qos ? [id >> 8, id & 0xff] : []), ...payload]);
const SUBSCRIBE = (filter, id = 7) => pkt(8, 2, [id >> 8, id & 0xff, ...str(filter), 0]);

function harness(Broker) {
  const store = new Map();
  const sockets = [];
  let alarm = null;
  const ctx = {
    storage: {
      get: async (k) => store.get(k),
      put: async (k, v) => { store.set(k, JSON.parse(JSON.stringify(v))); },
      delete: async (k) => store.delete(k),
      list: async ({ prefix }) => new Map([...store].filter(([k]) => k.startsWith(prefix))),
      getAlarm: async () => alarm,
      setAlarm: async (t) => { alarm = t; },
    },
    acceptWebSocket: (ws) => sockets.push(ws),
    getWebSockets: () => sockets.filter(w => !w.closed),
  };
  const broker = new Broker(ctx, {});
  const socket = () => {
    let att = null;
    const ws = {
      got: [], closed: null,
      send: (b) => ws.got.push(Array.from(b)),
      close: (code, why) => { ws.closed = { code, why }; },
      serializeAttachment: (a) => { att = JSON.parse(JSON.stringify(a)); },
      deserializeAttachment: () => att,
    };
    ctx.acceptWebSocket(ws);
    ws.serializeAttachment({ connected: false, subs: [], will: null, sent: [] });
    return ws;
  };
  return { broker, store, socket, alarm: () => alarm };
}
const types = (ws) => ws.got.map(b => b[0] >> 4);
const topicOf = (b) => { let at = 1; while (b[at] & 0x80) at++; at++; const n = (b[at] << 8) | b[at + 1]; return String.fromCharCode(...b.slice(at + 2, at + 2 + n)); };

test('CONNECT, then a public position reaches a wildcard subscriber; QoS 1 is acknowledged', async () => {
  const { Broker } = await load();
  const h = harness(Broker);
  const pilot = h.socket(), viewer = h.socket();
  await h.broker.webSocketMessage(pilot, CONNECT());
  await h.broker.webSocketMessage(viewer, CONNECT());
  expect(types(pilot)).toEqual([2]);                         // CONNACK
  await h.broker.webSocketMessage(viewer, SUBSCRIBE('navaid/public/v1/+'));
  expect(viewer.got[1]).toEqual([0x90, 3, 0, 7, 0]);          // SUBACK, granted
  await h.broker.webSocketMessage(pilot, PUBLISH('navaid/public/v1/abc', [1, 2, 3], { retain: true, qos: 1, id: 9 }));
  expect(pilot.got[1]).toEqual([0x40, 2, 0, 9]);              // PUBACK
  const got = viewer.got[2];
  expect(got[0]).toBe(0x30);                                  // PUBLISH, live (not retained)
  expect(topicOf(got)).toBe('navaid/public/v1/abc');
  expect(got.slice(-3)).toEqual([1, 2, 3]);
});

test('a late subscriber gets the retained copy, flagged RETAIN; an empty retained publish clears it', async () => {
  const { Broker } = await load();
  const h = harness(Broker);
  const pilot = h.socket();
  await h.broker.webSocketMessage(pilot, CONNECT());
  await h.broker.webSocketMessage(pilot, PUBLISH('navaid/follow/k1', [7], { retain: true }));
  await h.broker.webSocketMessage(pilot, PUBLISH('navaid/follow/k1/route', [8], { retain: true }));
  expect(h.alarm()).not.toBeNull();                           // the sweep that ages them out
  const late = h.socket();
  await h.broker.webSocketMessage(late, CONNECT());
  await h.broker.webSocketMessage(late, SUBSCRIBE('navaid/follow/k1'));
  const retained = late.got.filter(b => b[0] >> 4 === 3);
  expect(retained.map(topicOf)).toEqual(['navaid/follow/k1']); // the exact topic, not /route
  expect(retained[0][0] & 1).toBe(1);
  await h.broker.webSocketMessage(pilot, PUBLISH('navaid/follow/k1', [], { retain: true }));
  expect(h.store.has('r:navaid/follow/k1')).toBe(false);
});

test('a socket that vanishes gets its will published; DISCONNECT does not', async () => {
  const { Broker } = await load();
  const h = harness(Broker);
  const pilot = h.socket(), viewer = h.socket();
  await h.broker.webSocketMessage(pilot, CONNECT('navaid/follow/k2'));
  await h.broker.webSocketMessage(pilot, PUBLISH('navaid/follow/k2', [5], { retain: true }));
  await h.broker.webSocketMessage(viewer, CONNECT());
  await h.broker.webSocketMessage(viewer, SUBSCRIBE('navaid/follow/k2'));
  pilot.closed = { code: 1006 };
  await h.broker.webSocketClose(pilot);
  expect(h.store.has('r:navaid/follow/k2')).toBe(false);       // the empty retained will cleared it
  // ...and the viewer is told: the will, an empty packet on the pilot's topic.
  const last = viewer.got.at(-1);
  expect(topicOf(last)).toBe('navaid/follow/k2');
  expect(last.length).toBe(2 + 2 + 'navaid/follow/k2'.length);

  const tidy = h.socket();
  await h.broker.webSocketMessage(tidy, CONNECT('navaid/follow/k3'));
  await h.broker.webSocketMessage(tidy, PUBLISH('navaid/follow/k3', [6], { retain: true }));
  await h.broker.webSocketMessage(tidy, Uint8Array.from([0xe0, 0]).buffer);
  await h.broker.webSocketClose(tidy);
  expect(h.store.has('r:navaid/follow/k3')).toBe(true);       // a clean DISCONNECT sends no will
});

test('only NavAid topics, nothing before CONNECT, and a publisher is rate-limited', async () => {
  const { Broker, RATE } = await load();
  const h = harness(Broker);
  const early = h.socket();
  await h.broker.webSocketMessage(early, PUBLISH('navaid/x', [1]));
  expect(early.closed.why).toBe('CONNECT first');
  const stranger = h.socket();
  await h.broker.webSocketMessage(stranger, CONNECT());
  await h.broker.webSocketMessage(stranger, PUBLISH('someone/else', [1]));
  expect(stranger.closed.why).toBe('topic not allowed');
  const chatty = h.socket();
  await h.broker.webSocketMessage(chatty, CONNECT());
  for (let i = 0; i <= RATE.perWindow; i++) await h.broker.webSocketMessage(chatty, PUBLISH('navaid/public/v1/z', [i]));
  expect(chatty.closed.why).toBe('rate limit');
  const pinger = h.socket();
  await h.broker.webSocketMessage(pinger, CONNECT());
  await h.broker.webSocketMessage(pinger, Uint8Array.from([0xc0, 0]).buffer);
  expect(pinger.got.at(-1)).toEqual([0xd0, 0]);               // PINGRESP
});

test('retained copies older than a day are neither handed out nor kept', async () => {
  const { Broker, RETAINED_TTL_MS } = await load();
  const h = harness(Broker);
  h.store.set('r:navaid/public/v1/old', { p: Buffer.from([1]).toString('base64'), at: Date.now() - RETAINED_TTL_MS - 1000 });
  h.store.set('r:navaid/public/v1/new', { p: Buffer.from([2]).toString('base64'), at: Date.now() });
  const v = h.socket();
  await h.broker.webSocketMessage(v, CONNECT());
  await h.broker.webSocketMessage(v, SUBSCRIBE('navaid/public/v1/+'));
  expect(v.got.filter(b => b[0] >> 4 === 3).map(topicOf)).toEqual(['navaid/public/v1/new']);
  await h.broker.alarm();
  expect([...h.store.keys()]).toEqual(['r:navaid/public/v1/new']);
});

test('topic filters: + is one level, # the rest', async () => {
  const { topicMatches, validFilter } = await load();
  expect(topicMatches('navaid/public/v1/+', 'navaid/public/v1/a')).toBe(true);
  expect(topicMatches('navaid/public/v1/+', 'navaid/public/v1/a/b')).toBe(false);
  expect(topicMatches('navaid/#', 'navaid/follow/k/route')).toBe(true);
  expect(validFilter('navaid/a#')).toBe(false);
  expect(validFilter('other/+')).toBe(false);
});
