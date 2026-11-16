# HOT — Book Buddha

## Last session
2026-11-15: **Slices 7 and 8 BUILT** (accrual-always + Cash/Accrual P&L toggle; the
project/fair dimension), plus **two real defect fixes** and one consolidated plan for all
remaining work. Owner locked four decisions. Gates: **175/175 vitest, tsc clean, build ok**.

## Active now — autonomous backend finish (branch `autonomous/book-buddha-finish`)
BACKEND-ONLY. Slices 1–6 earlier (latest `c10b96e`, v4). This session, 11 commits, local-only:
- **7a** `5fc5aa8` BS liabilities credit-normal · **7b** `4db437a` accrual-always posting
  (−156 lines, cash-basis helpers deleted) · **7c** `fbd358c` business_id + entry_date
  (migration **v5**) + business/date report filters · **7d** `710d4f6` derived Cash/Accrual
  **P&L** toggle (writes no journals)
- **8a** `5449f46` fair_id on journals/stock/bills/expenses (migration **v6**) · **8b**
  `573cbd6` fair tagging on documents/stock/COGS (FIFO provably unchanged) · **8c** `9857a36`
  fair filter on P&L/TB/GL + cash view; Balance Sheet **refuses** it
- **fixes** `43aca3c` a paid invoice could be cancelled (drove AR negative, cash stranded) ·
  `c832a3a` v6 gate 3 now checks each entry against its OWN document
- **docs** `daa9853` Slice 7 recorded · `b320b56` the remaining-work plan

**NEXT STEP → `book-buddha/REMAINING_BUILD_PLAN.md`, S1:** migration v7 adding
UNEARNED_REVENUE / BANK / UNCATEGORIZED / OPENING_BALANCE_EQUITY in ONE account-CHECK
rebuild, and — same commit — replacing the hardcoded account lists in `getBalanceSheet`,
`getProfitAndLoss` and `deriveCashView` with one classification map: a new code missing from
one of those lists is silently dropped and **unbalances the sheet with no error**. Then S2
payment dates, S3 credit-note cash view, S4 opening balances, … S14 archive.

## Owner's model (implemented)
Post ALWAYS accrual; `accounting_basis` is only the report default. Cash P&L: gross sales =
cash received, GST separate, net = gross − GST. COGS follows the SALE's collection, not the
supplier payment. **IST (UTC+5:30)** for every business date; **reversals carry their OWN
date**. A fair is OPTIONAL on every record; **no per-fair Balance Sheet** (DD §12.1).

## Workflow (owner-set)
Sonnet builds, Haiku docs, Opus verifies gates+diff then commits. **No per-slice plan files
any more** — one consolidated plan. Gates (npm NOT on PATH), from `book-buddha/`:
`.\node_modules\.bin\` → `vitest.cmd run --root .`, `tsc.cmd`, `vite.cmd build`. Stage by
explicit path; one commit = one idea; never `git add -A`. Max 2 agents, **never both in
`repository.ts`**, never run gates while one writes. Leave `context/*.md` uncommitted.

## Blocked / open
**11 commits are local-only — ask before pushing** (auth works, `git fetch` verified). UI was
deferred "until the push issue is fixed"; that is now MET, so resuming UI is the owner's call.
Deferred: **Subscriptions** (DD §11.6, 3 open) · bank categorization + **bill OCR** (FD
UNAPPROVED, 3 open items) · PDF/XLSX, OCR engine, Tauri, UI, live OAuth, npm audit (installs).
Carried: unknown `fairId` → empty report, not an error · `GeneralLedgerRow.date` is the
posting timestamp (`entryDate` is the transaction date) · cash gross may differ from net+GST
by a paise mid-collection · `updateDraft` throws a plain Error so the API 500s instead of
400 · 7d/8c acceptance figures are **built but unconfirmed** by the owner. Keep <50 lines.
