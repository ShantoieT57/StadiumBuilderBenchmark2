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
| `checkSession` / `currentSession` / `signInPathFor` | `app-frontend/src/lib/server/session.ts` | Server-only `GET /auth/me` with the incoming cookie -> signed-in user / signed-out reason / unavailable (`currentSession` = per-request de-duplicated); sign-in redirect path (`?reason=` for non-`NotSignedIn`) |
| `landingPathFor` | `app-frontend/src/lib/auth/landing.ts` | Role -> landing page (Importer `/upload`, Approver `/transactions`) |
| `ROUTE_ACCESS` / `canAccess` / `menuItemsFor` / `AppRoute` | `app-frontend/src/lib/auth/access.ts` | The single route -> role access map; feeds both the menu and the server-side route guard. New signed-in screens add a row |
| Sign-in / app wording constants | `app-frontend/src/lib/auth/messages.ts` | `APP_NAME`, administrator contact, sign-in failure, required-field and no-access messages |
| `SignedInHeader` | `app-frontend/src/components/shell/SignedInHeader.tsx` | Shell banner showing the signed-in name and role; `nav` slot for the menu |
| `AppNav` | `app-frontend/src/components/shell/AppNav.tsx` | Role-filtered main menu from the access map: inline `<nav>` at md+, icon menu button + Sheet below md; optional per-route `badges` slot |
| `RouteGuard` | `app-frontend/src/components/shell/RouteGuard.tsx` | Server-side per-screen role check (`route: AppRoute`); renders `NoAccess` in the shell for a disallowed role |
| `NoAccess` | `app-frontend/src/components/shell/NoAccess.tsx` | In-shell no-access message naming the administrator |
| `ToastProvider` / `useToast` / `ToastContainer` / `Toast` | `app-frontend/src/contexts/ToastContext.tsx`, `app-frontend/src/components/toast/`, `app-frontend/src/types/toast.ts` | The single shared message mechanism (mounted in the root layout): `showToast({ variant, title, message? })` returns an id; `success`/`info`/`warning` auto-dismiss (default 5 s), `error` = "Problem" never auto-dismisses (close by the person or `dismissToast(id)` when resolved); visible kind word, `status`/`alert` live regions, tooltip-labelled dismiss button; one timer per message in the provider |
| Tooltip / Sheet primitives | `app-frontend/src/components/ui/tooltip.tsx`, `sheet.tsx` | shadcn (radix-ui) |
| `(signed-in)` layout | `app-frontend/src/app/(signed-in)/layout.tsx` | Server-gated shell: header + role menu + `<main>`; redirects to sign-in before rendering |

## Conventions
- Browser code calls only the same-origin `/api` (via the API client); server code reaches the back-end via `backendUrl()`. No `NEXT_PUBLIC_*` back-end URL.
- Signed-in screens live under `app/(signed-in)/` and render no `<main>` of their own (the layout owns it); standalone screens (sign-in, privacy) render their own `<main>`.
- Every signed-in page wraps its content in `<RouteGuard route=...>` (the layout does not re-run on client navigation, so the role check lives in the page).
- Icon-only buttons: `aria-label` + shadcn Tooltip with its own `TooltipProvider disableHoverableContent`, shown on hover and focus.
- Success / problem feedback that is not tied to one form field goes through `useToast()`; status colours use the `success` / `warning` / `destructive` tokens, never palette utilities.
- Forms: required fields carry `required` + a visible `*`; validation on blur and on submit (react-hook-form `mode: 'onBlur'`, `reValidateMode: 'onBlur'`); field errors linked by `aria-describedby`.

## Cross-epic debt
- None.
