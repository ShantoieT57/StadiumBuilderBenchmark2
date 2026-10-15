# Transaction Import and Approval App

A web app for a bank operations team that receives a daily file of bank transactions. Importers bring the CSV files in and correct or cancel problem files. Approvers review every transaction and approve or reject it (rejections carry a written reason). The .NET back-end is already complete. The front-end consumes it.

| Field | Value |
|---|---|
| Project slug | `transaction-import-approval` |
| Created | 2026-10-15 |
| Intake source | docs |
| Backend connectivity | verified (reachability-only) |

Source of truth for functional rules: `documentation/Transaction-Import-and-Approval-Brief.md` (rule IDs SI-, UP-, FP-, FS-, FC-, FX-, DB-, FD-, TS-, TL-, SF-, AP-, RJ-, EX-, AC-, GN-). Per-epic briefs carry the detailed requirements.

---

## Roles & Permissions

**Template:** `custom`

Two roles, exactly as the brief defines them. Seeded users (password `Test123` for both):

| Name | Email | Role |
|---|---|---|
| File Importer | `fileimporter@digiata.com` | Importer |
| Approver User | `approver@digiata.com` | Approver |

| Permission | Importer | Approver |
|---|---|---|
| View main dashboard (file list and summary) | ✓ | ✓ |
| View file details and download original file | ✓ | ✓ |
| View transactions list and transaction details | ✓ | ✓ |
| Filter and search transactions | ✓ | ✓ |
| Upload files | ✓ | |
| Correct invalid rows and re-check a file | ✓ | |
| Cancel a file | ✓ | |
| Approve a transaction | | ✓ |
| Reject a transaction (with reason) | | ✓ |
| Export transactions to CSV | | ✓ |
| See Imported-count badge on Transactions menu | | ✓ |

Landing screen after sign-in (SI-05): Importer goes to Upload, Approver goes to Transactions. Role rules are hidden, not disabled (AC-01), enforced by the back-end (AC-03), and a disallowed screen shows a no-access message naming who to ask (AC-02).

> Permissions extend during BUILD as new stories surface new actions. Additions land here via a project-change PR (§6.1 of the epic-branch plan). Permission removals or role-set changes halt for user review.

---

## Authentication

