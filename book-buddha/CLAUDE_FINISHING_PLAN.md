# Book Buddha — Claude Finishing Plan

This document is the implementation handoff for completing Book Buddha.
It is intended for another coding agent, including Claude, to continue work
without losing context.

## 1. Project location

Work only in:

```text
D:\dhruv-book-accounting-app\book-buddha
```

The project is a TypeScript offline-first accounting application using:

- TypeScript
- SQLite through `better-sqlite3`
- Fastify
- Zod
- React
- Vite
- Vitest

## 2. Product goal

Book Buddha is intended for small businesses and non-accountants. It must
provide simple workflows while preserving reliable, balanced, auditable
double-entry accounting.

The application should work locally/offline and eventually be packaged as a
Windows desktop application.

## 3. Non-negotiable accounting rules

These rules must be preserved in every future change:

1. Store all money as integer paise.
2. Never use floating-point values for stored money.
3. Every posted journal entry must balance:
   - total debits = total credits.
4. Draft documents must not post accounting entries.
5. Finalized financial documents are immutable.
6. Corrections must use reversal or adjustment entries.
7. Cancelled invoices must reverse their accounting effect.
8. Invoice cancellation must restore tracked inventory and reverse COGS.
9. Never allow tracked inventory to go negative.
10. Validate that companies, businesses, customers, fairs, and items belong
    to the correct company.
11. Never silently discard invalid or incomplete financial data.
12. Existing databases require backward-compatible migrations.
13. Do not run `npm audit fix --force` without reviewing advisories.
14. Do not delete or rewrite user changes unrelated to the current task.

## 4. Current accounting basis behavior

Companies support:

- `ACCRUAL`
- `CASH`

### Accrual basis

- Finalizing an invoice recognizes sales immediately.
- Output GST is recognized when the invoice is finalized.
- Receivable invoices debit `RECEIVABLES`.
- Customer payments settle receivables.

### Cash basis

- Cash invoices recognize sales immediately because payment occurs with sale.
- Receivable invoices do not recognize sales or output GST at finalization.
- Receivable cash-basis invoices recognize sales and GST when payments arrive.
- Partial payments recognize only the paid proportion.

This behavior must remain balanced for:

- Full payments
- Partial payments
- GST invoices
- Invoice cancellation
- Inventory and COGS

## 5. Completed functionality

### Foundation

- SQLite schema
- Additive startup migrations
- Repository and transaction layer
- Fastify API
- React/Vite frontend
- TypeScript build
- Vitest tests

### Master data

- Companies
- Businesses
- Customers
- Items
- Fairs
- Company ownership validation

### Sales

- Draft invoices
- Multiple invoice lines
- Optional item links
- Invoice dates
- Due dates
- Discounts
- Extra charges
- Notes
- Payment terms
- Cash invoices
- Receivable invoices
- Finalization
- Cancellation with reversal
- Quotation records
- Quotation-to-draft-invoice conversion

### GST

- No tax
- CGST + SGST
- IGST
- Invoice-level tax rate
- GST journal accounts:
  - `OUTPUT_CGST`
  - `OUTPUT_SGST`
  - `OUTPUT_IGST`
- Tax-inclusive totals
- Tax reversal on invoice cancellation

### Payments

- Customer payments
- Partial payments
- Outstanding invoice balances
- Receivables ageing
- Payment journal entries
- Cash-basis recognition on receipt

### Inventory

- Opening stock
- Purchase stock movements
- Adjustments
- FIFO layers
- Stock balances
- Stock valuation
- Negative-stock prevention
- Sale consumption
- Stock restoration on cancellation
- COGS journal entries
- Inventory journal entries

### Reports

- Trial Balance
- Profit & Loss
- Balance Sheet
- General Ledger
- Fair-sales report
- Inventory balances
- Receivables ageing

### Credit notes

Backend support exists for:

- Credit-note records
- Finalized-invoice validation
- Partial item-linked quantities
- Duplicate/over-return prevention
- GST reversal
- Receivable/cash reduction
- FIFO inventory restoration
- COGS reversal
- Audit events

