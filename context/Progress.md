# Progress — Book Buddha
*Whole file ≤ 60 lines (S17-11). Test details → Testing.md; definitions → architecture.md; rules → decisions.md.*

## Start here next session
- **Resume straight into development with `book-buddha/BUILD_PLAN_S18.md`.** It lists every remaining part in order, with ready-to-paste builder briefs: §0 baseline gates, §1 order and lanes, §2 hard rules, §3 briefs.
- **First moves:**
  1. Run the §0 gates. Expect tsc 0 · **1,134 tests / 97 files** · vite about 1.2s · migration **v33**.
  2. Dispatch **G** (clock + back-dating confirm everywhere; the serial `repository.ts` builder).
  3. In parallel: P1 (old screen number boxes) · P2 (`/imports/last` company filter) · research **I-1** (GST per line + round-off mini-spec) · **Q16-1** (.xlsx/PDF packages) · **R14-1** (archive mini-spec).
- **His order (S17-1):** BUILD → REVIEW → TESTS. Remaining build: G → I-2 → Q16-2 (after install approval) → R14-2. Then REV (3 reviewers) → FIX → TST (gap map + s17-walk e2e + workings for his hand check).
- **Branch** `autonomous/book-buddha-finish`, never `main`. Push only after asking Dhruv each time. Count unpushed with `git log --oneline @{u}..HEAD`.

## Development — by slice
| Slice | What it does | Built | Tests | Accepted by Dhruv |
|---|---|---|---|---|
| R1, R2, R4, R4b, R5, R7 | not in plan files | ✅ | in gate | ✅ closed (S16-10) |
| R3, R4c | not in plan files | ✅ | in gate | ✅ hand-verified |
| R6 | not in plan files | not stated in sources | not stated | not stated |
| R8 | Purchase returns, refunds, bill discount (S8; S17-7 stock-only spread, S17-10 refusal) | ✅ (H, S17-10) | in gate | ✅ closed (S16-10); S17 parts in review |
| R9 | Document storage for invoices and bills (S9) | ✅ routes 2–5 | in gate | ✅ closed (S16-10) |
| R10 | CSV and JSON import/export; expenses import (Q17) and every report export (Q18) | ✅ (.xlsx/PDF = Q16, install pending) | in gate | ✅ closed (S16-10); D in review |
| R11 | Offline backup, restore, integrity check (S11) | ✅ | in gate | ✅ closed (S16-10) |
| R12 | Banking 12a–12g | ✅ (3562d71) | in gate + 2 e2e | ✅ closed (S16-10) |
| S16 e2e / defects | October 2025 end to end; D1–D16 fixed | ✅ | 22 + in gate | ✅ (S16-5, S16-9) |
| S17 numbering | App numbers INV/QUO/CN/PR-001/25-26; quotation link; edit guard (S17-4/8/9) | ✅ (E) | in gate | review pending |
| S16 slice | Refund account, money account kept on edit, repeated payments, audit, FY lock, stock adjustment | ✅ (A, B) | in gate | review pending |
| F | Pre-opening items kept as history, never posted (S16-2(c), Q13, S17-12; v33) | ✅ | 20 | review pending |
| R13 | Cash Flow Statement, direct method (S17-6; v30) | ✅ (C) | 7 | review pending |
| G | Back-dating confirm on every dated entry + settable "today" (Q12, S17-13) | ✅ (S18) | 122 + in gate | review pending |
| I | GST per line (Q24) + rupee round-off line (Q23); v34 | ⬜ mini-spec first | — | — |
| R14 | Archive masters: Active / Inactive / Archived (S11-6, FD §F; v35) | ⬜ mini-spec first | — | — |
| §13 reports 1–6, S10-4 | Customer, stock and profit reports; stock write-down | ✅ | in gate | ✅ closed (S16-10) |
| 7d, 8c | Cash-basis invoice, bill and P&L figures | ✅ | in gate | on trust |

## Known issues / review items
- **S18-1 ruled "refuse it" and BUILT:** a bill discount that leaves nothing payable is refused at save (and at finalize).
- **F2 (ask Dhruv):** saving an opening set dated after posted documents is unchecked, so they double count silently. Reversing the last set leaves history items with no opening figure. Proposed: warn with a count + confirm (BUILD_PLAN_S18.md §1).
- **S18: everything waiting on Dhruv is in `book-buddha/REVIEW_PACK_S18.md`** (I-1, Q16 installs, R14-1, S17-10 edge, F2, REV calls).
- For REV:
  - The settlement discount is stored only on the posted entry (no column).
  - F builder's own calls (decisions.md "F plan").
  - Orchestrator calls: refund default = account of the latest live payment (A); opening entries are never cash flows (C); mixed-bill return clawback assumed none (H).
- No real database yet (S11-16); never touch his live file.

## Last 3 sessions
- **Session 17 (22 Nov):**
  - Built: S16 slice (A, B), R13 cash flow (C), Q17/Q18 + slow tests (D), bill discount (H), app numbering (E), S17-10 refusal, quotation-edit guard, F pre-opening history. Migrations v30–v33.
  - Rulings S17-1..13. Context restructured (S17-11). Code 451f9ab pushed. Full plan written: `book-buddha/BUILD_PLAN_S18.md`.
- **Session 16 (21 Nov):** R12 committed; Q1–Q26 and S16-1..8 ruled; October e2e ACCEPTANCE on approved figures; 16 audit defects fixed (fba7cfb, d2120dc). S16-9: taken numbers refused. S16-10: all parked acceptance closed.
- **Session 15 (21 Nov):** R12 planned (S15-1..4); 12a–12d and 12e–12g built, reviewed, mutation-proved, two e2e acceptance tests.
<!-- END OF SUMMARY - the session-start hook loads only what is above this line -->

## Live briefs (one or two lines each; full text in BUILD_PLAN_S18.md §3)
- S18 (22 Nov): **P1** done (App.tsx number boxes removed) · **P2** done (`/imports/last?companyId=` required, +1 test) · **I-1, Q16-1, R14-1** research done → REVIEW_PACK_S18.md. Gates: tsc 0 · 1,135 / 97 · vite OK. Uncommitted.
- **G** BUILT + verified by orchestrator: tsc 0 · 1,257 / 98 · October 22/22 · vite OK. 30 doors, shared `assertPostable` (FY lock first). Orchestrator fixed the opening-import gap (import-masters.ts, +1 test, proven red without it). Open for REV: bank-feed preview of a past-month line returns 400 without the confirm; some test pins precede their documents.
- **S18-1** BUILT + verified: refused at create and at finalize (no draft-edit door exists for bills). Gates tsc 0 · **1,262 / 98** · October 22/22. The agent-pair run failed in 6 s: PS 5.1 splits a quoted prompt, `agent-pair-worker.ps1:30/34`.
