# architecture.md — Book Buddha

*On-demand allied file (not auto-loaded). Seeded 2026-11-14 from the repo docs.
Sources cited inline: DD = spec/Design Document (9 Nov), ARCH = ARCHITECTURE_AND_DATABASE.md,
PROTO = book-buddha/ prototype files. Anything uncertain is flagged — do not treat
this as settled truth; see `decisions.md` and `Progress.md` → Open to-dos and questions for open conflicts.*

## Two realities (read this first)
The repo holds **two different things** and they do not fully agree:
1. **Target** — the approved specification (DD, ARCH target sections) for a local,
   offline-first, one-company accounting app.
2. **Current prototype** — an earlier working codebase in `book-buddha/` that already
   implements a subset. (ARCH §1)

Do **not** assume a target screen or table already exists in the prototype. Label work
as **Target** or **Current prototype**. The README/handoffs say "nothing is built,"
which is stale — the prototype exists and self-reports passing tests. (conflict, see
`Progress.md` → Open to-dos and questions)

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
  React for UI. Formal stack choice is still officially "pending" (see `Progress.md` → Open to-dos and questions).
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
  Unresolved (see `Progress.md` → Open to-dos and questions).

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

### Import / export — VERIFIED as built, session 14 (R10)
New folder `src/import-export/`; **no migration** (still v22). Every write goes through public
`AccountingRepository` methods, so posting, validation and the audit log are the normal ones.
- **`codec.ts`** — pure file reading: encoding (BOM → UTF-8 → Windows-1252), delimiter
  detection, RFC 4180 CSV, flat JSON; rupees → paise by string arithmetic; dates in the format
  the user picks in the column map (never guessed).
- **`import-engine.ts`** — stateless two-phase: `inspect` → `preview` → `commit`. One outer
  transaction per run; each record or document (rows grouped by Number) is a nested savepoint,
  so a failure is skipped and listed while the rest post. PREVIEW runs the same path and always
  rolls back. The kind registry is `registeredKinds()` (a function, because masters/documents
  and the engine import each other).
- **`import-masters.ts`** — customers, suppliers (duplicate name/GSTIN → skipped), items (same
  name → updated; opening stock on new items), opening balances (general, customer, supplier).
- **`import-documents.ts`** — invoices, purchase bills, credit notes, customer and supplier
  payments: posted on their own dates; refused on or before the latest opening-balance date;
  existing number → skipped (rulings S14-3).
- **`exports.ts`** — 11 datasets to CSV (BOM, CRLF, formula guard) or JSON; documents one row
  per line, headers = the importer's labels, so an export re-imports.
- **Routes** (`src/api/import-routes.ts`, `export-routes.ts`, wired in `buildApi`):
  `GET /imports/kinds`, `POST /imports/inspect|preview|commit` (20 MB body limit, base64 JSON),
  `GET /exports/:dataset?format=csv|json`. All behind the fail-closed auth hook.
- **Not built:** .xlsx and PDF (need a package install), expenses import.

## Prototype vs spec — known divergences (ARCH §6)
- One `invoices` table for drafts/quotes/finalised/cancelled (ARCH §6 wants a
  deliberate choice; target uses a common `documents` header).
- Hardcoded account codes (CASH, RECEIVABLES, SALES, INVENTORY, COGS, OUTPUT_*).
- Invoice-level GST vs target's user-named per-line taxes (DD §13.1).
- Roles in REQUIREMENTS vs spec's Phase-1-Admin-only (DD §15.1).
- Cash/accrual per company vs spec's per-report (DD §4.5).

*Note: `book-buddha/CLAUDE_FINISHING_PLAN.md` was NOT read and may govern the
prototype's own next steps — read it before acting on the prototype.*

## Slice definitions (moved from Progress.md, S17-11; condensed)

