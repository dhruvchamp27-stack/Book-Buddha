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

### 0a. `openCustomerItemRows` gains `fairId` and `includeSettled` (and nothing else — see the trap below)
`openCustomerItemRows` (`repository.ts:6605`) is the **one definition of what a customer still
owes**: invoices less non-cancelled payments, less applied credit, less credit notes read from the
posted journal, plus opening balances less their receipts. `getReceivables`, `getReceivablesAgeing`
and `getOpenCustomerItems` are all reshapes of it.

It has one limit that blocks the reports: it ends with
`.filter((item) => item.outstandingPaise > 0)`, so a settled document vanishes — right for an
open-item list, wrong for a statement.

### THE AS-AT TRAP — do not add `asAtDate` to this function
My first draft of this file said to add one. **That was wrong, and it would have planted a second
meaning of `asAtDate` inside shared code.** `getReceivablesAgeing` (`repository.ts:2782`) already
takes `asAtDate` and **never filters the open items by it**: it passes the date to
`buildAgeingReport`, which uses it to measure each document's age and — only when the caller
actually asked for a date — to drop documents *dated after* it. Settlements are never rolled back.
So the established, accepted meaning in this codebase is:

> **"What is outstanding now, excluding documents that did not yet exist on the as-at date, aged to
> that date."** It is NOT "the balance as it stood that day."

