// @ts-check
// The app's own Follow me client (docs/app/followme.js) against NavAid's relay broker
// (relay/edge/broker.mjs), end to end: two pages, each with its WebSocket bridged to the broker
// running here in Node. A pilot shares publicly; a viewer on the secret pilots link sees the
// aircraft -- real signing, real packets, nothing on the network.
const { test, expect } = require('./_setup');
const path = require('path');

const loadBroker = () => import(path.join(__dirname, '..', 'relay', 'edge', 'broker.mjs'));

function fakeCtx() {
  const store = new Map();
  const sockets = [];
  let alarm = null;
  return {
    sockets,
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
}

// Replace the page's WebSocket with one that hands every frame to the broker here, and gives the
// page whatever the broker sends back.
async function bridge(page, broker, ctx) {
  const byId = new Map();
  let next = 0;
  await page.exposeBinding('__brokerOpen', async () => {
    const id = ++next;
    let att = null;
    const ws = {
      closed: null,
      send: (b) => { page.evaluate(([i, bytes]) => window.__brokerRecv(i, bytes), [id, Array.from(b)]).catch(() => {}); },
      close: () => { ws.closed = true; page.evaluate((i) => window.__brokerClosed(i), id).catch(() => {}); },
      serializeAttachment: (a) => { att = JSON.parse(JSON.stringify(a)); },
      deserializeAttachment: () => att,
    };
    ctx.acceptWebSocket(ws);
    ws.serializeAttachment({ connected: false, subs: [], will: null, sent: [] });
    byId.set(id, ws);
    return id;
  });
  await page.exposeBinding('__brokerSend', async (_src, id, bytes) => {
    await broker.webSocketMessage(byId.get(id), Uint8Array.from(bytes).buffer);
  });
  await page.exposeBinding('__brokerGone', async (_src, id) => {
    const ws = byId.get(id);
    if (ws && !ws.closed) { ws.closed = true; await broker.webSocketClose(ws); }
  });
  await page.addInitScript(() => {
    const live = new Map();
    window.__brokerRecv = (id, bytes) => { const s = live.get(id); if (s && s.onmessage) s.onmessage({ data: Uint8Array.from(bytes).buffer }); };
    window.__brokerClosed = (id) => { const s = live.get(id); if (s && s.onclose) s.onclose(); };
    window.WebSocket = class {
      constructor(url, proto) {
        this.url = url; this.protocol = proto; this.binaryType = 'arraybuffer';
        window.__brokerOpen().then((id) => { this.id = id; live.set(id, this); if (this.onopen) this.onopen(); });
      }
      send(b) { window.__brokerSend(this.id, Array.from(new Uint8Array(b))); }
      close() { window.__brokerGone(this.id); if (this.onclose) this.onclose(); }
    };
  });
}

test('a public share reaches a viewer through NavAid\'s own broker', async ({ browser }) => {
  const { Broker } = await loadBroker();
  const ctx = fakeCtx();
  const broker = new Broker(ctx, {});
  const pilotCtx = await browser.newContext(), viewerCtx = await browser.newContext();
  const pilot = await pilotCtx.newPage(), viewer = await viewerCtx.newPage();
  for (const p of [pilot, viewer]) {
    await bridge(p, broker, ctx);
    await p.goto('?lang=en&nogist');
    await p.waitForFunction(() => !!(window.NavAid && NavAid.followMe && NavAid.publicPilots) && typeof setTune === 'function');
    await p.evaluate(() => { setTune('featureFollowMe', true); setTune('followMeBroker', 'wss://relay.navaid.test/mqtt'); });
  }
  // The viewer: the secret pilots link, so it sees everyone without sharing.
  await viewer.evaluate(async () => {
    const secret = 'interop';
    const hex = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret))))
      .map(b => b.toString(16).padStart(2, '0')).join('');
    setTune('publicPilotsViewHash', hex);
    await NavAid.publicPilots.unlock(secret);
    map.setView([32.1, 34.85], 10, { animate: false });
    NavAid.publicPilots.start();
  });
  // The pilot: share publicly, one position.
  await pilot.evaluate(async () => {
    window.gpsLiveOn = true;
    NavAid.followMe.setPublic(true);
    await NavAid.followMe.start('4X-E2E');
  });
  await expect.poll(() => pilot.evaluate(() => NavAid.followMe.status())).toBe('connected');
  await pilot.evaluate(() => NavAid.followMe.publish({ lat: 32.1, lng: 34.85, trk: 90, kt: 95, af: 2500 }));
  await expect.poll(() => viewer.evaluate(() => NavAid.publicPilots.list().map(p => p.reg)), { timeout: 8000 })
    .toEqual(['4X-E2E']);
  // ...and the broker kept it as the retained copy a late viewer would get.
  expect((await ctx.storage.list({ prefix: 'r:navaid/public/v1/' })).size).toBe(1);
  await pilotCtx.close(); await viewerCtx.close();
});

test('a private Follow me link works through NavAid\'s own broker, and a late viewer gets the last position', async ({ browser }) => {
  const { Broker } = await loadBroker();
  const ctx = fakeCtx();
  const broker = new Broker(ctx, {});
  const pilotCtx = await browser.newContext(), viewerCtx = await browser.newContext();
  const pilot = await pilotCtx.newPage(), viewer = await viewerCtx.newPage();
  for (const p of [pilot, viewer]) {
    await bridge(p, broker, ctx);
    await p.goto('?lang=en&nogist');
    await p.waitForFunction(() => !!(window.NavAid && NavAid.followMe) && typeof setTune === 'function');
    await p.evaluate(() => { setTune('featureFollowMe', true); setTune('followMeBroker', 'wss://relay.navaid.test/mqtt'); });
  }
  const link = await pilot.evaluate(async () => { window.gpsLiveOn = true; return NavAid.followMe.start('4X-PRV'); });
  await expect.poll(() => pilot.evaluate(() => NavAid.followMe.status())).toBe('connected');
  await pilot.evaluate(() => NavAid.followMe.publish({ lat: 31.9, lng: 34.9, trk: 180, kt: 100, af: 3000 }));
  // The viewer opens the link after the position went out: the retained copy is what it gets.
  await viewer.evaluate(async (l) => {
    const u = new URL(l);
    await NavAid.followMe.viewerStart({ search: u.search, hash: u.hash });
  }, link);
  await expect.poll(() => viewer.evaluate(() => {
    const f = NavAid.followMe.viewerFix();
    return f ? [Math.round(f.lat * 10) / 10, Math.round(f.lng * 10) / 10] : null;
  }), { timeout: 8000 }).toEqual([31.9, 34.9]);
  // Nothing on the public channel: this share was private.
  expect((await ctx.storage.list({ prefix: 'r:navaid/public/' })).size).toBe(0);
  await pilotCtx.close(); await viewerCtx.close();
});
