# Architecture & Reuse Registry
> One line per durable thing. Edit the line when it changes; delete it when the thing is gone.
> No story narrative, no dates, no rationale.

## Shared utilities & components
| Export | Location | Capability |
| --- | --- | --- |
| `apiClient` / `get` / `post` / `put` / `del` | `app-frontend/src/lib/api/client.ts` | Browser API client to the same-origin `/api`; throws `APIError` with `statusCode`, `message`, `reason` (401), `errors` (400), raw `body` (409 etc.); 502-504 / fetch failure -> `statusCode` 0. Never logs `/auth/*` bodies |
| `isNetworkError` / `isAPIError` / `statusOf` | `app-frontend/src/lib/api/errors.ts` | Branch on a thrown API error (unreachable vs HTTP status) |
| Endpoint functions (`signIn`, `getCurrentUser`, `signOut`, files, transactions) | `app-frontend/src/lib/api/endpoints.ts` | Typed wrappers per API operation |
| `/api/*` proxy | `app-frontend/src/app/api/[...path]/route.ts` | Same-origin pass-through to `BACKEND_URL` (cookies both ways, streamed bodies, 502 when unreachable) |
| `backendUrl` / `SESSION_COOKIE` | `app-frontend/src/lib/server/backend.ts` | Server-only back-end base (`BACKEND_URL`, default `http://localhost:5100/api`) read at request time |
| `checkSession` / `signInPathFor` | `app-frontend/src/lib/server/session.ts` | Server-only `GET /auth/me` with the incoming cookie -> signed-in user / signed-out reason / unavailable; sign-in redirect path (`?reason=` for non-`NotSignedIn`) |
| `landingPathFor` | `app-frontend/src/lib/auth/landing.ts` | Role -> landing page (Importer `/upload`, Approver `/transactions`) |
| Sign-in / app wording constants | `app-frontend/src/lib/auth/messages.ts` | `APP_NAME`, administrator contact, sign-in failure and required-field messages |
| `SignedInHeader` | `app-frontend/src/components/shell/SignedInHeader.tsx` | Shell banner showing the signed-in name and role |
| `(signed-in)` layout | `app-frontend/src/app/(signed-in)/layout.tsx` | Server-gated shell: header + `<main>`; redirects to sign-in before rendering |

## Conventions
- Browser code calls only the same-origin `/api` (via the API client); server code reaches the back-end via `backendUrl()`. No `NEXT_PUBLIC_*` back-end URL.
- Signed-in screens live under `app/(signed-in)/` and render no `<main>` of their own (the layout owns it); standalone screens (sign-in, privacy) render their own `<main>`.
- Forms: required fields carry `required` + a visible `*`; validation on blur and on submit (react-hook-form `mode: 'onBlur'`, `reValidateMode: 'onBlur'`); field errors linked by `aria-describedby`.

## Cross-epic debt
- None.
