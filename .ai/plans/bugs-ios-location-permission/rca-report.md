---
status: draft
---

# RCA — ios-location-permission: iOS app does not request location permission

**Tier**: lean · **Confidence**: HIGH · **Service(s)**: NavAid iOS wrapper

## What's happening

The installed iOS app never registers for foreground location access, so NavAid is absent from iOS Location Services and **Show location** cannot display a GPS fix. The connected iPad confirms the symptom.

## Root cause

`mobile/ios/App/App/Info.plist:27-34` declares local-network access but omits Apple's required `NSLocationWhenInUseUsageDescription`. The existing GPS action reaches `navigator.geolocation` through `docs/app/gps.js:337-378`, while both native checks accept the incomplete plist.

## Design system

### What this change touches

The change is confined to native permission metadata, native wrapper validation, contract coverage, and documentation. It does not alter an application-rendered component or layout.

### What the app already ships

The existing **Show location** action and GPS rendering path remain unchanged.

### What binds

No design-system obligation applies because the fix adds no application UI.

### Unclear

NavAid is not registered in the design-intelligence product resolver, which only identifies DAP and Cyber products. This does not change the code-walk result because the fix adds no application UI.

**Grounded by**: code walk (native plist and validation to the existing GPS action) · KB (unavailable — no NavAid product profile) · DS MCP (unavailable — no NavAid product profile)

## Suggested fix

- `mobile/ios/App/App/Info.plist` — add a concise, non-empty foreground-location purpose string.
- `mobile/scripts/validate-capacitor.mjs` — reject a missing or empty iOS foreground-location declaration before native sync/build.
- `tests/capacitor-mobile.spec.js` — keep the committed red contract regression and turn it green.
- `mobile/README.md` and `.ai/navaid-dev.md` — distinguish supported foreground iOS location from deferred background/lock-screen tracking.

**Expected shape**: 5 files, ~30 changed lines · extend the existing plist, validator, wrapper contract test, and two native documentation sources · new test files: 0

## Failing test (written, red)

`tests/capacitor-mobile.spec.js` — `declares foreground location access for iOS` (contract) requires a non-empty `NSLocationWhenInUseUsageDescription`. Current result: 1 failed, 6 passed because the key is missing.

## Verification plan

- Contract: focused `tests/capacitor-mobile.spec.js` passes.
- Native validation: `npm run validate` and `plutil -lint` pass; run Capacitor sync to verify generated native inputs.
- iOS build: build the branch with the existing development team/profile and install it on the connected iPad.
- Physical device: start **Show location**, allow the prompt, confirm NavAid appears in Location Services, and confirm a position is drawn.
- New executables: none.

## Deferred / follow-ups

- iOS background or lock-screen tracking remains unsupported because it requires a separate entitlement/plugin decision.
- Native app icon refresh is unrelated and remains out of scope.
- Android and browser/PWA geolocation behavior do not change.
