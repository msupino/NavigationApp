# navaid-edge: NavAid's own relay (Cloudflare Worker)

One Worker, two jobs. Both stay off until the gist points at them, and either can be switched
back by clearing its gist setting.

| | What | Replaces | Gist setting |
|---|---|---|---|
| **Follow me broker** | `wss://<host>/mqtt`: a Durable Object speaking the slice of MQTT 3.1.1 the app uses (`broker.mjs`) | the public `broker.emqx.io` | `followMeBroker` |
| **SIGMET / AIRMET** | `https://<host>/feeds/{sigmet,airmet}.json`: rebuilt every 5 min by a Cron Trigger into KV (`feeds.mjs`) | the 20-minute GitHub Action and raw.githubusercontent's cache | `hazardFeedBase` |

The broker answers NavAid topics only (`navaid/...`). It caps packets (160 KB) and
rate-limits publishers (40 packets per 10 s). Retained copies expire after a day, so a dead
phone's last position doesn't stay on the relay for ever. Payloads stay opaque, as they were on
the public broker: positions are sealed and signed on the aeroplane.

The feeds run the same build as the Action (`scripts/build-aviation-feeds.mjs`). Weather
(`wx.json`) and NOTAMs stay with the Actions, because their source, IAA's MobileAeroinfo,
answers curl only. If the relay fails, the app falls back to the GitHub branches.

All of this fits the free Workers plan:
- SQLite-backed Durable Objects with WebSocket Hibernation, so idle sockets cost nothing;
- 288 cron runs a day, with two KV writes each (the free limit is 1,000 writes a day);
- feed reads cached for 60 s.

## Deploy (once)

You need an API token (Cloudflare: My Profile → API Tokens → **Edit Cloudflare Workers**
template) in a file only you can read, `~/.config/cf-token`:

```bash
cd relay/edge
export CLOUDFLARE_API_TOKEN=$(cat ~/.config/cf-token)
npx wrangler kv namespace create FEEDS      # prints an id: paste it into wrangler.toml
npx wrangler deploy                         # prints https://navaid-edge.<account>.workers.dev
```

The Worker imports `../../scripts/build-aviation-feeds.mjs`, so deploy from this folder of a
checkout; the dashboard editor can't take it as a single file. The first feed build runs within
5 minutes.

## Check, then switch over

```bash
curl -s https://navaid-edge.<account>.workers.dev/feeds/sigmet.json | head -c 300
```

Then in the tuning gist:

```json
"hazardFeedBase": "https://navaid-edge.<account>.workers.dev/feeds",
"followMeBroker": "wss://navaid-edge.<account>.workers.dev/mqtt"
```

To switch back, clear `hazardFeedBase` and set `followMeBroker` to
`wss://broker.emqx.io:8084/mqtt`.

Changing the broker moves everyone at once. A link shared before the switch keeps working,
because the topic and keys are in the link, not the broker, but a pilot and a viewer on different
gist versions won't see each other until both have reloaded. Switch on the ground, not mid-flight.

## Tests

- `tests/edge-broker.spec.js`: the protocol, with a fake Durable Object.
- `tests/edge-broker-interop.spec.js`: the app's real Follow me client against the broker, a
  public share and a private link.
- `tests/edge-feeds.spec.js`: the cron build and serving.
- `tests/hazard-feed-relay.spec.js`: the app reading the feeds from the relay, and falling back.
