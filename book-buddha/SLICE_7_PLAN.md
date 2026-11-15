# Slice 7 plan — Accrual-always books + report foundations

**Status: PLAN ONLY. Nothing in this slice is built.** The owner paused Slice 7 at
the plan phase on 2026-11-15; the build resumes in the next session. Do **not** start
any code in this slice until the owner says "build".

Branch: `autonomous/book-buddha-finish`. Backend only. Work only in `book-buddha/`.
Money = integer paise. Every posted journal balances (Σdebit=Σcredit via `balancedLines`).
Finalized records immutable (corrections via reversal). Never negative stock.
One commit = one idea, staged by explicit path. Never push.

---

## Why this slice exists (the owner's redirection, 2026-11-15)

The owner **replaced** the per-company cash/accrual model with the spec model
(DD §4.5, QuickBooks Online approach):

> Always post transactions using **accrual** accounting, regardless of the company's
> preferred reporting method. Keep accurate AR/AP. Provide a **Cash/Accrual toggle at
> the report level**. Cash reports recognize income when received and expenses when
> paid, computed from **actual payment allocations**. The company's accounting
> preference is the **default report setting, not a posting restriction**.
> Refactor the existing cash-basis sales and purchase logic **without duplicating
> journal entries**. **Preserve existing data** and **add regression tests**.

This **reverses** the posting-time deferral built in Slices 1–6 and in the
cash-basis-credit-purchases commit `5576a21`. Those commits stay in history; this
slice supersedes them. The advisor confirmed the shape and sequencing below.

This also resolves two standing conflicts in `context/todos.md`:
conflict **#10** (cash vs accrual: **per report** wins) and the direction for
report dimensions.

---

## Sub-slices (each is one commit; build them in order)

### 7a — Balance Sheet sign fix *(do this first; smallest, unblocks acceptance)*
Liabilities and equity are credit-normal; present them as **credit − debit** so the
sheet balances with all-positive numbers.
- Change **`getBalanceSheet()` only** (`repository.ts` ~line 1624). Do **not** change
  `getReportAccountRows()` — it also feeds the P&L, which needs debit−credit.
- Accept: `totalAssets === totalLiabilities + totalEquity`, liabilities ≥ 0.
- This retires open decision (b) in HOT.md.

### 7b — Accrual-always posting *(the refactor)*
Remove every per-company basis branch on **both** the sales side and the purchase side.
Company basis becomes a **default report setting only** — never a posting restriction.
- **Inventory the branches first — search, do not recall.** `grep` `src/` for
  `basis`, `cashBasis`, `cashBasisPaymentLines`, `cashBasisPurchaseFinalizeEntry`,
  `cashBasisSupplierPaymentLines`, `je-pending`, `assertCashBasis`. Include the
  **cancel** paths and the **credit-note** path.
- Sales: `finalizeInvoice` always posts revenue + GST at finalize (Dr AR / Cr SALES /
  Cr OUTPUT tax); `recordPayment` becomes Dr CASH / Cr AR only (no revenue split).
- Purchases: `finalizePurchaseBill` / `finalizeExpense` always post the full accrual
  entry (Dr INVENTORY/EXPENSE/INPUT, Cr PAYABLES); `recordSupplierPayment` becomes
  Dr PAYABLES / Cr CASH only.
- Delete the two cash-basis engine helpers added in `5576a21` and the sales-side
  `cashBasisPaymentLines`, **once** nothing references them.
- **Legacy data (the tightest constraint — OWNER INPUT NEEDED):** "preserve existing
  data" + "no duplicate journals" + "immutable posted records" collide on any document
  already posted in deferred (payment-time) shape. Rewriting posted rows breaks
  immutability. Plan a **reversal-plus-repost** or a **true-up entry**, not a row
  rewrite. **First ask the owner: does any real cash-basis data exist yet?** If the
  only cash-basis data is test data (likely — this is a prototype), there is nothing
  to convert and 7b is a clean refactor.