### §13 reports 1–6 (REPORT_DEFINITIONS_S12, built session 13)
| # | Report | Figures from | Must tie to | Does NOT |
|---|---|---|---|---|
| 1 | Customer statement | open-items query (incl. settled), own payments, applied credits, opening receipts; credit notes from journal | closing = customer's outstanding (hand example Rs 15,000 = getReceivables) | show cash invoices, take cash basis, net unapplied credit |
| 2 | Customer Balance Detail | same open-items query; subtotal per customer | total = getReceivables, same filter | net unapplied credit, roll back settlements for an as-at date |
| 3 | Collections | Balance Detail rows past due date (no due date → invoice date, row says so), oldest first | strict subset of Balance Detail | rebuild a historical balance |
| 4 | Stock ageing | FIFO layers by bill/journal/credit-note entry date; bands 0–30, 31–60, 61–90, over 90; undated layers counted and shown | buckets sum to Inventory Valuation | filter by business/fair (stock has none) |
| 5 | Inventory Valuation Detail | each remaining lot: item, received date + basis, qty, unit cost, value, source | = getInventoryValuation by item | re-sort FIFO (stays `occurred_at, rowid`) |
| 6 | Item profitability | revenue from Sales by Item; COGS from the same sales' stock rows by source date | COGS = COGS account (no date filter); revenue = Sales by Item | spread discount/GST across lines, cash basis, store a margin % |

### R10 import / export (spec §14.1–14.2; rulings S14-3) — extra design detail
- **Shape:** stateless inspect → preview (real posting path in a transaction that always rolls back) → commit. Body `{ fileName, contentBase64, … }`, 20 MB limit. No migration. CSV/JSON only.
- **Codec rules:** `decodeBytes` BOM → strict UTF-8 → Windows-1252; `detectDelimiter` (comma, semicolon, tab, pipe); RFC 4180 CSV; JSON = array of flat objects or `{ rows }`; header trimmed, blank/duplicate header = error; `rowNumber` = spreadsheet row (header 1). `parseRupeesToPaise` by string arithmetic (accepts `1,23,456.50`, `₹`, `Rs`; rejects third decimal, letters, bad commas). `parseDate` takes the format the user picks (never guessed); impossible dates rejected. `normaliseName` = NFC, trim, collapse spaces, lower-case.
- **Engine contract:** `ImportKindDefinition { kind, scope COMPANY|BUSINESS, fields, groupBy?, post(context, rows) }`; `runImport({ …, mode PREVIEW|COMMIT })`. Unit = one record or one document (rows sharing `groupBy`), each in a savepoint: failure is collected as FAILED with row numbers, the rest go on. Result `{ mode, kind, totalRows, units, created, updated, skipped, failed, outcomes }`. SKIPPED = already exists.
- **Masters:** customers/suppliers (same name or GSTIN → SKIPPED; customer number always allocated); items (same name → update filled cells; Opening quantity + cost on a NEW tracked item posts OPENING); opening-balances, opening-customer-balances, opening-supplier-balances.
- **Documents (BUSINESS, grouped by Number):** invoices, purchase-bills, credit-notes (confirmBackdatedMonth automatic: the preview is the confirmation), payments, supplier-payments. Existing number → SKIPPED; dated on or before the latest opening-balance date → FAILED "would count twice"; locked FY / unknown party → FAILED.
- **Session 17 additions:** expenses kind (keeps its own number; lines folded into one amount; blank payment account → PAYABLES with a supplier else CASH); repeated payments (count-based against a per-run snapshot: the k-th equal row is skipped only if the books already hold ≥ k equal live payments, so re-importing a file skips all); `import.committed` audit event + `GET /imports/last` (latest commit per kind).
- **Exports:** `GET /exports/:dataset?format=csv|json` — 11 original datasets + 8 report datasets (P&L, Balance Sheet, customer statement, customer balance detail, collections, stock ageing, inventory valuation detail, item profitability) with their report filters. CSV: BOM, CRLF, money as `1234.50`, text cells starting with `= + - @` tab or CR get a quote guard (stripped on import).
- **Not built:** .xlsx and PDF (install, Q16).

