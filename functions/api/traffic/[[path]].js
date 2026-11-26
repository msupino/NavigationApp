// The live-traffic relay as a Cloudflare Pages Function: navaid.supino.org/api/traffic/v2/lat/
// {lat}/lon/{lon}/dist/{dist}. The same code as the Worker (relay/traffic/worker.mjs), served from
// the site's own host -- some networks cannot reach *.workers.dev at all (reported: every request
// timed out on a pilot's Mac, so the web showed no traffic while the app, which asks the feed
// directly, did), and a network that loads NavAid reaches this.
//
// Runs only for /api/* (site/_routes.json, written by the deploy), so ordinary page and tile loads
// do not touch the Workers quota.
import { handle } from '../../../relay/traffic/worker.mjs';

const PREFIX = '/api/traffic';

export function relayRequest(request) {
  const url = new URL(request.url);
  url.pathname = url.pathname.slice(PREFIX.length) || '/';
  const headers = new Headers(request.headers);
  // The site's own page asks from the same origin, and a browser sends no Origin header on a
  // same-origin GET -- which the relay would refuse as "a script with no Origin at all". The
  // browser's Sec-Fetch-Site, which page scripts cannot set, says the request is the site's own.
  if (!headers.get('Origin') && headers.get('Sec-Fetch-Site') === 'same-origin') {
    headers.set('Origin', new URL(request.url).origin);
  }
  return new Request(url.toString(), { method: request.method, headers });
}

export async function onRequest(context) {
  return handle(relayRequest(context.request));
}
