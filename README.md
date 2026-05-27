# NavAid

Browser-based CVFR / Israel-area flight-route planner. Plain HTML +
CSS + JavaScript on top of Leaflet, no build step. Plot waypoints
on a slippy chart, label legs with altitude / speed / time, drop
free-text notes, and export the framed result as a high-resolution
PNG.

## Links

- **Live (production):** https://msupino.github.io/NavigationApp/
- **Live (staging):** https://msupino.github.io/NavigationApp/staging/
- **Repo:** https://github.com/msupino/NavigationApp
- **Wiki:** https://github.com/msupino/NavigationApp/wiki
- **App docs:** [`docs/README.md`](docs/README.md)

## Run locally

```bash
python3 -m http.server -d docs 8000
# http://localhost:8000
```

## License & data

NavAid (the source code) is released under the [MIT License](LICENSE) — do
whatever you want, no warranty, no liability.

Data layers retain their own terms: charts are © flight-maps.com / CAAI;
imagery is © Esri (World Imagery); map data is © OpenStreetMap contributors;
VFR reporting points are derived from the
[ForeFlight Israel Base Pack](https://www.foreflightisrael.xyz/) /
ICAO / CAAI public AIP data.

NavAid is a planning aid only and is not certified for primary navigation.

---

<div dir="rtl">

## עברית

**<bdi>NavAid</bdi>** — כלי לתכנון מסלולי טיסת <bdi>CVFR</bdi> באזור ישראל. פועל בדפדפן, ללא התקנה.

- **גרסה חיה:** <bdi>https://msupino.github.io/NavigationApp/</bdi>
- **גרסת בדיקות:** <bdi>https://msupino.github.io/NavigationApp/staging/</bdi>
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
