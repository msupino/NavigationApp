# App Review notes

Paste into App Store Connect → App Review Information → Notes.

---

NavAid is a VFR flight-planning aid for pilots flying in Israeli airspace. Everything works with no
account and no sign-in. Google sign-in appears only in the saved-routes library ("Sync with Google Drive"), as an optional way to keep the
pilot's own routes in their own Google Drive; it creates no NavAid account and unlocks no feature.

**What to try**
1. The first launch shows a safety notice — NavAid is a planning aid and is not certified for
   navigation. Tap "I understand".
2. Type `LLHZ BAZRA DEROR SHARO HADRA FRDIS LLHA` in the search box at the top and press
   Return (or tap the map to place waypoints). A route is drawn with headings, distances and
   times. Tap a waypoint for its details.
3. Tap **Plan** (bottom bar) for the navigation log: headings, ETE, fuel and a terrain
   profile.
4. Tap **Location** to show your position on the chart; tap the accuracy line that appears
   for the GPS details, including the iPhone/iPad barometer (pressure altitude, vertical speed). Location and track recording ask
   for location permission when enabled. Declining leaves everything else
   working.
5. **Menu → Extra layers** turns on NOTAM, airspace, weather and traffic. These are fetched
   from public aviation feeds.

**Location**
Foreground only ("While Using the App"). It draws the aircraft on the chart and records a
track when the pilot starts a recording. There is no background location on iOS in this
build. Position sharing uploads only when the pilot starts a "Follow me" share, which publishes an
end-to-end encrypted position to a link the pilot chooses to send; the key travels only in
the link's fragment and is never sent to the relay.

**Data**
Charts are published by the Israeli CAA and hosted for the app. Weather comes from public
meteorological APIs; NOTAM from the published Israeli AIS feed; traffic from public ADS-B
feeds. None of it is user data.

**Safety**
The first-run notice, and Terms, both state that NavAid is not certified for navigation and
must not be used as a primary in-flight reference. The notice cannot be dismissed except by
acknowledging it.

**Embedded build and offline use**
The app, its map libraries and the CVFR chart (zooms 7–12) are inside the app: turn on
Airplane Mode and relaunch, and the chart, the saved route and planning all work. The closer
zoom (13) can be downloaded in Charts for offline use. Other chart layers, plates, weather, NOTAM, traffic, and sharing require a connection.
Files leave the app through the native share sheet. The native simulator discovery action
can connect to a compatible X-Plane bridge on the same Wi-Fi network.

**Native features**
GPS position and track recording, the barometer (CoreMotion), offline chart storage, spoken and
local-notification in-flight alerts, the native share sheet for exports, and Wi-Fi discovery of a
flight-simulator bridge.

**Content rights**
CVFR and AIP chart material is published by the Civil Aviation Authority of Israel.
[Before submitting: state the permission you hold to distribute the bundled chart, or attach it
under App Review Information → Attachment.]