The code says so in its own words at `repository.ts:2718-2724`. A real historical balance would
need payments, cancellations and reversals rolled back (`cancelled_at`, `status`, `reversed_at` all
record only today's state), which is a different and much larger piece of work.

Therefore: **`openCustomerItemRows` gains `fairId` and `includeSettled` only.** No date filter.
- **Customer statement** needs no as-at: it is the whole history with a running balance, ending at
  what is owed now.
- **Customer Balance Detail** needs no as-at: it is the detail behind today's A/R, and must tie to
  `getReceivables` exactly.
- **Collections** takes `asAtDate`, and uses it exactly as `buildAgeingReport` does — to compute
  `daysOverdue` and to drop documents dated after it — so the two reports agree about who is
  overdue. Its doc comment must carry the sentence above, so nobody reads it as a historical
  balance.

**Do NOT write a second "what is owed" query.** Extend this one:
`openCustomerItemRows({ businessId?, customerId?, fairId?, asAtDate?, includeSettled? })`.

**`fairId` is required by the spec, not optional polish.** The Design Document (authority #1,
line 366) says every report except the Balance Sheet is viewable fair by fair, and that fair-level
reporting "stops at P&L, **A/R** and other income/cost views" — A/R is named. It is cheap here
because `invoices.fair_id` exists on the invoice itself (`schema.ts:56`); no journal join is
needed, unlike `salesByItem`. `getReceivables` and `getReceivablesAgeing` get the fair filter for
free by passing through, which closes a pre-existing spec gap at no risk (they pass nothing today,
and nothing = consolidated = exactly their current behaviour).

**Under a fair filter, opening customer balances are EXCLUDED, and the report says so.**
`opening_customer_balances` has no `fair_id` (`opening-sub-ledger-schema.ts:26`) and should not:
an opening balance is what the customer owed before the books began, so it cannot belong to a fair
that happened afterwards. This is not a gap to be filled — it is the right answer. But a fair-wise
A/R total will therefore be less than the consolidated total by the opening balances, so each
fair-filtered report carries `excludedOpeningBalancesPaise` so the difference is visible and
nobody reads it as a missing receivable.
**Dates, where a report needs one.** Use the column and conversion each part already has; **do not
invent a date rule.** These are also the dates the statement's rows carry:

| part | the date expression to use | why this one |
|---|---|---|
| invoice | the invoice's posted `entry_date` | house rule 4. **Not** `COALESCE(i.invoice_date, i.created_at)` — when `invoice_date` is NULL that yields a UTC *timestamp*, and comparing it to a date drops a same-day invoice and shifts the IST boundary. `openCustomerItemRows` selects the COALESCE only to *display* a date, never to compare one. |
| payment | `date(p.paid_at, '+330 minutes')` | `payments` has **no** `paid_on`; `paid_at` holds either a UTC timestamp or a bare business date (`repository.ts:2464`), and this is the identical expression that dates the payment's own journal entry (`journal-dimensions-schema.ts:69`). A bare date passes through unchanged; a timestamp converts UTC→IST. Anything else would date the report differently from the ledger. |
| applied credit | `credit_note_applications.applied_on` | stored, already a date |
| credit note | the posting journal entry's `entry_date` | the note is read from the posted journal, so its date must come from there too |
| opening balance | `opening_customer_balances.as_at` | stored, already a date |
| opening receipt | `opening_balance_receipts.received_on` | stored, already a date |
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
| SALE_REVERSAL (goods returned on a credit note) | `je-credit-note-<source_id>`'s `entry_date` | `CREDIT_NOTE` |
| PURCHASE with no source and no entry | IST date of `occurred_at` | `ENTRY_INSTANT` |

The `SALE_REVERSAL` row is easy to miss: the replay opens a lot for **any** positive delta, and a
credit note returning goods is a positive delta, so returned stock becomes a layer. Note the
deliberate asymmetry — a note's stock rows carry the NOTE's id in `source_id`, while the note's
journal entry carries the INVOICE's id, so the entry is matched on its `id`, never its `source_id`.
`ENTRY_INSTANT` must be left for genuinely undated layers alone, so that its count means something.

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
| `CREDIT_APPLIED` | − | `credit_note_applications`, dated `applied_on` | **this row is easy to miss and the balance will not tie without it:** `openCustomerItemRows` counts applications inside `paid_paise`. It is a genuinely separate event posted under its own id `je-credit-apply-<id>` (`Dr CUSTOMER_CREDITS / Cr RECEIVABLES`, `repository.ts:2117`), deliberately NOT under the `je-credit-note-` prefix |
| `PAYMENT` | − | `payments`, `cancelled_at IS NULL` | **a cancelled payment never settled anything** — the same rule the supplier statement follows, and leaving it in would make the statement disagree with `getReceivables` |
| `OPENING_RECEIPT` | − | `opening_balance_receipts` | |

**A cancelled credit note needs no special case, and must not get one.** Its reversal carries the
same `je-credit-note-` prefix (stated in the `reports-sales.ts` header), and the prefix query nets
credits against debits, so the note and its reversal both appear as rows and cancel to nil — which
is how a statement should read, the way a bank statement shows a reversed charge. Do not filter
either row out.

**A refund (`je-refund-<id>`) is NOT a statement row.** It posts `Dr CUSTOMER_CREDITS / Cr CASH`
and never touches RECEIVABLES, so it cannot move the closing balance. It reduces
`unappliedCreditPaise` instead.

**Ordering:** `(date, order)` with documents `order: 0` before settlements `order: 1`, as the
supplier statement does — so a same-day invoice-and-receipt reads in the order it happened.

**TIE-OUT (the test that makes this report true):** `closingBalancePaise` **must equal** the sum
of `outstandingPaise` from `openCustomerItemRows({ customerId })`. If those two ever differ, one
of them is wrong, and this report is not to be shipped until they agree.

**Unapplied customer credit** — a credit note's refundable part that is neither refunded nor
applied is **not** part of what the customer owes (it is the business's liability to them). It is
reported as a separate `unappliedCreditPaise` figure beside the closing balance, never netted into
it. Netting would make the statement disagree with `getReceivables`.

**Fair filter:** accepted, for spec compliance, and it restricts the invoices (and therefore the
credit notes and receipts hanging off them) to that fair, excluding opening balances per 0a. With
no fair given — the normal case — it is the customer's whole account, which is what a statement
sent to a customer must be.

**Does NOT:** show cash invoices (`payment_account = 'CASH'` never created a receivable) or take a
cash-basis view.

**Hand example to pin.** The tie-out fixture must contain the awkward cases, or it proves nothing:
an applied credit, a cancelled payment and a cancelled credit note.

| date | event | effect | running balance |
|---|---|---|---|
| 1 Apr | opening balance | +10,000 | 10,000 |
| 5 Apr | invoice INV-1 | +25,000 | 35,000 |
| 7 Apr | credit note CN-1 | −5,000 | 30,000 |
| 9 Apr | receipt | −12,000 | 18,000 |
| 11 Apr | receipt, later CANCELLED | 0 — both rows shown, netting to nil | 18,000 |
| 13 Apr | credit applied to INV-1 | −3,000 | 15,000 |
| 15 Apr | credit note CN-2, later CANCELLED | 0 — note and reversal both shown | 15,000 |

Closing **Rs 15,000**, and `getReceivables` for that customer must also say Rs 15,000. If they
differ, the report is wrong — do not adjust the expected figure to match the code.

## 2. Customer Balance Detail
**Plain English:** every customer, and under each one every document still unpaid, with what is
left on it — the detail behind the A/R total.

Built on `openCustomerItemRows({ businessId?, customerId?, fairId?, asAtDate? })`, grouped by
customer, each group carrying its own subtotal, plus a report total.

**TIE-OUT:** report total **must equal** `getReceivables` for the same filter, and (with no
as-at) the RECEIVABLES balance in the trial balance less opening sub-ledger timing. The first of
those two is the test; the second is checked by hand once and recorded.

**Does NOT** net unapplied customer credit into a customer's subtotal, for the reason given under
report 1 — it is a liability to the customer, not a receivable from them.

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
  it falls back to its `as_at`. **The fallback is not arbitrary:** `buildAgeingReport` already ages
  every open document from its own date, so falling back to the invoice date is what makes
  Collections and A/R ageing name the same people as overdue. It does mean an invoice with no due
  date reads as overdue the day after it is issued — a real consequence, so it is flagged per row
  and put to the owner in one line rather than buried.
- Overdue = `dueOn < asAtDate` (default: today, IST). `daysOverdue` = whole days between.
- **`asAtDate` carries the codebase's established meaning, not a historical one** — see "the as-at
  trap" in 0a. It drops documents dated after the as-at and measures days to it; it does not roll
  settlements back. The doc comment must say this plainly.
- Sorted oldest-overdue first — that is the order someone actually makes the calls in.
- Contact details come from `customers`; no column is invented.

**TIE-OUT:** every Collections row must appear in Customer Balance Detail for the same as-at with
the same `outstandingPaise`; Collections is a strict subset. A test asserts the subset property,
so the two can never drift.

## 4. Stock ageing
**Plain English:** how long the stock on the shelf has been sitting there — the buckets tell you
what is going stale.

Per stock-tracked item, the layers from `datedStockLayers` placed in buckets by
`asAtDate − receivedOn`, each bucket carrying quantity and value (`quantity × unitCostPaise`).

**The buckets are `AGEING_BANDS`, the one shared list** — 0-30 / 31-60 / 61-90 / Over 90 days. My
first draft invented a second list with 91–180 and 180+; that was wrong. The list's own comment
("The age bands every ageing report uses. One definition, so customer and supplier agree.") exists
precisely to stop a second list appearing, and stock ageing is a third ageing report. The list has
been moved to its own module so a report can read it without importing the repository; there must
be exactly ONE literal band list in the codebase. Finer stock bands would change A/R ageing too,
which is accepted work — so that is the owner's call, not ours.

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

**The COGS rows must cover exactly the documents `salesByItem` counts**, or revenue and cost in
this one report would be measured over different sets of sales. So join each stock row's source
through to the document and require what `salesByItem` requires: the invoice FINALIZED, the entry
not a reversal. A cancelled invoice's stock rows must be excluded on the same test that excludes
its revenue — check how `cancelInvoice` writes and dates its stock rows before relying on this.

**TIE-OUT:** total COGS in this report must equal the sum of COGS-account debits less credits in
the posted journal. **Assert this with no date filter**, where it must hold exactly. With a date
filter it can legitimately differ: a stock row and its journal entry are dated from the source
document, but a cancellation or reversal dated in a later period moves the journal side only.
State that on the report; do not weaken the no-filter assertion to accommodate it.

**INHERITED LIMIT, stated plainly because it will be asked about:** `salesByItem` deliberately
does **not** spread invoice-level discount, extra charge or GST across lines — its own comment
says there is no honest rule for doing so. So revenue here is quantity × unit price, and the
report's revenue total ties to `salesByItem`, **not** to net sales from the journal. The report
must carry that sentence on its face. Spreading a header discount across lines is the very
question still waiting on his odd-paise ruling (S11-1/S11-2); until he rules, this report must not
invent an answer.

---

## Known limitations to record, not to fix in this slice
- A fair-wise A/R total is less than the consolidated total by the opening balances, for the
  reason given in 0a. Shown as `excludedOpeningBalancesPaise`, never silently.
- Stock ageing and valuation detail take **no** business or fair filter: a FIFO layer has no
  business dimension (`stock_movements` carries `fair_id` as a reporting tag that explicitly never
  affects FIFO or quantity — `addStockMovement`'s own comment), so a per-business stock valuation
  would be an invention. The Design Document's fair-wise rule stops at "income/cost views", which
  a stock valuation is not. Record it; do not invent one.
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
