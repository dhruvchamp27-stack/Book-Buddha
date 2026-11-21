# HOT — Book Buddha

## STANDING ORDER (his words, mark every session — S12-3)
"Pause on acceptance tests, do the tests in the above prompt, then will continue with development
work and build everything till R12. Then till R12 will run all the tests for pending ones and the
newly build and check the backend end to end." **DONE in S16:** R12 committed, the all-together run
done (October 2025 end-to-end ACCEPTANCE test, S16-5), and all 16 audit defects fixed. **R14 deferred (S12-4).**

## Last session
Session 16 (21 Nov) — R12 committed; October e2e ACCEPTANCE on his figures; 16 audit defects fixed;
S16-9 taken invoice numbers refused; S16-10 every parked acceptance slice closed, probe files deleted.

## State now
Branch `autonomous/book-buddha-finish`. Gates **all green, measured 21 Nov after the last change:
tsc 0 · 1,060 tests, 93 files · vite 1.05s.** Migration **v29**. **Count unpushed commits, never quote a
figure from here:** `git log --oneline @{u}..HEAD`. **PUSH in the background and ASK HIM EVERY TIME
(S11-17).** The October ACCEPTANCE test (`src/e2e/october.e2e.test.ts`) is the end-to-end regression
check — it must stay green. **ACCEPTANCE (per slice): hand-verified R3, R4c · on trust 7d, 8c ·
R1, R2, R4, R4b, R5, R7, R8 CLOSED (S16-10, on the S16 run + October e2e). No acceptance backlog.**

## NEXT STEP — resume here
**His order for session 17 (S16-11), aim = the FULL BACKEND done, few or no pending tests:**
1. **First, the "taken invoice number refused" change (S16-9)** — he will "complete" it. It is already
   committed (1196954) and pushed: ASK him what is left (his check? screens? more cases?).
2. **Then the tests:** tests written FIRST for the unbuilt work (S16 slice · bill discount Q1/Q2 · GST per
   line Q24 · R13 cash flow), plus the 2 slow tests (R10 2,000-invoice timing 6.5–7.4 s of 10 s; the
   engine.test.ts fuzz test that can time out under load).
3. **Then build those** till the tests pass. S16 slice = refund account choice · keep money account on
   edit · import repeated payments + last-import banner · pre-opening items as history · back-dating
   warning everywhere · attachment + restore audit · zero-cost write-down FY lock · stock adjustment (Q15).

## Waiting on him (ask when a slice touches it, not as a batch)
1. **Fair buyers as sub-customers (S16-9(3))** — does he want a sub-customer list/report? Ask when the
   fair/customer screens are planned, not before.
**Still NO real database (S11-16)** — never touch his file.

## Corrections that must not be re-inherited
**`getTrialBalance` returns NET balances** (S10-5). **THREE gates, not four.** `salesByItem` does
**not** spread header discount/GST. **A `SALE` stock row is NOT always an invoice** (S12-6).
**A cancelled payment has NO statement row** (S13-1). **There is NO restore route** — by design.
**S8-1 is REPLACED by S16-7(3):** a payment cancelled in a later month leaves the earlier month alone.
**Fair invoices must be to the fair's host customer** (repository.ts:4858). **A taken invoice number is
REFUSED, never renumbered** (S16-9) — conversion takes an optional `number`.

## Workflow
Gates from `book-buddha/`: `tsc.cmd` **first** · `vitest.cmd run --root .` · `vite.cmd build` —
**never through a pipe; READ the count.** **An `ACCEPTANCE` test going red = STOP.** Builders that edit
`repository.ts` run ONE AT A TIME; others in parallel on DISJOINT files; briefs in `Progress.md` first.
New confirmed defects go in `src/e2e/known-defects.test.ts` as `knownDefect(...)`; flip to `it("FIXED…")`.
