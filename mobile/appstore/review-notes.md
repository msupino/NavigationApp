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
4. Tap **Location**
"While Using the App" only. It draws the aircraft on the chart and records the flight track.
While the pilot has a recording or the live position on, it keeps running with the screen
locked (background mode "location", with the blue location indicator), so a track is not lost
when the phone is put away in flight; turning the position off stops it. Position sharing
uploads only when the pilot starts a "Follow me" share, which publishes an end-to-end
encrypted position to a link the pilot chooses to send; the key travels only in the link's
fragment and is never sent to the relay.

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
