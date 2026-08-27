---
status: approved
---

# RCA — ios-location-permission: iOS app does not request location permission

**Tier**: lean · **Confidence**: HIGH · **Service(s)**: NavAid iOS wrapper

## What's happening

Before the fix, the installed iOS app never registered for foreground location access. NavAid was absent from iOS Location Services, and **Show location** could not display a GPS fix.

## Root cause

The checked-in iOS `Info.plist` declared local-network access but omitted Apple's required `NSLocationWhenInUseUsageDescription`. The existing `gpsStartWatch()` path reaches `navigator.geolocation`, while both native checks accepted the incomplete plist.

## Design system

### What this change touches

The change is confined to native permission metadata, native wrapper validation, contract coverage, and documentation. It does not alter an application-rendered component or layout.

### What the app already ships

The existing **Show location** action and GPS rendering path remain unchanged.

### What binds

No design-system obligation applies because the fix adds no application UI.

### Unclear

NavAid is not registered in the design-intelligence product resolver. This does not change the code-walk result because the fix adds no application UI.

**Grounded by**: code walk from the native plist and validator to the existing GPS action. The KB and DS MCP have no NavAid product profile.

## Suggested fix

- `mobile/ios/App/App/Info.plist` — add a concise, non-empty foreground-location purpose string.
- `mobile/scripts/validate-capacitor.mjs` — reject a missing or empty iOS foreground-location declaration before native sync/build.
- `tests/capacitor-mobile.spec.js` — keep the committed red contract regression and turn it green.
- `mobile/README.md` and `.ai/navaid-dev.md` — distinguish supported foreground iOS location from deferred background/lock-screen tracking.

**Expected shape**: five files and about 30 changed lines. Extend the existing plist, validator, contract test, and two documentation sources. Add no test file.

## Failing test (written, red)

Red-phase result: the new `declares foreground location access for iOS` contract required a non-empty purpose string. It failed while the other six tests passed.

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
