# architecture.md — Book Buddha

*On-demand allied file (not auto-loaded). Seeded 2026-11-14 from the repo docs.
Sources cited inline: DD = spec/Design Document (9 Nov), ARCH = ARCHITECTURE_AND_DATABASE.md,
PROTO = book-buddha/ prototype files. Anything uncertain is flagged — do not treat
this as settled truth; see `decisions.md` and `todos.md` for open conflicts.*

## Two realities (read this first)
The repo holds **two different things** and they do not fully agree:
1. **Target** — the approved specification (DD, ARCH target sections) for a local,
   offline-first, one-company accounting app.
2. **Current prototype** — an earlier working codebase in `book-buddha/` that already
   implements a subset. (ARCH §1)

Do **not** assume a target screen or table already exists in the prototype. Label work
as **Target** or **Current prototype**. The README/handoffs say "nothing is built,"
which is stale — the prototype exists and self-reports passing tests. (conflict, see
`todos.md`)

## Target architecture (ARCH §3–§4, DD §2)
Browser UI (React) → local app over HTTP/JSON on localhost. Layers:
- **Presentation** — React UI (`web/`).
- **API / auth** — validates ALL input, enforces company/business/project scope,
  never trusts frontend totals or statuses.
- **Application / accounting engine** — owns lifecycle, integer-paise math, rounding,
  tax, cash/accrual, allocations, FIFO, deferred revenue, journal balancing,
  reversals, FY locks, audit events.
- **Repository** — every financial operation runs in ONE DB transaction; commit only
  if all steps succeed.
- **Storage** — one **SQLite file per company**.

Target module tree (ARCH §4): `src/api`, `src/application/*`, `src/accounting/*`,
`src/database/*`, `src/security`, `src/audit`, `web/src/*`. ARCH says extract modules
gradually — avoid a big rewrite.

Target SQLite settings (ARCH §3.5): foreign keys ON, integer paise, ISO
dates/timestamps, explicit indexes, ordered transactional migrations, integrity
checks at startup and before backup/restore.

## Technology stack
- **Target spec:** sets no formal language/framework; names SQLite as the DB and
  React for UI. Formal stack choice is still officially "pending" (see `todos.md`).
- **Current prototype (PROTO package.json / tsconfig / vite.config / README):**
  TypeScript (strict, ES2022, NodeNext) · SQLite via `better-sqlite3` ^13 ·
  **Fastify** ^5 API · **Zod** ^4 validation · **React 19** + **Vite 7** frontend
  (web root `web/`, dev proxy `/api` → :3000, frontend :5173) · **Vitest 3** tests ·
  Node 22+ (24 verified). Scripts: `npm test`, `npm run build` (tsc),
  `npm run build:web`, `npm run start:api`, `npm run dev:web`. On Windows,
  `better-sqlite3` needs VS C++ Build Tools.
- **Desktop packaging:** undecided — Tauri (preferred in REQUIREMENTS) vs Electron
  (IMPLEMENTATION_PROGRESS). Packaging is last in the delivery order.
- **PDF/OCR (from Feature Design):** cites pdfplumber / Camelot (Python) and
  Tesseract / PaddleOCR — note these are Python, while the prototype is TypeScript.
  Unresolved (see `todos.md`).

## Prototype structure & progress (PROTO/IMPLEMENTATION_PROGRESS.md — self-reported, unverified)
Top level: `src/` (accounting/types.ts, accounting/engine.ts, database/schema.ts,
database/repository.ts, api/server.ts, api/main.ts), `web/` (App.tsx), config files,
README/REQUIREMENTS/SETUP/CLAUDE_FINISHING_PLAN/IMPLEMENTATION_PROGRESS.
- **Reported done:** SQLite schema + repository + migrations + audit events;
  companies/businesses/customers/items/fairs; cash/accrual per company;
  draft/finalised/cancelled/quotation invoices; multi-line invoices; GST
  CGST/SGST/IGST at invoice level; payments + ageing; FIFO + COGS; Trial Balance,
  P&L, Balance Sheet, GL, fair & stock reports; quote→draft; credit notes + returns
  (API). Claims 19 passing tests + successful builds (NOT run/verified here).
- **Reported not done:** recurring invoices, print/PDF, suppliers, purchase
  bills/returns, expenses, supplier payments, bank accounts & reconciliation, Cash
  Flow, filters, consolidated reports, opening balances, CSV/Excel import/export,
  backup/restore, attachments, auth/roles/sessions/lockout, FY locking, hash-chain
  audit, versioned migrations, automated backups, desktop packaging.

