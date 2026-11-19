# HOT — Book Buddha

## STANDING ORDER (his words, mark every session — S12-3)
"Pause on acceptance tests, do the tests in the above prompt, then will continue with development
work and build everything till R12. Then till R12 will run all the tests for pending ones and the
newly build and check the backend end to end." So: **acceptance is PARKED**, build to **R12**, then
run everything together. **R14 deferred (S12-4).** Order: reports → attachments → stock correction
→ bill discount → import/export → backup → banking.

## Last session
2026-11-18 (session 11) — nineteen questions answered, backlog CLEARED (S11-1..S11-22); four items
built and pushed (**v20**, **v21**). Session 12: R9 HTTP seam committed (`d6da71d`); the engine fuzz
test given a 30s timeout (CPU contention, not a wrong figure — same cause and fix as `49c31f9`).

## State now
Branch `autonomous/book-buddha-finish`. Gates **all green, re-run 19 Nov: tsc 0 · 594 tests,
48 files · vite build clean.** Migration **v21**. Verify, never quote: `git log --oneline
@{u}..HEAD | wc -l`. **PUSHING: never in the foreground, and ASK HIM EVERY TIME (S11-17).**
**ACCEPTANCE (parked): hand-verified R3, R4c · on trust 7d, 8c · outstanding R1, R2, R4, R4b,
R5, R7, R8.** Under **S12-1** acceptance = the accounting logic is satisfied.

## NEXT STEP
**SIX §13 reports are absent, not five (S12-2 undercounted):** customer statement · customer
balance detail · collections · stock ageing · **inventory valuation DETAIL** · item profitability.
Definitions and tie-outs: `context/REPORT_DEFINITIONS_S12.md`. Follow `reports-sales.ts`: `db`
first, `reportConditions` + `assertReportFairExists`, read the POSTED JOURNAL. Then R9 routes 2–5 →
stock correction (v22 drafted, `src/database/stock-adjustment-schema.ts`, **unregistered**) → bill
discount (**needs his odd-paise ruling**) → R10 → R11 → R12. Brief: `context/RESUME_PROMPT.md`.

## Uncommitted / blocked
Uncommitted: `src/accounting/engine.test.ts` (timeout fix), `context/decisions.md` (S12-1..4),
`context/HOT.md`, untracked `stock-adjustment-schema.ts` and `context/AGENT_BRIEF_R9_ROUTES.md`
(**dead — the agent was cancelled; offered to delete, no answer**). **Waiting on him:** (1) the
**odd-paise ruling** — Rs 150 off 7 units will not divide into whole paise; S11-22 is the precedent,
show the remainder; (2) his prompt asks for UI, `RESUME_PROMPT.md` says he builds the frontend —
resolved as **backend-first through R12**, items 9–10 to be put to him there; (3) purchase-return
back-dating warning? (4) base64 for attachments (S11-19, defaulted never answered); (5) §D6 TWO
Uncategorized accounts (S11-8) before R12. **Still NO real database (S11-16)** — never touch his file.

## Corrections that must not be re-inherited
**`getTrialBalance` returns NET balances** (his find, S10-5). **THREE gates, not four.**
`applyPurchasingExpensesSchema` is **v4, not v18** — any NEW `stock_movements` rebuild must carry
`fair_id` (v22 asserts the column set). `salesByItem` deliberately does **not** spread header
discount/charges/GST across lines; item profitability inherits that limit.

## Workflow
Gates from `book-buddha/`: `tsc.cmd` **first** (vitest does NOT type-check) · `vitest.cmd run
--root .` · `vite.cmd build` — **never through a pipe. READ the count, never assume it.** **An
`ACCEPTANCE` test pins a figure HE signed — if one turns red, STOP and report. Never edit one.**
Stop servers BY PORT. Throwaway DB in the scratchpad. Sonnet writes code, I review and run gates
myself; Haiku for search. Advisor = Opus 5.5.
