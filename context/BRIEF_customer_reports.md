# Build brief — `reports-customers.ts`: three customer reports

You are building ONE new module and ONE new test file in an existing, strict TypeScript
double-entry accounting codebase. Everything you need is already written down; your job is to
follow it exactly, not to redesign it.

Repo root: `C:\Users\Admin\Desktop\Book Buddha`
All commands run from: `C:\Users\Admin\Desktop\Book Buddha\book-buddha`

## READ THESE FIRST, in this order, before writing any code

1. `context/REPORT_DEFINITIONS_S12.md` — **the whole file.** It is the specification. In
   particular: the house rules at the top, section 0a and "THE AS-AT TRAP", sections **1, 2, 3**,
   and the **RESOLUTIONS** section near the end. **The RESOLUTIONS override anything earlier in
   that file that disagrees with them.**
2. `book-buddha/src/database/reports-sales.ts` — the house model for a report module. Copy its
   shape: file header comment explaining what the report means and what it deliberately does not
   do, exported `interface`s for the report shapes, exported functions taking the
   `better-sqlite3` handle FIRST.
3. `book-buddha/src/database/report-filters-sql.ts` — `assertReportFairExists`, `reportConditions`.
4. `book-buddha/src/database/open-items.ts` — the shared "what a customer owes" query. **This is
   the only definition of a customer receivable. Do not write a second one.**
5. `book-buddha/src/database/repository.ts` → `getSupplierStatement` (search for it). The customer
   statement mirrors its SHAPE. It does not mirror its content — read definitions section 1.
6. `book-buddha/src/database/reports-stock.test.ts` — the house model for a report test file.

## What to build

### File A — `book-buddha/src/database/open-items.ts` (one small addition)

Add and export ONE helper, as RESOLUTION R1 specifies:

```ts
export function existingOn<T extends { readonly date: string }>(
  rows: readonly T[],
  asAtDate?: string,
): readonly T[]
```

- With `asAtDate` undefined, returns `rows` unchanged.
- Otherwise drops rows where `row.date.slice(0, 10) > asAtDate`.
- Doc comment must state the established as-at meaning (see "THE AS-AT TRAP"): it excludes
  documents that did not yet exist on that date and does NOT roll settlements back.
- Point out in the comment that this is the same comparison `buildAgeingReport` and
  `getReceivables` make in `repository.ts`, which is why it is shared.

Change nothing else in that file.

### File B — `book-buddha/src/database/reports-customers.ts` (new)

Three reports. Each takes the db handle first and a filter object second.

