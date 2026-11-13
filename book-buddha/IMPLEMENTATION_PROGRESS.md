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

- [x] Credit notes and item-linked sales returns (API/repository, GST and inventory reversal)
- [ ] Recurring invoice templates and generation
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

The next safe implementation slice is **print/PDF invoices**. Credit notes now
support finalized-invoice validation, partial item quantities, duplicate/over-return
prevention, GST reversal, receivable/cash reduction, FIFO inventory restoration,
COGS reversal, and audit events through the API. A frontend credit-note workflow
and dedicated credit-note report still need to be added.

Do not mark a feature complete until targeted tests and both builds pass:

```powershell
npm test
npm run build
npm run build:web
```

## Notes for the next session

- Work only in `D:\dhruv-book-accounting-app\book-buddha`.
- Money is integer paise.
- Finalized records are immutable; use reversal entries.
- Existing databases need backward-compatible migrations.
- Do not run `npm audit fix --force` without reviewing advisories.
