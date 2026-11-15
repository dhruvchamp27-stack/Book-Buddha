# Remaining build plan — Book Buddha backend

Written 2026-11-15, at the end of the session that built Slices 7 and 8.
**This supersedes per-slice plan files.** The owner asked for one plan covering everything
still pending, rather than a new `SLICE_n_PLAN.md` each time.

Branch `autonomous/book-buddha-finish`. Backend only. Money = integer paise. Every posted
journal balances. Finalized records immutable (corrections via reversal). Never negative
stock. One commit = one idea, staged by explicit path. Never push without asking.

Source of truth order: `spec/Design Document` → `CLAUDE_FINISHING_PLAN.md` (§25B = Phase 0–8
roadmap, §13 = reports/filters, §25D = "fully fledged ready") → `context/HOT.md` for live
status. §-references below point at those.

---

## Decisions LOCKED by the owner, 2026-11-15

1. **Chart of accounts — add all four in ONE migration:** `UNEARNED_REVENUE`, `BANK`,
   `UNCATEGORIZED`, `OPENING_BALANCE_EQUITY`. The `journal_lines` account `CHECK` is a fixed
   13-code list rebuilt by migration; doing it once beats three or four rebuilds.
2. **Subscriptions / deferred revenue — DEFERRED** (DD §11; §11.6 still has three open
   items: early-closure behaviour, statement layouts, refund-vs-carry-forward default).
3. **NEW owner-requested slice — "all report formats"**: build out the full report set
   (§13), not just the filters.
4. **Credit notes in the cash view — recognise when the adjustment actually happens, never
   retroactively.** The owner's wording:
   > Recognize credit notes in the cash view on the date they are actually refunded or
   > applied, not retroactively against the original invoice collections.
   > - Credit note issued but not refunded/applied → **no impact** on cash-basis P&L.
   > - Refund issued → reduce revenue **in the refund month**.
   > - Credit applied to a future invoice/payment → reduce revenue **when the credit is used**.
   > - Previously collected invoice → **never rewrite an earlier month's cash figures**.
   > Principle: cash-basis reports reflect the period in which the financial adjustment
   > actually occurs; they do not rewrite historical periods.
   This is the same principle already applied to reversals in 7c (a reversal carries its own
   date). **Current code does NOT do this** — `deriveCashView` folds a credit note into its
   invoice's lines pro rata with collections, which restates earlier periods. See S3.

---

## Three buckets

- **A — buildable now, no owner input, no installs:** S1–S11 below.
- **B — needs an owner decision first:** Subscriptions (§11.6 ×3); bank categorization +
  bill OCR (the Feature Design is **unapproved**, 3 open items in its §H — archive scope,
  auto-record payment on match, who names `UNCATEGORIZED`).
- **C — not backend, or needs an install (ask first):** PDF export, XLSX export, an OCR
  engine, Tauri packaging, all UI, live Google OAuth verification, `npm audit` remediation.

---

## Ordered slices

Dependencies drive the order. S1 and S2 unblock most of the rest, so they go first.

### S1 — Chart of accounts + one account classification map *(do first)*
Migration **v7**: rebuild the `journal_lines` account `CHECK` with the four new codes
(decision 1). Follow v4's rebuild pattern, which needs `PRAGMA foreign_keys = OFF` and so
must be `transactional: false`, and mind the `journal_lines` cascade-delete hazard noted in
`purchasing-schema.ts`.
**In the same commit, fix a latent trap:** `getBalanceSheet`, `getProfitAndLoss` and
`deriveCashView` each **hardcode account names**. A new code missing from one of those lists
is silently dropped — which, for a balance-sheet account, **unbalances the sheet with no
error**. Replace the three hardcoded lists with a single classification map
(account → ASSET / LIABILITY / EQUITY / INCOME / EXPENSE / TAX) and derive every report
section from it. Acceptance: add the four codes and the Balance Sheet still balances; a test
asserts every account code appears in exactly one classification.

### S2 — Payment dates
`recordPayment` and `recordSupplierPayment` stamp `paidAt = now()` with no way to pass a
date. Consequences: nothing entered after the fact can be dated correctly, the 7d cash view
and every date filter are wrong for back-dated entry, the 7d acceptance tests needed fake
timers to place a payment, and a future bank import has no way to supply the real date.
Add an optional payment date (validated `YYYY-MM-DD`, IST, defaulting to today).
**No migration needed** — `paid_at` already exists. Acceptance: a back-dated payment lands
in the right month's cash P&L.

### S3 — Credit notes in the cash view + a refund path
Implement decision 4. A credit note must stop affecting earlier periods. Needs:
a refund record (cash out against a credit note), recognition of the reduction on the
**refund date**, recognition on the **application date** when a credit is applied to another
invoice, and **no cash-P&L effect at all** while a note is merely issued. Update
`deriveCashView` and its comment, which currently documents the pro-rata behaviour.
Acceptance (ask the owner for figures): an invoice collected in January with a note raised in
March leaves January's cash sales untouched and reduces March's.

