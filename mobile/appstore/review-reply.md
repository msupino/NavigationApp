# Reply to App Review: Guideline 2.1 – Information Needed

Paste the section below the line as the reply in App Store Connect (Resolution Center), (no recording attached yet: item 1 asks App Review whether an iPad Simulator recording will do), and paste the same text into App Review Information → Notes.

App Store Connect takes at most 4000 characters here; the text below is 3,662. Plain text:
no markdown, the field does not render it.

---

Thank you for reviewing NavAid. The requested information follows.

1. Screen recording
We do not have a physical iPad available at the moment. Would a screen recording made in the Xcode iPad Simulator, running the current iPadOS with the same build, be acceptable? If so, we will send it right away; if you need one from a physical iPad, we will record it on a device as soon as one is available.
The recording will show launch and the safety notice, building a route, waypoint details, the navigation log, the route check, map layers and weather, the GPS position, and the app working with no network (the CVFR chart is built in). NavAid has no account or login, no user-generated content shared with others, and no paid content or In-App Purchases.

2. Purpose and audience
A VFR flight-planning and navigation aid for private and student pilots flying light aircraft in Israel. The pilot draws a route on the official Israeli VFR chart and gets per-leg heading, distance, time, fuel and altitude, radio frequency changes, a printable navigation log, and a pre-flight check against airspace, NOTAMs, SIGMET/AIRMET and forecast weather. In flight it shows the GPS position on the chart with spoken and on-screen alerts, and works offline. It is a planning aid, not certified for primary navigation; the app says so at every launch.

3. How to use it (no login or sample files needed)
1. Launch and tap "I understand" on the safety notice.
2. Tap Menu (bottom bar), type LLHZ BAZRA DEROR SHARO HADRA FRDIS LLHA in the search box and press Return, or tap the map to place waypoints.
3. Tap a waypoint for details; tap Plan (bottom bar) for the navigation log.
4. The tick button on the left runs the route check; the layers button above it switches charts and turns on weather, NOTAM and airspace layers.
5. Tap Location (bottom bar) for the device's position. Declining the permission leaves everything else working.
6. Turn on Airplane Mode and relaunch: the chart, route and planning still work.

4. External services
- Charts: Civil Aviation Authority of Israel (CAAI) VFR charts (flight-maps.com) from our own tile mirror (navaid-tiles.supino.org); OpenFlightMaps; OpenStreetMap; Esri World Imagery.
- Data: Israeli AIS NOTAMs; IMS SIGMET/AIRMET and charts; METAR/TAF, via our public data files (raw.githubusercontent.com); Open-Meteo forecasts.
- Traffic (optional): adsb.lol public ADS-B feed.
- App updates: verified web-content updates from navaid.supino.org, applied at next launch.
- Optional, user-initiated: Google Sign-In / Drive to keep the pilot's own routes in their own Drive (no NavAid account); "Follow me" end-to-end encrypted position sharing via a public MQTT relay (broker.emqx.io); an AI assistant using the pilot's own API key (Anthropic, Google Gemini, DeepSeek, OpenRouter or OrcaRouter), off without a key.
- No analytics or advertising SDKs.

5. Regional differences
The app works the same in every region. Its aviation content covers Israel, its intended area of use; OpenFlightMaps adds some European charts. The interface is in English and Hebrew.

6. Regulated / third-party material
NavAid is a pilot's planning aid, not a certified avionics or air-navigation service, and makes no regulatory claim. The VFR charts are aeronautical information published publicly by the Civil Aviation Authority of Israel (CAAI), and are shown with attribution to the CAAI and flight-maps.com. The operator of flight-maps.com, which serves these charts, has told us in writing that he has no objection to NavAid using them. OpenStreetMap (ODbL), OpenFlightMaps and Esri imagery are used under their published terms, with attribution on the map.