### Auth layer — VERIFIED as built, session 6 (not self-reported)
The target's "API / auth" layer now exists in the prototype and is gated. Wiring:
- **`src/api/server.ts`** — ONE `onRequest` hook inside `buildApi` is the single
  enforcement point for all 101 routes. It **fails closed**: a route is reachable
  without a session only when registered with `config: { public: true }`, read from
  the matched route's own config, never from the URL string. An unmatched path has no
  config, so it is denied rather than answering 404. Public surface is exactly
  `GET /health`, `GET /auth/status`, `POST /auth/setup`, `POST /auth/login`,
  `POST /auth/recover` (7 table entries — Fastify mirrors HEAD onto every GET).
  Unconfigured DB → 409; bad/expired/revoked token → 401. `app.authRoutes` (built by
  an `onRoute` hook) exposes the route table so the test sweep is DERIVED, not listed.
- **`buildApi(repo, { __unsafeDisableAuthForTests })`** — opt-in, default off, and
  deliberately unreachable from `createApi`, `main.ts`, env vars and config files.
  Used at 28 test call sites. **Never add a way to set it from outside code.**
- **`src/auth/recovery-code.ts` + `src/database/recovery-code-schema.ts` (migration
  v16)** — `auth_users.recovery_code_hash`. Recovery is by 150-bit code only; the old
  `email`/`googleSub` identity match is GONE. Using a code burns it and reissues.
  `POST /auth/recovery-code` (authenticated, needs the current password) mints one.
- **`web/src/AuthGate.tsx` + `web/src/session.ts`** — the UI gate. The token lives in
  module scope in `session.ts`; `api()` in `App.tsx` reads it via `authHeaders()`.
  Not persisted, so a refresh signs out. Designed to be deleted whole when the real
  UI lands. **`web/` is type-checked by NOTHING** (`tsconfig` is `include: ["src"]`,
  vite is transpile-only) — see decisions S6-4.

### Stock → ledger — VERIFIED as built, session 7 (R4c)
Hand-entered stock used to move inventory with no GL effect. It now posts, and the
wiring is deliberately thin — **no new table and no migration** (v17 is still free):
- **`addStockMovement` (`src/database/repository.ts`)** — OPENING posts
  `Dr INVENTORY / Cr OPENING_BALANCE_EQUITY`, ADJUSTMENT `Cr STOCK_ADJUSTMENT`
  (seeded at v13); a bare PURCHASE still posts NOTHING, because its bill posts it.
  Movement + entry are ONE transaction, through `insertJournalEntry`, so the FY lock
  and the chart validation apply and a refusal leaves no stock row behind.
- **`"STOCK_MOVEMENT"` in `JournalSourceType`** — `journal_entries.source_type` has
  no CHECK in SQLite, so this is a TypeScript widening. `source_id` is the movement's
  own id: a movement is posted exactly when such an entry carries its id, which is
  also what makes the backfill idempotent. No link table exists or is needed.
- **`resolveStockMovementBusiness`** — the ONE place a movement's business is decided
  (items belong to a company, entries need a business): derived when the company has
  exactly one, refused by name when it has more. Reversing it is a one-line change.
- **`occurredOn`** dates the JOURNAL ENTRY only. `stock_movements.occurred_at` stays
  the insertion instant because `getStockLayers` consumes FIFO `ORDER BY occurred_at`
  — a back-dated layer would re-measure COGS already posted.
- **`planStockJournalBackfill` / `backfillStockJournals` + `POST /inventory/journal-backfill`**
  — for movements entered before R4c. **Dry run unless `apply: true`**, idempotent,
  refuses locked years and lists each refusal, posts the ORIGINAL layer value, and
  COUNTS source-less PURCHASE movements as uncovered rather than implying a tie-out.
- **`web/src/App.tsx`** — the Add stock card names the reason and states what it will
  post before submission; a second card shows the inventory-vs-stock tie-out and runs
  the backfill (check-only first). Reports load on mount, so the tie-out is never read
  off an empty trial balance. Still no UI tests, and `web/` is still ungated (S6-4).

## Prototype vs spec — known divergences (ARCH §6)
- One `invoices` table for drafts/quotes/finalised/cancelled (ARCH §6 wants a
  deliberate choice; target uses a common `documents` header).
- Hardcoded account codes (CASH, RECEIVABLES, SALES, INVENTORY, COGS, OUTPUT_*).
- Invoice-level GST vs target's user-named per-line taxes (DD §13.1).
- Roles in REQUIREMENTS vs spec's Phase-1-Admin-only (DD §15.1).
- Cash/accrual per company vs spec's per-report (DD §4.5).

*Note: `book-buddha/CLAUDE_FINISHING_PLAN.md` was NOT read and may govern the
prototype's own next steps — read it before acting on the prototype.*
