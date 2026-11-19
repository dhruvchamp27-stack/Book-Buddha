# Implementation progress

This file is the handoff record for continuing work if a session ends or context
limits are reached. Update it after every meaningful implementation phase.

## Completed

- [x] SQLite schema, repository, migrations, and audit events
- [x] Companies, businesses, customers, items, and fairs
- [x] Company accounting basis setting: cash or accrual
- [x] Draft, finalized, cancelled, and quotation invoices
- [x] Multiple invoice lines and item links
- [x] Invoice dates, due dates, discounts, extra charges, notes, and terms
- [x] Invoice-level GST with CGST/SGST and IGST
- [x] Customer payments, partial payments, receivables, and ageing
- [x] FIFO inventory, stock validation, COGS, and inventory reversals
- [x] Trial Balance, Profit & Loss, Balance Sheet, General Ledger, fair sales, and stock reports
- [x] Quotation-to-draft-invoice conversion
- [x] Accrual-always posting, Balance Sheet credit-normal liabilities, business/date report filters, and a derived Cash/Accrual Profit & Loss toggle (Slice 7)
- [x] React/Vite frontend and Fastify API
- [x] 19 passing tests and successful backend/frontend builds
- [x] README, setup guide, and requirements specification

## Not yet implemented

- [x] Credit notes and item-linked sales returns (API/repository, GST and inventory reversal, frontend UI, and sales-returns report)
- [x] Recurring invoice templates and generation (API, repository, and due-invoice generation are done; frontend UI is DEFERRED to the later UI phase)
- [ ] Print/PDF invoices
- [x] Suppliers and supplier statements (backend; supplier delete/deactivate and `GET /suppliers/:id` DEFERRED)
- [x] Purchase bills and purchase taxes (backend; **purchase returns** and header-level bill discount/extra-charge DEFERRED)
- [x] Expenses (backend; **receipts/attachments** DEFERRED)
- [x] Supplier payments and payables ageing (backend; supplier **refunds** and cancelling a supplier payment DEFERRED)
- [ ] Bank accounts, transfers, and reconciliation
- [ ] Cash Flow Statement
- [ ] Projects (fairs) as a first-class dimension with a per-project P&L (next slice)
- [ ] Cash view of Trial Balance, Balance Sheet and General Ledger (deferred; the Balance Sheet needs an Unearned Revenue account from the Subscriptions slice)
- [ ] Owner decision: how credit notes are recognised in the cash view
- [ ] Fair, item, and customer report filters (business and date filters on P&L, General Ledger, Trial Balance and Balance Sheet are done in Slice 7c)
- [ ] Opening balances
- [ ] CSV/Excel import and export
- [ ] PDF report export
- [ ] Backup and restore
- [ ] Attachments and document storage
- [x] Authentication, password hashing, roles, sessions, and lockout (backend: scrypt app password, single-Admin role, sessions with 1-hr idle expiry, 5-try/15-min lockout, change/recover; login UI + live Google OAuth verification DEFERRED to the UI slice)
- [ ] Financial-year locking
- [ ] Strong immutable audit controls
- [x] Versioned migration system (structured logging: minimal hook only, full wiring deferred)
- [ ] Automated backups and integrity checks
- [ ] Tauri/Electron desktop packaging
- [ ] Safe review and remediation of `npm audit` advisories

## Current handoff

The repository now has an updated completion plan in
`CLAUDE_FINISHING_PLAN.md`. It reconciles the nested prototype with the
approved target specification in the repository root and defines the full
vertical-slice roadmap, migration rules, acceptance gates, and definition of
fully fledged readiness.

Credit-note frontend and reports are **done** (Slice 1 of the finish plan).
The web app has a credit-note card (select a finalized invoice, choose return
lines with quantities capped at returnable, create draft, finalize) and a
"Sales returns" report with the total returned; the API adds
`GET /credit-notes?invoiceId=&status=`. Slice 1 gates passed: 21/21 vitest
tests, tsc exit 0, and vite build exit 0.

Recurring invoice templates are **backend-done** (Slice 2 of the finish plan):
new template tables, `src/accounting/recurrence.ts` date cadence helpers,
repository create/list/update/deactivate and `generateDueInvoices` (draft
invoices, atomic and idempotent), and the `/recurring-invoices` API routes.
The frontend UI is **DEFERRED** to the later UI phase. Slice 2 gates passed:
32/32 vitest tests, tsc exit 0, and vite build exit 0.

