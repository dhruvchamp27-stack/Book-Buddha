# Build brief — `reports-profitability.ts`: report 6, item profitability

You are building ONE new module and ONE new test file in an existing, strict TypeScript
double-entry accounting codebase. The report is fully specified; follow it, do not redesign it.

Repo root: `C:\Users\Admin\Desktop\Book Buddha` · all commands run from `book-buddha/`.

**Another agent is working in parallel** on `src/database/open-items.ts` and
`src/database/reports-customers*.ts`. **Do not open those for editing, and do not touch any file
not listed under "What to build".**

## READ THESE FIRST, in this order

1. `context/REPORT_DEFINITIONS_S12.md` — house rules (top), **section 6**, and **RESOLUTION R7**
   (near the end), which overrides anything earlier that disagrees.
2. `src/database/reports-sales.ts` — the house model. In particular `salesByItem` (≈ line 479),
   `SalesByItemRow` (≈ 437), the "not spread" header (≈ 472-475), `withConditions` (≈ 144), and
   **`salesReturnReport`** — read exactly how it dates a credit note, because report 6 must date a
   note's stock rows the SAME way, or revenue and cost will fall into different periods.
3. `src/database/report-filters-sql.ts` — `assertReportFairExists`, `reportConditions` (alias `je`).
4. `src/database/stock-layers.ts`, `src/database/reports-stock.ts` — house shape for a stock report.
5. `src/database/repository.ts` — read (do not edit): `consumeInvoiceStock` (≈ 3949),
   `restoreInvoiceStock` (≈ 3983), `restoreCreditNoteStock` (≈ 3922), `cancelCreditNote` (≈ 2203),
   `inventoryJournalEntry` (≈ 4020), and the credit-note inventory posting (≈ 1928).
6. `src/database/reports-stock.test.ts` — the house model for a test file and its fixture.

## Facts already established (verified in the code — rely on them, but re-check if in doubt)

| what happened | `movement_type` | `source_id` | delta | journal entry |
|---|---|---|---|---|
| invoice finalized | `SALE`, one row per FIFO layer, own `unit_cost_paise` | the invoice | − | `je-inventory-<inv>`: Dr COGS / Cr INVENTORY |
| invoice CANCELLED | `SALE_REVERSAL` | the invoice | + | `je-inventory-<inv>-reversal`: Dr INVENTORY / Cr COGS, dated the day of cancellation |
| credit note finalized | `SALE_REVERSAL` | **the NOTE** | + | `je-credit-note-inventory-<note>`: Dr INVENTORY / Cr COGS |
| credit note cancelled | `SALE` | **the NOTE** | − | `je-credit-note-cancel-inventory-<note>` |

- COGS account code is `COGS` (type EXPENSE). Stock tables: `stock_movements` (`schema.ts:133`),
  `items` (`schema.ts:43`, flag `track_stock`).
- **A `SALE` row is NOT always an invoice** (R7.2). Resolve each stock row's source by looking the
  `source_id` up in `invoices` first, then in `credit_notes` — never by `movement_type`.

## What to build

### File A — `book-buddha/src/database/reports-profitability.ts` (new)

`export function itemProfitability(db, filter: ItemProfitabilityFilter = {}): ItemProfitabilityReport`

- **Filter:** `{ businessId?; fairId?; fromDate?; toDate?; itemId? }` (strings). No `customerId`
  in this slice — say so in the header comment.
- **First line:** `assertReportFairExists(db, filter.fairId)` (R5).
- **Revenue** per item = `salesByItem(db, filter)` → `netSalesPaise` (and carry `netQuantity`).
  **Never a second revenue query.**
- **COGS** per item from `stock_movements` where `movement_type IN ('SALE','SALE_REVERSAL')`:
  `SUM(-quantity_delta * unit_cost_paise)`. Only rows whose source resolves to a document that
  `salesByItem` would count:
  - source is an invoice → invoice `status = 'FINALIZED'`; date and business/fair taken from the
    invoice's own journal entry exactly as `salesByItem` takes them
    (`source_type = 'INVOICE' AND is_reversal = 0`, `MIN(entry_date)`, grouped by `source_id`).
    A cancelled invoice is therefore excluded on the same test that excludes its revenue (R7.1).
  - source is a credit note → dated, and business/fair-filtered, the way `salesReturnReport`
    dates and filters that note. A cancelled note contributes BOTH its rows (they net to nil),
    mirroring how its revenue side nets through the `je-credit-note-` prefix. **Check this
    against `salesReturnReport` and say in your report what you found.**
  - Apply business/fair/from/to via `reportConditions` on that resolved entry (alias `je`), and
    `itemId` directly. No `occurred_at` anywhere in the dating.
