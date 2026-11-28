# Live-traffic relay (Cloudflare Worker)

The public ADS-B feeds send no CORS header, so the web app cannot read them. The Android and
iOS apps fetch the feed natively. In a browser, the app fetches this relay, which asks
[adsb.lol](https://adsb.lol) (open data, ODbL) and adds the CORS header, for NavAid's own
origins only (`ALLOWED_ORIGINS` in `worker.mjs`).

adsb.lol rate-limits by IP, and Workers share their outgoing IPs, so a 429 is routine. When
adsb.lol refuses, the relay asks [adsb.fi](https://adsb.fi), which uses the same format. If both
refuse, it serves the last good answer for that spot if it's under 2 minutes old, marked
`X-NavAid-Stale: 1`.

Every answer carries `X-NavAid-Feeds`, which says what each feed did, e.g.
`adsb.lol=429; adsb.fi=403`. It reads `cache` when the answer came from the relay's own cache,
and `backoff` for a feed resting after a 429 (for its `Retry-After`, or 60 s). A 502's body
lists the same.

Known limit: adsb.lol counts its allowance (4/s, 60/min, 500/day) per IP address, and Workers
share Cloudflare's outgoing addresses. adsb.fi refuses Cloudflare outright. So from a Worker,
most requests get turned away. The apps aren't affected, because each phone asks from its own
address.

To spare the feed, each request snaps to a 0.1° grid with its radius widened to cover the snap.
Answers are cached for 8 s, so all pilots near one spot share one upstream call per poll. The
free Workers plan (100,000 requests a day) is plenty.

## Deploy

```bash
cd relay/traffic
npx wrangler login        # once, in a browser
npx wrangler deploy       # prints https://navaid-traffic.<account>.workers.dev
```

Then point the web app at it. In the tuning gist set:

```json
"trafficWebApiUrl": "https://navaid-traffic.<account>.workers.dev/v2/lat/{lat}/lon/{lon}/dist/{dist}"
```

The browser's Traffic switch is undimmed from the next gist load. An empty value turns web
traffic off again.

## Check it

```bash
curl -s -H 'Origin: https://navaid.supino.org' -D - \
  https://navaid-traffic.<account>.workers.dev/v2/lat/32.1/lon/34.8/dist/40 | head -20
```

The response should carry `access-control-allow-origin: https://navaid.supino.org`. Tests:
`tests/traffic-web-relay.spec.js`.
