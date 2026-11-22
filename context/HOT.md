# HOT — Book Buddha

## STANDING ORDER (his words — S17-1, replaces S16-11)
"Build this pending work and then review and then write the tests." Order: **BUILD → REVIEW → TESTS.**
Aim: full backend done, few or no pending tests. R14 archive is in scope (R13 is built, S17-3).

## Last session
Session 17 (22 Nov). **Built:** S16 slice (A, B), R13 cash flow, Q17/Q18, slow tests, bill discount on
stock only + settlement discount, app numbering INV-001/25-26, S17-10 refusal, quotation-edit guard,
F pre-opening history. Migrations v30–v33. Rulings S17-1..13. Code commit 451f9ab, pushed.

## State now
Branch `autonomous/book-buddha-finish`. Gates (22 Nov, after the last change): tsc 0 · **1,134 tests,
97 files** · vite 1.23s. Migration **v33**. Count unpushed commits fresh with
`git log --oneline @{u}..HEAD`. PUSH in the background, and ASK HIM EVERY TIME (S11-17).
The October ACCEPTANCE test (`src/e2e/october.e2e.test.ts`) must stay green.

## NEXT STEP — resume here
**Open `book-buddha/BUILD_PLAN_S18.md`**: the whole remaining plan, with ready builder briefs.
1. Run the §0 gates.
2. Dispatch **G**: settable "today" + back-dating confirm on every dated entry (Q12, S17-13). This is
   the serial `repository.ts` builder.
3. In parallel: **P1** old screen number boxes · **P2** `/imports/last` company filter · **I-1** GST
   per line + round-off mini-spec · **Q16-1** .xlsx/PDF package research · **R14-1** archive mini-spec.
4. Take I-1, the Q16 installs (name + size) and R14-1 to Dhruv. Then build I-2 → Q16-2 → R14-2,
   then REV (3 reviewers) → FIX → TST (with workings for his hand check).

## Waiting on him
1. **ON HOLD (he is checking):** a bill discount EQUAL to the stock value on an ALL-stock bill saves but
   cannot finalize. Options are in decisions.md (S17-10 edge); refusing it is recommended.
2. At their step: the I-1 mini-spec · Q16 packages + sizes · R14 mini-spec · REV rulings · TST workings.
**Still NO real database (S11-16)** — never touch his file.

## Corrections that must not be re-inherited
**`getTrialBalance` returns NET balances** (S10-5). **THREE gates, not four.** `salesByItem` does
**not** spread header discount/GST. **A `SALE` stock row is NOT always an invoice** (S12-6). **A
cancelled payment has NO statement row** (S13-1). **There is NO restore route** — by design. **S8-1 is
REPLACED by S16-7(3).** **Fair invoices go to the fair's host customer.** **The app numbers every
document it creates (S17-4):** routes refuse a `number`, imports keep their own, and conversion takes
NO number. **History items (F) post nothing.**

## Workflow
Gates from `book-buddha/`: `tsc.cmd` **first** · `vitest.cmd run --root .` · `vite.cmd build`. Never run
them through a pipe; READ the count. **An `ACCEPTANCE` test going red = STOP.** `repository.ts`
builders run ONE AT A TIME; others in parallel on DISJOINT files. Only the orchestrator registers
migrations. Live briefs go in Progress.md, one or two lines each.
