# Book Buddha - Updated Architecture and Database Structure

Updated: 14 November 2026

This document describes the architecture and database direction for the
cloned Book Buddha repository:

```text
D:\dhruv-book-accounting-app\Book-Buddha-github
```

It is based on:

- `spec/Design Document - Book Buddha (9 Nov 2026).md`
- `spec/APP_FLOW.md`
- `spec/PRD - Book Buddha.md`
- `spec/Features List - Book Buddha.md`
- `plan/Build phase plan - Book Buddha (8 Nov 2026).md`
- `plan/Decisions - 9 Nov 2026 (the 15 questions).md`
- The existing prototype in `book-buddha/`
- The supplied UI reference images

## 1. Important status clarification

The repository has two different realities:

1. **Target product architecture:** the approved specification for a local,
   offline-first, one-company accounting application.
2. **Current code snapshot:** an earlier TypeScript/SQLite prototype that
   already implements a smaller subset of the target.

The root `README.md` describes the repository as specification-stage. However,
the nested `book-buddha/` folder contains working prototype code, tests, and a
React UI. This document therefore labels designs as either **Target** or
**Current prototype**.

Do not assume that a table or screen listed in the target design already exists
in the prototype.

## 2. Product boundaries

### Target product

- Local web application running on one PC.
- One company and one database file per installation.
- Browser UI served by a local application.
- Offline-first operation.
- English and INR defaults for v1.
- One full-access Admin in Phase 1.
- Invoicing-only users on other local-network devices in Phase 2.
- Generic business/project model; a book fair is a project type, not a
  hardcoded accounting subsystem.

### Fixed accounting rules

These are not configurable:

1. Every posted transaction uses automatic double-entry accounting.
2. Every journal entry must balance.
3. Every data-changing action is audit logged.
4. The audit log is read-only in the UI and tamper-evident through a hash
   chain.
5. Posted documents are never deleted.
6. Cancellation creates an exact reversal and restores related stock.
7. Draft documents do not post accounting entries.
8. Locked financial-year periods cannot be changed without controlled Admin
   correction.

## 3. Target logical architecture

```text
                         +----------------------+
                         |  Browser UI          |
                         |  React screens       |
                         |  Forms, lists,       |
                         |  reports, print      |
                         +----------+-----------+
                                    |
                         HTTP/JSON over localhost
                                    |
                         +----------v-----------+
                         |  Local application   |
                         |  API + auth/session  |
                         |  validation         |
                         +----------+-----------+
                                    |
                         +----------v-----------+
                         |  Application layer   |
                         |  use cases/workflows |
                         |  lifecycle rules    |
                         +----+-------------+---+
                              |             |
                  +-----------v--+   +------v-----------+
                  | Accounting   |   | Repository       |
                  | engine       |   | transactions     |
                  | totals, tax, |   | persistence,     |
                  | journals,    |   | queries,         |
                  | reversals    |   | migrations       |
                  +-----------+--+   +------+-----------+
                              |             |
                              +------+------+ 
                                     |
                            +--------v---------+
                            | SQLite database  |
                            | one file/company |
                            +------------------+
```

### Target layers

#### 3.1 Presentation layer

React screens should cover:

- Login and first-run setup
- Dashboard
- Customers
- Items and stock
- Invoices
- Quotations
- Credit notes
- Challans
- Recurring invoices
- Bills and expenses
- Purchase orders
- Payments and refunds
- Projects/fairs
- Subscriptions
- Reports
- Settings
- Import/export
- Backup/restore
- Audit and technical logs

The supplied UI references establish the intended interaction language:

- Persistent left navigation.
- Dashboard with recent transactions and overview figures.
- Searchable, filterable, paginated lists.
- Clear status pills such as Draft, Sent, Partial/Deposit, Paid, and
  Cancelled.
- Responsive invoice forms.
- Modal/drawer creation for related records such as clients.
- Inline validation, loading states, empty states, confirmation dialogs, and
  locked posted documents.
- Light/dark visual themes and mobile/tablet layouts.

