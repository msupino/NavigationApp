# NavAid — HTML5

Browser-based CVFR / Israel-area flight-route planner. Plain HTML +
CSS + JavaScript on top of Leaflet, no build step.

- **Live (production):** https://msupino.github.io/NavigationApp/
- **Live (staging):** https://msupino.github.io/NavigationApp/staging/

## Run locally

Serve the folder so Leaflet's CDN tiles load over HTTPS:

```bash
python3 -m http.server -d docs 8000
# http://localhost:8000
```

## Use

The toolbar is a vertical column with a `⋯` grip on top — drag it
anywhere on screen (its position is remembered).

- **Add Waypoint** — click the map to drop a waypoint; legs connect
  them. With no mode active, click / drag an existing waypoint or leg
  to select and edit it.
- **Add Note** — drop a free-text annotation box at the click point;
  pick a colour for it in the inspector.
- **Reverse Route** — invert the route, swapping each leg's altitude
  pair and rotating waypoint name text 180° so the chart turned around
  still reads upright.
- **Clear map** — remove all waypoints + notes (with confirm).
- **Save / Load** — JSON file with the full route + notes.
- **Fit** — frame the route in view.
- **📋 Plan** — open a modal with a per-leg flight plan table
  (From, To, Hdg, Dist, Speed, Alt, Time, totals).
- **Show return path** — render the outbound (return-direction)
  marker.
- **Show leg dist** — yellow distance badge in the middle of each
  leg.
- **Highlight diff** — purple halo on legs whose altitude differs
  from the adjacent leg, marking the climb / descent point.
- **Show Nav Waypoints** (default on) — overlays 238 published
  Israeli VFR reporting points; the 5-letter ID labels appear at
  higher zoom.
- **Transparency** slider — opacity of every label background.
- **Text size** slider — waypoint name / number font + circle size.
- **Mag var** — magnetic variation in the "value added to true"
  convention (Israel ≈ −5, shown as `(5°E)` next to the input).
- **A3 / A4** — show a print-frame rectangle at 1:250 000; clicking
  the same button again clears it. A modal asks Landscape vs
  Portrait.
- **⬇ Save PNG** — exports the framed map + route as a high-resolution
  PNG, rendered at the highest practical native tile zoom. Tiles
  are pulled through `images.weserv.nl` so the export canvas stays
  CORS-clean.

Click a waypoint to open the inspector — the title doubles as the
editable name. If a name is set it's drawn inside the circle
(replacing the sequence number). Editing a leg's altitude
propagates along the same cruise level until a different altitude
already exists.

## Map layers

CVFR · Nav · Low Altitude · Helicopters · Satellite (Esri) · OSM.
Selected base layer is remembered across reloads.

## Storage

Route, notes, current view, label opacity, text size, magnetic
variation, toolbar position, base layer, and the nav-waypoints
toggle are all kept in `localStorage` (under the `navaid.*` prefix)
so a reload picks up where you left off.

## License & data

NavAid (the source code) is released under the [MIT License](../LICENSE) —
do whatever you want, no warranty, no liability.

Charts are © flight-maps.com / CAAI — public deploys need permission.
Imagery: © Esri (World Imagery). Map data: © OpenStreetMap
contributors. VFR reporting points: ICAO/CAAI public AIP data.

NavAid is a planning aid only and is not certified for primary navigation.

---

<div dir="rtl">

## עברית

**<bdi>NavAid</bdi>** — כלי לתכנון מסלולי טיסת <bdi>CVFR</bdi> באזור ישראל. פועל בדפדפן, ללא התקנה.

- **גרסה חיה:** <bdi>https://msupino.github.io/NavigationApp/</bdi>
- **הוספת נקודת ציון** — לחיצה על המפה מוסיפה נקודה; הקטעים מתחברים אוטומטית.
  לחיצה או גרירה של נקודה או קטע קיימים פותחת אותם לעריכה.
- **הוספת הערה** — תיבת טקסט חופשי על המפה, עם בחירת צבע.
- **היפוך מסלול** — היפוך כיוון הטיסה.
- **שמירה / טעינה** — קובץ <bdi>JSON</bdi> עם המסלול וההערות.
- **נקודות ניווט** — שכבת נקודות הדיווח (<bdi>VFR</bdi>) המפורסמות בישראל.
- **תוכנית טיסה** — טבלה עם כיוון, מרחק, מהירות, גובה וזמן לכל קטע.
- **הדפסה / ייצוא <bdi>PNG</bdi>** — שמירת המפה והמסלול כתמונה ברזולוציה גבוהה (<bdi>A3 / A4</bdi>).

המסלול והתצוגה נשמרים בדפדפן — רענון הדף משחזר את העבודה האחרונה.

מפות תעופה: © <bdi>flight-maps.com</bdi> / רת"א — לשימוש אישי.

</div>
