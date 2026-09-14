# App Review notes

Paste into App Store Connect → App Review Information → Notes.

---

NavAid is a VFR flight-planning aid for pilots flying in Israeli airspace. Core planning needs no account and no
sign-in. Optional Google Drive sync requires connecting a Google account.

**What to try**
1. The first launch shows a safety notice — NavAid is a planning aid and is not certified for
   navigation. Tap "I understand".
2. Tap the map twice to place two waypoints. A route is drawn with headings, distances and
   times.
3. Tap **Plan** (bottom bar) for the navigation log: headings, ETE, fuel and a terrain
   profile.
4. Tap **Location** to show your position on the chart. Location and track recording ask
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
The app shell and its Leaflet dependencies are bundled. In Charts, download CVFR until the
status reads ready, then relaunch without a connection to use the downloaded chart and saved
route. Other chart layers, plates, weather, NOTAM, traffic, and sharing require a connection.
Files leave the app through the native share sheet. The native simulator discovery action
can connect to a compatible X-Plane bridge on the same Wi-Fi network.
