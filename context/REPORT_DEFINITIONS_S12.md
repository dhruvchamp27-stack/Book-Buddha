# Report definitions — session 12, the six absent §13 reports

Written BEFORE any code, per his standing instruction "Define accounting entries before coding".
Each report below states: **what it means in plain English · where every figure comes from · what
it must tie to · the hand-workable example · what it deliberately does NOT do.**

Authorities: `spec/Design Document - Book Buddha (9 Nov 2026).md` (#1) names Customer Balance
Detail, Open Invoices, Collections, Inventory Valuation **Detail**. `CLAUDE_FINISHING_PLAN.md` §13
(#8) names customer statements, stock ageing, item profitability. They are additive, and §1A
forbids reducing scope, so **all six are in scope**. S12-2 said five; it missed Inventory
Valuation Detail, which exists only in summary form (`getInventoryValuation`, one route).

## House rules these six must obey (from `reports-sales.ts`, which is the model)
1. A module `reports-<area>.ts` + `reports-<area>.test.ts`; every function takes the
   `better-sqlite3` handle FIRST, so it touches neither the repository nor the API.
2. Filters through `reportConditions` (alias `je`) and `assertReportFairExists` — never a
   privately-invented idea of which documents belong to a fair (S11-9: an unknown fair must
   raise, not return zero rows).
3. Figures come from the **POSTED JOURNAL**, not from document lines, so a report and the ledger
   cannot disagree. The two exceptions are stated below and justified where they occur.
4. Dates are `journal_entries.entry_date` (the transaction date), never `created_at`.
5. Integer paise only. Every total is the sum of its own rows — no second formula.
6. Accrual only. A cash-basis view would need `deriveCashView`, which needs the repository; a
   second proportional formula is exactly how defects S3-4 and S3-5 happened.

---

## 0. THE SHARED CHANGE THIS SLICE NEEDS FIRST

### 0a. `openCustomerItemRows` gains `asAtDate` (and keeps today's behaviour when not given)
`openCustomerItemRows` (`repository.ts:6605`) is the **one definition of what a customer still
owes**: invoices less non-cancelled payments, less applied credit, less credit notes read from the
posted journal, plus opening balances less their receipts. `getReceivables`, `getReceivablesAgeing`
and `getOpenCustomerItems` are all reshapes of it.

It has two limits that block three of the six reports:
- **no as-at date** — so "what was owed on 31 March" cannot be asked;
- it ends with `.filter((item) => item.outstandingPaise > 0)` — so a settled document vanishes,
  which is right for an open-item list and wrong for a statement.

**Do NOT write a second "what is owed" query.** Extend this one:
`openCustomerItemRows({ businessId?, customerId?, asAtDate?, includeSettled? })`.
- `asAtDate` ⇒ invoice counted only if its entry date ≤ as-at; a payment counted only if
  `payments.paid_on` ≤ as-at; an applied credit only if its application date ≤ as-at; a credit
  note only if its journal `entry_date` ≤ as-at; an opening balance only if `as_at` ≤ as-at, and
  its receipts likewise.
- `includeSettled` ⇒ skip the final filter.
- **Both default to today's behaviour**, so the three existing callers are untouched and their
  tests must stay green unchanged. That is the regression guard.

### 0b. One dated-stock-layer helper, shared by reports 4 and 5 and 6
`getStockLayers` (`repository.ts:4033`) replays FIFO but **throws the date away**. Stock ageing,
valuation detail and item profitability all need it. Write it **once**:
`datedStockLayers(db, itemId)` → `{ movementId, quantity, unitCostPaise, sourceId, receivedOn,
dateBasis }`.

**Which date a layer ages from** — `stock_movements.occurred_at` is the *insertion instant*, not
the economic date (`addStockMovement`'s own comment says so: `occurredOn` dates the journal entry
only, because FIFO consumes `ORDER BY occurred_at` and a back-dated layer would re-measure COGS
already posted). Ageing from `occurred_at` would date opening stock entered today as *today*,
which is the one thing an ageing report must not do. So:

| layer came from | `receivedOn` | `dateBasis` |
|---|---|---|
| PURCHASE with a bill | that bill's posted entry date | `BILL` |
| OPENING / ADJUSTMENT | `je-stock-movement-<id>`'s `entry_date` | `JOURNAL` |
| PURCHASE with no source and no entry | IST date of `occurred_at` | `ENTRY_INSTANT` |

The last row is the honest hole `planStockJournalBackfill` already counts: a source-less PURCHASE
posts nothing. It must be **flagged in the row, not hidden**, and the ageing report must report
how many layers fell back.

**FIFO order is never re-sorted by `receivedOn`.** The replay stays `ORDER BY occurred_at, rowid`.
`receivedOn` is a label carried along, nothing more. A test must pin this: back-date an opening
layer and prove the consumption order did not change.

---

## 1. Customer statement
**Plain English:** one customer's account, like a bank statement — every invoice, credit note and
receipt in date order, with a running balance, ending in what they owe today.

**Mirror** `getSupplierStatement` (`repository.ts:5575`) in shape, **but not in content** — the
supplier version lists only BILL / EXPENSE / PAYMENT and so predates opening supplier balances
(v14) and purchase returns (v19). The customer version must carry all five event kinds:

| row type | sign | source | note |
|---|---|---|---|
| `OPENING` | + | `opening_customer_balances`, `reversed_at IS NULL` | dated `as_at` |
| `INVOICE` | + | FINALIZED, `payment_account = 'RECEIVABLES'` | total as `openCustomerItemRows` computes it |
| `CREDIT_NOTE` | − | posted journal, `je.id LIKE 'je-credit-note-%'`, line on the invoice's payment account | read posted, never recomputed from note lines (they drift when tax is clamped) |
| `PAYMENT` | − | `payments`, `cancelled_at IS NULL` | **a cancelled payment never settled anything** — the same rule the supplier statement follows, and leaving it in would make the statement disagree with `getReceivables` |
| `OPENING_RECEIPT` | − | `opening_balance_receipts` | |

**Ordering:** `(date, order)` with documents `order: 0` before settlements `order: 1`, as the
supplier statement does — so a same-day invoice-and-receipt reads in the order it happened.

**TIE-OUT (the test that makes this report true):** `closingBalancePaise` **must equal** the sum
of `outstandingPaise` from `openCustomerItemRows({ customerId })`. If those two ever differ, one
of them is wrong, and this report is not to be shipped until they agree.

**Unapplied customer credit** — a credit note's refundable part that is neither refunded nor
applied is **not** part of what the customer owes (it is the business's liability to them). It is
reported as a separate `unappliedCreditPaise` figure beside the closing balance, never netted into
it. Netting would make the statement disagree with `getReceivables`.

**Does NOT:** show cash invoices (`payment_account = 'CASH'` never created a receivable), take a
cash-basis view, or carry fair-wise columns (a customer's account is across fairs by nature; the
fair view is Customer Balance Detail's job).

**Hand example to pin:** opening Rs 10,000 (1 Apr) · invoice Rs 25,000 (5 Apr) · credit note
Rs 5,000 (7 Apr) · receipt Rs 12,000 (9 Apr) → running 10,000 / 35,000 / 30,000 / 18,000.
Closing **Rs 18,000**, and `getReceivables` for that customer must also say Rs 18,000.

## 2. Customer Balance Detail
**Plain English:** every customer, and under each one every document still unpaid, with what is
left on it — the detail behind the A/R total.

Built on `openCustomerItemRows({ businessId?, customerId?, asAtDate? })`, grouped by customer,
each group carrying its own subtotal, plus a report total.

**TIE-OUT:** report total **must equal** `getReceivables` for the same filter, and (with no
as-at) the RECEIVABLES balance in the trial balance less opening sub-ledger timing. The first of
those two is the test; the second is checked by hand once and recorded.

**Does NOT** invent a fair column until `openCustomerItemRows` has one — see Known limitations.

## 3. Collections
**Plain English:** the chasing list — who is **overdue**, by how much, and how to reach them.

Collections has **no written definition in the spec** — `PRD.md:109` and `app-flow.md:332` give
only the name, and the `invoiceCollections` in `repository.ts` is unrelated internal cash-view
plumbing. So it is defined here from the standard meaning, and the definition is small enough to
be obviously right: **Customer Balance Detail, restricted to documents whose due date is before
the as-at date, with the customer's contact details attached.**

`invoices.due_date` **exists** (`schema.ts:61`), which is what makes this honest rather than
guessed. Rules:
- `dueOn` = `invoices.due_date` when set; when NULL, fall back to the invoice date **and say so in
  the row** (`dueDateBasis: 'DUE_DATE' | 'INVOICE_DATE'`). An opening balance has no due date, so
  it falls back to its `as_at`.
- Overdue = `dueOn < asAtDate` (default: today, IST). `daysOverdue` = whole days between.
- Sorted oldest-overdue first — that is the order someone actually makes the calls in.
- Contact details come from `customers`; no column is invented.

**TIE-OUT:** every Collections row must appear in Customer Balance Detail for the same as-at with
the same `outstandingPaise`; Collections is a strict subset. A test asserts the subset property,
so the two can never drift.

## 4. Stock ageing
**Plain English:** how long the stock on the shelf has been sitting there — the buckets tell you
what is going stale.

Per stock-tracked item, the layers from `datedStockLayers` placed in buckets by
`asAtDate − receivedOn`: **0–30 / 31–60 / 61–90 / 91–180 / 180+ days**, each bucket carrying
quantity and value (`quantity × unitCostPaise`).

**TIE-OUT (the one that matters):** for every item, the buckets must sum to exactly the quantity
and value that `getInventoryValuation` reports. Same FIFO replay, same numbers, only grouped — so
if the buckets do not sum to the valuation, the ageing report is wrong by construction. Test it
per item and in total.

**Reports its own uncertainty:** a count of layers whose date came from `ENTRY_INSTANT` (the
source-less-PURCHASE hole), so nobody reads an ageing profile as firmer than it is.

## 5. Inventory Valuation Detail
**Plain English:** the valuation summary, opened up — each remaining lot, when it came in, what it
cost, what it is worth.

One row per surviving FIFO layer from `datedStockLayers`: item, `receivedOn`, `dateBasis`,
quantity, unit cost, value, and where it came from (`sourceId`).

**TIE-OUT:** rows grouped by item must equal `getInventoryValuation` exactly, quantity and value.
This is the same assertion as stock ageing, from the other direction, and both share one helper —
which is the point of writing the helper once.

## 6. Item profitability
**Plain English:** per item, what it sold for less what it cost us — the gross margin.

- **Revenue** from `salesByItem` (net of returns). Do **not** write a second revenue query.
- **COGS** from the stock sub-ledger: `SUM(−quantity_delta × unit_cost_paise)` over
  `movement_type IN ('SALE','SALE_REVERSAL')`. `consumeInvoiceStock` (`repository.ts:3942`) writes
  **one SALE row per FIFO layer consumed, each at that layer's own cost**, and returns exactly
  that sum as the COGS journal amount — so this figure IS the posted COGS, not a re-derivation.
  SALE has a negative delta (stock out, positive COGS); SALE_REVERSAL has a positive delta (goods
  back, negative COGS), so returns net themselves off with no special case.
- **Gross margin** = revenue − COGS. **Margin %** is NOT stored as a rounded integer; it is
  derived for display only, so no paise is ever lost to a percentage.

**Dating:** by the **source document's** posted entry date, exactly as `salesByItem` does
(`source_type = 'INVOICE' AND is_reversal = 0`, `MIN(entry_date)`, grouped by `source_id`) — never
`occurred_at`, or a back-dated sale would split across months and the two halves of this one report
would disagree with each other. A credit note's stock rows carry `source_id = <note id>` while the
note's journal entry carries `sourceId = <invoice id>` under the id `je-credit-note-<note id>`, so
the note's date is read from that entry.

**TIE-OUT:** total COGS in this report must equal the sum of COGS-account debits less credits in
the posted journal for the same filter. That is the assertion that proves it ties to the ledger.

**INHERITED LIMIT, stated plainly because it will be asked about:** `salesByItem` deliberately
does **not** spread invoice-level discount, extra charge or GST across lines — its own comment
says there is no honest rule for doing so. So revenue here is quantity × unit price, and the
report's revenue total ties to `salesByItem`, **not** to net sales from the journal. The report
must carry that sentence on its face. Spreading a header discount across lines is the very
question still waiting on his odd-paise ruling (S11-1/S11-2); until he rules, this report must not
invent an answer.

---

## Known limitations to record, not to fix in this slice
- **No fair filter on the customer reports.** `openCustomerItemRows` has `businessId` and
  `customerId` only, and the Design Document wants every report except the Balance Sheet available
  fair-by-fair. Adding a fair dimension to receivables is its own slice (an invoice's fair lives on
  its journal entry, so it means joining the posted entry into the open-item query and deciding
  what an opening balance's fair is — a question for him). **Carry it as a limitation and tell
  him**; do not half-build it here.
- The RECEIVABLES trial-balance tie is hand-checked once, not asserted, because opening sub-ledger
  timing can legitimately differ. Record the hand figures.
- Cash-basis views of these six are out of scope by house rule 6.

## Build order (each a gate-passing step, in this order)
1. `0a` as-at on `openCustomerItemRows` — existing three callers' tests must pass UNCHANGED.
2. `0b` `datedStockLayers` + the FIFO-order-unchanged test.
3. Reports 4 and 5 (stock ageing, valuation detail) — they share `0b` and tie to one another.
4. Reports 1, 2, 3 (statement, balance detail, collections) — they share `0a` and tie to one another.
5. Report 6 (item profitability).
6. Routes for all six + `reports-wiring.test.ts` entries + the unknown-fair sweep.