**1. `buildCustomerStatement(db, filter)`** — definitions section 1 plus RESOLUTIONS R2 and R3.
   - `filter`: `{ customerId: string; businessId?: string; fairId?: string }` — `customerId` is
     REQUIRED (a statement is for one customer).
   - Documents come from `openCustomerItemRows(db, { ...filter, includeSettled: true })`.
     **Never a second "what is owed" query.**
   - Settlement rows are read PER DOCUMENT from that document's own settlements (R2) — not from a
     separate customer-wide sweep. Tables: `payments` (`schema.ts`),
     `credit_note_applications` (`customer-credits-schema.ts`),
     `opening_balance_receipts` (`opening-sub-ledger-schema.ts`). Read the actual columns; do not
     guess names.
   - Credit-note rows come from the POSTED journal (`je.id LIKE 'je-credit-note-%'`, lines on the
     invoice's own payment account) — never recomputed from note lines. R3 explains why the
     payment-account filter is what keeps `je-credit-note-inventory-%` out; obey it.
   - A cancelled payment is excluded (`cancelled_at IS NULL`). A cancelled credit note gets NO
     special case — see the definitions, and do not add one.
   - A refund (`je-refund-%`) is not a statement row.
   - Ordering `(date, order)`, documents `order: 0` before settlements `order: 1`.
   - Carries `unappliedCreditPaise` separately, NEVER netted into the closing balance.
   - Under a `fairId`, also carries `excludedOpeningBalancesPaise` from
     `excludedOpeningBalances(db, filter)`.

**2. `buildCustomerBalanceDetail(db, filter)`** — definitions section 2.
   - `filter`: `{ businessId?: string; customerId?: string; fairId?: string; asAtDate?: string }`.
   - Groups the open items by customer, each group with its own subtotal, plus a report total.
   - `asAtDate` is applied through `existingOn` from File A. Nothing else.
   - Under a `fairId`, carries `excludedOpeningBalancesPaise`.

**3. `buildCollectionsReport(db, filter)`** — definitions section 3.
   - Same filter as report 2.
   - `dueOn` = `dueDate` when set, else the document's own date, with
     `dueDateBasis: "DUE_DATE" | "INVOICE_DATE"` on every row saying which was used.
   - Overdue = `dueOn < asAtDate`; `asAtDate` defaults to `istDateOf()` from
     `./ist-date.js` (**not** `new Date().toISOString()` — the app's business date is IST).
   - `daysOverdue` = whole days from `dueOn` to the as-at date.
   - Rows sorted oldest-overdue first.
   - Contact details from the `customers` table. **Read the table and use only columns that
     exist.** Invent no column.

**Every one of the three calls `assertReportFairExists(db, filter.fairId)` first when a `fairId`
was given** (RESOLUTION R5).

Figures are integer paise throughout. No floats, no rounding. Margin-style percentages do not
appear in these three.

### File C — `book-buddha/src/database/reports-customers.test.ts` (new)

The tests that make these reports true. At minimum:

1. **The statement hand example from definitions section 1, exactly as tabulated** — opening
   balance, invoice, credit note, receipt, a CANCELLED receipt, an applied credit, and a CANCELLED
   credit note. Assert each running balance and the closing **Rs 15,000**, and assert
   `getReceivables` for that customer also says Rs 15,000. **If the code and the table disagree,
   the code is wrong — fix the code, never the expected figure.**
2. **Per-document settlement tie-out** (R2): for every document on the statement, the settlement
   rows under it sum to that document's `settledPaise`. Not a total-only check.
3. A cancelled credit note shows as TWO rows netting to nil (not filtered out).
4. A refund does not appear as a statement row and does not move the closing balance.
5. `unappliedCreditPaise` is reported beside the closing balance and not netted into it.
6. **Balance Detail tie-out:** report total equals `getReceivables` for the same filter.
7. **Collections is a strict subset of Balance Detail** for the same as-at, with identical
   `outstandingPaise` per row.
8. `dueDateBasis` is `"INVOICE_DATE"` for an invoice with no due date, `"DUE_DATE"` otherwise, and
   the row says so.
9. `existingOn` / as-at: a document dated after the as-at is excluded from both reports; a
   settlement made after the as-at is NOT rolled back (that is the established meaning — assert
   it, so nobody "fixes" it later).
10. A `fairId` that does not exist THROWS from all three (not an empty report).
11. Under a `fairId`, `excludedOpeningBalancesPaise` is reported.

Use `new AccountingRepository()` with no argument — an isolated in-memory database. **Never open a
file database, never touch any real data file, never set or read `BOOK_BUDDHA_DATABASE`.**
Close every repository in a `finally`.

## Hard constraints — breaking any of these fails the task

- **Do not edit any existing test file.** Not one line. If an existing test turns red, STOP and
  report it; that is a real regression and it is mine to look at.
- **Do not edit `repository.ts`**, except that you may ADD a thin delegating wrapper method if and
  only if one is genuinely needed — and say so in your report if you do. Prefer not to.
- Do not edit `spec/` or `plan/`. Do not touch git — no `add`, no `commit`, no branch change.
- No new dependency. No migration (these are read-only reports over existing tables).
- TypeScript is strict with `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` and
  `erasableSyntaxOnly`: **no parameter properties, no enums**, index access yields `T | undefined`
  so handle it, and an optional property must be omitted rather than set to `undefined` (see how
  the existing tests spread `...(x === undefined ? {} : { x })`).
- Local imports end in `.js` (NodeNext).
- Date comparison is string comparison on `YYYY-MM-DD`. Never `new Date()` for a business date.

## The gates — run these yourself, from `book-buddha/`, and report the REAL numbers

```
./node_modules/.bin/tsc.cmd
./node_modules/.bin/vitest.cmd run --root .
```

- `tsc` FIRST and every time — **vitest does not type-check.**
- **Never pipe the vitest output.** Run it bare and READ the counts.
- The baseline you must not break is **619 tests passing in 51 files, tsc exit 0.** Your new tests
  add to that; nothing may be subtracted.
- Iterate until both are clean. Do not report done with a red gate.

## Report back

- The exact `tsc` exit code and the exact vitest line (`N passed`, `M files`).
- Every file you created or changed, with a one-line why.
- The hand example: did the code produce Rs 15,000 on the first run, or did you have to fix
  something? If you fixed something, what was actually wrong.
- Anything in the definitions that turned out to be wrong, impossible, or ambiguous when you met
  the real schema — say so plainly rather than quietly working around it. That is the most
  valuable thing in your report.
- Any column you wanted and did not find.
