# Simulator link over WebRTC — design

**Goal:** let NavAid **in a browser** take a flight simulator's live aircraft from another computer
on the same network — the iPad or laptop beside the X-Plane PC — with LAN latency, no certificates
and no CORS setup, and keep the existing `http://` bridge connection for the apps and `localhost`.

**Status:** design for review. Nothing built. Spans two repos: **NavigationApp** (the browser side)
and **msupino/cvfr-bridge** (a helper on the simulator computer).

## The problem

Today NavAid polls a bridge's JSON once a second (`_simRequestData` / `_simFetch`, `io.js`). From
the live site (`https://navaid.supino.org`) a browser refuses that for a LAN address:

| From an `https://` page to a LAN computer | Allowed? |
| --- | --- |
| `http://`, `ws://` | No — mixed content (only `http://localhost` / `127.0.0.1`, and not in Safari) |
| `https://`, `wss://` | Only with a certificate the browser trusts — a per-device warning ritual for a LAN IP |
| UDP, broadcast, multicast | No API in a web page at all |
| WebTransport | Only with a pinned certificate renewed every 14 days; weak Safari support |
| **WebRTC data channel** | **Yes** — built for device-to-device links, encrypted (DTLS) with its own keys, exempt from mixed-content rules |

The Android/iOS apps are not affected: they send an `http://` bridge address through the phone's
own network stack (`CapacitorHttp`). This design is for browsers; the apps can use it too.

## Decisions taken

| | |
| --- | --- |
| Transport | A **WebRTC data channel**, directly over the LAN. Positions never cross the internet |
| Who speaks WebRTC on the simulator side | A **helper script** that reads the bridge already running there over `http://127.0.0.1:2020` — so the C plugin, the Python bridge, Little NavMap and `scripts/fake-sim-bridge.py` all work unchanged. The C plugin gets no WebRTC stack |
| Pairing | A **code** the helper shows and the pilot types into NavAid. The one-time handshake (WebRTC "signalling": offer, answer, network candidates) goes through the **Follow me relay** NavAid already uses (`followMeBroker`, default `wss://broker.emqx.io:8084/mqtt`) |
| Handshake privacy | The handshake messages are **AES-GCM encrypted** with a key derived from the code, as Follow me encrypts its fixes, so the public relay never sees LAN addresses in the clear |
| Data shape | The **same JSON** the bridge serves (`schema.json` fields: `latitude`, `longitude`, `altitude`, `heading`, `variation`, `ias`, …), one message per update |
| Rate | Pushed by the helper, **5 Hz** by default (`--rate`), instead of today's 1 Hz poll |
| In NavAid | One pipeline: the data-channel messages go through the **same "apply a simulator fix" code** as the HTTP poll, so the own-ship, alerts, recording, follow lock, screen-awake lock and status messages behave exactly as today |

## How it works

```
X-Plane ─► plugin / bridge   (http://127.0.0.1:2020, unchanged)
              ▲  reads locally, 5 Hz
        navaid-link helper ══════ WebRTC data channel, LAN ══════► NavAid (browser)
              │                                                       ▲
              └── offer/answer, encrypted, once ── Follow me relay ───┘
```

1. The pilot starts the helper on the simulator computer. It reads the local bridge, prints
   **`NavAid code: K7Q2-M9X4`**, and subscribes to that code's topic on the relay.
2. In NavAid → **Simulator** the pilot picks **Connect with a code** and types it.
3. NavAid creates an `RTCPeerConnection` with one data channel, makes an **offer**, encrypts it with
   the code's key, and publishes it to the code's topic.
4. The helper decrypts it, answers, and both sides exchange ICE candidates the same way. On a LAN
   the direct "host" candidates connect; no STUN/TURN server is needed.
5. The data channel opens: the helper pushes a JSON fix 5 times a second. The relay is no longer
   used. Closing the window, disconnecting, or the helper exiting ends the session.

## NavigationApp changes

**`io.js` — split the simulator pipeline**
- `_simFetch()` today both *gets* the bridge JSON and *applies* it. Split it into `_simApply(d)` —
  everything after the JSON is in hand: `simAircraft`, the Follow me feed, the own-ship and alerts,
  the recorded line while recording the simulator, the readout, the discontinuity check, the status —
  and a getter. The HTTP poll calls the getter then `_simApply`; the data channel calls
  `_simApply` per message. Behaviour of the HTTP path is unchanged; existing specs pin it.
- `simStart()` / `simStop()` take a *source*: `{ kind: 'http', url }` (today) or
  `{ kind: 'rtc', code }`. The connected state, the lit plane button, the toolbar disconnect,
  `navaid.simOn` and the reload resume work for both. A resumed RTC session needs the helper to
  still show the same code, so it resumes by re-running the handshake with the saved code.

**New `sim-link.js` — the WebRTC side (loaded in the second loader phase)**
- `simLinkConnect(code, onMessage, onState)`: derives the key, opens the relay client, creates the
  peer connection and data channel, runs the handshake, delivers messages, reports
  `connecting` / `connected` / `no data` / `failed`.
- Key: `PBKDF2(code, salt = 'navaid-simlink-v1', 200 000 iterations, SHA-256)` → AES-GCM 256.
  Topic: `navaid/simlink/v1/<SHA-256(code)[0..16]>` — the topic does not reveal the code.