| Field | Value |
|---|---|
| Method | `bff` |
| BFF login endpoint (if BFF) | `POST /api/auth/sign-in` (body `{email, password}`; sets HttpOnly `txn_session` cookie, SameSite=Lax; returns `{name, email, role}`) |
| BFF userinfo endpoint (if BFF) | `GET /api/auth/me` (returns `{name, email, role}`; 401 with `reason` of `NotSignedIn`, `SessionExpired`, `SignedInElsewhere`, or `SignedOut`) |
| BFF logout endpoint (if BFF) | `POST /api/auth/sign-out` (ends the person's sessions on every device per SI-08; 204, clears cookie) |
| Custom auth notes (if custom) | n/a |

- Session cookie `txn_session` is browser-managed. The front-end never reads or stores a token.
- 401 bodies carry a `reason`. The front-end returns the person to sign-in with a matching message (SI-03 unreachable, SI-06 idle timeout, SI-07 signed in elsewhere). Wrong credentials show "Invalid email or password" (SI-02).
- Idle timeout 60 minutes, single active sign-in per person (SI-06, SI-07).

**Policy deviations (back-end contract wins; the front-end adapts):**
- The endpoint contract differs from the canonical shape in `.claude/policies/bff-auth-pattern.md` (`/bff/auth/*`): different paths, `email` instead of `username`, cookie name `txn_session`, SameSite=Lax.
- SI-08 sign-out-everywhere intentionally overrides that policy's per-device logout rule.
- Policy rules not yet implemented in the back-end: login rate limiting / lockout (Rule 3; the brief puts account lockout out of scope), the auth audit log (Rule 5), and HSTS (Rule 6, production only).

> Auth method is never inferred. The user confirmed it explicitly per [authentication-intake.md](.claude/policies/authentication-intake.md).

---

## Data Source & Backend Integration

| Field | Value |
|---|---|
| Data source | `existing-api` |
| Backend status | `running` |
| Mock layer required | no |

The .NET back-end in `app-backend/` is **complete** (15 BDD cycles, 541 passing tests, every brief rule implemented). The front-end consumes the API contract and must not redesign it. Any back-end change goes through the `backend-workflow` sub-agent per `CLAUDE.backend.md`.

### Backend connectivity

| Aspect | Value |
|---|---|
| Base URL | `http://localhost:5100/api` |
| Auth scheme | cookie (`txn_session`, browser-managed) |
| Auth header | none |
| Auth value format | n/a |
| Credential env vars | none |
| Smoke-test endpoint | `GET /auth/me` (unauthenticated 401 = reachable) |
| Smoke-test mode | reachability-only |
| Smoke-test status | verified |
| Smoke-test verified at | 2026-10-15 |
| Smoke-test notes | Cookie-session auth, so only reachability is probed. Artifacts: `generated-docs/specs/smoke-config.json`, `generated-docs/specs/api-smoke-test.sh` |
| CORS / proxy notes | The back-end sends no `Access-Control-Allow-Origin`. The front-end MUST use same-origin Next.js rewrites or route handlers (BFF pattern). The browser must never call `:5100` directly. |

### API specs

| Path | Source |
|---|---|
| `app-backend/docs/TransactionApi.yaml` | generated (canonical, authoritative; title TransactionApi, server `http://localhost:5100/api`) |

### Endpoint inventory (from TransactionApi.yaml)

All paths are relative to base URL `http://localhost:5100/api`.

| Endpoint | Notes |
|---|---|
| `POST /auth/sign-in` | Anonymous |
| `GET /auth/me` | |
| `POST /auth/sign-out` | Anonymous; always 204 |
| `POST /files` | Multipart: field `file` plus optional `kind` (default `BankTransactions`). Importer only. Responses: 201, 400, 413, 415 |
| `GET /files` | Paged list. Query: `page`, `pageSize` (5/10/20/50), `sortBy` (`FileName`\|`LastProcessedAt`\|`RowCount`\|`Status`\|`ImportedCount`), `sortDirection`, `status`, `fileName`, `processedFrom`, `processedTo`, `visibility` (`Active`\|`Cancelled`\|`Both`) |
| `GET /dashboard/summary` | |
| `GET /files/{fileId}` | Details including `processingHistory` and flags `isFullyReviewed`, `areTransactionsAvailable`, `canDownload` |
| `GET /files/{fileId}/content` | Original CSV; 410 once cancelled |
| `GET /files/{fileId}/invalid-rows` | Importer only; 409 when not waiting for corrections |
| `PATCH /files/{fileId}/invalid-rows` | Importer only; saves corrections without re-checking; body `{rows:[RowCorrection]}` |
| `POST /files/{fileId}/recheck` | Importer only; body `{corrections:[RowCorrection]}`; returns `{status, file, invalidRows}` |
| `POST /files/{fileId}/cancel` | Importer only; 409 when the file has approved transactions; idempotent |
| `GET /transactions` | Paged list. Query: `page`, `pageSize`, `sortBy` (`TransactionDate`\|`Reference`\|`AccountNumber`\|`Description`\|`Amount`\|`Currency`\|`TransactionType`\|`Status`\|`FileName`), `sortDirection`, `status`, `fileId`, `dateFrom`, `dateTo`, `minAmount`, `maxAmount`, `search`. Response includes `hasAnyTransactions` |
| `GET /transactions/{transactionId}` | |
| `GET /transactions/imported-count` | Approver only; `{count}` |
| `POST /transactions/{transactionId}/approve` | Approver only; 409 with `{message, transaction}` |
| `POST /transactions/{transactionId}/reject` | Approver only; body `{reason}` (1-500 chars after trim); 409 with `{message, transaction}` |
| `GET /transactions/export` | Approver only; same filter and sort params as the list; CSV attachment; 409 when nothing matches |
| `GET /events` | SSE, both roles; events `file-changed`, `transactions-changed`, `resync`, `session-ended`; heartbeats; must not be called cross-origin |

### API conventions the front-end must follow

- 400 validation problems use camelCase JSON-path keys (`$` means the whole body).
- 401 bodies carry a `reason`. Return the person to sign-in with a matching message (SI-03, SI-06, SI-07).
- 403 bodies carry a message telling the person to ask their administrator (AC-02).
- 409 on approve/reject carries the current transaction. Show its current status (AP-04, RJ-05).
- Amounts are JSON numbers with exactly 2 decimals.
- Transaction dates are ISO local times without an offset.
- Export is a CSV download. The file name comes from `Content-Disposition`.
- File upload progress and live status come from the upload request and the `/events` SSE stream (UP-07). Handle `resync` by refetching and `session-ended` by returning to sign-in.

---

## Compliance

**Applicable domains:** `popia`, `pci-dss`
**Region (if Personal data applies):** `ZA`

### Compliance Requirements

**POPIA (South Africa).** Personal data in this app: signed-in users' names and emails, and bank account numbers (plus free-text descriptions that may name people) in transactions.

- `[INFERRED]` Personal data is collected and used only for the stated purpose (reviewing and approving bank transactions). Data minimisation applies: do not show or log more personal data than a screen needs.
- `[INFERRED]` Personal data (names, emails, account numbers) encrypted in transit (HTTPS/TLS 1.2+) and at rest in the back-end store.
- `[INFERRED]` Account numbers and descriptions MUST NOT appear in client-side logs, analytics, or error-reporting payloads.
- `[INFERRED]` Original uploaded files contain account numbers. Access is limited to signed-in users (FD-05) and the copy is discarded on cancel (FX-04).
- `[INFERRED]` A purpose / privacy notice link is visible on the sign-in screen, the only form that collects personal data from the user.
- `[QUESTION]` Right to erasure / data-subject requests: the brief has no profile page and no user self-service. Confirm whether a data-subject request process is needed (e.g. handled out-of-band by the administrator) or explicitly out of scope.

**PCI-DSS.** The brief's data contains no card numbers (credit/debit are transaction types, not cards). The entries below mostly constrain what must never be accepted or logged.

- `[INFERRED]` No card data (PAN, CVV, magnetic stripe) is accepted, stored, or displayed. If a file or description appears to contain a card number, it must not be echoed in UI, logs, or error messages.
- `[INFERRED]` Error messages and logs MUST NOT include card numbers or other sensitive payment details.
- `[INFERRED]` All pages and API traffic served over HTTPS with TLS 1.2+ in production.
- `[INFERRED]` No payment capture flow exists. Any later addition of one must use third-party hosted fields (Stripe / Adyen / PayFast pattern).

---

## Styling & Branding

| Field | Value |
|---|---|
| Primary brand color | `#0F172A` (template default, slate-900) |
| Accent / secondary | `#2563EB` (template default, blue-600) |
| Background (light) | `#FFFFFF` |
| Background (dark, if applicable) | n/a |
| Font family (headings) | Inter (template default) |
| Font family (body) | Inter / system stack (template default) |
| Theme | light only |
| Source | defaulted (no design, no branding in the BRD) |

> **Thin section:** no design or brand source exists. These values are template defaults and are provisional. Status is always conveyed in words, never by colour alone (FS-03). All colours/fonts reference tokens in `globals.css` per [styling-centralisation.md](.claude/policies/styling-centralisation.md). Please confirm or supply brand colours.

---

## Baseline NFRs

- **NFR-base-1:** Accessibility: WCAG 2.1 Level AA baseline
- **NFR-base-2:** Performance: First Contentful Paint < 2.5s on a mid-tier mobile network
- **NFR-base-3:** Responsive design: mobile (≥360px) / tablet (≥768px) / desktop (≥1280px) breakpoints
- **NFR-base-4:** Browser support: latest two versions of Chrome / Edge / Firefox / Safari
- **NFR-base-5:** Error UX: user-visible error states with retry affordance for all async operations
- **NFR-base-6:** Next.js rewrite proxy / route handlers required (back-end sends no CORS headers). The browser never calls `:5100` directly.
- **NFR-base-7:** Keyboard-only operability for every action, and labelled tooltips on icon-only buttons (GN-02, GN-03)
- **NFR-base-8:** Success messages auto-dismiss after a few seconds. Problems needing attention persist until resolved (GN-05)

---

## Out of Scope (project-level, from the brief's "Not in scope")

- Configuring file kinds. Bank transactions is the only kind of file, and it is fixed.
- Collecting files from a shared folder. Files arrive only by upload.
- Currencies other than ZAR, and any currency conversion.
- Password reset, account lockout, and two-step sign-in.