Slice 3 (formal/versioned migrations) is **done**. `src/database/migrations.ts`
adds an ordered migration list and a `schema_migrations` table that records
applied versions; pending migrations run in ascending order, transactionally
by default, and the run is a no-op when up to date. Migration 1
(`baseline_schema`) is non-transactional because the legacy baseline toggles
PRAGMA foreign_keys, which SQLite ignores inside a transaction. Existing
databases keep their data. Structured logging is only a minimal optional
callback; full wiring is deferred.

Slice 4 (Foundation and authentication) is **backend-done**. New pure modules
`src/auth/password.ts` (scrypt hash/verify, ≥8-char letters+numbers policy) and
`src/auth/session.ts` (token gen + sha256 hash, 1-hr idle expiry, lockout
constants); migration v2 `auth_foundation` adds `auth_users` (single Admin) and
`auth_sessions` tables; repository methods `setupAdmin`/`login`/`validateSession`/
`logout`/`changePassword`/`recoverPassword` (each audited), and `/auth/*` API
routes (bearer-token). Lockout = 5 wrong tries → 15-min lock; sessions expire
after 1 hr idle. `recoverPassword` trusts an already-verified Google identity —
**live Google OAuth verification and all login/session UI are DEFERRED** to the
later UI slice; until then `/auth/recover` must stay localhost-only. Slice 4 gates
passed: 58/58 vitest tests, tsc exit 0, vite build exit 0.

Slice 5 (Customers, items, inventory) is **backend-done**. Migration v3
`customer_item_inventory` adds customer master fields (classification,
per-category auto-numbering SCH/LIB/CLG/RET/GEN from 0001, GSTIN, website,
2nd contact, billing/shipping address, internal notes, active flag) and item
fields (description, selling/cost/MRP paise, reorder threshold, active), plus a
`customer_number_counters` table for atomic numbering. Repository: enriched
create/list for customers+items, `updateCustomer`/`updateItem`,
`findDuplicateCustomers` (warn-not-block), `setCustomerActive`/`setItemActive`,
`deleteCustomer` (refused if linked to invoices/credit notes/payments/recurring
templates/fairs), and **read-only** inventory reports `getInventoryValuation`
(FIFO), `getLowStockItems`, `getSalesByItem`. New `/customers`, `/items` and
`/reports/{inventory-valuation,low-stock,sales-by-item}` routes.
**No accounting/journal logic changed** — opening/purchase stock still posts no
GL entry; tying the stock sub-ledger to the INVENTORY ledger is a deferred
accounting decision for Slice 6 (purchasing) / opening balances. Slice 5 gates
passed: 73/73 vitest tests, tsc exit 0, vite build exit 0.

Slice 6 (Purchasing and expenses) is **backend-done**. Migration v4
`purchasing_expenses` (transactional:false) drops the `journal_entries -> invoices`
FK and adds `source_type`, widens the `journal_lines` account CHECK with
`PAYABLES / INPUT_CGST / INPUT_SGST / INPUT_IGST / EXPENSE`, adds
`PURCHASE_REVERSAL` to `stock_movements`, and creates `suppliers`,
`purchase_bills(+lines)`, `expense_categories`, `expenses` and
`supplier_payments`; the rebuilds preserve every index and replay any trigger,
and a `foreign_key_check` gates success. New pure engine helpers
(`purchaseEntry`, `inputTaxLines`, `reverseEntry`, `supplierPaymentEntry`) post
through `balancedLines`. Purchase bills **tie inventory to the INVENTORY ledger**:
a tracked line debits INVENTORY and adds a FIFO PURCHASE lot (source = bill id);
non-tracked lines debit EXPENSE; input GST debits INPUT_*; the payment account
(CASH or PAYABLES) is credited the full total. Expenses post the same way on a
single amount. Supplier payments debit PAYABLES, credit CASH, capped at the
document's outstanding. Cancels are exact reversals, immutable otherwise;
a bill cancel is **refused per-lot** if any of the bill's own purchased stock was
already sold, and **refused** if supplier payments exist. `getPayables` and
`getSupplierStatement` added; Balance Sheet now carries INPUT_* (asset) and
PAYABLES (liability) and the P&L carries EXPENSE.

**Deliberate decisions in Slice 6 (surface to the owner):**
- ~~**Recognition is accrual-at-finalize for all companies, BUT cash-basis
  companies are refused PAYABLES (credit) bills/expenses** (CASH only).~~
  **SUPERSEDED** — cash-basis credit purchases are now fully supported with
  payment-based expense recognition (see "Cash-basis credit purchases" below).
- **Retained earnings on the Balance Sheet was corrected** from `SALES` only to
  `SALES - COGS - EXPENSE`. This changes sales-side Balance Sheet output whenever
  COGS exists (no prior test asserted it; the sheet could not balance without it).