- Relay client: the MQTT-over-WebSocket client inside `followme.js` (`mqttConnect`, the framing and
  the AES-GCM helpers) is factored into a small shared module, so Follow me and the simulator link
  use one implementation. Follow me's behaviour must not change; its specs are the guard.
- No STUN servers (`iceServers: []`): the link is LAN-only by design.
- Health: no message for 3 s → *No data* (the existing toast); the peer connection failing or closing
  → one automatic re-handshake, then *No data* until the pilot reconnects.

**The Simulator window (`index.html`, `ui.js`, `style.css`)**
- A second way in under the address field: **Connect with a code** — a code field (8 characters,
  grouped `XXXX-XXXX`, case-insensitive, no 0/O/1/I) and the same primary **Connect** button. The
  window closes on Connect as today.
- Help line by platform: in a browser, the code is suggested for another computer and the address for
  `localhost`; in the apps, both are offered (the address works there without a helper).
- EN + HE strings in `core.js` and `i18n/he/strings.js` (parity spec), `dir="ltr"` on the code field.

**Gist / tuning**
- `featureSimLink` (default **off** until it has been flown on the real setup), `simLinkRelay`
  (default: `followMeBroker`), `simLinkNoDataSec` (3).

## cvfr-bridge changes

**New `tools/navaid-link.py`** (Python 3.10+):
- Reads `http://127.0.0.1:2020/` (or `--bridge URL`) at `--rate` Hz; forwards each JSON unchanged.
- Generates the code (8 characters from a 32-letter alphabet ≈ 40 bits), prints it, and also writes
  it to the terminal title so it is visible over X-Plane.
- Signalling over the relay with the same key derivation and AES-GCM framing as NavAid
  (`--relay URL`).
- WebRTC: `aiortc` (data channel only). MQTT: `paho-mqtt` over WebSockets + TLS.
- One NavAid at a time per code (a second offer replaces the first); `--codes-file` optional to keep
  the same code across restarts, so a reload resumes.
- `requirements-navaid-link.txt`; a one-file Windows build (PyInstaller) later, not in this step.
- README section beside the existing backends, and the fake bridge as the way to try it without
  X-Plane: `python3 tools/cvfrmap-fake.py & python3 tools/navaid-link.py`.

No change to `c/plugin.c`, `python/cvfrmap-bridge.py` or `schema.json`.

## Security

- **Data path:** DTLS-encrypted by WebRTC; peers authenticate through the fingerprints carried in the
  (encrypted) handshake, so the relay cannot substitute itself.
- **Handshake:** encrypted with the code-derived key. A ~40-bit code with 200 000 PBKDF2 iterations
  makes an offline guess of a captured handshake slow, and what it would reveal is a LAN address and a
  position feed — the same exposure Follow me accepts.
- **Code lifetime:** the helper rotates the code on each start unless `--codes-file` keeps it; a
  handshake older than 2 minutes is ignored.
- **Nothing new runs in NavAid's origin from the relay:** messages are parsed as JSON and only the
  schema's numeric fields are used.

## Testing

**NavigationApp (Playwright, CI):**
- `_simApply` split: the existing simulator specs (`sim-footer`, `sim-connected-indicator`,
  recording, alerts, screen awake) pass unchanged over the HTTP path.
- Data-channel path with a **stubbed `RTCPeerConnection`** and a fake relay `WebSocket` (as the
  Follow me specs stub theirs): the handshake publishes an encrypted offer to the hashed topic;
  a stubbed answer opens the channel; messages drive `simAircraft` at 5 Hz; silence for 3 s gives
  *No data*; disconnect ends the session.
- The code field: grouping, case, rejected characters, EN/HE, phone and desktop.
- Follow me specs as the guard for the shared relay module.

**By hand (not possible in CI):** the real link, on one LAN — `fake-sim-bridge.py` + `navaid-link.py`
on one computer, NavAid in Chrome, Safari (macOS + iPad) and Firefox on another; then the same with
X-Plane and the C plugin. Check: connects by code, LAN-only (no traffic to the relay after the
handshake), 5 Hz movement, reconnect after Wi-Fi blips, guest Wi-Fi fails with a clear message.

**cvfr-bridge:** unit tests for the code alphabet, key derivation and AES-GCM framing against fixed
vectors shared with NavAid's spec, so both sides provably agree.

## Limits

- Needs **internet once per connection** for the handshake; the flight data stays on the LAN.
- Both computers on the **same network**, with devices allowed to talk to each other (guest Wi-Fi
  with client isolation blocks it; the window then says *Could not reach the simulator computer —
  are both on the same network?*).
- A new dependency on the simulator computer (`aiortc`), larger than the stdlib-only bridge.

## Not in this step

- Reading X-Plane's built-in "send to EFB apps" UDP broadcast — app-only, a separate design.
- WebRTC inside the C plugin.
- A TURN server for different networks (would put the data back on the internet).

## Order of work

1. **NavigationApp, PR 1:** split `_simFetch` into getter + `_simApply` (no behaviour change).
2. **NavigationApp, PR 2:** shared relay module out of `followme.js` (no behaviour change).
3. **cvfr-bridge PR:** `tools/navaid-link.py`, tested against the fake bridge.
4. **NavigationApp, PR 3:** `sim-link.js`, the code field, strings, specs, wiki — behind
   `featureSimLink`, off.
5. Fly it on the real setup; then switch `featureSimLink` on in the gist.
