# Progress — Book Buddha
*Top part ≤ 50 lines: loaded at every session start, rewritten at every session end.*

## Start here next session
- **Next step:** R10 import/export, design first: write the definitions into Progress.md → Definitions, then a brief in Progress.md → Active briefs, then Sonnet builds. CSV and JSON need no install; .xlsx and PDF need a package, so ask first.
- **Waiting on Dhruv:** odd-paise ruling (blocks bill discount); attachment audit log; purchase-return back-dating warning; the other Claude session in this folder; delete AGENT_BRIEF_R9_ROUTES.md?
- **Branch and gates (measured 19 Nov):** `autonomous/book-buddha-finish`, never `main`. tsc exit 0 · 714 tests in 56 files · vite built in 1.18s · migration v22.
- **Push rule:** only after the tests pass, in the background, and only after asking Dhruv each time. Count unpushed commits fresh with `git log --oneline @{u}..HEAD`.
- **After R10:** bill discount (blocked) → R12 banking (amend FD §D6 first) → run all tests together and check the backend end to end (standing order S12-3) → then R13 cash flow (S14-2).

## Development — by slice
| Slice | What it does | Built | Tests | Accepted by Dhruv |
|---|---|---|---|---|
| R1, R2, R4, R4b, R5 | not in plan files | ✅ | in gate | outstanding |
| R3, R4c | not in plan files | ✅ | in gate | ✅ hand-verified |
| R6 | not in plan files | not stated in sources | not stated | not stated |
| R7 | not in plan files | ✅ | in gate | outstanding |
| R8 | Purchase returns, refunds, bill discount (S8) | ✅ (stock-cost part ⏳ blocked) | in gate | outstanding |
| R9 | Document storage for invoices and bills (S9) | ✅ routes 2–5 | 8 + 24 engine | parked |
| R10 | CSV and JSON import/export (S10) | ⬜ design first | — | — |
| R11 | Offline backup, restore, integrity check (S11) | ✅ | 16 + 7 | parked |
| R12 | Bank accounts, transfers, reconciliation (S12) | ⬜ | — | — |
| R13 | Cash Flow Statement (S13) | ⬜ after the all-together test run (S14-2) | — | — |
| R14 | Archive: active, inactive, archived (S14) | deferred (S12-4) | — | — |
| §13 reports 1–6 | Customer, stock and profit reports | ✅ | in gate | parked |
| S10-4 | Stock write-down and reversal (v22) | ✅ | 15 | parked |
| 7d, 8c | Cash-basis invoice, bill and P&L figures | ✅ | in gate | on trust |

## Testing
- **Gates, 19 Nov (last measured):** tsc exit 0 · vitest 714 tests in 56 files · vite built in 1.18s. Run tsc first; vitest does not type-check.
- **Acceptance:** hand-verified R3, R4c · on trust 7d, 8c · outstanding R1, R2, R4, R4b, R5, R7, R8 · everything else parked until R12 (S12-3).

## Known Issues
- Attachment upload and delete write no audit log (S13-2); the audit log is a fixed rule.
- No real database yet (S11-16); never touch the live file.
- A purchase return can be back-dated with no warning, unlike a credit note (S11-21).
- Bill discount into stock cost is blocked: Rs 150 off 7 units leaves a paise remainder (S11-1, S11-2, S11-22).
- A bare PURCHASE stock row posts nothing, yet FIFO still consumes it (S7-1(d)).
- Restore writes no audit event, and a zero-cost write-down skips the financial-year lock check.
- Known flake: the fuzz test in engine.test.ts can time out under load; it passes alone.
- Another Claude session commits in this folder (S13-3).

## Last 3 sessions
- **Session 13 (19 Nov):** six commits pushed: reports 1–3 and 6, R9 routes 2–5, S10-4 (v22), R11 backup. Paused by Dhruv.
- **Session 12:** set the standing order (S12-3), deferred R14 (S12-4), wrote the six report definitions before any code.
- **Session 11 (18 Nov):** Dhruv answered the nineteen questions (S11-1 to S11-22); 7d and 8c accepted on trust.

<!-- END OF SUMMARY - the session-start hook loads only what is above this line -->

## Working area (for the orchestrator and workers; written so Dhruv can inspect it)

### Active briefs
(None open. Template for the next one:)
#### <Slice> — status: open / sent / checked / sent back / closed
Goal · Files to read · Files it may change · Done when (a runnable check) · Orchestrator's check result

