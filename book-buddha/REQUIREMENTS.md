# Book Buddha requirements

## Product aim

Book Buddha should make everyday accounting understandable to non-accountants
while preserving balanced, auditable double-entry records. It is local-first,
offline-capable, safe for small-business financial data, and extensible to
desktop packaging.

## Functional requirements

### Master data

- Companies with currency and financial-year settings
- Company-selectable cash-basis or accrual-basis accounting
- Businesses belonging to a company
- Customers and suppliers belonging to a company
- Items with units and optional stock tracking
- Fairs linked to a company and host customer

### Sales and invoices

- Draft, quotation, finalized, cancelled, and corrected sales documents
- Multiple invoice lines with optional item links
- Invoice and due dates
- Discounts and extra charges
- Notes and payment terms
- Invoice-level GST: CGST/SGST or IGST
- Cash and receivable invoices
- Partial and full customer payments
- Immutable finalized documents with reversal-based cancellation
- Quotation conversion into a draft invoice
- Credit notes and sales returns
- Recurring invoice templates
- Printable and PDF invoices

### Purchases and expenses

- Suppliers and supplier balances
- Purchase bills with dates, taxes, discounts, and charges
- Inventory additions from purchase bills
- Expense categories and expense transactions
- Supplier payments, refunds, and purchase returns
- Payables ageing and supplier statements

### Inventory

- Opening stock, purchases, adjustments, sales, and returns
- FIFO cost layers
- Negative-stock prevention
- Inventory valuation
- COGS journal entries
- Stock movement and low-stock reports

### Accounting and reporting

- Balanced journal entries
- Trial Balance
- Profit & Loss
- Balance Sheet
- General Ledger
- Cash Flow Statement
- Receivables and payables ageing
- Sales by item, customer, business, fair, and tax
- Inventory and COGS reports
- Date, company, business, fair, customer, supplier, and item filters
- Consolidated company reports

### Data management

- Opening balances for assets, liabilities, capital, receivables, payables,
  inventory, cash, and bank accounts
- CSV and Excel import with preview, validation, duplicate handling, and rollback
- CSV, Excel, and PDF export
- Manual and automated backup/restore
- Attachment storage for invoices, bills, expenses, and receipts

### Security and controls

- Admin authentication with strong password hashing
- Protected API routes and session timeout
- Failed-login lockout and rate limiting
- Roles such as admin, accountant, and viewer
- Financial-year locking
- Immutable audit history with actor, timestamp, reason, and before/after values

### Production readiness

- Versioned database migrations
- Structured error logging
- Database integrity checks and recovery handling
- Automated backup policy
- User documentation
- Windows desktop installer, preferably with Tauri
- Safe dependency-vulnerability remediation

## Non-functional requirements

- Preserve integer-paise arithmetic
- Cash basis recognizes receivable sales and related output tax when payment is received
- Accrual basis recognizes finalized invoice revenue and related output tax immediately
- Preserve balanced journals under success, failure, cancellation, and restore
- Never silently discard financial data
- Validate company ownership at every cross-entity boundary
- Keep finalized records immutable
- Keep the application useful offline
- Provide clear errors for invalid input
- Test accounting behavior, migrations, and API validation

## Delivery order

1. Credit notes and sales returns
2. Print/PDF invoices
3. Recurring invoices
4. Suppliers, purchase bills, and expenses
5. Supplier payments, refunds, and payables
6. Cash/bank accounts and Cash Flow
7. Complete reports and filters
8. Opening balances and imports/exports
9. Backup, restore, and attachments
10. Authentication, roles, and financial-year locking
11. Versioned migrations, logging, and hardening
12. Tauri desktop packaging

See [IMPLEMENTATION_PROGRESS.md](./IMPLEMENTATION_PROGRESS.md) for the live status.
