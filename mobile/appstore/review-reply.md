# Reply to App Review: Guideline 2.1 – Information Needed

Paste the section below the line as the reply in App Store Connect (Resolution Center), attach
the screen recording, and paste the same text into App Review Information → Notes.

---

Thank you for reviewing NavAid. The requested information follows; a screen recording from a
physical iPad on the current iPadOS is attached.

**1. Screen recording**
Attached. It starts at launch and shows the safety notice, building a route, the waypoint
details, the navigation log (flight plan), the route check, the map layers and weather, the live
GPS position, and the app working with Airplane Mode on (the CVFR chart is built into the app).
NavAid has no account registration or login, no user-generated content shared with other users,
and no paid content or In-App Purchases.

**2. Purpose and audience**
NavAid is a VFR (visual flight rules) flight-planning and navigation aid for private and
student pilots flying light aircraft in Israel. A pilot draws a route on the official Israeli
VFR chart and gets, per leg, the magnetic heading, distance, time, fuel and altitude, the radio
frequency changes and the reporting points; a printable navigation log; and a pre-flight check
of the route against airspace, NOTAMs, SIGMET/AIRMET and the weather at the planned time. In
flight it shows the aircraft's GPS position on the chart and gives spoken and on-screen alerts.
It replaces paper charts, a plotter and a whiteboard with one tool that works offline in the
cockpit. It is a planning aid and is not certified for primary navigation; the app says so at
every launch.

**3. How to use it (no login, no sample files needed)**
1. Launch, read the safety notice and tap "I understand".
2. Type `LLHZ BAZRA DEROR SHARO HADRA FRDIS LLHA` in the search box at the top and press Return,
   or tap the map to place waypoints. The route appears with headings, times and fuel.
3. Tap a waypoint for its details; tap Plan (bottom bar) for the navigation log.
4. The tick button on the left runs the route check; the layers button above it switches the
   chart and turns on weather, NOTAM and airspace layers.
5. Tap Location to show the device's position (location permission is asked then; declining
   leaves everything else working).
6. Turn on Airplane Mode and relaunch: the chart, the route and planning still work.

**4. External services**
- Aeronautical charts: Civil Aviation Authority of Israel (CAAI) VFR charts (flight-maps.com),
  served from our own tile mirror (navaid-tiles.supino.org); OpenFlightMaps; OpenStreetMap;
  Esri World Imagery (satellite).
- Aviation and weather data: Israeli AIS NOTAMs, IMS (Israel Meteorological Service) SIGMET /
  AIRMET and charts, METAR/TAF, collected into our public data files (raw.githubusercontent.com);
  Open-Meteo (forecast wind, temperature, dew point, pressure).
- Traffic (optional layer): adsb.lol public ADS-B feed.
- App updates: web-content updates from navaid.supino.org, verified, applied at the next launch.
- Optional, user-initiated only:
  - Google Sign-In / Google Drive, to keep the pilot's own routes in their own Drive (no NavAid
    account is created);
  - "Follow me" position sharing: an end-to-end encrypted position through a public MQTT relay
    (broker.emqx.io) to a link the pilot sends;
  - an AI assistant using the pilot's own API key, entered by the pilot, for one of Anthropic,
    Google Gemini, DeepSeek, OpenRouter or OrcaRouter. Without a key the assistant is off.
- No analytics or advertising SDKs in the app.

**5. Regional differences**
The app works the same in every region. Its aviation content — charts, NOTAMs, airspace,
airfields — covers Israel, its intended area of use; OpenFlightMaps adds charts for some European
regions. The interface is in English and Hebrew.

**6. Regulated / third-party material**
NavAid is a pilot's planning aid, not a certified avionics or air-navigation service, and makes
no regulatory claim. Third-party material: [state here the permission you hold from the CAAI /
flight-maps.com to distribute the VFR chart, and attach it]. OpenStreetMap (ODbL),
OpenFlightMaps and Esri imagery are used under their published terms, with attribution shown
on the map.