Credit-note frontend workflow, broader credit allocation, and dedicated credit
reports are still required.

## 6. Important current files

- `src/accounting/types.ts`
  - Domain types and account codes.
- `src/accounting/engine.ts`
  - Invoice finalization, tax posting, and cancellation journal logic.
- `src/database/schema.ts`
  - SQLite tables and migrations.
- `src/database/repository.ts`
  - Persistence, validation, reports, payments, inventory, and credit notes.
- `src/api/server.ts`
  - Fastify routes and Zod request validation.
- `src/accounting/engine.test.ts`
  - Accounting engine tests.
- `src/database/repository.test.ts`
  - Repository and accounting workflow tests.
- `src/api/server.test.ts`
  - API integration tests.
- `web/src/App.tsx`
  - Current frontend workflow.
- `web/src/styles.css`
  - Frontend styling.
- `README.md`
  - Setup and project overview.
- `SETUP.md`
  - Installation and troubleshooting.
- `REQUIREMENTS.md`
  - Product requirements.
- `IMPLEMENTATION_PROGRESS.md`
  - Short progress checkpoint.

## 7. Immediate work: finish credit notes and sales returns

Complete this feature before starting purchases.

### Required backend behavior

- Credit-note list endpoint
- Credit-note update endpoint while draft
- Credit-note cancel/reversal endpoint
- Credit-note totals
- Credit-note date
- Credit-note reason
- Credit-note status
- Link to original invoice
- Link from original invoice to credit notes
- Prevent credit notes on draft/cancelled invoices
- Prevent credit quantities above sold quantities
- Prevent total credits above original invoice total
- Preserve invoice tax type and tax rate
- Reverse GST correctly
- Reverse receivable/cash balance correctly
- Restore inventory for tracked returned items
- Reverse COGS
- Record audit events

### Required frontend behavior

- Credit-note creation screen
- Select original finalized invoice
- Show original invoice lines
- Enter return quantities
- Display original, returned, and remaining quantity
- Show subtotal, GST, and total credit
- Enter reason
- Save draft
- Finalize credit note
- Cancel credit note with reversal
- Show credit notes on invoice detail
- Show clear validation errors

### Required tests

- Full credit note
- Partial credit note
- GST credit note
- CGST/SGST reversal
- IGST reversal
- Receivable credit note
- Cash credit note
- Tracked item return
- FIFO restoration
- COGS reversal
- Over-return rejection
- Duplicate return rejection
- Cancelled invoice rejection
- Draft credit note update
- API validation

## 8. Recurring invoices

Implement recurring invoices after credit notes.

### Data

Add a recurring invoice template table with:

- ID
- Company/business
- Customer
- Template number/prefix
- Frequency
- Start date
- End date
- Next generation date
- Remaining cycles
- Paused/enabled status
- Payment account
- Tax settings
- Discount
- Extra charge
- Notes
- Payment terms
- Invoice lines
- Created/updated timestamps

Supported frequencies should initially be:

- Monthly
- Quarterly
- Half-yearly
- Yearly

Use `remaining_cycles = -1` for unlimited recurrence.

### Behavior

- Generate draft child invoices.
- Never automatically finalize without explicit configuration.
- Preserve tax, discount, charge, and payment terms.
- Generate unique invoice numbers.
- Prevent duplicate generation for the same schedule/date.
- Skip or report generation when an earlier child invoice remains unpaid.
- Pause and resume schedules.
- Stop after end date or cycle limit.
- Preserve links between template and generated invoices.
- For tracked inventory, use the same stock rules as normal invoices.

### Tests

- Monthly generation
- End date
- Cycle limit
- Unlimited cycles
- Pause/resume
- Duplicate prevention
- Number generation
- Tax and discount preservation
- Unpaid-child interlock

## 9. Print and PDF invoices

Start with browser print, then add PDF export.

### Invoice output must include