These visual references define UX direction, not accounting behavior.

#### 3.2 API layer

The API should:

- Validate all request bodies and query filters.
- Enforce authentication and company/business/project scope.
- Return stable error responses.
- Never trust frontend totals or status transitions.
- Call application/repository use cases rather than writing SQL in routes.
- Expose list endpoints with SQL-side filtering, sorting, and pagination.

#### 3.3 Application and accounting layer

This layer owns:

- Document lifecycle transitions.
- Integer-paise money calculations.
- Whole-rupee invoice rounding where specified.
- Tax calculation and tax account selection.
- Cash/accrual report basis.
- Payment allocation and customer credit ledgers.
- FIFO stock and COGS.
- Deferred revenue and challan recognition.
- Journal balancing.
- Reversal generation.
- Financial-year locks.
- Audit event creation.

No screen should independently calculate an accounting total that can affect
the books.

#### 3.4 Repository and persistence layer

All financial operations should run in one database transaction:

1. Validate ownership, lifecycle, dates, and amounts.
2. Calculate totals and accounting effects.
3. Validate inventory, payment allocation, and lock constraints.
4. Save the document and child records.
5. Save journals, stock movements, allocations, and audit events.
6. Commit only after every step succeeds.

#### 3.5 SQLite layer

SQLite is the target local database because the product is one-PC,
offline-first, and transaction-heavy. Use:

- Foreign keys enabled.
- Integer paise for monetary values.
- ISO dates/timestamps.
- Explicit indexes for common filters.
- Transactional, ordered migrations.
- Integrity checks on startup and before backup/restore.

## 4. Target module boundaries

Recommended source structure after the specification is implemented:

```text
book-buddha/
  src/
    api/
      routes/
      middleware/
      schemas/
    application/
      setup/
      customers/
      items/
      invoices/
      payments/
      purchases/
      projects/
      subscriptions/
      reports/
      imports/
      exports/
      backups/
    accounting/
      accounts/
      journal/
      totals/
      tax/
      inventory/
      recognition/
      reversals/
    database/
      migrations/
      repositories/
      schema/
    security/
      authentication/
      authorization/
      sessions/
    audit/
    logging/
    shared/
  web/
    src/
      pages/
      components/
      forms/
      reports/
      api/
      state/
      styles/
```

The prototype currently uses a flatter structure:

```text
book-buddha/
  src/accounting/types.ts
  src/accounting/engine.ts
  src/database/schema.ts
  src/database/repository.ts
  src/api/server.ts
  src/api/main.ts
  web/src/App.tsx
```

Keep the prototype's behavior while gradually extracting bounded modules.
Avoid a large rewrite before the first vertical slices are accepted.

## 5. Target database model

The database is one company file. Every business-facing record must be scoped
to the company and, where applicable, one business. Accounting dimensions such
as business, project, and tags must be carried onto the complete journal entry,
not only onto individual UI rows.

### 5.1 Company and security

| Table | Purpose | Important fields |
|---|---|---|
| `companies` | One top-level company per installation | `id`, `name`, `currency`, `country`, `timezone`, `created_at` |
| `businesses` | User-named businesses/divisions | `id`, `company_id`, `name`, `financial_year_start`, `active` |
| `users` | Phase 1 Admin and Phase 2 invoicing users | `id`, `company_id`, `email`, `password_hash`, `role`, `active` |
| `sessions` | Local login sessions and expiry | `id`, `user_id`, `expires_at`, `last_seen_at`, `revoked_at` |
| `login_attempts` | Lockout and rate-limit tracking | `user_id`, `attempted_at`, `success`, `ip_or_device` |
| `permissions` | Optional explicit permission matrix | `role`, `resource`, `action` |

### 5.2 Configuration and numbering

