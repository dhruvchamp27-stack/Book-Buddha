# database.md — Book Buddha

*On-demand allied file (not auto-loaded). Seeded 2026-11-14 from the repo docs.
Sources: ARCH = ARCHITECTURE_AND_DATABASE.md (§5–§8), DD = spec/Design Document,
DEC = plan/Decisions (15 questions). Target model unless marked "prototype".
`ARCH §5 lists the target tables; it does NOT say all are required in V1.`*

## Ground rules
- **One SQLite file per company.** All money is **integer paise**. Dates are ISO.
  Foreign keys ON. (ARCH §3.5)
- Every financial operation runs in **one DB transaction** — all-or-nothing.

## Target table model (ARCH §5), by group
- **Company & security:** `companies`, `businesses` (company_id, financial_year_start),
  `users` (Phase 1 Admin; Phase 2 invoicing users), `sessions`, `login_attempts`,
  `permissions`.
- **Config & numbering:** `financial_years` (per business, `locked_at`),
  `numbering_sequences` (per business, per doc type, `next_number`), `settings`,
  `chart_accounts` (shared company chart), `business_account_settings`, `tax_rates`,
  `custom_field_definitions` (`is_duplicate_key`), `tags`.
- **Master data:** `customers`, `customer_contacts`, `customer_addresses`,
  `customer_aliases` (merge redirect), `suppliers`, `items` (`track_stock`, `mrp`,
  account links), `item_prices` (date-effective, per supplier),
  `item_stock_settings` (per-business thresholds), `projects`
  (host_customer_id, project_type), `custom_field_values`, `entity_tags`.
- **Sales documents:** `documents` (common header: business, document_type, number,
  status, customer, dates), `document_lines`, `document_taxes`, `document_versions`
  (immutable snapshot_json history), `document_links` (quote/invoice/challan/credit),
  plus typed child tables `quotations`, `credit_notes`, `challans`,
  `recurring_invoice_templates`, `recurring_invoice_lines`.
- **Purchases & money:** `purchase_orders`(+lines), `bills`(+`bill_lines`),
  `expenses`(+`expense_lines`), `payments` (party, type, method, date),
  `payment_allocations`, `customer_credit_ledgers` (advances vs credit notes),
  `refunds`, `write_offs`, `money_accounts`, `money_transfers`,
  `bank_reconciliations`(+lines).
- **Inventory & subscriptions:** `stock_movements`, `stock_layers` (FIFO lots),
  `stock_allocations` (FIFO consume/restore), `subscription_profiles`,
  `subscription_rates`, `subscription_deliveries`, `subscription_settlements`.
- **Accounting, reporting, audit:** `journal_entries` (date, business, project,
  source, `reversal_of`), `journal_lines` (account, debit_paise, credit_paise, tags),
  `opening_balances`, `report_definitions`, `report_schedules`, `audit_events`
  (actor, action, entity, before, after, `previous_hash`, `hash`), `system_logs`,
  `attachments` (metadata only; files live outside SQLite), `backups`.

## Double-entry design (DD §3.2, §4; ARCH §5)
- Every posting writes a **balanced** `journal_entries` header + `journal_lines`
  (debit/credit). A save that does not balance is **rejected** (DD §4.1).
- **Business and project sit on the whole entry** (header + detail), not on UI rows.
- **Drafts post nothing** (they only reserve stock) (DD §4.2).
- Stock is a **separate movement ledger** tied to FIFO layers (DD §6.3).

## Standard accounting flows (ARCH §7, DD §11.1)
- **Accrual invoice:** Dr Receivables/Cash · Cr Sales · Cr output tax. Tracked items
  add Dr COGS · Cr Inventory.
- **Customer payment:** Dr Cash/Bank/UPI · Cr Receivables.
- **Credit note:** Dr Sales/allowance · Dr output tax · Cr Receivables/Cash · + FIFO
  restoration for tracked items.
- **Purchase:** Dr Inventory or Expense · Dr input tax (never mixed with output tax) ·
  Cr Cash/Payables.
- **Advance subscription invoice:** Dr AR · Cr Unearned Revenue. Linked challan:
  Dr Unearned Revenue · Cr Sales (+ Dr COGS · Cr Inventory if tracked).
- **Cash-basis invoice:** revenue recognised only as payment allocations arrive;
  partial payments never recognise more than received (ARCH §7.2).

## Cancel-with-reversal (DD §2.1, §4.4; ARCH §2)
Posts the **exact reverse** entry (`journal_entries.reversal_of`), restores stock,
marks the document **Cancelled**, keeps it visible, and **never reuses the number**.
Finalised docs: editable with the prior version kept in `document_versions`.
Payments: amount & customer **immutable** after save — correction is reverse-and-re-enter
(DD §9.4).

## Audit log (DD §2.1, DEC Q9)
Append-only `audit_events` with a **hash chain** (`previous_hash` → `hash`), read-only
in the UI, from day one. Q9: restrict direct DB access; periodically back up / anchor
the hashes externally. **Not yet implemented in the prototype.**

## Integrity checks (ARCH §8)
Debits = credits · reversals are exact opposites · drafts don't post · posted records
not destructively edited · ownership matches (company/business/customer/supplier/item/
project) · stock never negative · FIFO reconciles to movements · allocations ≤ balances
· credit-note total ≤ source · locked periods reject changes · failed ops roll back ·
audit chain valid · reports reconcile to journals. Migrations backward-compatible,
ordered, with `PRAGMA foreign_key_check`.

## Prototype schema (ARCH §6) — the subset that actually exists
`companies, businesses, customers, fairs, items, invoices, invoice_lines,
credit_notes, credit_note_lines, journal_entries, journal_lines, audit_events,
payments, stock_movements`. Company → many businesses/customers/items/fairs; fair →
one host customer; invoice → business + fair + customer; invoice_lines → items;
journal_entries → invoices. **No hash chain, no `documents` header, invoice-level GST.**