- Company/business information
- Customer information
- Invoice number
- Invoice date
- Due date
- Invoice status
- Line items
- Quantity
- Unit price
- Line totals
- Subtotal
- Discount
- Extra charges
- GST type and rate
- CGST/SGST or IGST breakup
- Grand total
- Payment terms
- Notes
- Fair information when relevant
- Buyer information when relevant

### Required outputs

- Print-friendly invoice route/view
- Browser print button
- PDF download
- Credit-note print/PDF
- Quotation print/PDF
- Delivery challan print/PDF later

The output must not expose private/internal notes.

## 10. Suppliers and purchasing

### Suppliers

Add:

- Supplier records
- Supplier contacts
- Supplier classification
- Supplier company validation
- Supplier statement
- Supplier balance
- Supplier archive

### Purchase bills

Add:

- Bill draft
- Bill number
- Bill date
- Due date
- Supplier invoice number
- Multiple lines
- Inventory-linked lines
- Purchase discounts
- Extra charges
- Purchase tax
- Finalization
- Cancellation reversal
- Attachments

### Purchase accounting

Inventory purchase example:

```text
Debit: INVENTORY
Debit: Input GST, if applicable
Credit: CASH or PAYABLES
```

Expense purchase example:

```text
Debit: Expense account
Debit: Input GST, if applicable
Credit: CASH or PAYABLES
```

Use separate input-tax accounts:

- `INPUT_CGST`
- `INPUT_SGST`
- `INPUT_IGST`

Do not mix input tax with output tax.

## 11. Expenses and supplier payments

Add:

- Expense categories
- Expense records
- Expense dates
- Supplier/vendor link
- Payment account
- Tax treatment
- Receipt attachment
- Draft and finalized expense states
- Expense cancellation/reversal
- Supplier payments
- Partial supplier payments
- Supplier refunds
- Purchase returns
- Payables ageing
- Supplier statements

All supplier payments must post balanced entries.

## 12. Banking and cash management

Add account types:

- Cash accounts
- Bank accounts
- UPI accounts
- Cheque accounts

Add:

- Transfers
- Deposits
- Withdrawals
- Opening bank balances
- Cashbook
- Bankbook
- Bank reconciliation
- Transaction references
- Reconciliation status

Example transfer:

```text
Debit: destination account
Credit: source account
```

## 13. Reports and filters

### Reports still required

- Cash Flow Statement
- Accounts Payable ageing
- Sales by item
- Sales by customer
- Sales by business
- Sales by fair
- Sales by tax
- Customer statements
- Supplier statements
- Credit-note report
- Sales-return report
- Stock movement report
- Stock ageing
- Low-stock report
- Item profitability

### Filters

Reports must support, where relevant:

- Start date
- End date
- Company
- Business
- Customer
- Supplier
- Fair
- Item
- Tax type
- Payment account
- Status

Filters must be applied in SQL/repository queries, not only visually.

### Cash/accrual reporting

Keep company accounting basis support, but also add a report-level option where
useful:

- Accrual P&L
- Cash P&L

Cash reporting must derive revenue from payment allocations, not invoice dates.

## 14. Opening balances

Add an opening-balance workflow for:

- Cash
- Bank
- Receivables
- Payables
- Inventory
- Capital
- Loans
- Other assets
- Other liabilities

Opening balances must:

- Be dated
- Create balanced journal entries
- Be auditable
- Support customer/supplier allocation where relevant
- Be protected after financial-year locking

## 15. Import and export

### Import

Support CSV and XLSX import for:

- Customers
- Suppliers
- Items
- Opening balances
- Invoices
- Invoice lines
- Purchase bills
- Expenses
- Stock
- Payments
- Credit notes

Use a two-phase process:

1. Upload and inspect
2. Map columns and preview validation
3. Confirm import
4. Commit transaction
5. Return imported/skipped/error counts

Failed rows should be reported. Do not silently skip them.

### Export

Support:

- CSV
- JSON
- XLSX
- PDF

Export:

- Invoices
- Credit notes
- Payments
- Customers
- Suppliers
- Items
- Stock
- Journal entries
- Trial Balance
- P&L
- Balance Sheet
- General Ledger
- Receivables
- Payables
- GST reports

