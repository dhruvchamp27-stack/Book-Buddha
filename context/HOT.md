# HOT — Book Buddha

## Last session
2026-11-17 (session 6), branch `autonomous/book-buddha-finish`. **AUTH IS NOW FIXED AND CLOSED.**
4 code commits (last `ceb0db7`) + this state save. **EVERY commit on this branch is unpushed; count
with `git log --oneline @{u}..HEAD | wc -l` — only the owner's terminal can push.** Owner ruled
**S6-1..S6-5**. Gates: **442/442 vitest, 36 files, tsc clean (unpiped), vite build clean.**

## What session 6 did (detail in decisions.md S6-1..S6-5)
1. **`a1ac6bd` — the API had NO authentication at all** (102 routes, no hook). Now ONE `onRequest`
   hook in `buildApi`, **fail closed**: public only via `config: { public: true }`, never a URL
   string — 5 public routes (7 entries, HEAD mirrors GET). Unconfigured → 409, bad token → 401,
   unmatched path denied. Opt-out `__unsafeDisableAuthForTests` (OFF, 28 sites). Sweep DERIVED.
2. **`e69860f` — login gate** (`web/src/AuthGate.tsx` + `session.ts`), since auth broke `App.tsx`.
   Token in module scope, **not persisted** — refresh signs you out (owner's choice).
3. **`7ab89fe` — recovery code, migration v16** (**S6-3**). 150-bit code at setup, shown once, hash
   stored; using it BURNS it. New **authenticated** `POST /auth/recovery-code`.
4. **`ceb0db7`** — fixed 3 of my own defects: v16 tests never ran v16; the attack was pinned only
   via a cast; `AuthGate` **lost the code** if sign-in failed after setup. UI not re-driven after.

## NEXT STEP — in this order
1. **R4c** — opening stock posts `Dr INVENTORY / Cr OPENING_BALANCE_EQUITY`; a mid-year ADJUSTMENT
   posts to `STOCK_ADJUSTMENT` (seeded v13) per **S5-3**. Then an idempotent backfill for the
   owner's GL-less OPENING/ADJUSTMENT movements, through the ledger door, refusing locked years.
   **Next free migration is v17** (v16 went to recovery). TRAPS: FIFO consumes layers
   `ORDER BY occurred_at` (`repository.ts:3003`) so a BACK-DATED opening layer re-measures posted
   COGS; `addStockMovement` has no `businessId` but `insertJournalEntry` needs one.
2. **R5-rem** — presentation only. Split the derived `RETAINED_EARNINGS` into brought-forward and
   profit-for-the-year at the FY boundary, with an invariant test that they still sum (**S5-4**).
3. **R7b** — wire `reports-sales.ts` + `reports-transactions.ts` (unreachable today), then fix the
   four thin reports in **S5-7**. New reports must read `getOpenCustomerItems`/`getOpenSupplierItems`.
4. **R8** — purchase returns, supplier refunds, payment cancellation, bill discount.

## Owner action / carried
**IF YOUR DB ALREADY HAS AN ADMIN** it predates v16 → NO recovery code → recovery REFUSES (fail
closed). Sign in, call `POST /auth/recovery-code` with your password to mint one. **There is no
forgot-password or mint FORM in the UI** — API call only. **ACCEPTANCE R4/R4b figures await
owner**; also unconfirmed 7d, 8c, R2, R1, R5. **Nothing type-checks `web/`** (**S6-4**).
**Headroom cannot compress in the DESKTOP app** (**S6-5**): proxy is HEALTHY, Desktop bypasses it
(0 API requests). Terminal CLI for compression. **CBM works fine here — use it actively.**
Open: shrinkage unbuildable (**S5-3**) · `recordPayment` hardcodes CASH, one invoice/call ·
`finalizeCreditNote` hardcodes `SALES` (**S5-8**) · subscriptions spec/plan clash · audit chain
unkeyed · `GeneralLedgerRow.date` = posting time. Rulings **S4-1..S6-5** in `decisions.md`.

## Workflow — full brief in `context/RESUME_PROMPT.md`
Max **2 agents**, never both in `repository.ts`; orchestrator owns `migrations.ts` (next **v17**)
and **alone runs the full suite** (**S5-5**). Gates — `book-buddha/node_modules/.bin/`:
`vitest.cmd run --root .` · `tsc.cmd` · `vite.cmd build`. **Never read a gate's `$?` through a pipe.**
**Advisor = Fable.** **PUSH: ALL LOCAL — ask, never retry.**
