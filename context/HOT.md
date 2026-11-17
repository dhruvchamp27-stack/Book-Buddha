# HOT — Book Buddha

## Last session
2026-11-17 (session 8), branch `autonomous/book-buddha-finish`, tip `6ad504c`. **R5 DONE, R7b
DONE, R8 ONE QUARTER DONE.** Rulings **S8-1..S8-4**. **EVERY commit here is unpushed — count with
`git log --oneline @{u}..HEAD | wc -l`; only the owner's terminal can push.**
Gates: **486/486 vitest, 41 files, tsc clean (unpiped), vite build clean, web tsc clean.**

## What session 8 did
1. **`e945a7f`** — deleted the "Offline-first accounting" tag (3 sites). Screenshotted.
2. **`a89f7fc` + `9ede5e4` — R5-rem.** Retained earnings split at the FY boundary, **added as a
   new `retainedEarnings` field, NOT replacing the derived row** (chart-accounts.test pins that
   row). One cut at the FY start; the upper bound mirrors the sheet's own, so the two parts
   partition exactly. No business / no FY / uncovered date → `split: null` + a plain reason.
   On screen with a Year-close card. Live proof: 15,000 = 3,000 b/f + 12,000 for the year.
3. **`0797270` — R7b wiring.** `reports-sales.ts` + `reports-transactions.ts` had NO caller
   outside their tests; 9 repository methods + 9 routes now reach them. **`GeneralLedgerRow.date`
   → `postedAt` (S8-3)**; the ledger shows `entryDate`.
4. **`a2758de` + `1af0dc2` — R7b ageing.** `/reports/receivables-ageing`, `/payables-ageing`,
   0-30/31-60/61-90/90+, off the SAME open-items query. `getReceivables`/`getPayables` gained
   businessId/party/asAtDate and no longer age off the wall clock (**S8-2**).
5. **`6ad504c` — R8 payment cancellation, migration v17.** `cancelled_at` on `payments` +
   `supplier_payments`; reversal = the posted entry's lines FLIPPED, dated today. **Closed a real
   dead end:** a paid invoice refused cancellation and the payment could not be undone. **S8-1.**

## NEXT STEP — in this order
1. **Finish R8:** bill discount (header-level, own migration **v18**) · supplier refunds ·
   **purchase returns are BLOCKED on S7-2** — they take stock out and a movement still cannot be
   reversed or entered negative. Put S7-2 to the owner first.
2. **R7b leftovers:** `/reports/fair-sales` and `/reports/sales-by-item` still ignore credit
   notes, so fair-sales says 60,000 where the new `/reports/sales-by-fair` says 40,000 —
   **two routes, two answers.** Also `getSupplierStatement` exists with no customer equivalent.
3. **R10** import-export · R11 backup · R12 banking · R13 cash flow · R14 archive.

## Owner action / carried
**FOUR DECISIONS IN `book-buddha/R4C-WORKINGS.md`** + **S8-1** (cash view rewritten
retrospectively on cancellation; the FY lock does not protect it) + **S7-2** (no stock reversal)
+ **S8-4** (a credit note has no date, so a return cannot be back-dated). **ACCEPTANCE for 7d,
8c, R1, R2, R4, R4b, R4c, R5, R7 await him — only R3 is signed off.** **The R4c backfill has
never touched his real DB and must not without his say-so.** IF HIS DB PREDATES v16 there is NO
recovery code — sign in, `POST /auth/recovery-code`. 13 test files dirty with **CRLF-only churn**
(offer `git checkout --`, explicit paths). `.codebase-memory/` untracked — ask about `.gitignore`.
Open: CASH hardcoded in `recordPayment`, `SALES` in `finalizeCreditNote` (S5-8); `web/` in NO gate.

## Workflow — full brief in `context/RESUME_PROMPT.md`
Gates from `book-buddha/`: `vitest.cmd run --root .` · `tsc.cmd` · `vite.cmd build`, **never via
a pipe**. **vitest does NOT type-check — run `tsc.cmd` before claiming it. READ the test count
before writing it.** Stop servers BY PORT. Throwaway DB in the scratchpad — **NEVER his real DB.
Advisor = Fable. PUSH: ASK, NEVER RETRY.**