## 16. Backup and restore

Implement:

- Manual backup
- Automatic backup configuration
- Backup history
- Backup integrity validation
- Restore preview
- Safety backup before restore
- Database restore
- Attachment inclusion option
- Clear warning about what is included/excluded

Never replace the live database without first creating a safety backup.

Use SQLite backup facilities where possible. Do not copy a live database file
blindly while transactions are active.

## 17. Attachments

Add file storage outside the SQLite database with metadata in SQLite:

- Entity type
- Entity ID
- Original filename
- Safe stored filename
- MIME type
- Size
- Hash
- Created by
- Created timestamp

Support attachments for:

- Invoices
- Credit notes
- Purchase bills
- Expenses
- Customers
- Suppliers
- Fairs

Validate:

- File size
- MIME type
- Extension
- Safe filename
- Storage path traversal

Include attachments in backups only when selected, and state clearly when they
are excluded.

## 18. Authentication and security

Add:

- Admin account setup
- Password hashing with Argon2 or bcrypt
- Login/logout
- Protected API routes
- Session timeout
- Failed-login lockout
- Rate limiting
- Password change
- Roles:
  - Admin
  - Accountant
  - Viewer

Use secure session handling. Do not store plaintext passwords.

Users must only access companies and businesses they are permitted to access.

## 19. Financial-year locking

Add:

- Financial-year start/end
- Current financial year
- Locked periods
- Year close
- Opening balance carry-forward
- Year-end profit transfer

When a period is locked:

- Finalized invoices cannot be edited
- Payments cannot be changed
- Journals cannot be deleted
- Corrections require controlled reversal permissions
- Opening balances require admin permissions

## 20. Audit and logging

Improve audit events with:

- Actor/user ID
- Company
- Entity type
- Entity ID
- Action
- Timestamp
- Reason
- Before values
- After values

Recommended hardening:

- Append-only audit API
- Database triggers or restricted write path
- Optional hash chain using previous event hash

Add separate structured system logs for:

- API errors
- Database errors
- Backup/restore
- Authentication
- PDF generation
- Imports/exports

Do not silently catch and ignore operational errors.

## 21. Migration and production hardening

Replace informal schema checks over time with:

- Migration version table
- Ordered migration files
- Transactional migrations
- Startup validation
- Migration failure reporting
- Foreign-key checks
- Journal-balance integrity checks
- Database integrity checks

Do not break existing databases.

## 22. User experience

Add:

- Dashboard
- Quick actions
- Invoice search
- Deep line-item search
- Pagination
- Status filters
- Date filters
- Customer detail screen
- Supplier detail screen
- Item detail screen
- Customer statements
- Supplier statements
- Loading states
- Empty states
- Confirmation dialogs
- Inline validation
- Unsaved-change warnings
- Save & New
- Responsive tablet layout
- Accessible labels and focus behavior

Do not copy known Invoice Ninja usability problems:

- No silent row deletion
- No silent invalid-row dropping
- No hidden financial effects
- No destructive delete for posted records

## 23. Desktop packaging

After feature completion, package with Tauri unless there is a strong reason to
choose Electron.

Required:

- Windows installer
- Application icon
- Local database location
- Native file dialogs
- Printer support
- PDF export
- Backup integration
- App-data migration
- Safe uninstall behavior
- Update strategy

## 24. Testing requirements

Every feature must include tests before being marked complete.

### Accounting tests

- Debit/credit balance
- Tax rounding
- Partial payments
- Cash basis
- Accrual basis
- Cancellation reversals
- Credit notes
- Sales returns
- Purchase bills
- Supplier payments
- Opening balances
- Financial-year locks

### Repository tests

- Persistence
- Validation
- Migrations from older schemas
- Transactions rollback on failure
- Company ownership
- Inventory/FIFO
- Backup/restore

### API tests

- Valid requests
- Invalid requests
- Unauthorized requests
- Error response shape
- Filters
- Imports/exports

### Frontend tests

