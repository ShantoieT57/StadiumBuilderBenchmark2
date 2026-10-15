# Epic Brief: Sign-in and app shell

Inherits roles, auth, data source, compliance, and styling from project.md.

Source of truth for rule text: `documentation/Transaction-Import-and-Approval-Brief.md`. Rule IDs are cited on each requirement.

---

## Goal

People sign in with their email and password, land on the right screen for their role, always see who is signed in, see only the menu items their role allows, and are signed out when idle, when they sign in elsewhere, or when they choose to.

This epic also owns the shared foundations later epics reuse: the same-origin proxy in front of the API, the gated signed-in layout, the role-filtered menu, the no-access screen, 401-reason handling, the shared success/problem message pattern, and the single `GET /events` SSE connection. It replaces the template's public welcome page at `/`.

Depends on: none.

---

## Data Model

Entities this epic touches (from `app-backend/docs/TransactionApi.yaml`, authoritative):

| Entity | Fields | Notes |
|---|---|---|
| SignInRequest | `email`, `password` | Both required (SI-01). Sent to `POST /api/auth/sign-in`. |
| CurrentUser | `name`, `email`, `role` (`Importer` or `Approver`) | Returned by sign-in and `GET /api/auth/me`. |
| AuthProblem (401 body) | `reason`: `NotSignedIn`, `SessionExpired`, `SignedInElsewhere`, `SignedOut` | Drives which message the sign-in screen shows. |
| Forbidden (403 body) | `message` telling the person to ask their administrator | Basis for the no-access message (AC-02). |
| SSE event (`GET /events`) | `file-changed`, `transactions-changed`, `resync`, `session-ended` | This epic owns the connection and `session-ended`. Later epics subscribe to the others. |

Session state lives in the HttpOnly `txn_session` cookie. The front-end never reads or stores a token.

---

## Functional Requirements

Each requirement's text is quoted exactly from the source brief rule with the same ID.

Signing in

- **R1 (SI-01):** "A person signs in with their email address and password. Both are required."
- **R2 (SI-02):** "If the email or the password is wrong, the app says "Invalid email or password". It never says which of the two was wrong."
- **R3 (SI-03):** "If the app cannot be reached, the message says so, so the person can tell a connection problem from a wrong password."
- **R4 (SI-04):** "The sign-in screen tells a person who has forgotten their password to contact their administrator."
- **R5 (SI-05):** "After signing in, an importer lands on the Upload screen and an approver lands on the Transactions screen."
- **R6 (SI-06):** "A person who has done nothing in the app for 60 minutes is signed out and returned to the sign-in screen. Any activity resets the 60 minutes."
- **R7 (SI-07):** "A person can be signed in in one place at a time. Signing in on a second device or browser signs them out of the first."
- **R8 (SI-08):** "A person can sign out at any time. Signing out ends their sign-in on every device."
- **R9 (SI-09):** "The app always shows who is signed in."

Access control

- **R10 (AC-01):** "A person never sees a menu item, button, or action their role does not allow. The app hides it rather than showing it disabled."
- **R11 (AC-02):** "If a person reaches a screen their role does not allow, for example through a saved link, the app tells them they do not have access and who to ask."
- **R12 (AC-03):** "The app enforces every role rule itself, not only by hiding things on screen."

General conventions (inherited by every later epic)

- **R13 (GN-02):** "Every action can be done with the keyboard alone."
- **R14 (GN-03):** "Every icon-only button has a label that appears when the person points at it or moves to it with the keyboard."
- **R15 (GN-04):** "Required fields on a form are marked. The app checks a field when the person leaves it and again when they submit, not on every keystroke."
- **R16 (GN-05):** "Success messages disappear on their own after a few seconds. Problems that need attention stay on screen until resolved."

---

## Business Rules

- **BR1:** The menu follows the brief's Menu and access table. Dashboard: Importer yes, Approver yes. Transactions: Importer yes (view only), Approver yes. Upload: Importer yes, Approver no. Items a role may not use are not rendered (R10).
- **BR2:** Landing after sign-in: Importer goes to Upload, Approver goes to Transactions (R5). Both destinations are minimal placeholder pages in this epic; later epics replace them.
- **BR3:** The signed-in layout is gated server-side. An unauthenticated request to any signed-in route redirects to sign-in. The role check for each route also happens server-side, so a saved link to a disallowed screen shows the no-access message (R11, R12). The back-end remains the final enforcer (R12).
- **BR4:** 401 handling by `reason`:
  - `NotSignedIn`: go to sign-in with no special message.
  - `SessionExpired`: go to sign-in with an idle-timeout message (R6).
  - `SignedInElsewhere`: go to sign-in with a message that the account was signed in on another device or browser (R7).
  - `SignedOut`: go to sign-in (the person chose to sign out, or signed out elsewhere via R8).
  - Backend unreachable: show a "cannot reach the app" message distinct from "Invalid email or password" (R3).
