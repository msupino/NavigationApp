# NavAid Mobile (Capacitor)

Native iOS and Android shell for NavAid. The released apps are the **embedded** build (below):
the web app is inside the package, so NavAid starts with no network, and each web deploy
reaches it as an update bundle on the next launch. Rebuild the native app only when the shell
itself changes: a Capacitor/plugin upgrade, manifest / permission changes, icons, or signing.
The committed `capacitor.config.json` is the **remote** development shell, which loads the
live site (`server.url = https://navaid.supino.org`).

Native bits baked into the shell:

- `@capacitor-community/background-geolocation` — Android foreground service
  so GPS track recording / live location keep running while the phone is
  locked (`docs/app/gps.js` falls back to plain `watchPosition` on the web).
  `capacitor.config.json` deliberately excludes it from `ios.includePlugins`:
  its Swift package targets Capacitor 7, while this shell and social login use
  Capacitor 8. iOS supports foreground location through `navigator.geolocation`
  while the app is in use; background or lock-screen tracking is not enabled.
- The iOS wrapper disables the idle timer while NavAid is active. This keeps the
  chart visible on older iPads that do not support the Web Screen Wake Lock API.
  Moving NavAid to the background restores the user's normal Auto-Lock behavior.
- Android manifest: fine/coarse location, `FOREGROUND_SERVICE(_LOCATION)`,
  `POST_NOTIFICATIONS`.
- `webDir` is the tiny `shell/` stub — packaged only so `cap sync` has a
  webDir; the real app always comes from the server URL.
- Offline: the production site's service worker gives the shell offline
  support after the first online launch, including the *Extra layers →
  Download charts for offline* tile packs.

## Two builds: remote and embedded

The **embedded** build is what ships: the APK and the App Store app. It packages the web app
and pinned Leaflet assets, so it starts with no network at all, and the APK also carries the
CVFR chart at z7-z12 (~1,500 tiles, ~32 MB, `scripts/bundle-charts.mjs`; fetched once into
the git-ignored `mobile/.chart-cache/`). On first launch those tiles are copied into the same
on-device store the offline download fills; z13 remains a Wi-Fi download. The **remote**
config above is the development shell and the one committed.

```sh
npm run bundle:check   # validate local assets and dependency integrity
npm run embed          # docs + vendor + CVFR tiles -> mobile/www, sync iOS and Android
npm run remote         # restore remote configuration and sync native projects
```

Building the APK (JDK 21):

```sh
npm run embed
cd android && JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64 ./gradlew assembleRelease
cd .. && node scripts/bundle-web.mjs --remote   # back to the committed config
```

Bump `versionCode` / `versionName` in `android/app/build.gradle` for every APK.

Embedded CVFR downloads use the existing Filesystem plugin and load directly into the map
and magnifier without a service worker. Plates remain online at the production BYOP URL.
**Android is served at `https://navaid.supino.org`** (`--android-hostname`, the last step of
`npm run embed`), not Capacitor's default `https://localhost`. The APK before 1.9 loaded the live
site, so a pilot's saved routes, recordings and settings live under that address, and a WebView
keeps each address's storage apart: 1.9.0, served at localhost, opened on an empty app. At that
address every WebView request is answered from the package, so the update manifest is read with
the native HTTP client and approach plates come from `raw.githubusercontent.com`. The embedded app
also unregisters the old APK's service worker. iOS stays at `capacitor://localhost` (its native
origin policy trusts only that), so shared route and follow-me links always name
`https://navaid.supino.org/`. After a bare `npx cap sync`, run
`node scripts/bundle-web.mjs --android-hostname` again.

**Updates without a new APK.** Every production deploy (`.github/workflows/deploy.yml`) runs
`scripts/build-ota.mjs` on the assembled site and publishes `/ota/navaid-1.0-<sha>.zip` and
`/ota/manifest.json`. `docs/app/ota.js` fetches the manifest on Wi-Fi, downloads and verifies
the zip, and installs it on the NEXT cold start -- never mid-flight -- rolling back if the new
bundle does not come up. Update zips carry the web app only, not the chart tiles. Native
changes (plugins, permissions) still need a new APK. For iOS, guideline 2.5.2 allows exactly
this for interpreted code.

