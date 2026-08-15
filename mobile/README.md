# NavAid Mobile (Capacitor)

Native iOS and Android shell for NavAid. The WebView loads the **live site**
(`capacitor.config.json` → `server.url = https://navaid.supino.org`), so the
installed app **updates itself with every web deploy** — rebuild the native
app only when the shell itself changes: a Capacitor/plugin upgrade, manifest /
permission changes, `capacitor.config.json`, icons, or signing.

Native bits baked into the shell:

- `@capacitor-community/background-geolocation` — Android foreground service
  so GPS track recording / live location keep running while the phone is
  locked (`docs/app/gps.js` falls back to plain `watchPosition` on the web).
  `capacitor.config.json` deliberately excludes it from `ios.includePlugins`:
  its Swift package targets Capacitor 7, while this shell and social login use
  Capacitor 8. iOS background location is not enabled or advertised yet.
- Android manifest: fine/coarse location, `FOREGROUND_SERVICE(_LOCATION)`,
  `POST_NOTIFICATIONS`.
- `webDir` is the tiny `shell/` stub — packaged only so `cap sync` has a
  webDir; the real app always comes from the server URL.
- Offline: the production site's service worker gives the shell offline
  support after the first online launch, including the *Extra layers →
  Download charts for offline* tile packs.

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

The current package version is **1.5** (`versionCode 5`). Its
`android-v1.5.0` GitHub release remains a draft until this PR reaches production.

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
storeFile=/Users/marco/keystores/navaid-release.jks
storePassword=…
keyAlias=navaid
keyPassword=…
```

The keystore lives at `~/keystores/navaid-release.jks` (password in
`~/keystores/navaid-release-password.txt` — move it to a password manager).
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
otherwise rejects the native JavaScript bridge on the remote page. Background
location on iOS still needs the
`UIBackgroundModes: location` entitlement + usage strings before lock-screen
recording works there.

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
