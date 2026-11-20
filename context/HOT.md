# HOT — Book Buddha

## STANDING ORDER (his words, mark every session — S12-3)
"Pause on acceptance tests, do the tests in the above prompt, then will continue with development
work and build everything till R12. Then till R12 will run all the tests for pending ones and the
newly build and check the backend end to end." So: **acceptance is PARKED**, build to **R12**, then
run everything together. **R14 deferred (S12-4).** Remaining order: **R10 ✅ → bill discount
(blocked) → R12 banking → the all-together test run → R13 cash flow (S14-2).** R11 was built before R10 (S13-4).

## Last session
Session 14 (20 Nov) — setup (orchestrator/workers, Progress.md, closed context folder; S14-1) and
**R10 import/export built**: `9037872` `098ce15` `d2fa92b` `aecc96a` (rulings S14-3). **All pushed.**

## State now
Branch `autonomous/book-buddha-finish`. Gates **all green, measured 20 Nov on the final tree:
tsc 0 · 856 tests, 64 files · vite 1.23s.** Migration **v22**. **Count unpushed commits, never
quote a figure from here:** `git log --oneline @{u}..HEAD | wc -l`. **PUSH in the background and
ASK HIM EVERY TIME (S11-17).** **ACCEPTANCE (parked): hand-verified R3, R4c · on trust 7d, 8c ·
outstanding R1, R2, R4, R4b, R5, R7, R8.** All six §13 reports DONE and reachable over HTTP.

## NEXT STEP — resume here, nothing is half-built
**R12 banking** (accounts, transfers, reconciliation; REMAINING_BUILD_PLAN S12). Amend FD §D6 to
two Uncategorized accounts first (S11-8). Definitions → brief in `Progress.md` → Sonnet builds.
Bill discount stays blocked on item 1. R10 leftovers (xlsx/PDF = install, expenses) in Progress.md.

## Waiting on him (ask when a slice touches it, not as a batch)
1. **ODD-PAISE RULING — blocks bill discount.** Rs 150 off 7 units ≠ whole paise; S11-22 precedent:
   show the remainder. Plus: how a bill tells a TRADE from a SETTLEMENT discount.
2. **Attachment upload/delete writes NO audit log** (S13-2) — audit log is a fixed part. His call.
3. Purchase-return back-dating has no warning, unlike credit notes (S11-21).
4. **Another Claude session commits in this folder** (S13-3) — is it his; keep it?
5. Smaller: base64 vs multipart (S11-19) · `OPENING_DATE` label in Collections · backend-only
   through R12 (confirm at R12) · `AGENT_BRIEF_R9_ROUTES.md` is dead litter — delete? · 3 R10
   choices to confirm (Progress.md → Open to-dos).
**Still NO real database (S11-16)** — never touch his file.

## Corrections that must not be re-inherited
**`getTrialBalance` returns NET balances** (S10-5). **THREE gates, not four.** `salesByItem` does
**not** spread header discount/GST. **A `SALE` stock row is NOT always an invoice** (S12-6).
**A cancelled payment has NO statement row** (S13-1). **There is NO restore route** — by design.

## Workflow
Gates from `book-buddha/`: `tsc.cmd` **first** · `vitest.cmd run --root .` · `vite.cmd build` —
**never through a pipe; READ the count.** **An `ACCEPTANCE` test going red = STOP.** Two Sonnet
builders in parallel on DISJOINT files, briefs written into `Progress.md` → Active briefs first; Haiku for
search; CBM for navigation; I review, mutation-prove, gate and commit one slice per commit.