- **Row:** `{ itemId: string | null; itemName; unit; netQuantity; netSalesPaise; cogsPaise;
  grossMarginPaise }`. `grossMarginPaise = netSalesPaise − cogsPaise`.
  **No margin percentage field** — the definition says it is derived for display only, so no
  paise is ever lost to rounding; the header comment says the UI derives it.
  Union of items: an item with revenue and no COGS (non-stock item, or a free-text line with
  `itemId: null`) appears with `cogsPaise: 0`; an item with COGS and no revenue in range also
  appears. Sort by `itemName`, then `itemId`.
- **Report:** `{ rows; totals: { netSalesPaise; cogsPaise; grossMarginPaise }; notes: readonly
  string[] }`. Every total is the sum of its own rows. `notes` carries, verbatim in meaning:
  1. Revenue is quantity × unit price per line; invoice-level discount, extra charge and GST are
     not spread across lines, so revenue ties to Sales by Item, not to net sales in the journal.
  2. With a date filter, COGS may differ from the COGS ledger, because a cancellation posts on the
     day it happens while its stock rows keep the document's date.
- Header comment in the house style: what it means, where each figure comes from, what it ties to,
  what it deliberately does not do (no customer filter, no discount spreading — that waits on the
  owner's odd-paise ruling S11-1/S11-2, no cash basis).

### File B — `book-buddha/src/database/reports-profitability.test.ts` (new)

Fixture in the house style (copy the `world()` pattern from `reports-stock.test.ts`, fake Date as
it does). It must contain the awkward cases or it proves nothing: a sale that consumes **two FIFO
layers at different costs**, a **cancelled invoice**, a **credit note returning goods**, a
**cancelled credit note**, a **non-stock item** sale, and invoices on **two fairs** (and one on none).

Tests, at minimum:
1. **COGS tie-out, no filter:** report `totals.cogsPaise` equals the COGS account's
   Σdebit − Σcredit over ALL `journal_lines` (`jl.journal_entry_id`, `jl.account = 'COGS'`). Exact.
2. **Revenue tie-out:** each row's `netSalesPaise` equals `salesByItem` for the same filter, per item.
3. **Hand figures:** for the two-layer item, assert the COGS figure worked by hand in a comment
   (e.g. 3 @ 50.00 + 2 @ 60.00 = 270.00) — write the arithmetic in the test.
4. Cancelled invoice: contributes 0 revenue and 0 COGS.
5. Credit note with goods back reduces COGS by the returned layers' cost; cancelling it restores it.
6. **R7.2 guard:** a cancelled credit note's `SALE` row (source = the NOTE) is counted, not
   silently dropped — assert the item's COGS after cancel equals COGS before the note existed.
7. Non-stock item: revenue, `cogsPaise: 0`.
8. Fair filter: each fair's figures; unknown `fairId` THROWS (not an empty report).
9. Date filter: a sale dated outside the range is excluded from BOTH revenue and COGS.
10. Totals equal the sum of rows; `notes` has both sentences.
11. Mutation-sensitivity: make sure test 1 would FAIL if `cancelCreditNote`'s `SALE` rows were
    dropped (the fixture's cancelled note must carry real cost). Say in your report that you
    checked this by temporarily breaking your own code and restoring it.

`new AccountingRepository()` with no argument (in-memory). Never a file database; never read or
set `BOOK_BUDDHA_DATABASE`. Close every repository in a `finally` (or afterEach).

## Hard constraints

- **Do not edit any existing file.** Not `repository.ts`, not `server.ts`, not any test. Two new
  files only. If an existing test turns red, STOP and report it.
- No routes in this slice (they come next, for all six reports together). No migration, no
  dependency. Do not touch git. Leave untracked files you did not create alone.
- Strict TS: `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `erasableSyntaxOnly` (no
  enums, no parameter properties). Omit optional properties rather than set them `undefined`.
  Local imports end in `.js`. Dates are `YYYY-MM-DD` string comparisons; never `new Date()` for a
  business date. Integer paise only.

## Gates — from `C:\Users\Admin\Desktop\Book Buddha\book-buddha`, in PowerShell

```
.\node_modules\.bin\tsc.cmd; $LASTEXITCODE
.\node_modules\.bin\vitest.cmd run --root .
```
tsc FIRST (vitest does not type-check). Never pipe into tail/head. **Known flake:** the
`allocateProportionally … fuzz` test in `src/accounting/engine.test.ts` can time out under load —
re-run that file alone; if it passes alone it is the flake. Another agent may be adding test files
concurrently, so the total count can move for reasons that are not yours — report the counts and
which files are yours.

## Report back
- tsc exit code; the vitest `Test Files …` and `Tests …` lines verbatim.
- Files created, one line each.
- How you dated credit-note stock rows and why that matches `salesReturnReport`.
- The mutation check from test 11.
- Anything in the definitions that was wrong, impossible or ambiguous against the real code — say
  it plainly rather than working around it quietly.
