# Investigation: iOS foreground location permission

## Ticket context

- GitHub issue: #1963
- Branch: `codex/ios-location-permission`, derived from `origin/dev`
- Reported environment: physical iPad Air 2, iPadOS 15.8.8, installed bundle `org.supino.navaid`
- Observed behavior: NavAid is absent from **Settings > Privacy & Security > Location Services** and **Show location** produces no GPS position.
- Expected behavior: the installed iOS app requests foreground location access and displays the device position after access is allowed.

## Root cause

The iOS target's effective property list is the checked-in
`mobile/ios/App/App/Info.plist` (`INFOPLIST_FILE = App/Info.plist` in both Xcode
build configurations). That plist declares local-network access, but it does not
declare `NSLocationWhenInUseUsageDescription`.

The app nevertheless requests foreground location through the browser API:

- `docs/app/gps.js:gpsStartWatch()` calls
  `navigator.geolocation.watchPosition(...)` whenever the Android-only
  background-geolocation plugin is unavailable.
- `mobile/capacitor.config.json` deliberately excludes
  `@capacitor-community/background-geolocation` from `ios.includePlugins`, so
  the installed iOS shell necessarily follows that foreground WebKit
  geolocation path.
- `startLiveLocation()` and `startGpsRecording()` both reach `gpsStartWatch()`.

Apple requires a non-empty `NSLocationWhenInUseUsageDescription` purpose string
for an iOS app that accesses location while in use. Without the declaration,
the native bundle has no valid foreground-location permission contract, which
matches the physical-device evidence: the app does not appear in Location
Services and cannot deliver a fix. Apple documents the requirement at
<https://developer.apple.com/documentation/bundleresources/information-property-list/nslocationwheninuseusagedescription>.

This is not caused by the HTTPS remote-shell URL, the app-bound-domain setting,
the local-network permission, or the absence of the Android background plugin.
The app only claims foreground iOS location today; an Always/background purpose
string is neither required nor appropriate for this bug.

## Affected files and surface

- `mobile/ios/App/App/Info.plist` — missing foreground-location purpose key.
- `mobile/scripts/validate-capacitor.mjs` — validates iOS local-network privacy
  declarations but does not validate the foreground-location declaration.
- `tests/capacitor-mobile.spec.js` — wrapper contract coverage checks Android
  location permissions and iOS local-network access, but not iOS foreground
  location permission.
- `mobile/README.md` — says iOS background location is not enabled, but does not
  distinguish the supported foreground location permission from that deferred
  capability.
- `.ai/navaid-dev.md` — native packaging/GPS documentation should state the
  foreground iOS plist contract so later wrapper regeneration cannot remove it.

Bug surface: **frontend** (native iOS wrapper for the client application).

## Test Gap

The current wrapper contract has no assertion that the iOS plist contains a
non-empty `NSLocationWhenInUseUsageDescription`. Both existing native checks can
pass while producing an iOS bundle that cannot ask for location:

1. `tests/capacitor-mobile.spec.js` verifies Android location permissions and
   iOS local-network keys only.
2. `mobile/scripts/validate-capacitor.mjs`, run before every Capacitor sync,
   likewise accepts the incomplete plist.

A regression test should first assert a non-empty When-In-Use purpose string in
the checked-in plist and fail on the current branch. The sync-time validator
should enforce the same invariant so local native builds fail before Xcode.
Physical-device verification is still necessary after the static tests: install
the rebuilt bundle, start **Show location**, confirm the permission prompt, allow
access, confirm NavAid appears in Location Services, and confirm a position is
drawn. Static CI cannot exercise an iPad privacy database or GPS fix.

## Minimal fix shape

1. Add `NSLocationWhenInUseUsageDescription` with a concise, user-facing reason
   to `mobile/ios/App/App/Info.plist`.
2. Add matching assertions to `tests/capacitor-mobile.spec.js` and
   `mobile/scripts/validate-capacitor.mjs` so both CI and `npm run sync` prevent
   recurrence.
3. Clarify `mobile/README.md` and `.ai/navaid-dev.md`: foreground iOS location is
   supported through `navigator.geolocation`; background/lock-screen iOS
   tracking remains unsupported.
4. Run only the focused Capacitor wrapper test and `npm run validate`/`npm run
   sync` as appropriate, then build and install the signed app on the connected
   iPad for the permission-and-fix check.

No application JavaScript behavior change or new dependency is required.

## Deferrals / out of scope

- iOS background or lock-screen tracking (`UIBackgroundModes: location`, Always
  authorization, or a Capacitor 8-compatible background plugin).
- Android permission or background-service changes.
- Browser/PWA geolocation behavior.
- Simulator HTTP/local-network access.
- Native app icon refresh.

## Classification

- Tier: **lean**
- Confidence: **high**
- Reason: the physical-device symptom, plist contents, Xcode target wiring, and
  iOS runtime path agree on one missing mandatory declaration. The change is a
  small native metadata fix with direct static regression coverage and one
  physical-device verification step.