See [appstore/README.md](appstore/README.md) for archive validation and device checks.

## First setup

```sh
cd mobile
npm install
npm run sync       # validates the config, then cap sync
```

## Android build

Prereqs: Android SDK at `~/Library/Android/sdk`, **JDK 21** (Capacitor 8
fails on older with `invalid source release: 21`; Homebrew:
`/opt/homebrew/opt/openjdk@21`).

The current package version is **1.23** (`versionCode 23`). Release tags use the
matching `android-vX.Y.Z` form. Publish a draft only after that version reaches `main`.

```sh
cd mobile/android
export JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home
export ANDROID_HOME="$HOME/Library/Android/sdk"

./gradlew assembleDebug     # -> app/build/outputs/apk/debug/app-debug.apk
./gradlew assembleRelease   # -> app/build/outputs/apk/release/app-release.apk (signed, below)
```

If Gradle can't find the SDK, put `sdk.dir=/Users/<you>/Library/Android/sdk`
in `mobile/android/local.properties` (gitignored).

### Release signing

`app/build.gradle` reads `mobile/android/keystore.properties` (gitignored):

```properties
storeFile=/absolute/path/to/your/navaid-release.jks
storePassword=…
keyAlias=navaid
keyPassword=…
```

Keep the keystore and its passwords outside the repository, preferably in a password
manager or protected signing service. Do not document maintainer-specific secret paths.
**Back the keystore up**: updates must be signed with the same key; losing it
means every phone must uninstall/reinstall. Without `keystore.properties`,
`assembleRelease` still builds, just unsigned (CI-safe). Debug builds use the
machine's throwaway `~/.android/debug.keystore` — a phone can't switch
between debug- and release-signed installs without uninstalling first.

### Ship a new APK

1. Bump `versionCode` (+1, integer) and `versionName` in `app/build.gradle`
   — Android refuses to update over an equal/lower `versionCode`.
2. `cd mobile && npm run sync && cd android && ./gradlew assembleRelease`
3. Verify the signature is the release key (not debug):
   `$ANDROID_HOME/build-tools/<ver>/apksigner verify --print-certs app/build/outputs/apk/release/app-release.apk`
4. Publish: `gh release create android-vX.Y.Z <apk> --title … --notes …`
   (replace an existing asset: `gh release upload <tag> <apk> --clobber`).

## iOS

The `ios/` project exists (bundle id `org.supino.navaid`). Building needs
Xcode + CocoaPods (`brew install cocoapods`) and an Apple ID in Xcode
(free = own-device installs that expire weekly; the $99/yr program adds
TestFlight/App Store). `Info.plist` lists `navaid.supino.org` under
`WKAppBoundDomains` so the site's service worker (offline + chart packs)
works inside WKWebView. The matching Capacitor
`ios.limitsNavigationsToAppBoundDomains` option must remain enabled; WebKit
otherwise rejects the native JavaScript bridge on the remote page. Foreground
**Show location** and GPS track recording use `navigator.geolocation` and the
when-in-use permission declared in `Info.plist`. Background location still needs
a compatible plugin, the `UIBackgroundModes: location` entitlement, and
additional usage metadata before lock-screen recording works there.

The native iOS and Android apps can poll an HTTP simulator bridge on the local
network. Those requests use Capacitor's native HTTP client instead of mixed-content
WebView fetch. iOS declares local-network access without disabling App Transport
Security globally; Android opts into cleartext transport in its manifest. Enter the
simulator computer's LAN address; `localhost` means the phone or tablet itself.

## Notes

- The web app detects the shell (`isNativeCapacitorShell()` in
  `docs/app/ui.js`) via the injected `window.Capacitor` bridge. No third-party
  analytics runtime is loaded. The service worker DOES register inside the
  remote-URL shell — offline depends on it; only the legacy local-origin
  (`app.navaid.local`) shell skips it.
- Contract tests: `tests/capacitor-mobile.spec.js` +
  `mobile/scripts/validate-capacitor.mjs` (run via `npm run sync`).
- Native checks: `cd android && ./gradlew testDebugUnitTest` validates Android
  discovery parsing. CI also compiles the iOS simulator app without code signing.
