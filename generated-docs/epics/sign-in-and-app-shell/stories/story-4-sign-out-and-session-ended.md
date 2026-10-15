# Story 4: Sign out and being signed out

- **Epic:** sign-in-and-app-shell
- **Slug:** story-4-sign-out-and-session-ended
- **Roles:** Importer, Approver
- **Route:** /dashboard
- **Page action:** modify_existing
- **Infrastructure only:** false
- **Requirement IDs:** R6, R7, R8, BR4, BR6, BR7, NFR-2
- **Target file:** app-frontend/src/app/(signed-in)/layout.tsx (sign-out control, events provider in contexts/, app/api/events/route.ts streaming proxy, 401 handling in lib/api/client.ts, reason messages on app/sign-in/page.tsx)

## Plain summary

People can sign out at any time, which ends their sign-in on every device. If they sit idle for 60 minutes, or sign in somewhere else, the app sends them back to the sign-in screen with a message explaining why. This happens even if they aren't clicking anything at the time. After signing out, the browser's Back button can't show the app again.

## Technical summary

- **Sign out control.** Add it to the shell. It:
  - calls `POST /api/auth/sign-out`
  - closes the live connection
  - goes to `/sign-in` with a short "You have signed out" success message
- **Back button.** Signed-in pages are served `no-store`, so the Back button can't show cached content. A `pageshow` (bfcache) check re-verifies the session.
- **Central 401 handler in `client.ts`.** Maps each `reason` to a sign-in redirect:
  - **SessionExpired:** show the idle message
  - **SignedInElsewhere:** show the other-device message
  - **NotSignedIn / SignedOut:** no special message

  The idle and other-device messages are persistent problem messages from Story 3.
- **Live connection.** Open a single `GET /api/events` connection per tab, through a streaming same-origin route handler.
  - On `session-ended`, route to sign-in with the same reason messages.
  - After a drop, reconnect using the server's 5-second retry. Stop reconnecting on sign-out.
  - Expose a subscribe API for later epics (`file-changed`, `transactions-changed`, `resync`).
  - Holding the stream is never treated as activity, and nothing polls `/auth/me` in the background.

## Acceptance criteria

- **AC-1** (coverage: playwright): Choosing Sign out returns the person to the sign-in screen, and opening any signed-in screen afterwards also shows the sign-in screen.
- **AC-2** (coverage: playwright): After signing out, pressing the browser Back button does not show the previously viewed signed-in page. The person is returned to the sign-in screen.
- **AC-3** (coverage: vitest): The sign-in screen shows an idle-timeout message after a session expired, and a signed-in-on-another-device message after a sign-in elsewhere. It shows no special message for an ordinary signed-out visit.
- **AC-4** (coverage: playwright): When an action in the app is rejected because the session has ended, the person is taken to the sign-in screen with the message that matches the reason.
- **AC-5** (coverage: playwright): When the live connection reports that the session has ended, the person is taken to the sign-in screen with the matching message without having to click anything.
- **AC-6** (coverage: vitest): Each signed-in tab keeps exactly one live connection. It closes on sign-out and reconnects by itself after a drop.

Additional technical checks (1): single connection per tab, closed on sign-out, reconnect behaviour (AC-6).

## Manual test checklist

- Click Sign out. You go back to the sign-in page.
- Sign in, sign out, then press the browser Back button. You are sent to sign-in, not back into the app.
- Sign in as the Approver in one browser, then sign in as the Approver in a second browser. Within about 15 seconds the first browser goes to sign-in with a "signed in on another device" message, without you clicking anything.
- Sign in in two browsers as the same person and sign out in one. The other returns to sign-in shortly after.
- (Optional, if the back-end's idle timeout can be shortened for testing) Leave the app idle past the timeout. You return to sign-in with an "inactive for 60 minutes" message.

## Infrastructure reuse notes

- **401 handling lives in one place.** Add it centrally in `client.ts` so every later epic inherits it. Don't add per-call handling.
- **Events don't count as activity.** `GET /events` does not count as session activity, which is what we want.
  - Proxy it through a streaming route handler (`app/api/events/route.ts`) that passes the response body through unbuffered, with `text/event-stream` and no compression.
  - Don't rely on a plain rewrite: Next.js rewrites may buffer or compress SSE.
- **Event payloads.** Per `TransactionApi.yaml`:
  - `session-ended` is `{reason, message}`.
  - The stream starts with `retry: 5000`.
  - Heartbeat comments arrive every 15s.
  - Events have incrementing ids, and `Last-Event-ID` is ignored.