- ~~**Known pre-existing presentation quirk:** liability rows reported as
  `debit - credit`, so liabilities (incl. PAYABLES) showed as **negative**
  numbers and `totalLiabilitiesPaise` was negative.~~ **FIXED in Slice 7a:**
  liabilities are now credit-normal and read positive.
- Inventory ties to the ledger for **bill-sourced** stock only; stock added via
  `addStockMovement` (OPENING/ADJUSTMENT) still posts no GL entry (opening-balance
  offset account is a later decision).

Slice 6 gates passed: 87/87 vitest tests, tsc exit 0, vite build exit 0.

> **⚠️ SUPERSEDED 2026-11-15 by the accrual-always decision (see `SLICE_7_PLAN.md`).**
> The owner replaced the per-company cash/accrual model with **accrual-always posting +
> a Cash/Accrual toggle at report level** (DD §4.5 / QBO). The payment-time deferral
> described in this section (and the two engine helpers it added) was **refactored
> away in Slice 7b** — accrual became the only posting path, and cash-basis is a
> **derived report view** from payment allocations, never a posting restriction. Commit
> `5576a21` stays in history; its tests were rewritten in Slice 7b. The description below is retained
> as the record of what was built, not as the current design.

**Cash-basis credit purchases (payment-based expense recognition)** is
**backend-done** (commit `5576a21`, no migration). Cash-basis companies can now
create/track PAYABLES (credit) bills and expenses; the Slice-6 refusal is reversed.
At finalize only stock received posts (Dr INVENTORY / Cr PAYABLES on V, the inventory
subtotal; nothing posts when V=0). Expense (E) and input tax (ITC) are **deferred**
and recognized proportionally as supplier payments are made. Two new pure engine
helpers: `cashBasisPurchaseFinalizeEntry` (inventory-only finalize entry, or `null`),
and `cashBasisSupplierPaymentLines` (a clamp-and-redistribute allocator driven by
recognized-so-far, with a **cumulative** CGST/SGST split, so no journal line is ever
negative and full payment lands exactly on {V, E, tax} == the accrual figures).
`recordSupplierPayment` picks the plain vs deferred posting from **what finalize
actually posted** (the PAYABLES credit vs the document total), not the current basis,
so accrual is byte-identical. Cancel of a deferred V=0 document uses a non-throwing
source-entry lookup and an empty reversal.

**Handoff notes for the owner:**
- The **ledger** PAYABLES balance equals V (inventory only) for a cash-basis credit
  purchase, while `getPayables` reports the full document-level outstanding (V+E+tax).
  This is deliberate — test req6 (full payable visible until paid) against `getPayables`,
  not the ledger. Reports were not changed; P&L/Balance Sheet read the ledger and are
  correct (deferred expense/ITC auto-excluded until paid).
- COGS still hits the P&L if stock from an unpaid cash-basis bill is sold (existing
  sales-side behaviour; inventory is basis-neutral).
- Deferring ITC to payment is a symmetry choice, not GST-return timing — flag if the
  owner wants ITC claimed at bill date instead.

Cash-basis slice gates passed: 93/93 vitest tests, tsc exit 0, vite build exit 0.

Slice 7 (Accrual-always books + report foundations) is **complete**, built in four commits
on branch `autonomous/book-buddha-finish`. The owner's model (answered 2026-11-15): post
**always accrual**; `companies.accounting_basis` is only the report default; the cash view
is derived and never posted.

- **7a** (`5fc5aa8`) Balance Sheet liabilities are presented credit-normal. `getBalanceSheet()`
  maps liability rows to `balancePaise = credit - debit`, so `totalAssets === totalLiabilities +
  totalEquity` holds directly and liabilities read positive. `getReportAccountRows()` was
  deliberately not changed because it also feeds the P&L, which needs debit minus credit.
- **7b** (`4db437a`) Accrual-always posting. Every per-company cash/accrual branch was removed
  from the sales side (`finalizeInvoice`, `cancelInvoice`, `recordPayment`) and the purchase side
  (`finalizePurchaseBill`, `finalizeExpense`, `recordSupplierPayment`, and both cancel paths); net
  -156 lines. Deleted: engine helpers `cashBasisPurchaseFinalizeEntry` and
  `cashBasisSupplierPaymentLines` with their input types; repository helpers `cashBasisPaymentLines`
  and `getInvoiceAccountingBasis`. `companies.accounting_basis` and the `AccountingBasis` type are
  kept only as the stored reporting preference (the default for the 7d toggle). Regression tests run
  the same scenario on a cash-basis and an accrual-basis company and assert identical journal lines,
  on both the receivable and payable side. Commit `5576a21` (cash-basis credit purchases) is superseded.
