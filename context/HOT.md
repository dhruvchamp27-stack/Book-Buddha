# HOT — Book Buddha

## STANDING ORDER (his words, mark every session — S12-3)
"Pause on acceptance tests, do the tests in the above prompt, then will continue with development
work and build everything till R12. Then till R12 will run all the tests for pending ones and the
newly build and check the backend end to end." So: **acceptance is PARKED**, build to **R12**, then
run everything together. **R14 deferred (S12-4).** Order: reports → attachments → stock correction
→ bill discount → import/export → backup → banking.

## Last session
Session 12 — the two stock reports (`528860a`); an **IST dating bug found and fixed** (`fadb6c8`:
an invoice entered 00:00–05:29 IST was dated and POSTED a day early, across 31 March into the
closed year); open-items moved to its own module with a fair filter (`63bb874`); definitions
corrected twice (`59d496a`, then R1–R7).

## State now
Branch `autonomous/book-buddha-finish`, **nothing pushed this session**. Gates **all green,
measured 19 Nov: tsc 0 · 619 tests, 51 files · vite 1.24s.** Migration **v21**. **Count the
unpushed commits, never quote a figure from this file** (it goes stale as it is written):
`git log --oneline @{u}..HEAD | wc -l`. **PUSHING: never in the foreground, and ASK HIM EVERY TIME
(S11-17).** **ACCEPTANCE (parked): hand-verified R3, R4c · on trust 7d, 8c · outstanding R1, R2,
R4, R4b, R5, R7, R8.** Under **S12-1** acceptance = the accounting logic is satisfied.

## NEXT STEP — resume here, nothing is half-built
**Build `src/database/reports-customers.ts`** (statement · balance detail · collections), then
report 6 item profitability. Brief is complete: `context/REPORT_DEFINITIONS_S12.md` — read its
**RESOLUTIONS R1–R7**, which override everything earlier in it; agent brief
`context/BRIEF_customer_reports.md`. **0a is DONE** (`63bb874`, `open-items.ts`). Then R9 routes
2–5 → stock correction (v22 draft `stock-adjustment-schema.ts`, **unregistered**) → bill discount
(**needs his odd-paise ruling**) → R10 → R11 → R12.

## Uncommitted / blocked
Untracked and unregistered: `stock-adjustment-schema.ts` (v22 draft) · `AGENT_BRIEF_R9_ROUTES.md`
(**dead, agent cancelled; offered to delete, no answer**). **Waiting on him:** (1) the **odd-paise
ruling** — Rs 150 off 7 units will not divide into whole paise; S11-22 is the precedent, show the
remainder; (2) his prompt asks for UI, `RESUME_PROMPT.md` says he builds the frontend — resolved
**backend-first through R12**, items 9–10 to him there; (3) purchase-return back-dating warning?
(4) base64 for attachments (S11-19, defaulted never answered); (5) §D6 TWO Uncategorized accounts
(S11-8) before R12. **Still NO real database (S11-16)** — never touch his file.

## Corrections that must not be re-inherited
**`getTrialBalance` returns NET balances** (S10-5). **THREE gates, not four.**
`applyPurchasingExpensesSchema` is **v4, not v18**. `salesByItem` deliberately does **not** spread
header discount/GST across lines. **A `SALE` stock row is NOT always an invoice** (S12-6).

## Workflow
Gates from `book-buddha/`: `tsc.cmd` **first** (vitest does NOT type-check) · `vitest.cmd run
--root .` · `vite.cmd build` — **never through a pipe. READ the count, never assume it.** **An
`ACCEPTANCE` test pins a figure HE signed — if one turns red, STOP and report. Never edit one.**
Stop servers BY PORT. Throwaway DB in scratchpad. Sonnet codes, I review and gate; Haiku searches.
