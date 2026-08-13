# Spoken in-flight alerts (APK)

**Date:** 2026-08-13
**Status:** designed

## The problem

The in-flight alerts (leg approach, TOP, altitude off plan, off-course) reach the pilot
as OS notifications, which Garmin Connect mirrors to a paired watch. Both require looking
at something. In the air, hands and eyes are busy, and a glance at a phone or watch is
exactly the wrong thing to be doing at a turn point. The alerts already know what to say;
nothing says it.

## What speaks

All four alerts, in the APK only:

| Alert | Notification (unchanged) | Spoken |
| --- | --- | --- |
| Leg approach | `Approaching NAGID — next leg: 2000 ft, 004°, 0:12:30` | "Approaching NAGID. Next leg 2000 feet, heading zero zero four, 12 minutes." |
| TOP | `TOP` | "TOP." |
| Altitude | `1500 ft — planned 2000 ft` | "Altitude 1500 feet, planned 2000." |
| Off course | `5° off course, 10° to intercept toward NAGID` | "5 degrees off course, 10 to intercept toward NAGID." |

The spoken text is a SEPARATE bilingual string set, not the notification body. The
notification is written for a watch face — dense, symbol-heavy (`—`, `°`, `0:12:30`) —
and how a TTS engine renders those symbols is engine-dependent and untestable from here.
The spoken forms spell out units, say headings digit by digit ("zero zero four", never
"four"), and give the leg time rounded to the nearest whole minute — `0:12:30` is spoken
as "13 minutes", and anything under a minute as "less than a minute". Seconds are never
spoken: they are false precision on a planned time, and they lengthen the phrase at the
moment the pilot is busiest. Both sets omit a missing field the same way: never guessed,
simply left out.

## Where it hooks in

`gpsSendWatchAlert(title, body)` gains an optional third argument, `speech`. No `speech`,
no voice. This keeps ONE funnel: every gate that already decides whether an alert is
legitimate — `_gpsAlertConfirmed`, the mobile-device check, the permission state, the
per-leg one-shot latches — stays in one place and applies to speech automatically. The
four call sites pass their own spoken text.

The alternative, a `gpsSpeak()` called beside each `gpsSendWatchAlert()`, was rejected: it
duplicates that gating across five sites, which is exactly how the two paths drift apart.

## Native only

`_nativeTts()` mirrors the existing `_nativeNotify()`: it returns the plugin only when
`Capacitor.isNativePlatform()`. On the website it returns null and nothing speaks.

Plugin: `@capacitor-community/text-to-speech@8.0.2` (peer `@capacitor/core >=8.0.0`; the
app is on 8.4.0).

Web `speechSynthesis` was rejected as the mechanism. Browsers suspend it when the page is
not foregrounded, which is precisely the cockpit case — phone locked, app in the
background, background-geolocation still feeding fixes. An alert that goes quiet exactly
when it matters is worse than no alert, because it is trusted.

## Setting

A checkbox in View/Set, `voice-alerts-cb` → `navaid.voiceAlerts`, gist default
`defaultVoiceAlerts`, registered in `NavAid.defaultVisibilityMap` like every other
toggle.

- **Default off.** It talks out loud in a cockpit; that is opt-in per pilot, not a
  surprise on first upgrade.
- **Hidden on non-native.** A switch that cannot do anything on the website is worse
  than no switch — it reads as broken rather than as unavailable.

## Language

Speak in the UI language. Once per session, ask the engine for its supported languages;
if the UI is Hebrew and no Hebrew voice is installed, speak the ENGLISH phrasing rather
than nothing. A device missing a voice must never mean a missed alert. The result is
cached — this is not a per-alert query.

## Sequencing and audio

Speech is chained, never interrupted: a TOP firing seconds after a leg approach waits its
turn rather than cutting it off mid-word. Audio focus is requested with ducking, so music
or intercom audio lowers instead of talking over the alert.

## Failure

Every TTS call is best-effort inside a try/catch, silently doing nothing on failure —
the same shape the notification code already uses. The notification is sent first and
independently, so no TTS failure can cost the pilot the alert itself.

## Testing

Playwright with a stubbed `Capacitor.Plugins.TextToSpeech`:

- the exact spoken text for each of the four alert types, in both languages
- silence when the toggle is off
- silence on a non-native platform
- the Hebrew-to-English fallback when `getSupportedLanguages()` reports no Hebrew voice
- a TTS rejection does not suppress the notification

The EN/HE string-parity suite picks up the new keys with no extra work.

Real device audio — voice quality, ducking against a headset, behaviour with the phone
locked — cannot be tested from here and is verified on the APK.

## What this deliberately does not do

- No web speech fallback. See above: it is unreliable in the one situation that matters,
  and a half-working voice alert invites misplaced trust.
- No voice/pitch/rate pickers. Engine defaults until there is a reason.
- No spoken read-back of anything else in the app.

## Consequences

Requires an APK rebuild (`npm i`, `cap sync`, build) because it adds a native plugin. The
website is unaffected by design.