### S4 — Opening balances (§14)
Uses `OPENING_BALANCE_EQUITY` from S1. Opening customer/supplier balances and opening stock
must create **balanced** journals. This also retires the standing carry-over that
opening/adjustment stock posts **no GL entry** (offset was TBD — it is now
`OPENING_BALANCE_EQUITY`). Acceptance: after entering opening balances the Trial Balance
balances and customer/supplier balances reconcile to the ledger.

### S5 — Financial-year locking (§19)
Enforce at **one choke point**: `insertJournalEntry`, which since 7c already receives
`entryDate`. A locked period refuses ordinary posting and allows only what the spec permits.
Acceptance: posting into a locked FY is refused at the repository boundary, not just the API.

### S6 — Audit hardening and hash chain (§20)
Append-only audit events with hash-chain verification that **detects tampering** (§25D
requires this explicitly). **Ordering trap:** a trigger that blocks `UPDATE` on
`journal_entries` would make any future v5/v6-style column backfill impossible. Either scope
immutability triggers to the amount/account columns, or add them in the **last** migration.

### S7 — The reports slice *(owner-requested)*
Build the full §13 set, each honouring the existing filters (business, date, fair, and
cash/accrual where relevant) **in SQL**: A/P ageing · Sales by item / customer / business /
tax · Customer statements · Credit-note report · Sales-return report · Stock movement ·
Stock ageing · Item profitability · Transaction Detail by Account · Transaction List by Date ·
Open Invoices · Collections · Customer Balance Detail · Inventory Valuation Detail.
Add the still-missing filters: **item** and **customer** (fair and business are done).
Carry-over to settle here: `GeneralLedgerRow.date` is still the posting timestamp while
`entryDate` is the transaction date — decide which the ledger should present.
Note: on-screen/JSON only. PDF and XLSX export are bucket C.

### S8 — Purchase returns, supplier refunds, payment cancellation, bill discount
The deferred purchase-side items. Purchase returns mirror credit notes (stock + ITC
reversal). Cancelling a supplier payment and supplier refunds both need the immutable
correction-by-reversal path. Header-level bill discount/extra charge completes the bill.

### S9 — Attachments (§17)
Document storage for invoices, bills, expenses and receipts — the shared engine the Feature
Design reuses for imports and OCR, which is why it comes **before** banking.

### S10 — Import / export (§15)
CSV and JSON in and out, over the shared import → review → post engine. XLSX and PDF are
bucket C. Acceptance (§25D): imports work with realistic data.

### S11 — Backup, restore and integrity checks (§16, §21)
Offline backup/restore of the SQLite file with an integrity check, plus automated backups.
Acceptance (§25D): an existing prototype database restores and still migrates.

### S12 — Banking *(partly bucket B)*
**Buildable now:** bank accounts, transfers, reconciliation — these have no open decisions.
Uses `BANK` from S1.
**Blocked on the owner:** the QBO-style "For review" **categorization queue** (Add / Match)
and **bill OCR**. The Feature Design is unapproved with 3 open items in its §H, and OCR needs
an engine installed (bucket C). Build the accounts/transfers/reconciliation part; leave the
queue until the FD is approved.

### S13 — Cash Flow Statement
After banking, per the roadmap. Uses the classification map from S1.

### S14 — Archive
The third state (Active / Inactive / Archived). Scope is one of the unapproved FD §H items —
confirm whether it covers masters only or documents too.

### Deferred beyond this list
Subscriptions / deferred revenue (decision 2) · bank categorization + OCR (bucket B/C) ·
PDF and XLSX export · Tauri packaging · all UI and the deferred Slice 4 login UI + live
Google OAuth · `npm audit` remediation.

---

## Standing engineering notes (learned the hard way this session)

- **Migration-count assertions are hardcoded in four test files** and break on every new
  migration (v5 broke three, v6 broke seven). Derive them from the `migrations` list once,
  early in S1, instead of editing literals again.
- **Two agents must never edit `repository.ts` at once.** Keep one agent there; the second
  works only in new files (a module taking `db`, its own test file), and the one-line wiring
  is added by hand. Assign migration version numbers centrally so two agents never both
  append to `migrations.ts`.
- **Never run the gates while an agent is writing** — line numbers shift mid-read and the
  failures are unattributable. Wait, verify the combined tree once, then split commits by path.
- **A migration can never be edited once applied.** Get its gates right before committing;
  v6's gate 3 had to be generalised the moment slice 8b made its assumption false.
- **Acceptance is the owner's hand-worked figures, not a passing test.** Every accounting
  slice should carry `ACCEPTANCE ...`-named tests with his numbers, as 7d and 8c do. Record a
  slice in `HOT.md` as *built, figures unconfirmed* until he confirms them.
