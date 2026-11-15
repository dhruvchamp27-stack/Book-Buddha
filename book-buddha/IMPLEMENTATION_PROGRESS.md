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
- [ ] Date/business/fair/item/customer filters and consolidated reports
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
- **Recognition is accrual-at-finalize for all companies, BUT cash-basis
  companies are refused PAYABLES (credit) bills/expenses** (CASH only). This keeps
  the cash/accrual invariant intact without guessing; full cash-basis deferral of
  credit purchases (symmetric with sales) is a later design decision.
- **Retained earnings on the Balance Sheet was corrected** from `SALES` only to
  `SALES - COGS - EXPENSE`. This changes sales-side Balance Sheet output whenever
  COGS exists (no prior test asserted it; the sheet could not balance without it).
- **Known pre-existing presentation quirk (not changed):** liability rows report
  as `debit - credit`, so liabilities (incl. PAYABLES) show as **negative**
  numbers and `totalLiabilitiesPaise` is negative. A reporting/UI-slice fix.
- Inventory ties to the ledger for **bill-sourced** stock only; stock added via
  `addStockMovement` (OPENING/ADJUSTMENT) still posts no GL entry (opening-balance
  offset account is a later decision).

Slice 6 gates passed: 87/87 vitest tests, tsc exit 0, vite build exit 0.

The next safe implementation slice is **Slice 7: Projects / subscriptions /
consolidated and cash-basis reports** (where report-level cash-basis views and the
liability-sign fix belong).

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

## Notes for the next session

- Work only in `D:\dhruv-book-accounting-app\Book-Buddha-github\book-buddha`.
- Treat the root `spec/` documents and `ARCHITECTURE_AND_DATABASE.md` as the
  target reference; the code in this folder is only a partial prototype.
- Money is integer paise.
- Finalized records are immutable; use reversal entries.
- Existing databases need backward-compatible migrations.
- Do not run `npm audit fix --force` without reviewing advisories.
