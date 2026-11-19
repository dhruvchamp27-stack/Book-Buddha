# Build brief — HTTP routes for the four new §13 reports

Repo root `C:\Users\Admin\Desktop\Book Buddha`; commands run from `book-buddha/`.
Reports 4 and 5 (stock ageing, valuation detail) are ALREADY routed (`server.ts` ≈ 1481-1484,
`repository.ts` ≈ 1233-1243). Copy that exact pattern for the remaining four.

**Another agent is working in parallel on `src/api/attachment-routes.ts` and
`src/api/attachments-api.test.ts`. Do not touch those two files.**

## Read first
1. `src/database/reports-customers.ts` — `buildCustomerStatement`, `buildCustomerBalanceDetail`,
   `buildCollectionsReport` and their filter types.
2. `src/database/reports-profitability.ts` — `itemProfitability` and its filter type.
3. `src/database/repository.ts` ≈ 1225-1245 (`getStockAgeing` wrapper pattern) and
   `getReceivables` (≈ 2690).
4. `src/api/server.ts` ≈ 1476-1490 (route pattern: `parseBody(<schema>, request.query)`), and find
   where `stockReportQuery`, `creditNoteReportQuery`, `customerOpenItemsQuery` are defined — copy
   their style for new query schemas (dates validated the same way the existing ones are).
5. `src/database/reports-wiring.test.ts` — every report route is called OVER HTTP here.
6. `src/database/report-unknown-fair.test.ts` — the S11-9 sweep: a table of entry points, each
   proved to throw on an unknown fair, return data on a real one, and be consolidated without one.
7. `context/REPORT_DEFINITIONS_S12.md` — RESOLUTIONS R1–R7 for meaning, if in doubt.

## What to build
1. **Repository wrappers** in `repository.ts`, beside `getInventoryValuationDetail`, each a one-line
   delegate with a short doc comment: `getCustomerStatement`, `getCustomerBalanceDetail`,
   `getCollections`, `getItemProfitability`. Nothing else in them.
2. **`getReceivables` gains an optional `fairId`**, passed straight through to
   `openCustomerItemRows` (which already supports it). The definitions (section 0a) said this would
   happen "for free by passing through" and it never did — so Balance Detail under a fair could not
   be tied to `getReceivables`. With no `fairId` the behaviour must be byte-for-byte unchanged (all
   existing receivables tests stay green, unedited). Add `fairId` to `customerOpenItemsQuery` too,
   and make `/reports/receivables` call `assertReportFairExists` when a fair is given (R5) — check
   whether it already goes through a guarded choke point first; do not double-guard.
3. **Four GET routes** in `server.ts`, next to `/reports/stock-ageing`, with a one-line comment:
   - `/reports/customer-statement` — `customerId` REQUIRED; `businessId?`, `fairId?`
   - `/reports/customer-balance-detail` — `businessId?`, `customerId?`, `fairId?`, `asAtDate?`
   - `/reports/collections` — same as balance detail
   - `/reports/item-profitability` — `businessId?`, `fairId?`, `fromDate?`, `toDate?`, `itemId?`
   Unknown query keys must be refused the way the existing schemas refuse them (check).
   A missing customer on the statement must come back 400 (or 404 if the house pattern is 404 for
   a missing entity — check how other routes answer and follow it), never 500.
4. **Tests, over HTTP**, appended to `reports-wiring.test.ts` (add; do not edit or delete any
   existing test): each of the four routes returns 200 with real data; `customer-statement`
   without `customerId` → 400; an unknown query key → 400; `/reports/receivables?fairId=<fair>`
   total equals `/reports/customer-balance-detail?fairId=<fair>` total; `collections` rows are a
   subset of balance-detail rows; `item-profitability` totals equal the sum of rows.
   Use `buildApi(repository, { __unsafeDisableAuthForTests: true })` — TWO positional arguments
   (passing one object gives every route a 500). Use `app.inject`.
5. **Extend the unknown-fair sweep** in `report-unknown-fair.test.ts` by adding the four new
   entry points (and `getReceivables` with `fairId`) to its existing table — add entries only. The
   test file has an anchor/vacuity guard; keep it honest (if it counts entries, update the count
   with a comment saying why).
6. **`src/api/auth-enforcement.test.ts`**: new routes are protected automatically; run it and
   confirm it is still green. If it enumerates routes and needs the four added, add them.

## Hard constraints
- No existing test may be edited except by APPENDING entries/tests as stated in 4–6. If an existing
  test goes red, STOP and report — it is a real regression.
- **If any test whose name contains `ACCEPTANCE` goes red, STOP immediately and report.** Never
  edit one.
- No migration, no dependency, no git. Do not touch `stock-adjustment-schema.ts`,
  `IMPLEMENTATION_PROGRESS.md` or anything under `context/`.
- Strict TS (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `erasableSyntaxOnly`).
  Omit optional properties rather than passing `undefined` (spread pattern
  `...(x === undefined ? {} : { x })`). Local imports end `.js`.

## Gates (PowerShell, from `book-buddha/`)
`.\node_modules\.bin\tsc.cmd; $LASTEXITCODE` FIRST, then `.\node_modules\.bin\vitest.cmd run --root .`
Never pipe into tail/head. Known flake: `allocateProportionally … fuzz` in
`src/accounting/engine.test.ts` may time out under load — re-run that file alone. Another agent
adds tests concurrently, so totals move; report which files are yours.

## Report back
tsc exit code; vitest `Test Files` / `Tests` lines verbatim; every file changed with one line why;
how a missing customer is answered and why; whether `/reports/receivables` was already fair-guarded.
