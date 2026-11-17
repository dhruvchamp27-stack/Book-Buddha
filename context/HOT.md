# HOT — Book Buddha

## Last session
2026-11-17 (session 7), branch `autonomous/book-buddha-finish`. **R4c IS BUILT AND ON SCREEN
(figures unconfirmed).** 4 commits, last `732e903`. **EVERY commit here is unpushed — count with
`git log --oneline @{u}..HEAD | wc -l`; only the owner's terminal can push.** Gates:
**458/458 vitest, 37 files, tsc clean (unpiped), vite build clean.** Rulings **S7-1, S7-2**.

## What session 7 did
1. **`b932d26` — R4c.** Opening stock posts `Dr INVENTORY / Cr OPENING_BALANCE_EQUITY`, an
   ADJUSTMENT `Cr STOCK_ADJUSTMENT` (S5-3). **NO MIGRATION — v17 IS STILL FREE:** `source_type` has
   no CHECK, so `"STOCK_MOVEMENT"` is a TS widening and a movement is posted exactly when an entry
   carries its id (also the backfill's idempotency). A bare PURCHASE posts nothing (its bill does)
   and is COUNTED as uncovered. `businessId` derived only when the company has ONE business;
   `occurredOn` dates the ENTRY only — the FIFO layer stays append-only, so posted COGS is never
   re-measured; movement + entry are ONE transaction. `planStockJournalBackfill` /
   `backfillStockJournals`: **dry run by default**, idempotent, refuses locked years and LISTS them.
2. **`c844e90` + `8556daf` — `book-buddha/R4C-WORKINGS.md`** (the sign-off document) plus three
   self-review fixes: the route had never executed in a test; the doc wrongly called scenario 2 his
   real data; S7-2 found. **Five mutations proved the new tests can fail.**
3. **`732e903` — R4c ON SCREEN** (`web/src/App.tsx`): Add stock picks the reason and says what it
   will post before you press; a new card shows the inventory-vs-stock tie-out and runs the backfill
   (check-only first; posting disabled until then). Reports load on arrival, money Indian-grouped.

## NEXT STEP — in this order
1. **R5-rem** — presentation only: split the derived `RETAINED_EARNINGS` into brought-forward and
   profit-for-the-year at the FY boundary, with an invariant test that they still sum (**S5-4**).
   Needs a `businessId` to pick the FY; consolidated has none.
2. **R7b** — wire `reports-sales.ts` + `reports-transactions.ts` (unreachable), fix the four thin
   reports in **S5-7**; new ones read `getOpenCustomerItems`/`getOpenSupplierItems`. **Settle
   `GeneralLedgerRow.date` here:** it shows POSTING time, so a back-dated opening entry appears
   under today's date — visible in the R4c screenshots.
3. **R8** purchase returns, supplier refunds, payment cancellation, bill discount · then R10
   import/export · R11 backup/restore · R12 banking · R13 cash flow · R14 archive.

## Owner action / carried
**R4C-WORKINGS.md HAS FOUR DECISIONS FOR HIM** (business derivation · dating the entry not the
layer · a recount on the CASH P&L · shrinkage, still unenterable — with **S7-2: a movement cannot
be reversed or deleted**, which now misstates equity too). **ACCEPTANCE R4/R4b/R4c await him**;
7d, 8c, R1, R2, R5 unconfirmed too — only R3 is signed off. **The backfill has never touched his
real database and must not without his say-so.** Carried: **IF HIS DB PREDATES v16 there is NO
recovery code** — sign in, `POST /auth/recovery-code` (no UI form). 15 test files dirty with
**CRLF-only churn** (offer `git checkout --`, explicit paths). **Nothing type-checks `web/`**
(S6-4). Open: `recordPayment` hardcodes CASH · `finalizeCreditNote` hardcodes `SALES` (S5-8).

## Workflow — full brief in `context/RESUME_PROMPT.md`
Max **2 agents**, never both in `repository.ts`; orchestrator owns `migrations.ts` (**v17 free**)
and alone runs the full suite (**S5-5**). Gates — `book-buddha/node_modules/.bin/`:
`vitest.cmd run --root .` · `tsc.cmd` · `vite.cmd build`. **Never read a gate's `$?` through a pipe.**
Live proof: throwaway DB in the scratchpad, `node.bat dist/api/main.js` + `vite.cmd`, drive the
browser — **NEVER his real DB**. **Advisor = Fable. PUSH: ASK, NEVER RETRY.**