- Invoice editor
- Quotation editor
- Credit-note editor
- Payment workflow
- Report filters
- Login
- Backup/restore screens

### Required commands

Run from the project directory:

```powershell
npm test
npm run build
npm run build:web
```

Do not mark work complete if any of these fail.

## 25. Recommended implementation order

1. Finish credit-note frontend and tests.
2. Add recurring invoice templates and generation.
3. Add print/PDF invoices and credit-note output.
4. Add suppliers.
5. Add purchase bills and purchase taxes.
6. Add expenses and receipts.
7. Add supplier payments, refunds, purchase returns, and payables ageing.
8. Add bank accounts, transfers, and reconciliation.
9. Add Cash Flow and complete report filters.
10. Add customer/supplier statements and sales/stock reports.
11. Add opening balances.
12. Add CSV/XLSX import and CSV/JSON/XLSX/PDF export.
13. Add backup/restore.
14. Add attachments.
15. Add authentication and permissions.
16. Add financial-year locking.
17. Add audit hardening and structured logging.
18. Add formal migration versioning.
19. Review and safely remediate npm audit advisories.
20. Package with Tauri.

## 25A. Accurate and efficient implementation guide

Use the following process for every feature. The goal is to deliver quickly
without weakening accounting correctness, migration safety, or auditability.

### A. Start each feature with a bounded slice

Before editing code:

1. Read `IMPLEMENTATION_PROGRESS.md`, `REQUIREMENTS.md`, and the relevant
   sections of this document.
2. Search the existing types, schema, repository, API, frontend, and tests for
   the closest existing workflow.
3. Write down the feature's:
   - User workflow
   - Data entities and relationships
   - Allowed lifecycle states
   - Accounting entries
   - Validation rules
   - Migration needs
   - API request/response shapes
   - Frontend screens and error states
   - Required tests
4. Implement one vertical slice end-to-end before starting a separate feature.

Prefer a complete small slice, such as "draft credit note -> finalize ->
reverse -> report", over implementing many database tables without a usable
workflow.

### B. Design accounting before UI

For every financial transaction, write a debit/credit table before coding.
Include the behavior for:

- Cash and accrual basis
- Full and partial payment
- GST and tax rounding
- Inventory and COGS
- Cancellation and reversal
- Credit notes or refunds
- Failed validation and transaction rollback

Use integer paise throughout. Calculate totals once in a shared accounting
helper and reuse those results in persistence, journals, reports, and UI
responses. Never recreate financial totals independently in the frontend or
in multiple SQL queries.

For each new journal-producing operation, verify:

```text
sum(debits) = sum(credits)
```

Also verify that every account used by the journal has the intended normal
balance and that a reversal is the exact opposite of the original posted
effect.

### C. Follow the repository's transaction boundary

All changes that affect financial data must be performed in one repository
transaction. The transaction should:

1. Validate company ownership and document state.
2. Validate quantities, amounts, dates, and references.
3. Calculate totals and accounting effects.
4. Check inventory and other balance constraints.
5. Write the document and its child rows.
6. Write journals, stock movements, allocations, and audit events.
7. Commit only after every step succeeds.

On any error, roll back the entire operation. Do not return a successful
response with partial data. Use the existing error/validation conventions and
return actionable messages to the API and frontend.

### D. Make schema changes backward-compatible

For every schema change:

1. Add the new table or column without removing existing data.
2. Supply a safe default or explicit backfill for existing rows.
3. Add indexes and foreign-key behavior deliberately.
4. Keep startup migration execution transactional.
5. Test initialization against a database representing the previous schema.
6. Test the new schema with both old and newly created records.

Do not assume a fresh database. Existing users' data is more important than
the convenience of a clean schema. Do not rename or delete a column until a
planned migration and compatibility period exist.

### E. Implement in this order inside each feature

Use this sequence to reduce rework:

1. Domain types and invariants
2. Schema and migration
3. Accounting calculations/engine logic
4. Repository transaction and persistence
5. API validation and routes
6. Repository/API tests
7. Frontend workflow
8. Frontend tests and user-facing error states
9. Reports, exports, and print output
10. Documentation and progress update