- **7c** (`fbd358c`) `business_id` and `entry_date` on `journal_entries` via **migration v5**
  (`src/database/journal-dimensions-schema.ts`), additive and transactional. Columns are nullable in
  SQLite; the non-null guarantee for new writes is enforced in the repository, and
  `insertJournalEntry` takes a required `{ businessId, entryDate }` so the compiler forces every call
  site to supply them. The backfill derives both from each entry's own source document, matching
  entry-id shapes by exact equality (a payment entry's `source_id` is the invoice id, so a
  source_id-only join would have dated payments with the invoice's date). Four gates: entry count
  unchanged, zero NULLs (offenders named), `foreign_key_check`, and `journal_lines` count unchanged.
  Two corrections made in review: (1) dates are **IST (UTC+5:30)**, not UTC, because `paid_at` and
  `created_at` are UTC instants and `date()` on them put a 02:00 IST payment on the previous day (wrong
  GST month, possibly wrong financial year); (2) a **reversal carries its own date**, so a March
  cancellation no longer restates January. Report filters: P&L and General Ledger take
  `{ businessId?, fromDate?, toDate? }`; Trial Balance and Balance Sheet take `{ businessId?, asAtDate? }`
  (a balance sheet is a point in time, so there is deliberately no fromDate). Omitting the filters
  matches the old consolidated behaviour, pinned by a regression test. The same filters are exposed as
  `.strict()` zod query params on the four report endpoints. General Ledger orders by `entry_date` and
  exposes `entryDate` alongside the posting timestamp.
- **7d** (`710d4f6`) Derived Cash/Accrual toggle on the **Profit and Loss**. The cash view writes no
  journal entries (a test counts both journal tables and compares the trial balance around every cash
  call). One rule for every document: for a document with total T and cash-so-far p, every posted
  accrual line is recognised in proportion p/T, each increment dated to the payment that caused it
  (IST date). `allocateProportionally()` in `src/accounting/engine.ts` is the pure allocator; it uses a
  cumulative target so successive payments telescope and a fully paid document lands exactly on its
  accrual amounts. BigInt arithmetic, with a 3000-round fuzz test. `ProfitAndLossReport` gains `basis`,
  `grossSalesPaise` and `gstOnSalesPaise` (additive, populated in both views). The filter gains
  `basis`, defaulting to the business's company preference, or ACCRUAL when consolidated. Exposed as a
  strict zod query param.

**Owner's cash-view rules (implemented):** the cash P&L shows **gross sales = the cash actually
received**, GST separately, and net = gross minus GST. **COGS follows the sale's collection, not the
supplier payment** (50% collected means 50% of that invoice's COGS). Supplier payments move Payables
and Cash only. The unpaid remainder stays a receivable or payable.

**Owner's acceptance figures** (reproduced exactly by tests named `ACCEPTANCE ...`):
- Invoice Rs 11,800 (taxable Rs 10,000 + 18% CGST/SGST Rs 1,800), COGS Rs 6,000, Rs 5,900 collected ->
  cash view gross 590000 paise, GST 90000 (CGST 45000 / SGST 45000), net 500000, COGS 300000;
  receivable still 590000.
- Bill Rs 7,080 (stock Rs 5,000 + freight Rs 1,000, IGST 18% Rs 1,080), Rs 3,540 paid -> cash view
  expense 50000, inventory 250000, input GST 54000; payable still 354000.
- Net profit: accrual 300000 vs cash 150000.

**Deliberate decisions in Slice 7 (surface to the owner):**
- **Credit notes in the cash view need an owner decision.** The uniform rule recognises a credit note
  pro rata with collections, measured against the ORIGINAL invoice total and dated to the payment
  dates. So a note raised after an invoice is fully collected restates the earlier period. The
  alternative, recognising a refund on its own date, would be a new mechanism; no refund mechanism was
  invented.
- Cash-view gross can differ from net + GST by a paise or two part-way through collecting an invoice
  (gross is the actual cash received; net and GST are each rounded). It is exact at full collection and
  on the owner's figures.
- `GeneralLedgerRow.date` is still the posting timestamp; `entryDate` is the transaction date.

**Not built in Slice 7 (open or deferred):**
- No cash view of the Trial Balance, Balance Sheet or General Ledger; they stay accrual-only. The
  owner's rule keeps AR/AP on the books, so a cash balance sheet cannot balance without an Unearned
  Revenue account, which belongs to the later Subscriptions slice.
- Still deferred from earlier slices: Slice 4 login UI and live Google OAuth, purchase returns, bill
  discount, receipts/attachments, supplier refunds, opening-balance GL offset, and all UI.

Slice 7 gates passed: 139/139 vitest tests in 15 files, tsc clean (no output), vite build ok.

The next implementation slice is **Projects (fairs)**: a first-class QBO-style dimension (spec
Design Document §3.3, §6.9, §10, §12.1), tied to one host customer, with its own P&L and no per-fair
Balance Sheet. It needs a project dimension on journal entries and builds directly on 7c
(`business_id` and `entry_date`). Subscriptions, imports, **banking (bank categorization + bill OCR,
its own slice)**, cash flow, archive, and audit hardening follow after it, in that order.

Credit notes already support
finalized-invoice validation, partial item quantities, duplicate/over-return
prevention, GST reversal, receivable/cash reduction, FIFO inventory
restoration, COGS reversal, and audit events through the API.

Do not mark a feature complete until targeted tests and both builds pass:

```powershell
npm test
npm run build
npm run build:web
```

## Session 12 — R7c, the two absent stock reports (19 Nov 2026)

The Design Document §13 names six reports that were specified and never built. Two of them are
stock reports, and both are the SAME FIFO replay that `getInventoryValuation` already runs, only
grouped differently — so neither can disagree with it. They are now built.

**Definitions and tie-outs written BEFORE any code:** `context/REPORT_DEFINITIONS_S12.md`
(sections 0b, 4 and 5).

New files:

- `src/database/ageing-bands.ts` — `AGEING_BANDS` moved out of `repository.ts`. There is now
  exactly ONE literal band list in the codebase, so customer, supplier and stock ageing cannot
  drift apart. The labels and boundaries are byte-identical to the old private list, so the
  accepted A/R and A/P ageing output is unchanged.
- `src/database/ist-date.ts` — `istDateOf` moved out of `repository.ts` (unchanged) to avoid a
  circular import. Still re-exported from `repository.ts`, so every existing importer is untouched.
- `src/database/stock-layers.ts` — `datedStockLayers(db, itemId)`: the FIFO replay MOVED, not
  changed, and each surviving lot given the date it came in plus how firm that date is
  (`dateBasis`: `BILL` | `JOURNAL` | `CREDIT_NOTE` | `ENTRY_INSTANT`). The replay order,
  `ORDER BY occurred_at, rowid`, is untouched: `occurred_at` is the INSERTION instant, never the
  economic date, because a back-dated layer would silently re-measure COGS already posted. A test
  pins exactly that — a back-dated opening layer yields identical COGS, movement rows and
  survivors, and only `receivedOn` differs.
- `src/database/reports-stock.ts` — `stockAgeing` and `inventoryValuationDetail`. Both take an
  as-at date and nothing else: a FIFO lot has no business or fair dimension, so accepting one
  would quietly answer a different question.
- `src/database/reports-stock.test.ts` — 15 tests, including the two tie-outs (buckets sum to
  `getInventoryValuation` per item and in total; detail rows group back to it), the FIFO-order
  test above, band boundaries at 30/31/90/91 days, and the three HTTP tests.

Changed: `src/database/repository.ts` (`getStockAgeing`, `getInventoryValuationDetail`;
`getStockLayers` now delegates to the shared replay) · `src/api/server.ts`
(`GET /reports/stock-ageing`, `GET /reports/inventory-valuation-detail`, both on a `strict()`
query so an unknown parameter is refused rather than ignored).

No migration: both reports read what is already stored.

**Gates, run in order from `book-buddha/` on 19 Nov 2026:**

- `./node_modules/.bin/tsc.cmd` — exit 0, no output.
- `./node_modules/.bin/vitest.cmd run --root .` — **609 passed, 49 files**, exit 0 (was 594/48
  at the start of the session; +12 from the new report tests, +3 from the HTTP tests).
- `./node_modules/.bin/vite.cmd build` — built in 1.01s, exit 0.

Still absent from §13, next in this slice: customer statement · customer balance detail ·
collections · item profitability. All four are defined in
`context/REPORT_DEFINITIONS_S12.md` sections 0a, 1, 2, 3 and 6.

## Notes for the next session

- Work only in `D:\dhruv-book-accounting-app\Book-Buddha-github\book-buddha`.
- Treat the root `spec/` documents and `ARCHITECTURE_AND_DATABASE.md` as the
  target reference; the code in this folder is only a partial prototype.
- Money is integer paise.
- Finalized records are immutable; use reversal entries.
- Existing databases need backward-compatible migrations.
- Do not run `npm audit fix --force` without reviewing advisories.
