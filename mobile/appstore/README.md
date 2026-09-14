# App Store submission

Build the App Store release and its TestFlight candidate in **embedded** mode. Android
and development installs may use the remote shell. Test the same build that will be submitted.

```sh
cd mobile
npm ci
npm run bundle:check
npm run embed                    # bundle docs + pinned vendor assets; sync iOS only
# Archive in Xcode, validate, and upload the archive to App Store Connect.
node scripts/verify-ios-app.mjs /path/to/NavAid.xcarchive/Products/Applications/App.app
npm run remote                   # restore the remote development configuration
```

`mobile/www/` is generated. `mobile/vendor/` contains the existing pinned Leaflet libraries,
CSS, images, and upstream license notices. Bundling verifies their SHA-384 hashes against
the manifest and web dependency pins, then rewrites only the generated HTML to local URLs.
`docs/index.html` keeps its CDN URLs and `?v=src` placeholders for Pages.

The embedded app uses the Filesystem plugin to store downloaded CVFR tiles in
`LIBRARY_NO_CLOUD/navaid-tiles-v1`. The map and magnifier read those files directly;
they do not need a service worker. Downloaded tiles are audited on launch. Other chart
layers, airfield plates, and live aviation feeds require a connection. Plates resolve to
`https://navaid.supino.org/byop/` because the large plate collection is not bundled.
The app's JavaScript changes only with a new binary; online aviation data can refresh.

## Submission checks

- [ ] Archive with Xcode 26 or later and the iOS 26 SDK or later; verify Apple's current
      [minimum SDK requirements](https://developer.apple.com/news/upcoming-requirements/).
- [ ] Set the version/build number and distribution signing for this submission.
- [ ] Run `verify-ios-app.mjs` against the archive's app, including its privacy manifest.
- [ ] Test the embedded build on iPhone and iPad: fresh launch, location allowed/denied,
      route creation/save/import/export, plates, optional Drive connection, and simulator discovery.
- [ ] Download CVFR until the app reports ready, terminate it, enable airplane mode,
      relaunch, and verify the route, map, and magnifier. Repeat after a build upgrade.
- [ ] Produce screenshots (`node scripts/appstore-screenshots.mjs`), compare them with
      the native release UI, and upload the final iPhone/iPad screenshots.
- [ ] Audit App Privacy answers against actual app and SDK data flows, including optional
      Google Drive and Follow Me. Reconcile the manifest and privacy policy with those answers.
- [ ] Confirm privacy URL `https://navaid.supino.org/privacy.html` and support URL
      `https://navaid.supino.org/about.html` are live and accurate.
- [ ] Confirm export-compliance answers; `ITSAppUsesNonExemptEncryption` is currently false.
- [ ] Paste the review notes, complete the age-rating questionnaire, and select Navigation.
- [ ] Confirm rights to distribute bundled libraries and aviation content.

CI compiles both the remote shell and an unsigned embedded Release simulator app, exercises
the native discovery origin policy, and verifies the built resources. It does not replace
signed-archive validation, physical-device testing, or App Store Connect setup.

## Review guidelines

Bundling provides a self-contained app shell; it does **not** guarantee acceptance under
[guideline 4.2](https://developer.apple.com/app-store/review/guidelines/#minimum-functionality).
Review evaluates the app's usefulness and experience, including its interactive flight
planning, location, native export, and offline functionality. Guideline 2.5.2 also addresses
code that introduces or changes functionality. Describe and test the actual submitted build.