### R12 banking (plan S15; all 12a–12g built, 3562d71)
His answers S15: R12 = QBO-style bank categorisation; payments take ANY cash/bank account plus a payment MODE; "Transfers" = **Internal Transfers**; OD/CC is a bank account shown as LIABILITY (S15-4: counted as borrowing; counts as cash in R13 only if `part_of_cash_management` is set).
| Sub-slice | Design | Migration |
|---|---|---|
| 12a Bank accounts + register | `createBankAccount` (role BANK, company-owned; ASSET for current/savings, LIABILITY for OD/CC); `bank_accounts` side table (kind, bank name, last 4 digits only, IFSC, `part_of_cash_management` default 1, 0 for OD/CC, sanctioned limit); payment modes CASH, NEFT, RTGS, IMPS, UPI, CHEQUE, OTHER (editable); `getAccountRegister` with running balance. Seeded `BANK` is company-NULL, so register and reconciliation key on company + account through `journal_entries.business_id`. | v23 modes, v25 |
| 12b Money through any account | new `money_account`, `payment_mode`, `payment_reference` columns on payments, supplier payments, invoices, bills, expenses, refunds, opening receipts/settlements; default CASH; trigger checks CASH/BANK role. Old `payment_account` keeps its meaning (paid at once vs credit). Cancel reverses to the SAME money account. `deriveCashView` recognises MONEY_VOUCHER entries on their own date. | v24 |
| 12c Internal Transfers + Vouchers | `TRF-001/25-26`, `RV-`, `PV-` per company per FY; transfer = Dr to / Cr from, not in P&L or cash flow; vouchers Dr/Cr any non-control account (GST accounts allowed; not CASH/BANK, RECEIVABLES, PAYABLES, INVENTORY); cancel by reversal, reason required | v26 |
| 12d Reconciliation | `bank_reconciliations` + lines pointing at `journal_lines.id`; statement end date + balance; finish only at difference 0 (no plug); undo only the latest FINISHED, reason required; report: beginning, cleared in/out, ending, uncleared, changed after finishing; C/R status in register | v27 |
| 12e Statement import | CSV/JSON, one bank account; lines held in `bank_statement_lines` OUTSIDE the books (FOR_REVIEW); bank "Debit" = money OUT = negative; k-th fingerprint duplicate rule (two identical Rs 59 lines in one file are both kept); bad rows FAILED, request-level faults 400; one audit event per commit | v28 |
| 12f Review queue | Add (voucher) / Split / Uncategorise / Transfer / Match (invoice → payment, bill → supplier payment, posted line → link only) / Exclude / Undo; every posting two-step (`confirm:false` rolls back and shows `willPost`, S11-7); a line cannot post without a business (FD §D4); one transaction per action; over-payment match refused in V1; undo refused while ticked in IN_PROGRESS or in a FINISHED reconciliation | — |
| 12g Bank rules | pre-fill only: conditions on description/reference/amount (contains, not contains, equals, greater, less), priority order, ALL/ANY, scope per bank, ADD or TRANSFER; cannot target UNCATEGORIZED or control accounts; never posts | v29 |
- **Cancel guard:** `assertNotOnBankLine` in the four cancel doors, plus a backstop in `postJournalEntry` refusing ANY reversal of an entry linked to a statement line. Reconciliation pre-ticks (C) lines linked to statement lines dated ≤ end date.
- **My calls (S15, for Dhruv):** transfers and reconciliation charges carry ONE business; a difference is never plugged; a bank line dated on/before the last reconciled date is allowed with a confirm and listed as "changed after reconciling".
- **Out of R12:** PDF statements/OCR, live feeds, auto-post rules, Undeposited Funds, credit cards, multi-currency.

