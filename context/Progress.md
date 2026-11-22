# Progress — Book Buddha
*Whole file <= 60 lines; the summary above the marker <= 50 (S17-11, hard rule 10). Test detail -> Testing.md; definitions -> architecture.md; rulings, open calls and session history -> decisions.md.*

## Start here next session
- **Resume with `book-buddha/BUILD_PLAN_S18.md`** - §0 gates, §1 order, §2 hard rules, §3 briefs. The I-2 and I-3 briefs are filled; Q16-2, R14-2, F2 and FIX are still skeletons.
- **Run the §0 gates first.** Expect tsc 0 · **1,314 passed / 1 failed of 1,315, 102 files, about 60s** · vite 1.8s · October 22/22 · migration **v35**. The ONE allowed red is `r10-integration.test.ts:238`, a wall-clock budget this machine does not meet (10.7s to 29.4s against 10s, on UNCHANGED code). Never loosen it; a timeout is not a failure you caused.
- **Next build, in order:** Q16-2 (.xlsx + PDF - installs APPROVED but NOT yet run) -> R14-2 (two states, **v36**) -> F2 (ruled, S18-3) -> REV (3 reviewers) -> FIX -> TST.
- **Order (S17-1):** BUILD -> REVIEW -> TESTS. **Branch** `autonomous/book-buddha-finish`, never `main`; pushed through `68ce29f`. Push only after asking him, every time (S11-17).
- **Waiting on him:** the ten unruled calls and three gaps in **S18-7** · **I-Q4** pro-rata GST, pending Puneet or Manish (S18-4) · Part C's five REV calls.

## Development - by slice
| Slice | What it does | Built | Tests | Accepted by Dhruv |
|---|---|---|---|---|
| R1-R5, R7 | Foundation, masters, sales, payments, inventory, reports | ✅ | in gate | ✅ closed (S16-10); R3/R4c hand-verified |
| R6 | Not named in any plan file | status not stated in any source | — | — |
| R8 | Purchase returns, refunds, bill discount (S8; S17-7, S17-10) | ✅ (H) | in gate | ✅ closed; S17 parts in review |
| R9 | Document storage for invoices and bills (S9) | ✅ routes 2-5 | in gate | ✅ closed (S16-10) |
| R10 | CSV/JSON import and export; expenses import (Q17), report export (Q18) | ✅ (.xlsx/PDF = Q16) | in gate | ✅ closed; D in review |
| R11 | Offline backup, restore, integrity check (S11) | ✅ | in gate | ✅ closed (S16-10) |
| R12 | Banking 12a-12g | ✅ (3562d71) | in gate + 2 e2e | ✅ closed (S16-10) |
| S16 e2e / defects | October 2025 end to end; D1-D16 fixed | ✅ | 22 + in gate | ✅ (S16-5, S16-9) |
| S17 numbering | App numbers INV/QUO/CN/PR-001/25-26; quotation link; edit guard | ✅ (E) | in gate | review pending |
| S16 slice | Refund account, money account on edit, repeated payments, audit, FY lock | ✅ (A, B) | in gate | review pending |
| F | Pre-opening items kept as history, never posted (Q13, S17-12; v33) | ✅ | 20 | review pending |
| R13 | Cash Flow Statement, direct method (S17-6; v30) | ✅ (C) | 7 | review pending |
| G | Back-dating confirm everywhere + settable "today" (Q12, S17-13) | ✅ (S18) | 122 + in gate | review pending |
| **I-2** | **GST per LINE, rounded per rate group; invoice and credit-note round-off (S18-3, S18-5; v34)** | ✅ **BUILT** | 23 + 7 migration | **review pending** |
| **I-3** | **Optional typed round-off on bills and expenses, tied to payables (S18-6; v35)** | ✅ **BUILT** | 15 + 6 migration | **review pending** |
| Test setup | In-memory databases restored from a migrated image, not replayed (346s -> 60s) | ✅ | in gate | review pending |
| R14 | Masters Active / Inactive, two states only (S18-2; **v36**) | ⬜ ruled, not built | — | — |
| §13 reports 1-6, S10-4 | Customer, stock and profit reports; stock write-down | ✅ | in gate | ✅ closed (S16-10) |
| 7d, 8c | Cash-basis invoice, bill and P&L figures | ✅ | in gate | on trust |

## Known issues / review items
- **S18-7: ten calls made while building I-2 and I-3 await his ruling**, plus three gaps (no cash-basis P&L case with a round-off; the v34 backfill never run against a real pre-v34 FILE database; `items.default_tax_rate_basis_points` with no reader).
- **`r10-integration.test.ts:238`** fails on this machine: 2,000 invoices import in 10.7s to 29.4s against a 10s budget, on unchanged code, and it was the only red before any of this work. NOT a timeout. His call whether to re-tune a figure he approved.
- **The local branch `autonomous/book-buddha-finish` at `df03cc5` is an ABANDONED line**, unrelated to the remote branch of the same name (shared base `616664f`, 149 commits apart). Rename it before someone pushes by habit.
- **`CLAUDE.md` is stale:** it says "spec stage, nothing is built yet" and hard rule 3 says all work happens on `Prototype`. Neither is true. `.claude/settings.local.json` still points `headroom.EXE` at another machine.
- For REV: settlement discount stored only on the posted entry · F builder's own calls (decisions.md) · refund default = latest live payment (A) · opening entries are never cash flows (C) · mixed-bill return clawback assumed none (H).
- No real database yet (S11-16); never touch his live file.

## Session history
- In `decisions.md`, newest first: S18-1..S18-7 (22 Nov), S17-1..S17-13, S16-1..S16-11, S15-1..S15-4.
<!-- END OF SUMMARY - the session-start hook loads only what is above this line -->

## Live briefs (one or two lines each; full text in BUILD_PLAN_S18.md §3)
- **Session 18 (22 Nov), all pushed as `c730051`, `fa3edd0`, `68ce29f`:** P1 · P2 · G · S18-1 refusal · research I-1/Q16-1/R14-1 · hook path fix · test-setup template · **v34 + I-2** · **v35 + I-3** including the payables tie-out defect found and fixed. Gates at the pushed head: tsc 0 · 1,314/1,315 · vite 1.82s · October 22/22, on two consecutive runs.
- **Open before the next build:** his ruling on S18-7 · Q16 installs approved but not run (`npm install https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz` · `npm install pdfkit` · `npm install -D @types/pdfkit`) · `run-agent-pair.ps1` and `agent-pair-worker.ps1` are NOT in this repo or on this machine, so the agent-pair harness cannot be repaired here.
