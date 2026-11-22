# HOT — Book Buddha

## STANDING ORDER (his words — S17-1, replaces S16-11)
"Build this pending work and then review and then write the tests." Order: **BUILD → REVIEW → TESTS.**
Aim: full backend done, few or no pending tests. R14 archive is in scope (R13 is built, S17-3).

## Last session
Session 18 (22 Nov). **Built:** P1 (old screen number boxes), P2 (`/imports/last?companyId=`), **G**
(settable "today" + back-dating confirm on 30 doors), S18-1 refusal. Research I-1, Q16-1, R14-1 done.
Rulings S18-1, S18-2 (Inactive = hidden + frozen, two states only). Uncommitted at time of writing.

## State now
Branch `autonomous/book-buddha-finish`. Gates (22 Nov): tsc 0 · **1,262 tests, 98 files** · vite OK.
Migration **v33**. Count unpushed with `git log --oneline @{u}..HEAD`. PUSH in the background, and
ASK HIM EVERY TIME (S11-17). The October ACCEPTANCE test must stay green.

## NEXT STEP — resume here
**Everything waiting on him: `book-buddha/REVIEW_PACK_S18.md`.** Plan + briefs: `BUILD_PLAN_S18.md`.
1. On his answers: I-2 (GST per line, v34) → Q16 install + Q16-2 → R14-2 (now two states, `active`
   made real; v35) → F2 → REV (3 reviewers) → FIX → TST (workings for his hand check).
2. REV must look at: a bank-feed preview of a past-month line gives 400 without the confirm; test
   clock pins that come before their documents.

## Waiting on him
1. **Review pack:** B1 GST per line (I-Q1..10) · B2 Q16 installs · B3 R14 remaining questions · F2.
2. His `run-agent-pair.ps1` failed (PS 5.1 splits quoted prompts, worker lines 30/34); not fixed.
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
