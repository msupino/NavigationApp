# NavAid AI assistant (chat) — design

Status: v1 implemented (`docs/app/assistant.js`).

## Goal
A chat panel where a pilot asks in natural language to plan a route, find
NOTAMs, check weather, and look up airfields / VOR — answered by an LLM that
drives NavAid's existing functions.

## Key decisions
- **BYOK, provider-agnostic, Gemini free-tier default.** NavAid is a static
  GitHub Pages site with no backend, so the model runs in the browser with the
  user's own key. Default provider is Google Gemini (`gemini-2.5-flash`, free
  tier, function-calling). One `providerSend(messages)` seam keeps Claude/OpenAI
  or a future serverless proxy pluggable without touching the agent logic.
  Note: a Gmail account is not an API key — "sign in with Google, no key" would
  need OAuth + a server, which breaks static hosting; BYOK keeps the free key.
- **Full agent** (read + route mutation + outbound), rolled out read-first.
- **Tiered safety:**
  - *read* (free): `describe_route`, `find_point`, `get_airfield_info`,
    `get_vor_radial`, `get_notams`, `get_weather`.
  - *route* (apply immediately, Undo-able via the existing undo stack):
    `set_route`, `reverse_route`, `set_leg`.
  - *outbound* (explicit `confirm`): `save_route`.
- **Anti-hallucination (hard-baked):** the system prompt forbids inventing a
  NOTAM / weather value / frequency / coordinate; read tools return real feed
  data; every answer is a planning aid, verify against AIP/NOTAM/brief.

## Architecture
Self-contained IIFE module `docs/app/assistant.js`, loaded via the cache-busted
loader in `index.html`. Builds its own FAB + panel + settings in JS (only the
`<script>` tag is added to the page). Components:
1. **Provider adapter** — `geminiSend(messages)` → `generateContent` with
   `systemInstruction` + `functionDeclarations`; key/model in `localStorage`
   (`navaid.ai.key/provider/model`).
2. **Tool registry** — declarative `{name, description, parameters, tier, run}`;
   handlers call existing globals (`airfieldByIcao`, `findNavWpToken`,
   `vorByIdent`, `vorRadialDme`, `airfieldPrimaryText`, `activeNotams`/`notams`,
   `decodeNotam`, `state`/`syncLegs`/`draw`, `commitRoute`/`undo`,
   `routeLibrarySaveCurrent`, Open-Meteo for weather).
3. **Agent loop** — model → tool calls → handlers → results fed back → repeat,
   capped at 6 iterations, with inline activity lines.
4. **UI** — FAB (💬) bottom-inline-end; dockable panel (RTL-aware, i18n en+he);
   settings pane for the key + a "get a free Gemini key" link.

## Test seam
`NavAid.assistant._setProvider(fn)` swaps the provider for a scripted stub;
`_setConfirm(fn)` overrides the outbound confirm; `_tools` exposes handlers for
unit-level calls. `tests/assistant-chat.spec.js` covers the agent loop, each
tier, undo, unresolved-waypoint handling, NOTAM filtering, and the no-key path —
no real API calls.

## Not in v1 (future)
`export_png` / overlay-toggle tools; streaming responses; altitude-level winds;
METAR/TAF; a shared-key serverless proxy.