### Definitions (written before any code)
#### §13 reports (from REPORT_DEFINITIONS_S12, built in session 13)
- **1. Customer statement.** One customer's account in date order, with a running balance ending at what they owe now. Figures: open-items query (including settled), each document's own payments, applied credits and opening receipts; credit notes from the posted journal. Must tie: closing balance equals that customer's outstanding in open items, and the hand example closes at Rs 15,000 (same as getReceivables). Does NOT: show cash invoices, take a cash basis, or net unapplied credit into the balance.
- **2. Customer Balance Detail.** Every customer, each unpaid document with what is left, a subtotal per customer and a report total. Figures: the same open-items query. Must tie: report total equals getReceivables for the same filter. Does NOT: net unapplied customer credit into a subtotal, or roll back settlements for an as-at date.
- **3. Collections.** The chasing list: overdue documents, days overdue, contact details, oldest first. Figures: Balance Detail rows whose due date is before the as-at date; with no due date, the invoice date is used and the row says so. Must tie: a strict subset of Balance Detail, same amounts. Does NOT: rebuild a historical balance or use a different overdue rule.
- **4. Stock ageing.** How long stock on the shelf has sat, in the four shared bands (0–30, 31–60, 61–90, over 90 days). Figures: FIFO layers dated by their bill, journal or credit-note entry date; layers with no date are counted and shown. Must tie: buckets sum to Inventory Valuation per item and in total. Does NOT: filter by business or fair (stock has no business dimension), or invent finer bands.
- **5. Inventory Valuation Detail.** Each remaining lot: item, received date and its basis, quantity, unit cost, value, source. Must tie: grouped by item, equal to getInventoryValuation exactly. Does NOT: filter by business or fair, or re-sort FIFO by received date (FIFO stays by occurred_at, rowid).
- **6. Item profitability.** Per item: net sales less cost of goods sold (COGS) equals gross margin. Revenue comes from Sales by Item (no second query); COGS from the stock rows of the same sales, dated by the source document. Must tie: COGS equals the COGS account in the posted journal with no date filter; revenue equals Sales by Item. Does NOT: spread invoice discount, extra charge or GST across lines, filter by customer, take a cash basis, or store a margin percentage.

### Open to-dos and questions
**Waiting on Dhruv (decisions)**
- Odd-paise ruling: Rs 150 off 7 units, and how a bill tells a trade discount from a settlement discount (S11-1, S11-2, S11-22). Blocks bill discount.
- Attachment upload and delete audit log (S13-2). His call; the audit log is a fixed rule.
- Purchase-return back-dating warning, as credit notes have (S11-21).
- Is the other Claude session in this folder his, and should it continue (S13-3)?
- Smaller calls: base64 vs multipart for attachments (S11-19, defaulted); OPENING_DATE label in Collections; backend-only through R12 (confirm at R12); web/src/App.tsx StockMovementType lacks the v22 types (UI is his).
- Delete context/AGENT_BRIEF_R9_ROUTES.md? Listed as dead litter in HOT.md; deletion offered, not answered.

**Build work still open**
- R10 import/export: definitions file, brief, then build. CSV and JSON only; .xlsx and PDF need a package, so ask first.
- Bill discount into stock cost: blocked on the odd-paise ruling.
- R12 banking: amend FD §D6 to two Uncategorized accounts (S11-8) before starting.
- Zero-cost write-down is not FY-lock checked; restore writes no audit event.
- Source-less PURCHASE posts nothing while FIFO consumes it (S7-1(d)). Flagged, not fixed.
- Acceptance for R1, R2, R4, R4b, R5, R7, R8 is parked until R12, then run all tests together (S12-3).

**From todos.md (seeded 14 Nov; may be stale)**
- FD §H, listed as open: archive scope; auto-record payment on a bank match; whether the Uncategorized account is auto-created or named by the owner. The section header says it is closed, so confirm before R12.
- Subscriptions deferred (S1-5). Outside advisers: CA (principal vs agent on magazine resale, GST timing, "Exempt" scope); lawyer (buyer personal data under DPDP Rules 2025).
- The old todos.md build order is superseded by HOT.md's remaining order.

**Open spec conflicts and technical decisions (from todos.md; seeded 14 Nov, may be stale)**
- Rounding: whole rupee (DD §7.4, PRD) vs exact paise (ANTI §4, TEST §5.3).
- Tax placement: per-line GST as the user names it (DD §13.1) vs invoice-level GST (prototype).
- Reports count: 8 in BP vs about 17 in DD §12.
- Archive scope: v1-skip (DEC Q7) vs v2 (DD §1.5/§17) vs V1 (FD/H13). FD §H scope is still open.
- M4 challan↔invoice link: pending (DEC) vs decided (DD §11.4).
- Formal tech-stack confirmation: TS + Fastify + SQLite + React in the prototype, never formally confirmed.
- Desktop packaging: Tauri vs Electron undecided; how it installs for a non-engineer.
- PDF extraction library: pdfplumber/Camelot are Python; the prototype is TS.
- OCR library: Tesseract vs PaddleOCR; whether cloud OCR is ever allowed.
- Who builds: Sonnet builds, Opus reviews (ANTI §5); process proposed, not owner-confirmed.
- Test basis: test data and fixtures, partly answered by the Vitest tests.
- Prototype roles: admin/accountant/viewer vs Phase-1 admin-only (DD §15.1).
- Canonical repo path: docs say D:\dhruv-book-accounting-app\Book-Buddha-github; this checkout is C:\Users\Admin\Desktop\Book Buddha. Confirm which.
- Build status: docs say nothing built; HOT shows a working prototype.
- Prototype cancel: claimed as reversal, unverified when seeded.
- testing/testing.md is a stale draft (says DD §5 unwritten; calls a fair a tag).
- Phase 2 design still open: invoicing-user login and recovery, permission matrix, tablet layout, LAN, connection drop (DD §2.4).