| Table | Purpose | Important fields |
|---|---|---|
| `financial_years` | Configurable and locked periods | `business_id`, `starts_on`, `ends_on`, `status`, `locked_at` |
| `numbering_sequences` | Per-business, per-document numbering | `business_id`, `document_type`, `prefix`, `year_token`, `next_number` |
| `settings` | Company/business settings | `company_id`, `business_id`, `key`, `value_json` |
| `chart_accounts` | Shared chart of accounts | `company_id`, `code`, `name`, `type`, `parent_id`, `active` |
| `business_account_settings` | Business-specific account links | `business_id`, `account_id`, `purpose` |
| `tax_rates` | User-defined tax names and rates | `company_id`, `name`, `rate`, `inclusive`, `tax_exempt` |
| `custom_field_definitions` | Configurable record fields | `company_id`, `entity_type`, `name`, `data_type`, `is_duplicate_key` |
| `tags` | Colored, filterable labels | `company_id`, `name`, `color` |

### 5.3 Master data

| Table | Purpose | Important fields |
|---|---|---|
| `customers` | Customers and fair hosts | `company_id`, `number`, `name`, `classification`, `gstin`, `status` |
| `customer_contacts` | Up to two or more contacts | `customer_id`, `name`, `email`, `phone` |
| `customer_addresses` | Billing and shipping addresses | `customer_id`, `address_type`, address fields |
| `customer_aliases` | Redirect after identity merge | `old_customer_id`, `primary_customer_id` |
| `suppliers` | Vendors and suppliers | `company_id`, `name`, `gstin`, `status` |
| `items` | Products and services | `company_id`, `name`, `unit`, `track_stock`, `mrp`, account links |
| `item_prices` | Date-effective selling/cost prices | `item_id`, `supplier_id`, `price_type`, `price`, `effective_on` |
| `item_stock_settings` | Thresholds and business defaults | `item_id`, `business_id`, `reorder_level` |
| `projects` | Generic project dimension | `company_id`, `host_customer_id`, `project_type`, `name`, `starts_on`, `ends_on` |
| `custom_field_values` | Values for defined fields | `definition_id`, `entity_type`, `entity_id`, `value_json` |
| `entity_tags` | Many-to-many tag links | `tag_id`, `entity_type`, `entity_id` |

### 5.4 Sales and customer documents

| Table | Purpose | Important fields |
|---|---|---|
| `documents` | Common document header/lifecycle | `business_id`, `document_type`, `number`, `status`, `customer_id`, dates |
| `document_lines` | Lines for sales and other documents | `document_id`, `item_id`, description, quantity, unit price, discount |
| `document_taxes` | Header/line tax calculation snapshot | `document_id`, `line_id`, `tax_rate_id`, amount |
| `document_versions` | Immutable history of edits | `document_id`, `version`, `snapshot_json`, `created_at` |
| `document_links` | Quote/invoice/challan/credit relationships | `from_document_id`, `to_document_id`, `link_type` |
| `quotations` | Quotation-specific fields | `document_id`, validity date, conversion state |
| `credit_notes` | Credit and return headers | `document_id`, `original_invoice_id`, reason |
| `challans` | Delivery notes, linked or non-posting | `document_id`, `source_invoice_id`, delivery state |
| `recurring_invoice_templates` | Invoice schedules | frequency, next date, cycles, enabled state |
| `recurring_invoice_lines` | Template lines | `template_id`, item, quantity, price, date token |

### 5.5 Purchases, expenses, and money

| Table | Purpose | Important fields |
|---|---|---|
| `purchase_orders` | Orders to suppliers | supplier, number, status, dates |
| `purchase_order_lines` | Ordered items/quantities | order, item, quantity, price |
| `bills` | Supplier bills | supplier, number, dates, payment state |
| `bill_lines` | Inventory or expense lines | bill, item/account, quantity, price |
| `expenses` | Expense documents | category account, supplier, payment account, status |
| `expense_lines` | Split expense lines | expense, account, amount, tax |
| `payments` | Customer and supplier payments | party, payment type, amount, method, date |
| `payment_allocations` | Split allocation to invoices/bills | payment, document, allocated amount |
| `customer_credit_ledgers` | Separate advances and credit-note balances | customer, ledger type, amount, source |
| `refunds` | Customer/supplier refunds | source payment/credit, amount, account |
| `write_offs` | Bad debt or balance write-off | document, account, amount, reason |
| `money_accounts` | Cash, bank, UPI, cheque accounts | business, account type, account code |
| `money_transfers` | Account-to-account transfers | source, destination, amount, date |
| `bank_reconciliations` | Reconciliation sessions | account, statement date, status |
| `bank_reconciliation_lines` | Matched/unmatched transactions | reconciliation, journal/payment, matched_at |

