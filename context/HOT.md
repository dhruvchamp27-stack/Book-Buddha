# HOT — Book Buddha

## Last session
2026-11-17 (session 8), branch `autonomous/book-buddha-finish`, tip `7dcf194` or later. **R5
DONE, R7b PARTIAL, R8 ONE OF FOUR.** Rulings **S8-1..S8-4**. Count the unpushed commits, never
quote a number: `git log --oneline @{u}..HEAD | wc -l`. **PUSHING WORKS from a tool shell — a
dry-run went through in 3s with every prompt disabled (2026-11-17, S8-5). ASK HIM EVERY TIME.**
Gates: **487/487 vitest, 41 files, tsc clean (unpiped), vite build clean, web tsc clean.**

## What session 8 did (full version in RESUME_PROMPT.md — do not rebuild any of it)
1. **`a89f7fc`+`9ede5e4` — R5-rem DONE.** Retained earnings split at the FY boundary as a **new
   `retainedEarnings` field, NOT replacing the derived row** (chart-accounts.test pins it).
2. **`0797270` — R7b wiring.** `reports-sales.ts`+`reports-transactions.ts` had NO caller outside
   their tests; 9 methods + 9 routes reach them. **`.date` → `postedAt` (S8-3)**.
3. **`a2758de`+`1af0dc2` — R7b ageing.** `/receivables-ageing`, `/payables-ageing`, 0-30/31-60/
   61-90/90+ off the SAME open-items query; both take businessId/party/asAtDate (**S8-2**).
4. **`6ad504c`+`f4773ab` — R8 payment cancellation, migration v17.** Row marked not deleted;
   reversal = the posted entry's lines FLIPPED, dated today. Closed a real dead end, then two
   holes it opened: **SALES could end on a DEBIT balance**; the supplier statement still counted
   a cancelled payment. **S8-1.** Proved live on a real v16→v17 upgrade.

## NEXT STEP — the owner set this order on 2026-11-17
1. **FIX fair-sales FIRST.** `/reports/fair-sales` + `/reports/sales-by-item` ignore credit notes
   and have no filters — fair-sales answers **60,000** where `/reports/sales-by-fair` answers
   **40,000 on the same books: two routes, two answers.** Reproduce both figures first. **Fix,
   do not retire** — he asked for a fix.
2. **R8 — three of four AT BEST.** Bill discount (header-level, own migration **v18**) ·
   supplier refunds · **purchase returns are BLOCKED on S7-2** (stock cannot go out in reverse).
3. **R9 attachments — CONDITIONAL, and small.** Engine already exists
   (`src/attachments/attachments.ts`, table in migration v7, `4033ecb`) with **NO caller outside
   its own folder** — the same hole R7b had; only routes + HTTP tests remain. **But there is no
   `@fastify/multipart`:** upload needs an install (ASK) or base64 JSON. Settle that first.
4. **R10** import-export · R11 backup · R12 banking · R13 cash flow · R14 archive.

## Owner action / carried
**FOUR DECISIONS IN `book-buddha/R4C-WORKINGS.md`** + **S8-1** (cash view rewritten
retrospectively on cancellation; the FY lock does not protect it) + **S7-2** (no stock reversal —
blocks R8 closing) + **S8-4** (a credit note has no date, so a return cannot be back-dated).
**ACCEPTANCE for 7d, 8c, R1, R2, R4, R4b, R4c, R5, R7 await him — only R3 is signed
off.** **The R4c backfill has never touched his real DB and must not without his say-so.** The 13
CRLF-dirty test files were restored 2026-11-17 and the tree is clean; `.codebase-memory/` is still
untracked. Open: CASH hardcoded in `recordPayment`, `SALES` in `finalizeCreditNote` (S5-8);
`web/` is in NO gate.

## Workflow — full brief in `context/RESUME_PROMPT.md`
Gates from `book-buddha/`: `vitest.cmd run --root .` · `tsc.cmd` · `vite.cmd build`, **never via a
pipe. vitest does NOT type-check — run `tsc.cmd` before claiming it. READ the test count before
writing it.** Stop servers BY PORT. Throwaway DB in the scratchpad — **NEVER his real DB. No UI.
Advisor = Fable. PUSH: ASK FIRST, then run it in the BACKGROUND.**