- Tests: the cash-basis tests added in `5576a21` get **rewritten** here (they assert
  deferral, which no longer happens). Add **accrual regression tests** proving sales
  and purchase posting is byte-identical to today's accrual path.

### 7c — Date + business dimension on journals *(migration + backfill)*
Today `journal_entries` has no business_id and no transaction/entry date
(`created_at` is insert time), and `getReportAccountRows` sums **all** companies with
no filter. So per-business reports, date filters, and project P&L are impossible today.
- New migration (v5) adds `business_id` and `entry_date` to `journal_entries`, with a
  **backfill** that derives both from each entry's source document (invoice / bill /
  expense / payment). Backfill on existing DBs is the acceptance risk — gate it with a
  `foreign_key_check` and a row-count assertion, like the v4 rebuild.
- Then add **business_id + date-range filters** to Trial Balance, P&L, Balance Sheet,
  and General Ledger. Consolidated = no business filter; per-business = one id.
- This retires the "consolidated & filtered reports" gap and unblocks project P&L (7-roadmap).

### 7d — Cash/Accrual report toggle *(derived, never posted)*
A report-level toggle. Accrual view = read the ledger as-is. **Cash view = derived**
from actual payment allocations: replay each document's payments in date order and
recognize income/expense/GST proportionally as cash moves — **no journal entries written**.
- **Check whether the existing allocators can be reused** as this derivation (they
  already compute the proportional split). If so, the existing fuzz test carries over.
- Company basis = the toggle's **default**, nothing more.
- Owner acceptance gate (OWNER INPUT NEEDED): hand-worked **cash** and **accrual**
  figures for one **part-paid invoice** and one **part-paid bill**, including **how
  COGS is treated in the cash view**.

---

## Roadmap AFTER Slice 7 (sequence; each its own slice)

1. **Projects (fairs)** — first-class QBO dimension (DD §3.3): tied to one host
   customer, own P&L, no per-project Balance Sheet. Needs project_id on journals
   (builds on 7c). A Book Fair is the primary project type.
2. **Subscriptions / deferred revenue** (DD §11) — advance invoice Dr AR / Cr Unearned
   Revenue; delivery challan Dr Unearned Revenue / Cr Sales (+COGS/stock); period-end
   settlement (refund / carry-forward / balance-due). New Unearned Revenue account +
   challan tables.
3. **Imports + attachments** — build **before** Banking/OCR, because the Feature Design
   reuses one shared import→review→post engine and document attachments.
4. **Banking** (its own slice, as the owner directed) — bank accounts, transfers,
   reconciliation, and the QBO "For review" **bank-categorization** queue (Add / Match).
   **Bill OCR** rides the same import engine.
5. **Cash Flow Statement** — its own slice, after Banking.
6. **Archive** — third state (Active / Inactive / Archived).
7. **Audit hardening, FY locking, packaging** — final slice(s).

> **Bank categorization is NOT built and NOT approved.** It lives only in
> `Feature Design - Bank Categorization, Bill OCR & Archive (V1).md`, which is awaiting
> owner approval and has **3 open decisions** (see `context/todos.md` → "Open questions
> awaiting the owner", FD §H). Record it as **blocked on the owner**, not scheduled,
> until those are settled.

---

## Chart-of-accounts note (decide once, not per feature)

Subscriptions needs **Unearned Revenue**; Banking needs **Bank** and **Uncategorized**
accounts. The `journal_lines` account CHECK is a fixed 13-code list, rebuilt via
migration (as v4 did). Plan **one** chart-of-accounts expansion decision covering all
new accounts, rather than a CHECK rebuild per feature.

---

## Open questions the owner must answer before the 7b/7d build

1. **Does any real (non-test) cash-basis data exist** in a live DB? (Decides whether
   7b needs a legacy conversion at all, and if so reversal-repost vs true-up.)
2. **Hand-worked acceptance figures:** cash + accrual numbers for one part-paid invoice
   and one part-paid bill, and **how COGS appears in the cash view**.
3. Confirm the chart-of-accounts expansion list (Unearned Revenue / Bank / Uncategorized)
   can be added in one migration.