### 5.6 Inventory and subscription accounting

| Table | Purpose | Important fields |
|---|---|---|
| `stock_movements` | All quantity changes | item, business, project, source, movement type, quantity |
| `stock_layers` | FIFO cost layers | item, source, remaining quantity, unit cost |
| `stock_allocations` | FIFO consumption and restoration | movement, layer, quantity, cost |
| `subscription_profiles` | Customer subscription settings | customer, period, billing model, active |
| `subscription_rates` | Effective price history | profile, item, rate, effective date |
| `subscription_deliveries` | Challan delivery recognition | subscription, challan, supply date, quantity |
| `subscription_settlements` | Period-end variance/refund/carry-forward | period, prepaid, delivered, settlement state |

### 5.7 Accounting, reporting, and audit

| Table | Purpose | Important fields |
|---|---|---|
| `journal_entries` | Balanced accounting headers | date, business, project, source, reversal_of |
| `journal_lines` | Debit/credit lines | journal, account, debit_paise, credit_paise, tags |
| `opening_balances` | Auditable opening balance batches | business, date, account, party, amount |
| `report_definitions` | Saved simple report builder configurations | user/company, entity, columns, filters |
| `report_schedules` | Optional scheduled exports/email | report, schedule, destination, enabled |
| `audit_events` | Append-only hash-chain audit records | actor, action, entity, before, after, previous_hash, hash |
| `system_logs` | Technical error and operational logs | level, event, context_json, occurred_at |
| `attachments` | File metadata outside SQLite | entity, safe path, MIME, size, hash |
| `backups` | Backup history and manifest | path, scope, hash, created_at, verified_at |

## 6. Current prototype database snapshot

The existing nested prototype in `book-buddha/src/database/schema.ts` currently
creates these tables:

```text
companies
businesses
customers
fairs
items
invoices
invoice_lines
credit_notes
credit_note_lines
journal_entries
journal_lines
audit_events
payments
stock_movements
```

### Current prototype relationships

```text
companies
  1 -> many businesses
  1 -> many customers
  1 -> many items
  1 -> many fairs

customers
  1 -> many fairs (host_customer_id)
  1 -> many invoices

businesses
  1 -> many invoices

fairs
  1 -> many invoices

invoices
  1 -> many invoice_lines
  1 -> many journal_entries
  1 -> many payments
  1 -> many credit_notes

credit_notes
  1 -> many credit_note_lines

items
  1 -> many invoice_lines
  1 -> many stock_movements

journal_entries
  1 -> many journal_lines
```

### Current prototype account codes

```text
CASH
RECEIVABLES
SALES
INVENTORY
COGS
OUTPUT_CGST
OUTPUT_SGST
OUTPUT_IGST
```

### Current prototype limitations

The prototype does not yet contain the complete target model. In particular,
it still needs suppliers, purchases, expenses, bank reconciliation,
subscriptions, challans, recurring templates, opening-balance workflows,
authentication, financial-year locks, attachment storage, backup/restore,
formal migrations, and the full audit hash chain.

The prototype also uses a single `invoices` table for draft invoices,
quotations, finalized invoices, and cancellations. The target architecture
should either preserve that approach deliberately or introduce a common
document header with typed child tables after a migration plan is approved.

## 7. Core accounting flows

### 7.1 Accrual invoice

```text
Debit  RECEIVABLES or CASH
Credit SALES
Credit OUTPUT TAX accounts, if applicable
```

For tracked stock:

```text
Debit  COGS
Credit INVENTORY
```

### 7.2 Cash-basis invoice

