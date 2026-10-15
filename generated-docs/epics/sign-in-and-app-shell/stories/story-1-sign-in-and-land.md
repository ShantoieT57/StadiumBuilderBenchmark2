# Story 1: Sign in and land on your screen

- **Epic:** sign-in-and-app-shell
- **Slug:** story-1-sign-in-and-land
- **Roles:** Importer, Approver
- **Route:** /sign-in
- **Page action:** create_new
- **Infrastructure only:** false
- **Requirement IDs:** R1, R2, R3, R4, R5, R9, R15, BR2, BR3, BR5, BR8, BR9, BR11, BR12, NFR-1, NFR-4
- **Target file:** app-frontend/src/app/sign-in/page.tsx + app-frontend/src/app/(signed-in)/layout.tsx (also app/layout.tsx replaced, app/page.tsx replaced by a redirect, (signed-in)/upload/page.tsx and (signed-in)/transactions/page.tsx placeholders, app/privacy/page.tsx, next.config.ts proxy)

## Plain summary

People sign in with their email and password and land on the right screen for their role. An Importer lands on Upload and an Approver lands on Transactions. Their name and role are always shown at the top. Opening the app while signed out always leads to the sign-in screen, never to a welcome page.

## Technical summary

- **Same-origin proxy.** Every browser call to `/api/*` reaches `http://localhost:5100/api`, with the `txn_session` cookie passed through. The browser never calls :5100 directly.
- **API client.** Point `client.ts` at the relative base.
- **Template replaced.** Replace the template root layout, the public welcome page and the template metadata.
- **`/sign-in` screen.** Email and password fields:
  - Required fields are marked, and checked when the person leaves a field and on submit.
  - A wrong email or password shows exactly "Invalid email or password".
  - An unreachable back-end, or a 5xx from the proxy, shows its own connection message.
  - The screen also has the forgotten-password text and a privacy-notice link to a static `/privacy` page.
- **`(signed-in)` route group.** Its server layout calls `GET /auth/me` with the incoming cookie and redirects to `/sign-in` before rendering anything (NFR-1).
- **`/` route.** Redirects to the role's landing page.
- **Header.** Shows the signed-in person's name and role.
- **Placeholders.** Upload and Transactions are minimal placeholder pages.

## Acceptance criteria

- **AC-1** (coverage: vitest): Email and password are marked required. Leaving either empty, or submitting with either empty, shows a "required" message under that field. Nothing is shown while the person is still typing.
- **AC-2** (coverage: vitest): Signing in with a wrong email or a wrong password shows exactly "Invalid email or password", whichever one was wrong.
- **AC-3** (coverage: vitest): When the app cannot be reached, the sign-in screen shows a connection-problem message that is clearly different from "Invalid email or password".
- **AC-4** (coverage: vitest): The sign-in screen tells a person who has forgotten their password to contact their administrator, and shows a privacy-notice link.
- **AC-5** (coverage: playwright): After signing in, an Importer lands on Upload and an Approver lands on Transactions, and the header shows the signed-in person's name and role.
- **AC-6** (coverage: playwright): While signed out, opening any protected address, including the app root, shows the sign-in screen without first showing any protected content.

Additional technical checks (2):
- The password is never logged or sent to error reporting (BR12).
- Browser calls stay same-origin (BR8).

## Manual test checklist

- Open the app while signed out. You land on the sign-in page, not a welcome page.
- Click Sign in with both fields empty. Each field shows a "required" message.
- Sign in as fileimporter@digiata.com with a wrong password. You see "Invalid email or password".
- Sign in as fileimporter@digiata.com / Test123. You land on Upload, and "File Importer" and "Importer" appear at the top.
- Sign in as approver@digiata.com / Test123. You land on Transactions.
- While signed out, type /transactions in the address bar. You are sent to the sign-in page.
- Stop the back-end and try to sign in. You see a "can't reach the app" message, not "Invalid email or password".

## Resolved design choices (approved at the stories approval)

- **Administrator contact:**
  - The sign-in screen uses generic wording: "Forgotten your password? Contact your administrator."
  - Keep this wording in one constants file so a named contact can be added later.
- **Privacy page:**
  - An internal static page at `/privacy`, reachable while signed out and linked from the sign-in screen.
  - Its placeholder text states:
    - the purpose: reviewing and approving bank transactions
    - the personal data held: name, email, and the bank account details in transactions
    - that access or deletion requests go to the administrator
  - There is no in-app self-service deletion (the POPIA stance, approved).
- **Colours:** keep the template-default tokens from `globals.css` (provisional). No hex literals in components.

## Infrastructure reuse notes

- **API client.** `app-frontend/src/lib/api/client.ts` is the single API path.
  - Point it at the same-origin `/api` base.
  - `API_BASE_URL` in `src/lib/utils/constants.ts` defaults to `http://localhost:8042`. Change the default to `/api`.
  - Keep the :5100 target server-side only, e.g. a non-public `BACKEND_URL` used by the `next.config` rewrites and by server-side fetches.
- **Request logging.** `client.ts` `logRequest` prints request bodies in development. The sign-in body contains the password, so redact or skip body logging for auth endpoints (BR12, POPIA).
- **Server-side layout gate.** It calls `GET /auth/me` from the Next.js server, forwarding the incoming `txn_session` cookie.
  - Every `/auth/me` call counts as session activity. Call it only on real navigation, never on a background timer.
- **Root layout.** Replace the template root layout's `<main className='min-h-screen'>` and its metadata, so the signed-in shell owns its own `<main>` landmark. Set the app title.
- **Existing test.** `src/__tests__/integration/api-client.test.ts` may assert the old absolute base URL or the old logging behaviour. Update it when `client.ts` changes.
- **shadcn primitives.** Already present: button, card, input, label.
