# HOT — Book Buddha

## Last session
2026-11-18 (session 10) — no build slice, by his instruction. **He found a real defect in the
trial balance and it is fixed** (S10-5): accounts printed **gross** instead of at their balance,
so R4c totalled Rs 17,750 a side instead of **Rs 15,250**. **R4c scenario 1 SIGNED OFF** (S10-6),
its four decisions settled (S10-1..S10-4, closing S7-2). The rest of the backlog went to him as
**nineteen numbered questions**, which he answers as his opening message next session.

## State now
Branch `autonomous/book-buddha-finish`, tip `fec2d2a`, **nothing unpushed** (verify, never quote:
`git log --oneline @{u}..HEAD | wc -l`). Gates: **528/528 vitest, 44 files, tsc clean (unpiped),
vite build clean. PUSHING WORKS from a tool shell (S8-5) — ASK HIM EVERY TIME.** Migration **v20**.

**TWO SLICES THROUGH ACCEPTANCE: R3 and R4c.** Nine await him — 7d, 8c, R1, R2, R4, R4b, R5, R7,
R8 (the old "nine awaiting, only R3" was miscounted — that list had ten names).

## NEXT STEP — take his answers to the nineteen questions
**His instruction, 2026-11-18:** *"Pause on this, I will answer all of them, as my starting prompt
in next session."* The nineteen questions, each with the default he can approve in a word, are the
top block of `context/RESUME_PROMPT.md`. **Do not re-ask them and do not re-derive the list.**
Write each answer into `decisions.md` as its own **S11-n**; say at once that items **1, 4, 5, 9**
can change what is built; then do the work, smallest first.
**Already ruled — never re-ask:** S10-1..S10-4 · S7-2 (closed by S10-4) · R4c scenario 1 (S10-6) ·
Subscriptions (deferred by S1-5) · the push count (nothing unpushed).
THEN build: **stock-reversal slice (S10-4) → R9 attachments** (`src/attachments/`, v7, no caller
outside its folder — routes + HTTP tests only; question 9 is its gate) → R10 → R11 backup →
R12 banking → R13 cash flow → R14 archive.

## Uncommitted / blocked
**Seven files are changed and NOT committed** — that is question 19, which he did not answer:
`book-buddha/src/database/repository.ts` + five of its tests + `book-buddha/R4C-WORKINGS.md`.
Message ready: *"Trial balance: report balances, not gross movements (owner-found)"*. `context/*`
is held back for its own commit. **`.gitignore` still deliberately uncommitted** (question 8).
**Check `git status` before assuming a clean start.**
**R4c backfill (scenario 2) is NOT signed off and has NEVER touched his real DB** — on 15 Nov no
real `.db` existed at all; ask before anything touches one.

## Corrections that must not be re-inherited
**S7-2 never blocked purchase returns** — `getStockLayers` already removes the purchase's own lot.
**There is no `web` tsc gate** (no `web/tsconfig.json`), so the vite build IS it. THREE gates.
**`getTrialBalance` now returns NET balances**, not `SUM(debit)`/`SUM(credit)` — and a gross trial
balance still balances, which is exactly why `debits === credits` never caught it.

## Workflow
Gates from `book-buddha/`: `vitest.cmd run --root .` · `tsc.cmd` · `vite.cmd build`, **never via a
pipe. vitest does NOT type-check — run `tsc.cmd` first. READ the test count before writing it.**
Stop servers BY PORT. Throwaway DB in the scratchpad — **NEVER his real DB. No UI. Advisor =
Fable. PUSH: ASK FIRST, then run it in the BACKGROUND.** Full brief: `context/RESUME_PROMPT.md`.
