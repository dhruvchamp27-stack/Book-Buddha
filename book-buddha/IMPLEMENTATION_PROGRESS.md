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
- [ ] Suppliers and supplier statements
- [ ] Purchase bills, purchase taxes, and purchase returns
- [ ] Expenses and receipts
- [ ] Supplier payments, refunds, and payables ageing
- [ ] Bank accounts, transfers, and reconciliation
- [ ] Cash Flow Statement
- [ ] Date/business/fair/item/customer filters and consolidated reports
- [ ] Opening balances
- [ ] CSV/Excel import and export
- [ ] PDF report export
- [ ] Backup and restore
- [ ] Attachments and document storage
- [ ] Authentication, password hashing, roles, sessions, and lockout
- [ ] Financial-year locking
- [ ] Strong immutable audit controls
- [ ] Versioned migration system and structured logging
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

The next safe implementation slice is **Slice 3: formal/versioned migrations**. Credit notes already support
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