### R13 Cash Flow Statement — DIRECT method (S17-6; built by C, v30)
- Files: `src/database/cash-flow.ts`, `cash-flow-section-schema.ts` (v30 `chart_accounts.cash_flow_section`, NULL = derive), `src/api/cash-flow-routes.ts`; `GET /reports/cash-flow?businessId=&from=&to=`, `PUT /chart-accounts/:code/cash-flow-section` (audited).
- Sections: Capital, Opening Balance Equity, Loans → FINANCING; everything else OPERATING unless set. Cash = CASH/BANK role accounts except an OD/CC with `part_of_cash_management = 0` (financing). Internal transfers are not flows.
- Operating lines: received from customers, paid to suppliers, paid for expenses, other income. Cash is attributed to the opposite-side non-cash lines pro-rata; GST lines follow the entry's largest non-tax counterpart. Opening-balance entries (`source_type OPENING_BALANCE`, id `je-opening-balance-%`) make "cash at the beginning", but receipts/settlements against them ARE flows. TIE: opening + net = closing from the trial balance.

### Session 17 built behaviour (A, B, H, migrations)
- **A:** refund default = the document's original money account (paid-at-once → stored account; credit document → account of its latest live payment; else CASH); `updateDraft` keeps omitted money fields; zero-cost stock rows check the FY lock (several businesses → any lock refuses); `addStockMovement` refuses `PURCHASE`; ADJUSTMENT already posts Dr Inventory / Cr Stock adjustment (v13, no migration).
- **B:** audit events `attachment.uploaded`, `attachment.deleted`, `backup.restored` (written into the restored database).
- **H bill discount (Q1, Q2, S17-7):** trade discount spread over STOCK lines only, pro-rata by line value in whole paise (`spreadBillDiscount`, engine.ts, largest remainder), then per unit with the remainder on the line's last unit; non-stock lines keep full price; INVENTORY debited net; no PURCHASE_DISCOUNT credit for the spread part; GST base unchanged. Returns take the bill's own discounted lots. **Settlement discount at payment** (`settlementDiscountPaise`): Dr PAYABLES amount+discount / Cr money amount / Cr PURCHASE_DISCOUNT ("Discount received"); read off the posted entry; cash view recognises it on the payment date. **S17-10 (built):** `assertBillDiscountFitsStock` (repository.ts) refuses at create and finalize a discount above the stock-line value, or any discount on a bill with no stock lines (400, exact messages in decisions.md S17-10); equal to stock value is allowed (all-stock + equal: ON HOLD).
- **Migrations:** v30 cash flow section · v31 `invoices.source_quotation_id` (quotation link) · v32 `idx_invoices_business_number` · v33 `before_opening` (F) · reserved v34 GST per line + round-off · v35 R14 archive.
- **Numbering (S17-4/8/9, built):** `nextBusinessNumber` (repository.ts) gives `INV-001/25-26`, `QUO-`, `CN-`, `PR-` per business, prefix and FY of the document's own date, highest ever + 1 (`nextNumberAfter`, internal-transfers.ts); HTTP create routes refuse a `number`; imports keep their own. Conversion gives the next INV number, `source_quotation_id` ↔ `converted_invoice_id`; `updateDraft` refuses QUOTATION↔DRAFT ("Use Convert").
- **F pre-opening history (S16-2(c), Q13, S17-12, built):** opening date = latest live `as_at` (`openingDateOf`, `isBeforeOpening`). A document/payment dated on/before it needs `confirmBeforeOpening`, then is FINALIZED with `before_opening = 1`: no journal, no stock, audit `<doc>.recorded_as_history`, cancel posts nothing. Ledger reports exclude it untouched; document-table reads (open items, payables, statements, credit balance, sales-by-item, note reports, cash view) filter it. Payments after opening on a history document, and credit notes/returns on one, are refused (point to the opening balance). Imports keep such rows as history; exports carry "Before opening".