- **BR5:** Wrong credentials always show exactly "Invalid email or password", whichever of the two was wrong (R2).
- **BR6:** Sign-out calls `POST /api/auth/sign-out` (ends sessions on every device, returns 204, clears the cookie), then returns to sign-in (R8).
- **BR7:** The 60-minute idle timeout is enforced by the back-end. The front-end's job is to send activity through to the API so it resets the window, and to react to a 401 or an SSE `session-ended` by returning to sign-in with the matching message (R6, R7).
- **BR8:** The browser never calls `:5100` directly. All API calls, including SSE, go through same-origin Next.js route handlers or rewrites (the back-end sends no CORS headers). All calls use `src/lib/api/client.ts`.
- **BR9:** The sign-in screen shows who to contact for a forgotten password (the administrator) and a privacy-notice link (POPIA, project.md Compliance). No password reset flow exists (out of scope).
- **BR10:** Message pattern (R16): success messages auto-dismiss after a few seconds; problem messages persist until resolved. One shared mechanism, reused by all later epics.
- **BR11:** Form conventions (R15): required fields are marked; validation runs on blur and on submit, not on every keystroke. The sign-in form is the first user.
- **BR12:** Personal data hygiene (project.md Compliance): never log or send to client-side error reporting the password or other personal data.

---

## Key Workflows

1. **Sign in (success):** Person opens the app, sees the sign-in screen, enters email and password, submits. The app signs them in, shows who is signed in, and lands an Importer on Upload or an Approver on Transactions.
2. **Sign in (failure):** Empty fields are flagged as required. Wrong email or password shows "Invalid email or password". An unreachable back-end shows a connection-problem message.
3. **Using the app:** The signed-in layout shows the person's name (and role or email) at all times, plus a menu containing only the items their role allows. Keyboard alone can reach every control; icon-only buttons show labels on hover and focus.
4. **No access:** A person opens a saved link to a screen their role does not allow. They see a no-access message naming who to ask (the administrator).
5. **Idle timeout:** After 60 minutes with no activity the next request or SSE event returns the person to sign-in with an idle-timeout message.
6. **Signed in elsewhere:** The person signs in on a second device. The first device returns to sign-in with the signed-in-elsewhere message, either on its next request or via the SSE `session-ended` event.
7. **Sign out:** The person chooses Sign out. All of their sessions end and they return to sign-in.
8. **Live connection:** While signed in, the app holds one `GET /events` connection through the same-origin proxy. `session-ended` returns the person to sign-in. The connection is exposed so later epics can subscribe to `file-changed`, `transactions-changed`, and `resync`.

---

## Feature NFRs

- **NFR-1:** The signed-in layout, the role check, and the redirect to sign-in are enforced server-side, with no flash of protected content before a redirect.
- **NFR-2:** Exactly one SSE connection per signed-in browser tab, closed on sign-out, with sensible reconnect after a drop.
- **NFR-3:** Sign-in and the shell work from 360px width upward; the menu collapses to a usable narrow-screen form (baseline responsive NFR).
- **NFR-4:** Accessible forms: labels associated with inputs, error messages announced to assistive technology, visible focus.
- **NFR-5:** Status and feedback are conveyed in words, never by colour alone.

---

## Out of Scope

- Password reset, account lockout, and two-step sign-in (project-level out of scope).
- The real Upload and Transactions screens (placeholders only here; later epics build them).
- Dashboard content (file list and summary).
- The Imported-count badge on the Transactions menu item (TL-07), which belongs to the transactions epic. The menu structure here should leave room for it.
- Subscribing to `file-changed`, `transactions-changed`, and `resync` (later epics).
- Login rate limiting, auth audit logging, and HSTS (not implemented in the back-end; see project.md policy deviations).

---

## Notes & Caveats

- **Replace template code:** the template's public welcome page at `/` is replaced by the sign-in / redirect flow. Do not nest the new shell inside the template's root layout wrappers; replace them (CLAUDE rule 6).
- **Back-end contract wins over the BFF policy:** paths are `/api/auth/sign-in`, `/api/auth/me`, `/api/auth/sign-out`; body uses `email`, not `username`; cookie is `txn_session` (SameSite=Lax). SI-08 sign-out-everywhere intentionally overrides the policy's per-device logout.
- **Smoke-test mode is reachability-only:** the only check performed was that unauthenticated `GET /auth/me` returns 401. Real sign-in with seeded users (`fileimporter@digiata.com`, `approver@digiata.com`, password `Test123`) is first exercised in this epic.
- **Placeholder pages:** the Upload and Transactions landing pages are minimal stand-ins so SI-05 can be verified. They are replaced, not extended, by later epics.
- **Styling is provisional:** brand colours are template defaults (project.md Styling). Use tokens from `globals.css`, no hex literals in components.

## Open Questions

- **POPIA data-deletion process (project.md `[QUESTION]`):** the brief has no profile page or user self-service. Confirm whether a data-subject request / right-to-erasure process is needed (for example handled out-of-band by the administrator) or explicitly out of scope. This affects what the privacy-notice link on the sign-in screen says and where it points; resolve during this epic's planning.
- **Privacy-notice destination:** where does the link point (an internal static page or an external URL), and who supplies the text?
- **Administrator contact (SI-04, AC-02):** the brief says "contact their administrator" and "who to ask" but supplies no name, email, or phone. Confirm whether generic wording is acceptable or a specific contact is to be shown.
- **Brand colours:** confirm or supply (project.md Styling is defaulted).
