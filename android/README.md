# NavAid Android (Capacitor)

Capacitor 8 shell around the web app. The WebView loads the **live site**
(`https://navaid.supino.org`, see `../capacitor.config.json` → `server.url`),
so the installed APK updates itself with every web deploy — **rebuild the APK
only when the native shell changes**: a Capacitor/plugin upgrade, manifest /
permission changes, `capacitor.config.json`, app icon/name, or signing.

Native bits baked into the shell:

- `@capacitor-community/background-geolocation` — foreground service so GPS
  track recording / live location keep running while the phone is locked
  (`docs/app/gps.js` falls back to plain `watchPosition` on the web).
- Manifest permissions: fine/coarse location, `FOREGROUND_SERVICE(_LOCATION)`,
  `POST_NOTIFICATIONS`.
- `webDir` is `../mobile-shell/` — a stub page; the real app comes from the
  server URL. Don't point it back at `docs/` unless you want a 90 MB static
  APK that no longer self-updates.

## Prerequisites (this machine already has them)

- Android SDK at `~/Library/Android/sdk` (platforms 36+, build-tools 35+)
- JDK **21** — Capacitor 8 needs it; Java 18 fails with
  `invalid source release: 21`. Homebrew: `/opt/homebrew/opt/openjdk@21`
- Node + the repo's `npm install` (`@capacitor/{core,cli,android}` are dev deps)

## Build

```sh
# from the repo root — only needed if capacitor.config.json or plugins changed:
npx cap sync android

cd android
export JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home
export ANDROID_HOME="$HOME/Library/Android/sdk"

./gradlew assembleDebug     # -> app/build/outputs/apk/debug/app-debug.apk
./gradlew assembleRelease   # -> app/build/outputs/apk/release/app-release.apk (signed, see below)
```

If Gradle can't find the SDK, `local.properties` (gitignored) needs
`sdk.dir=/Users/<you>/Library/Android/sdk`.

## Release signing

`app/build.gradle` reads `android/keystore.properties` (gitignored):

```properties
storeFile=/Users/marco/keystores/navaid-release.jks
storePassword=…
keyAlias=navaid
keyPassword=…
```

The keystore lives at `~/keystores/navaid-release.jks` with its password in
`~/keystores/navaid-release-password.txt` (move it to a password manager).
**Back the keystore up** — updates must be signed with the same key; losing it
means every phone must uninstall/reinstall. Without `keystore.properties`,
`assembleRelease` still builds but unsigned (CI-safe).

Debug builds use the machine's throwaway `~/.android/debug.keystore` — fine
for local testing, but a phone can't switch between debug- and release-signed
installs without uninstalling first.

## Ship a new APK

1. Bump `versionCode` (+1, integer) and `versionName` in `app/build.gradle` —
   Android refuses to update over an equal/lower `versionCode`.
2. `npx cap sync android && ./gradlew assembleRelease`
3. Verify the signature is the release key (not debug):
   `$ANDROID_HOME/build-tools/<ver>/apksigner verify --print-certs app/build/outputs/apk/release/app-release.apk`
4. Publish: `gh release create android-vX.Y.Z app-release.apk --title … --notes …`
   (existing releases: `gh release upload <tag> <apk> --clobber`).
