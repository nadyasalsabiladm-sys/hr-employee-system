# HR Employee System — Mobile Release Plan

## Goal
Prepare the existing Supabase-backed HR Employee System for Android and iOS without replacing the working leave approval flow or dynamic SPV configuration.

## Current repository audit (2026-10-10)
- The app is a static JavaScript site: `index.html` loads Supabase JS CDN, `config.js`, `spv-management.js`, and `app.js`.
- No `package.json`, Capacitor configuration, native Android project, or native iOS project was present at audit time.
- Existing Phase 16 field-trip tracking uses browser `navigator.geolocation` and sends points every 2 minutes while the page's JavaScript timer is running.
- The existing UI requests a screen wake lock where supported, but that does not guarantee background tracking or tracking while the device is locked.
- Field-trip flow already includes location consent, start/end trip, visit check-in, and HR/Admin trip map. Preserve it while preparing native support.
- Supabase project must remain `cziwtpqjwiaoawyeoqjd`. Do not place a service-role key in client-side code.

## Safety rules
1. Do not rewrite `app.js` wholesale.
2. Do not change leave approval RPCs or SPV assignment behavior as part of mobile scaffolding.
3. Keep mobile work on a separate branch until existing web flows are regression-tested.
4. Do not claim background tracking works until tested on a physical Android device and an iPhone.
5. Collect location only during an active, consented work trip and explain permissions clearly.
6. Never commit private signing keys, Apple certificates, service-role keys, or passwords.

## 14-day target
- Days 1–2: Confirm app entry points, RPC names, deploy path, and choose native wrapper/build service.
- Days 3–6: Implement native wrapper and platform permission configuration; verify trip start/stop and foreground GPS.
- Days 7–10: Configure/test Android and iOS background location behavior, privacy disclosures, and battery/network handling.
- Days 11–14: Regression-test login, employee PIN, leave request → SPV → HR, dynamic SPV, attendance/selfie/GPS, and field trips; prepare store metadata and test builds.

## Release caveat
The 14-day goal is a tested submission candidate, not a guarantee that both stores will approve and publish the apps within 14 days. Apple iOS builds require an Apple-compatible build environment (local Mac or a supported cloud macOS build service) and the required Apple developer account/signing setup.
