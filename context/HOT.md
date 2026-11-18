# HOT — Book Buddha

## Last session
2026-11-18 (session 11) — **he answered all nineteen questions, so the backlog is CLEARED**
(S11-1..S11-22 in `decisions.md`). Four items followed; **all four done, tested, committed, pushed**:
unknown-fair guard · ledger date (needed nothing) · credit-note own date (**v20**) · cash-view
**ROUNDING** line (**v21**). Two rulings: an undated credit note posts at **finalise** (S11-20);
back-dating a reported month is **allowed but warned** (S11-21).

## State now
Branch `autonomous/book-buddha-finish`. Gates: **590 tests, 47 files, tsc clean (unpiped first),
vite build clean.** Migration **v21**. Verify, never quote: `git log --oneline @{u}..HEAD | wc -l`.
**PUSHING WORKS, mystery solved (S11-17) — his credential can lapse, so NEVER push in the
foreground, and ASK HIM EVERY TIME.** **ACCEPTANCE: hand-verified R3, R4c · on trust 7d, 8c
(S11-13) · outstanding R1, R2, R4, R4b, R5, R7, R8** — seven, per **S11-14**: R4 first, R8 last.

## NEXT STEP
**Stock-reversal slice (S10-4)**, then **discount-into-inventory-cost (S11-1 + S11-2)** — the
largest work his answers created, and **it BLOCKS R8 acceptance** (`bill-discount.test.ts` figures
change). Unsolved hard part, in S11-1: a stock layer stores an integer `unit_cost_paise`, so a
discount will not divide into equal whole paise and the remainder must be placed deliberately.
**S11-22 is the precedent — show the odd paise, never absorb it silently.** Then **R9 attachments:
only HTTP ROUTES are missing** (`src/attachments/` is built, 24 tests, migration registered);
base64 per S11-19, Fastify `bodyLimit` (1 MB) **must be raised**. Then R10 → R11 backup → R12
banking → R13 cash flow (+ the S11-3 warning) → R14. Brief + file map: `context/RESUME_PROMPT.md`.

## Uncommitted / blocked
**Nothing uncommitted. Nothing blocked.** **Waiting on him when a slice reaches it — do not batch:**
(1) a purchase return can still be back-dated with **no warning**, unlike a credit note after
S11-21 — same guard, or a reason? (2) **item 9 / S11-19 was defaulted, never answered** — confirm
base64 at R9. (3) **§D6 of `Feature Design - Bank Categorization, Bill OCR & Archive (V1).md` →
TWO Uncategorized accounts** (S11-8) before R12. **Still NO real database (S11-16, verified)** —
the backfill has never run on real books; never touch or copy his live file.

## Corrections that must not be re-inherited
**`getTrialBalance` returns NET balances**, not gross — a gross trial balance still balances, which
is why `debits === credits` never caught it (his own find, S10-5). **S7-2 never blocked purchase
returns.** **THREE gates, not four** — no `web` tsc; the vite build covers it. **Item 15 needed no
work** (R7b). **Check before calling something missing:** I told an agent the rounding tolerance
guard was unbuilt; it was already there and the agent was right to push back.

## Workflow
Gates from `book-buddha/`: `tsc.cmd` **first** (vitest does NOT type-check) · `vitest.cmd run
--root .` · `vite.cmd build` — **never through a pipe. READ the count, never assume it.** **An
`ACCEPTANCE` test pins a figure HE signed — if one turns red, STOP and report. Never edit one to
make a build pass.** Stop servers BY PORT. Throwaway DB in the scratchpad. **No UI.** Sonnet writes
code, I review and run gates myself; Haiku for search. Advisor = Opus 5.5.