Do not start with the frontend. A screen built before the accounting and API
contract is stable usually causes duplicate calculations and later rewrites.

### F. Use a test matrix, not only happy-path tests

For every financial feature, test at least the following dimensions:

| Dimension | Cases |
|---|---|
| Lifecycle | Draft, finalize, cancel/reverse |
| Accounting basis | Cash, accrual |
| Payment | None, partial, full, overpayment rejection |
| Tax | No tax, CGST/SGST, IGST, rounding |
| Inventory | Non-stock item, tracked item, insufficient stock |
| Ownership | Valid company, cross-company reference |
| Data state | New database, migrated database |
| Failure | Invalid input, duplicate action, transaction rollback |
| Reporting | Detail total agrees with journal/report total |

Add regression tests before changing behavior that is already supported. Run
the smallest relevant test selection during development, then run the full
suite and both builds before marking the phase complete.

### G. Keep API and frontend contracts explicit

For every route, define and validate:

- Required and optional fields
- Numeric ranges and date formats
- Allowed status transitions
- Error status codes
- Stable error response shape
- Company/business ownership rules

The frontend must display server validation errors instead of guessing or
silently correcting financial values. Disable actions that are impossible for
the current document state, but retain server-side validation as the source of
truth.

### H. Improve efficiency without compromising correctness

- Reuse existing repository helpers, account codes, and validation patterns.
- Work in independent vertical phases and avoid unrelated refactors.
- Batch independent reads and tests, but keep accounting writes serialized
  inside a transaction.
- Use SQL filtering and pagination for reports and lists; do not load all
  records into the browser.
- Add indexes based on actual filters and verify query behavior with realistic
  data.
- Keep generated files, temporary exports, and test databases out of source
  control.
- Run targeted tests after each coherent change, not only at the end.
- Update documentation while the design is fresh instead of reconstructing it
  later.

Efficiency must never mean skipping migration tests, journal-balance checks,
ownership validation, or rollback tests.

### I. Validate each phase with an evidence checklist

Before declaring a phase complete, record:

- Files changed
- Schema/migration changes
- New API routes and validation rules
- Accounting entries and reversal behavior
- Test cases added and results
- `npm test` result
- `npm run build` result
- `npm run build:web` result
- Manual workflow checked in the UI
- Known limitations and the exact next task

If a command fails, fix the root cause or document the blocker. Never describe
an unverified feature as complete.

### J. Safe handoff procedure

At the end of every session or before context/credit limits:

1. Update `IMPLEMENTATION_PROGRESS.md`.
2. List completed behavior, not only file names.
3. Record the exact commands run and their results.
4. Record migrations that were added and any compatibility assumptions.
5. Record known bugs, open design decisions, and incomplete UI/API surfaces.
6. Give the next agent one specific starting task.
7. Leave the working tree in a buildable state whenever possible.

Do not create a second competing progress document. Keep the durable status in
`IMPLEMENTATION_PROGRESS.md` and the durable implementation rules in this
plan.

## 26. Progress handoff rule

After every meaningful phase, update:

```text
IMPLEMENTATION_PROGRESS.md
```

If work must stop because of context, time, tool, or credit limits, update that
file before stopping with:

- Features completed
- Files changed
- Tests/builds run
- Known issues
- Exact next task
- Remaining work

Never claim a feature is complete without verification.

## 27. Final completion checklist

The project is complete only when:

- All requirements in this document are implemented or explicitly documented
  as intentionally deferred.
- Cash and accrual accounting both work correctly.
- All posted journals balance.
- GST, payments, credit notes, purchases, expenses, and inventory are balanced.
- Reports reconcile to the journal.
- Existing databases migrate safely.
- Authentication protects financial routes.
- Backups restore successfully.
- Imports validate and roll back safely.
- Attachments are handled safely.
- Tests pass.
- Backend build passes.
- Frontend build passes.
- User documentation is complete.
- Desktop packaging is tested.