### Rules and lessons carried forward
- Owner's standing rule: build backend only, no UI (session 8). Screenshots only of things that really work.
- A slice is accepted when the accounting logic is satisfied (S12-1). The nineteen questions are closed (S11-1 to S11-22); do not re-ask them.
- Where the data model forces a choice, make it and say so; accounting policy is Dhruv's (S9-1 trade-off; v18 and v19 precedent).
- Date the entry, never the stock layer. FIFO runs ORDER BY occurred_at, rowid. Restored stock goes to the end of the queue (v19).
- A stock reversal stamps the BILL's id on the movement, then asserts the ledger equals valuation (session 9 bug).
- Reports key on entry_date, not created_at, and group by chart_accounts type or role via JOIN, never a hard-coded code list.
- An unknown fair must throw, not return zero rows (S11-9).
- A new seeded account needs a new frozen seed list and a new migration; migration-v15-seeding goes red by design, so add the list there.
- Migration tests: build to version n-1, insert rows by raw SQL, call the new apply function directly. A whole-chain run on an empty database tests nothing.
- Any rebuild of chart_accounts must replay every trigger that mentions it (journal_lines_account_exists).
- The posting door rejects a 0/0 journal line; filter zero lines out first.
- New API routes are protected automatically; a public route must be added to PUBLIC_ROUTES deliberately. Every new route needs an HTTP test.
- buildApi takes two positional arguments: buildApi(repository, { __unsafeDisableAuthForTests: true }).
- Fastify tests cannot use fake timers; age a session with validateSession(token, future).
- Edit with the Edit or Write tool, never perl -i -pe (it eats $ signs). Write markdown with Write, not a shell heredoc.
- Reproduce a defect before fixing it; mutation-test key assertions; restore by byte comparison, never git checkout while work is uncommitted.
- Triage any red test: old behaviour, stale count, or an ACCEPTANCE figure (stop and look; never edit it).
- Verify a stated blocker in the code before planning around it (S9-3: "purchase returns blocked on S7-2" was never true).
- Maximum two builders, never both in repository.ts; the orchestrator owns migrations.ts and runs the full suite alone (S5-5).
- Stage by explicit path, one commit per idea, honest limits in the commit message.

### History — closed briefs
- **R9 attachment routes 2–5** — built `fa4ab42`. Files: src/api/attachment-routes.ts, src/api/attachments-api.test.ts. Routes: POST upload (base64 JSON, raised body limit), GET list, GET content, DELETE. Checked by 8 HTTP tests. Open: delete writes no audit log (S13-2).
- **R11 backup, verify, restore** — built `2952c28`. Files: src/backup/backup.ts, src/api/backup-routes.ts. Routes: POST /backups, GET /backups, POST /backups/:id/verify. Restore is a backend function with no HTTP route, by design (S13-4). Checked by 16 + 7 tests, including "restored books show the same numbers".
- **Customer reports 1–3** — built `9cd1838`, shared as-at helper in open-items.ts (shared change in `63bb874`). Files: src/database/reports-customers.ts and its test. Checked by 15 tests: hand example Rs 15,000 and tie-outs to getReceivables and Balance Detail.
- **Item profitability (report 6)** — built `cf84fe9`. File: src/database/reports-profitability.ts. Checked by 14 tests: COGS ties to the journal with no date filter, fair filter, unknown fair throws. The mutation check was asked for; its result is not in the sources.
- **Report routes** — built `9cd503c`. Four GET routes for reports 1–3 and 6; repository wrappers; getReceivables gains a fair filter (S13-1). Checked by reports-wiring and unknown-fair sweep tests.
- **Stock correction S10-4 (v22)** — built `2cb332f`. Files: src/database/stock-adjustment-schema.ts, migration v22, stock-layers and repository changes. Routes: POST /inventory/write-downs, POST /inventory/movements/:id/reverse. Checked by 15 tests; v22 proved on a real file.