An unpaid receivable invoice is held until payment recognition. A payment
recognizes the paid proportion of revenue and tax. Partial payments must never
recognize more than the amount received.

### 7.3 Customer payment

```text
Debit  CASH/BANK/UPI account
Credit RECEIVABLES
```

Payment amount and customer are immutable after save. Allocation, date, method,
reference, and notes may be corrected according to the final payment policy.
Corrections use reversal and re-entry.

### 7.4 Credit note and return

```text
Debit  SALES / allowance account
Debit  OUTPUT TAX accounts, if applicable
Credit RECEIVABLES or CASH
```

Tracked returned items also restore FIFO stock and reverse the related COGS.

### 7.5 Purchase bill

Inventory purchase:

```text
Debit  INVENTORY
Debit  INPUT TAX accounts, if applicable
Credit CASH or PAYABLES
```

Expense purchase:

```text
Debit  Expense account
Debit  INPUT TAX accounts, if applicable
Credit CASH or PAYABLES
```

Input tax must never be mixed with output tax.

### 7.6 Subscription delivery

```text
At advance invoice:
  Debit  RECEIVABLES/CASH
  Credit UNEARNED REVENUE

At linked challan delivery:
  Debit  UNEARNED REVENUE
  Credit SALES
  Debit  COGS
  Credit INVENTORY
```

The final treatment of magazine resale and GST must remain aligned with the
open CA/legal decisions in the specification.

## 8. Data integrity requirements

Every implementation phase must verify:

- Debits equal credits for every journal.
- Journal reversals are exact opposites.
- Drafts do not post.
- Posted records cannot be destructively edited or deleted.
- Company, business, customer, supplier, item, and project ownership matches.
- Stock cannot become negative.
- FIFO allocations reconcile to stock movements.
- Payment allocations cannot exceed available balances.
- Credit-note quantities and totals cannot exceed the source invoice.
- Locked periods reject ordinary changes.
- Failed operations roll back completely.
- Audit hashes form a valid chain.
- Reports reconcile to journal entries.

## 9. Recommended implementation sequence

1. Confirm the four technology/build decisions from the handoff.
2. Lock the foundation mini-spec and database migration approach.
3. Build the accounting engine and journal integrity tests.
4. Build company, businesses, chart of accounts, numbering, FY, and opening
   balances.
5. Build login and Admin session security.
6. Build customers and merge/credit ledgers.
7. Build items, FIFO layers, thresholds, and stock movements.
8. Build invoices, quotations, tax, rounding, and document versions.
9. Build payments, allocations, refunds, returns, and write-offs.
10. Build other documents: credit notes, challans, recurring invoices, bills,
    expenses, and purchase orders.
11. Build projects/fairs and buyer-detail handling.
12. Build subscription/deferred-revenue workflows.
13. Build reports and the simple report builder.
14. Build import/export, attachments, backup/restore, and integrity checks.
15. Complete settings, audit UI, technical logs, and responsive UX.
16. Add Phase 2 scoped invoicing users and local-network device support.
17. Package and test the desktop distribution.

Each slice should follow:

```text
flow review -> mini-spec -> mini build plan -> implementation
-> accounting/repository/API/UI tests -> hand-worked acceptance figures
-> documentation and handoff
```

## 10. Repository references

- Target specification: `spec/Design Document - Book Buddha (9 Nov 2026).md`
- Screen behavior: `spec/APP_FLOW.md`
- Feature scope: `spec/Features List - Book Buddha.md`
- Requirements: `spec/PRD - Book Buddha.md`
- Build sequence: `plan/Build phase plan - Book Buddha (8 Nov 2026).md`
- Decisions: `plan/Decisions - 9 Nov 2026 (the 15 questions).md`
- Current schema: `book-buddha/src/database/schema.ts`
- Current repository: `book-buddha/src/database/repository.ts`
- Current accounting engine: `book-buddha/src/accounting/engine.ts`
- Current domain types: `book-buddha/src/accounting/types.ts`
- Current API: `book-buddha/src/api/server.ts`
- Current UI: `book-buddha/web/src/App.tsx`

