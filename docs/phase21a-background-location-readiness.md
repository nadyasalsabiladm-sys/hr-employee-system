# Phase 21A — Background Location Readiness and Design

## Scope and safety boundaries

- Work only on `phase21-mobile-prep`.
- Do not modify `main`.
- Do not run Supabase migrations or change existing RPCs.
- Preserve leave approvals, dynamic SPV configuration, employee PIN changes, contracts, attendance, and existing field-trip flows.
- Do not collect location outside an explicitly started active field-trip session.
- Show a persistent, understandable indicator while background tracking is active and stop tracking when the trip ends, is cancelled, the employee logs out, or the server no longer reports an active trip.

## Current implementation audit

The current Phase 16 field-trip code in `app.js`:
- calls `navigator.geolocation.getCurrentPosition` and sends a point through the existing `employee_field_track_point` RPC;
- schedules another send every 120 seconds using a JavaScript interval;
- uses Screen Wake Lock as a best-effort aid;
- resumes tracking after rendering the employee portal when the existing status RPC reports consent and an active trip.

This is useful while the web view is active, but a JavaScript timer and Screen Wake Lock do not guarantee continuous tracking while Android backgrounds or suspends the WebView. Do not describe the current version as reliable background tracking.

## Plugin compatibility decision

Candidate selected for a controlled proof of concept: `@capgo/background-geolocation`, using its Capacitor 8-compatible major version (v8).

Reason:
- its published compatibility matrix explicitly matches plugin v8 with Capacitor v8 and marks that major as maintained;
- it documents background location updates and the required Android persistent notification;
- its documentation warns that WebView HTTP requests can be throttled after several minutes in the background. The proof of concept must therefore test delivery through the current app architecture before committing to a final integration.

Do not select `@capacitor-community/background-geolocation` for this Capacitor 8 project without further compatibility evidence: its published matrix lists support only through Capacitor 7.

Reference documentation:
- https://github.com/Cap-go/capacitor-background-geolocation
- https://capgo.app/docs/plugins/background-geolocation/

## Planned implementation (not yet applied)

1. Pin a Capacitor 8-compatible plugin version and install it only on `phase21-mobile-prep`.
2. Add the smallest possible adapter in the mobile bundle; leave the web attendance flow using its existing browser APIs.
3. Start the native watcher only after explicit consent and server confirmation of an active field trip.
4. Display a persistent Android notification explaining that location is being recorded for the active trip.
5. Send points using the existing authorized session and existing RPC contract; do not create or alter any RPC. If WebView requests are throttled, stop and evaluate a supported native HTTP approach before changing implementation.
6. Stop/remove the watcher on trip completion, cancellation, logout, lost session, or server response that no active trip exists. On app resume, re-check server status before restarting.
7. Add only the platform permissions and privacy descriptions actually required. Do not request Android background-location permission unless the chosen tracking design and store policy review justify it.
8. Validate Android build and regressions; then test foreground, background, screen locked, location disabled, network loss/recovery, logout, and trip end. Background tracking remains unverified until these device tests pass.

## Acceptance criteria

- No location collection before consent and active-trip confirmation.
- Visible ongoing tracking notification while tracking runs in Android background.
- No duplicate watchers after repeated portal renders or app resume.
- Tracking stops promptly when the trip ends or authorization is lost.
- Existing RPC names and arguments remain unchanged.
- No Supabase schema/RPC changes.
- Existing attendance, leave approval, dynamic SPV, PIN, and contracts regressions pass.
- Build/test evidence is recorded before calling background tracking complete.

## Current status

Phase 21A design decision documented. No app code, native manifest, dependency, database, or RPC was changed by this design note. The next implementation step is a small isolated proof of concept on `phase21-mobile-prep`.
