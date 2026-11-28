// navaid-edge: NavAid's own relay for Follow me (MQTT over WebSocket, a Durable Object) and the
// SIGMET / AIRMET feeds (Cron Trigger -> KV). Deploy: see README.md beside this file.
//
//   wss://<host>/mqtt            the Follow me broker (gist: followMeBroker)
//   https://<host>/feeds/sigmet.json, /feeds/airmet.json   (gist: hazardFeedBase = https://<host>/feeds)
import './shim.mjs';
import { refreshFeeds, serveFeed } from './feeds.mjs';

export { Broker } from './broker.mjs';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/mqtt') {
      return env.BROKER.get(env.BROKER.idFromName('navaid')).fetch(request);
    }
    const feed = /^\/feeds\/([a-z]+\.json)$/.exec(url.pathname);   // also /feeds/status.json
    if (feed && request.method === 'GET') {
      const res = await serveFeed(feed[1], env);
      if (res) return res;
    }
    return new Response('not found', { status: 404 });
  },
  async scheduled(event, env, ctx) {
    // A build that throws outright is reported too, not lost in a log nobody reads.
    ctx.waitUntil(refreshFeeds(env).catch(async (e) => {
      console.error('feeds run crashed', e && e.stack ? e.stack : String(e));
      await env.FEEDS.put('status.json', JSON.stringify({ crashed: String(e && e.message ? e.message : e).slice(0, 500), since: new Date().toISOString() }));
    }));
  },
};
