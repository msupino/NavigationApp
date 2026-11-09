# NavAid on the wrist — Wear OS companion

Date: 2026-11-09. Status: design, not built.

## Intent

A pilot flying with NavAid has the phone on a kneeboard or a mount. The watch is the one screen
that is always in view, with both hands busy. The watch answers one question in one glance:
**where am I going next, and when do I get there?**

The in-flight alerts already reach a paired watch today. The phone posts them on the high-importance
"Flight alerts" channel (`gps.js` `gpsSendWatchAlert`), and Wear OS mirrors and buzzes them. This
project adds the **glanceable live picture** that notifications cannot give.

## Goals

1. **Watch app screen:** next waypoint, magnetic bearing and distance to it, ETE and ETA, time on
   this leg, ground speed, altitude (with the leg's planned altitude beside it).
2. **Tile** (swipe from the watch face): the same, compact.
3. **Complication** for any watch face: next waypoint + ETE (short text), and waypoint + ETA
   (long text).
4. Live from the phone, every 2 s or so. The watch shows plainly when the picture is old or gone,
   and never shows a frozen value as current.
5. Hebrew and English, from the watch's language. Waypoint names are sent as the phone shows them.

## Non-goals

- Controls on the watch (start recording, ack, next leg). Possibly a later step.
- Navigating from the watch's own GPS, or drawing a chart on the watch.
- watchOS (Apple Watch). That would be a separate project on the iOS app.
- Changing the alerts. They already reach the watch.

## Anti-goals (it fails even if it works, if…)

- …a stale number looks live. Every value is stamped with its fix time; past 10 s the screen
  greys and says how old it is, and past 60 s it says "No data from phone".
- …it drains the phone or the watch. Send only on change and at most every 2 s; nothing when no
  watch is connected or when location is off.
- …it shows a different number from the phone. The watch computes nothing navigational: the phone
  sends finished figures (same `geo`, `toMagnetic`, leg index as the app). The only watch-side
  arithmetic is the clock: "leg timer = now − legStart" and "age = now − fixTime".

## How it is built (decided)

**Watch module.** `mobile/android/wear`, a second Gradle module beside `:app`.
- Kotlin, Compose for Wear OS (Material 3), Tiles (`androidx.wear.tiles` / ProtoLayout), and a
  complication data source (`androidx.wear.watchface.complications.datasource`).
- `minSdk 30` (Wear OS 3+: Galaxy Watch 4 and later, Pixel Watch).
- Same `applicationId` (`org.supino.navaid`) and the **same signing key** as the phone app. The
  Wearable Data Layer only connects apps that match on both.
- The root build gains the Kotlin Gradle plugin; `:app` stays Java and is otherwise untouched.

**Phone side.**
- `WearBridgePlugin.java`, a Capacitor plugin beside `Gdl90Plugin.java`, using
  `com.google.android.gms:play-services-wearable`.
  - `publish({ json })` writes one DataItem at `/navaid/nav` (`setUrgent()`): a single latest-state
    item, so a watch that connects late gets the current picture at once.
  - `clear()` deletes it.
  - `nodes()` returns the connected watches, so the web side skips work when there are none.
- `docs/app/wear.js` (new) builds the payload from the live state and calls the plugin. It does
  nothing outside the Android app.
  - **Inputs:** `gpsOwn`, `gpsAlertLegIndex`, `gpsRouteUnknown`, `gpsLastGS`, `gpsLastAlt`,
    `state.waypoints`, `state.legs`, `geo`, `toMagnetic`, `gpsPlaceLabel`.
  - **When:** hooked where the readout updates (`gpsUpdateReadout`), throttled, and sent only
    when a rounded field changed.

**Payload v1** (JSON, all optional except `v` and `t`):

```json
{ "v": 1, "t": 1762689600000, "live": true, "offRoute": false,
  "wp": "SHARO", "wpIdx": 3, "wpCount": 7,
  "brgMag": 47, "distNm": 6.4, "eteSec": 263, "etaUtc": 1762689863000,
  "legStart": 1762689410000, "gsKt": 88, "altFt": 2480, "altPlanFt": 2500,
  "dest": "LLHZ", "destNm": 31.2 }
```

- **ETE:** distance over the **actual** ground speed. On the watch it is labelled ETE, not
  "planned", because it is what this flight is doing.
- **Leg timer:** the phone records the time `gpsAlertLegIndex` last changed.
- **`offRoute`:** the watch says "Off route" in place of the waypoint (the same state as the
  phone's off-route alert).

**Settings.**
- `featureWear` (gist, **default on in code**, matching the rule just applied to the ATC radio).
  It is the switch for the bridge and costs nothing without a watch.
- `wearSendSec` (2) and `wearStaleSec` (10) are gist settings. The watch's stale thresholds
  arrive in the payload, so the gist governs them too.

**Watch screen layout** (round, 1 glance):

```
        SHARO  3/7            ← next waypoint, leg of
     047°   6.4 nm            ← bearing (mag), distance — largest
   ETE 4:23   ETA 12:47Z      ← times, Zulu like the app
   leg 7:10                   ← time on this leg
   88 kt    2480 / 2500 ft    ← GS, alt / planned
```

Grey and "12 s old" when stale. Large type, high contrast, dark background (as Wear OS requires).

## Delivery

- **CI:** `native-android` also runs `./gradlew :wear:assembleDebug :wear:testDebugUnitTest`.
- **Release:**
  - `./gradlew :wear:assembleRelease` with the same keystore, attached to the same GitHub release
    as `navaid-wear-<version>.apk` (the curl upload path, then verify).
  - Installed on the watch by `adb` over Wi-Fi (Wear OS developer options). The steps go in the
    wiki in both languages.
- **Tests:**
  - Playwright for `wear.js` with a stubbed `Capacitor.Plugins.WearBridge`: the payload fields, the
    throttle, send-on-change, nothing when there are no nodes, `offRoute`, stale `t`.
  - JVM unit tests on the watch side: payload parsing, the stale rules and time formatting.

## Left to the builder

- Exact Compose / Tiles / complication library versions (current stable at build time).
- The watch launcher icon (from the app's icon).
- Tile refresh: request on DataItem change, with a fallback freshness interval.

## Decided with Marco

- **Test watch:** Pixel Watch 5 (current Wear OS; well above the API 30 minimum).
- **Distribution (my call, Marco can change it):** the watch APK is attached to the GitHub
  release beside the phone APK and installed over Wi-Fi with `adb`, as the phone APK ships today.
  A Play Store listing can come later.
