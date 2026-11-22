# decisions.md — Book Buddha

*On-demand allied file. Seeded 2026-11-14 from the repo docs (DD = Design Document,
DEC = plan/Decisions — the 15 questions, FD = Feature Design V1, H13 = 13 Nov handoff).
These pre-date this harness, so they keep their original IDs. **Future** decisions made
in a session use the harness convention `S<session>-<n>` (e.g. S1-1), newest at the top.*

## Rules and lessons carried forward (moved from Progress.md, S17-11)
- **Baseline gates on THIS machine (22 Nov, fresh clone of `b6bfea0`, Node 24.16.0, Windows):** tsc
  exit 0 · vitest **1,261 passed / 1 failed of 1,262, in 98 files** · vite builds in 1.78s. The single
  failure is `src/import-export/r10-integration.test.ts:238`, a WALL-CLOCK assertion that 2,000
  single-line invoices commit in under 10 seconds: it measured 14.06s in the full parallel run and
  passes 10/10 when that file is run on its own, so it is CONTENTION on this machine, not a defect.
  The October ACCEPTANCE test is green (22 tests). `HOT.md` records the gates as fully green because
  they were measured on the other machine. Do NOT "fix" this by loosening the threshold without the
  owner's say; it is the only allowed red in a builder's report.
- **The CGST odd-paise split is a PLAIN per-document `Math.floor(taxPaise / 2)`** (`engine.ts:69`, and
  `:187` for input tax). It is NOT cumulative. A cumulative CGST/SGST split does exist in the live code,
  but only in `cashBasisSupplierPaymentLines` (deferred input tax on cash-basis supplier payments) and in
  `allocateProportionally()` for the cash view — never in the invoice posting path. The ABANDONED local
  branch's `IMPLEMENTATION_PROGRESS.md:147` claims the invoice rule is `floor((prior+this)/2) - priorCgst`;
  that branch is a dead reimplementation that shares only commit `616664f` with this one, and its notes
  must not be used as a source. This wrong premise reached a worker brief once on 22 Nov.
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
- Builder rules (every brief restates): CBM first · no new `context/` file · never open `.env`, secrets or `*.db` · only own files · no installs · no git writes · journal writes only via `postJournalEntry`, audit only via `appendAuditEvent` (`single-writer.test.ts` enforces) · money in whole paise · every new posting names one business · reversals not edits · every create/update/cancel audited · gates unpiped, counts read · loop until green, then report.

## Open to-dos and spec questions (moved from Progress.md, S17-11; may be stale)
**Waiting on Dhruv**
- Is the other Claude session in this folder his, and should it continue (S13-3)?
- Smaller calls: base64 vs multipart for attachments (S11-19, defaulted to base64); OPENING_DATE label in Collections; `web/src/App.tsx` StockMovementType lacks the v22 types (UI is his).
- R12 set-two calls to confirm: over-payment matching refused in V1 (part-payment allowed) · statements CSV/JSON only · rules cannot target the Uncategorised accounts · Add/Split/Uncategorise post as vouchers · an import that adds nothing still writes an import row and audit event · matching a document overwrites the line's business; posted-line matches show exact amounts only · deleting a bank rule is a hard delete (audited); a TRANSFER rule cannot target its own bank account.
- R12 set-one calls (from Builder B, unasked): a credit note / purchase return on a document paid at once into a bank posts back to THAT bank; a credit document naming a money account/mode/reference is refused (name them on each payment). (The `PUT /invoices/:id` reset-to-CASH trap is fixed by S17 Builder A.)
- R10 choices made without him: customer/supplier payments are also refused on or before the opening date; imported credit notes confirm back-dating automatically (the preview is the confirmation). (Equal-payments rule replaced by S16-3 / Builder B.)
- Amend FD §D6 to two Uncategorized accounts (S11-8): wording edit only, no migration — confirm done.
- **S17-10 edge (asked 22 Nov; ON HOLD — Dhruv is checking, do not build either option until he rules):** a bill discount EQUAL to the stock value on a bill that is ALL stock (nothing payable). Saves, but finalize fails: the ledger refuses a nil payable line. Options:
  (a) refuse at save: "The bill discount equals the whole bill, so nothing is payable. Record free stock as a stock adjustment instead." The free stock then goes in through a stock adjustment.
  (b) allow it as a nil-total bill: stock comes in at nil cost and no journal entry is posted.
  (a) is recommended because a bill with nothing to pay has no ledger story; (b) leaves a "posted" bill with no entry, which the audit and cancel-with-reversal rules do not expect. With other lines (freight etc.) the equal case already posts fine.
- **F plan (22 Nov, for his approval) — pre-opening items as HISTORY (S16-2(c), Q13).** Today the app
  ACCEPTS and POSTS a document/payment dated on/before the opening date (counts twice); only imports refuse.
  Design: a `before_opening` 0/1 column (v33) on invoices, purchase_bills, expenses, credit_notes,
  purchase_returns, payments, supplier_payments; status stays FINALIZED. Rule enforced at WRITE: a history
  item is never journalled and never moves stock, so every ledger-based report (TB, BS, P&L, GL, cash
  flow, §13) excludes it untouched; 14 read paths that read document tables directly (open items/
  receivables/ageing, payables, supplier statement ×4, customer credit balance, sales-by-item, sales
  returns, cash view loops) get `before_opening = 0`. Confirm like `confirmBackdatedMonth`:
  "This is dated before your opening date — it will be kept as history and not posted. Continue?";
  imports keep such rows as history automatically (per-row "kept as history"). Numbering unchanged
  (app numbers for app documents, imported keep theirs). Defaults proposed: flag frozen at finalize; warn
  with a count before reversing the last opening set or saving one dated after posted documents;
  vouchers/transfers out of scope (no party). Questions put to him: payment after opening on a history
  invoice/bill · credit note/return on a history document · cancel a history document · opening-balance
  receipt dated exactly ON the opening date (today allowed). **BUILT 22 Nov.** Builder's own calls (for
  review): a history finalize/cancel returns an empty, unstored entry id `history-…`; a payment on/before
  opening against a POSTED document is refused; a history supplier payment cannot carry a settlement
  discount; credit/return refusals also at draft save; applying credit to / refunding a history document
  refused; a note/return dated pre-opening against a posted document is itself history; the importer
  accepts and ignores a "Before opening" column (history always decided from the date).
**Build work still open (see Progress.md live briefs for order)**
- R10 follow-ups: .xlsx import/export and PDF export need a package install (Q16: name each package + size, ask first).
- Pre-opening HISTORY: BUILT (F, 22 Nov); F2 RULED 22 Nov (S18-3), ready to build. Still to build: back-dating confirm on every dated entry (Q12) · GST per line (Q24) · round-off line (Q23). The full order is in `book-buddha/BUILD_PLAN_S18.md`.
**From todos.md (seeded 14 Nov; may be stale)**
- FD §H listed as open: archive scope; auto-record payment on a bank match; whether the Uncategorized account is auto-created or named by the owner (section header says closed — confirm).
- Subscriptions deferred (S1-5). Outside advisers: CA (principal vs agent on magazine resale, GST timing, "Exempt" scope); lawyer (buyer personal data under DPDP Rules 2025). The old todos.md build order is superseded by HOT.md.
**Open spec conflicts and technical decisions**
- Rounding: whole rupee (DD §7.4, PRD) vs exact paise (ANTI §4, TEST §5.3). Tax placement: per-line GST (DD §13.1) vs invoice-level (prototype).
- Reports count: 8 in BP vs about 17 in DD §12. Archive scope: v1-skip (DEC Q7) vs v2 (DD §1.5/§17) vs V1 (FD/H13). M4 challan↔invoice link: pending (DEC) vs decided (DD §11.4).
- Tech stack (TS + Fastify + SQLite + React) never formally confirmed. Desktop packaging: Tauri vs Electron undecided; how it installs for a non-engineer. PDF extraction library: pdfplumber/Camelot are Python, prototype is TS. OCR: Tesseract vs PaddleOCR; whether cloud OCR is allowed.
- Who builds: Sonnet builds, Opus reviews (ANTI §5), proposed not owner-confirmed. Test basis: fixtures partly answered by Vitest tests. Prototype roles: admin/accountant/viewer vs Phase-1 admin-only (DD §15.1).
- Canonical repo path: docs say D:\dhruv-book-accounting-app\Book-Buddha-github; this checkout is C:\Users\Admin\Desktop\Book Buddha — confirm which. Build status: docs say nothing built; HOT shows a working prototype. Prototype cancel: claimed as reversal, unverified.
- `testing/testing.md` is a stale draft (says DD §5 unwritten; calls a fair a tag). Phase 2 design open: invoicing-user login and recovery, permission matrix, tablet layout, LAN, connection drop (DD §2.4).

## Session decisions (harness convention, newest first)

- **S18-7 (2026-11-22) — TEN CALLS MADE WHILE BUILDING I-2 AND I-3 THAT HE HAS NOT RULED ON, and three
  gaps.** Each was surfaced by its builder and checked by the orchestrator; none is buried in the code.
  They stand until he rules, and a later session must not treat them as settled.
  **From I-2 (GST per line, invoice and credit-note round-off):**
  (1) A positive total UNDER 50 paise is not rounded to Rs 0 but left exact with no round-off line,
  because a zero-value invoice cannot post (`journal_lines` refuses a zero line) and the 3-paise
  tiny-sale tests depend on it. Documented at `roundToRupee` in `engine.ts`.
  (2) When earlier exact-paise notes have taken more than a rounded-DOWN invoice was worth, the note
  that completes the invoice posts a small DEBIT to the settlement account to put the paisa back;
  without it that entry would not balance.
  (3) `salesByTax` splits each posted entry across its rate groups, because journal lines carry no rate
  tag; where the posted figure differs from the computed one (a clamped note tax) it allocates by
  taxable share. A mixed-rate invoice shows in EVERY rate row it touches, but once in the totals.
  (4) Without an explicit `reversesInvoiceLineId`, a credit-note line matches by item and price; with no
  match it takes the document's single rate, and is REFUSED when the document holds several rates.
  **From I-3 (bill and expense round-off):**
  (5) The API field is optional with `.default(0)`, like `discountPaise`, so existing request bodies
  stay valid.
  (6) Two message texts: the API's names the range "(from -99 to 99)", the repository and engine's does
  not.
  (7) The round-off is set at CREATE time on the draft, like `discountPaise`. There is no edit route.
  (8) `purchaseEntry` refuses 100 or more, a fraction, or a non-integer, on top of the API check and the
  database CHECK.
  (9) `PurchaseEntryResult.totalPaise` stays the COMPUTED total; no round-off field was added to it.
  (10) `roundOffPaise` is REQUIRED on `PurchaseBillRecord` and `ExpenseRecord`, kept separate from
  `totalPaise`, which is what he asked for.
  **Three gaps — not failures, but NOT verified:** no cash-basis P&L case with a round-off · the v34
  backfill has never run against a real pre-v34 FILE database (the test builds a legacy-shaped invoice
  by hand) · `items.default_tax_rate_basis_points` exists with nothing reading it (I-Q2 is pre-fill,
  which is a screen concern, and this build was backend only).

- **S18-6 (2026-11-22) — I-Q6 CONFIRMED: round-off on bills and expenses, migration v35.** His
  words: optional · default zero · stored in whole paise · bills and expenses only · kept separate
  from existing document totals · old posted bills and expenses unchanged · no historical document
  re-rounded. Built as one SIGNED `round_off_paise` column on `purchase_bills` and `expenses`,
  capped below a rupee by CHECK (`> -100 AND < 100`) so the "under Rs 1" in I-Q6 is enforced by the
  database rather than trusted to callers. NOTHING is backfilled: existing rows keep 0 from the
  DEFAULT. Unlike an invoice (I-Q5) nothing is CALCULATED here - a bill carries only what the owner
  types, to match a supplier's printed total. Bills and expenses store no total (both computed on
  read), so this needs no equivalent of the invoice's `total_paise`.
  *Note:* this took v35, so R14 is now **v36** - a migration takes the next free number in the order
  it is actually built.

- **S18-5 (2026-11-22) — HIS RULINGS ON THE FOUR QUESTIONS I-1 NEVER ASKED (I-Q11..I-Q14).** These came
  out of reading the LIVE code before writing the I-2 brief: the I-1 mini-spec answered its own questions
  1-3 and 6 but never recorded 4 (the v34 migration) or 5 (the read-path inventory). Each was put to him
  with a recommended default and he took the recommendation in all four.
  - **I-Q11 — the Round off account must NOT inflate sales.** `salesByTax` net sales
    (`reports-sales.ts:205`), the credit-note report's taxable figure (`:336`) and P&L gross sales
    (`repository.ts:3664-3670`) all select `ca.type = 'INCOME'`, so a new income account would be counted
    inside reported sales. RULED: ROUND_OFF stays a signed INCOME account as ruled in I-Q7 and is
    EXCLUDED from those three aggregates. **Mechanism corrected 22 Nov, same day:** he first approved
    "its own role", but `V9_ACCOUNT_ROLES` is frozen and the role CHECK is built from it, so a new role
    would mean REBUILDING `chart_accounts` and replaying every trigger that mentions it, on real data,
    for a reporting exclusion. He then ruled: exclude it BY CODE, through the single exported
    `ROUND_OFF_ACCOUNT` constant, exactly as ROUNDING and STOCK_ADJUSTMENT are handled. v34 stays
    additive. Reported sales stay exactly as they are today; the rounding appears as its own P&L line.
  - **I-Q12 — the rounded total is STORED, never recomputed.** The invoice total is computed in four
    places today: `open-items.ts:90-91` (raw SQL; feeds receivables, customer statements and ageing),
    `repository.ts:4677` (`invoiceTotal`), `repository.ts:217` (`templateTotalPaise`), plus the bill and
    expense mirrors at `:5730` and `:6573`. The cash view also uses the total as its p/T denominator
    (`:3932`). RULED: v34 stores `round_off_paise` AND the rounded total on the invoice row, and all four
    readers use the stored figure. One extra column, and a receivable can never disagree with the ledger.
  - **I-Q13 — the tax type/rate coupling moves to the LINE.** `api/server.ts:179-184` refuses a tax type
    paired with a 0% rate, which blocked the exempt 0% lines approved in I-Q9. RULED: the document keeps
    the tax TYPE (place of supply), each LINE keeps its own rate, a 0% line is ALWAYS allowed, and an
    invoice that has a tax type but only exempt lines is allowed.
  - **I-Q14 — a note or return line LINKS to the line it reverses.** `credit_note_lines` and
    `purchase_return_lines` carry no rate of their own, and bill-return lot matching keys on
    (item, unit price) (`repository.ts:6279-6286`), which stops being unique once one item is sold at two
    rates. RULED: each credit-note and purchase-return line links to the invoice or bill line it reverses
    and takes THAT line's rate; the lot key gains the rate so matching stays unique.
  *Recorded with it, no decision needed:* `credit_notes.refundable_paise`
  (`customer-credits-schema.ts:184-185`) is a STORED total fixed at finalize, so the round-off has to be
  in it at write time or it goes stale.

- **S18-4 (2026-11-22) — I-Q4 IS OPEN, NOT RULED. GST JUDGMENT PENDING.** His answer was "use the
  recommended pro-rata treatment, pending GST confirmation", followed by: "record I-Q4 as pending CA/GST
  confirmation. Do not implement the pro-rata GST treatment as if it were legally confirmed. Use the
  approved test behavior only until confirmed." The pack's own default carries the same caveat
  ("*GST judgment: please confirm with Puneet / Manish*"). So a discount or freight/extra charge on a
  mixed-rate document is spread PRO RATA over the lines, each rate charged on its share — built as TEST
  BEHAVIOUR ONLY: reversible, and marked in the source as resting on an unconfirmed GST reading.
  **Only Puneet's or Manish's confirmation, recorded here, closes this.** No agent's reading of the GST
  rules closes it, and I-Q4 must not be cited as settled anywhere.

- **S18-3 (2026-11-22) — HIS ANSWERS TO THE SESSION 18 REVIEW PACK.** His words: "I approve the
  recommended defaults." All sixteen answers are the pack's own recommended default; nothing was varied.
  Question text and hand-worked figures stay in `book-buddha/REVIEW_PACK_S18.md`.
  **B1 — GST per line + rupee round-off (I-1 mini-spec, v34):** I-Q1 rate per LINE on invoice,
  credit-note, bill, return and recurring-template lines; tax TYPE stays per document (place of supply);
  an old document's rate is kept only as the fallback for lines that state none · I-Q2 item master gets
  an optional default GST rate, PRE-FILL ONLY, never changes posted documents · I-Q3 tax rounded PER RATE
  GROUP, not per line (ties to the GST return) · **I-Q4 OPEN — see S18-4** · I-Q5 round-off on invoices
  including cash invoices: nearest rupee, 50 paise and over rounds up · I-Q6 round-off on bills and
  expenses is an OPTIONAL typed amount under Rs 1, DEFAULT 0 · I-Q7 a NEW signed income account
  "Round off"; the existing "Rounding" account stays cash-view-only and nothing posts to it · I-Q8
  partial credit notes in EXACT PAISE, and only the note that completes the invoice reverses the
  round-off · I-Q9 exempt (0%) lines allowed on a taxed invoice, shown separately in the GST summary ·
  I-Q10 old invoices NEVER re-rounded, posted figures stand, round-off 0.
  **B2 — installs approved (Q16-1, hard rule 2):** Q16-a YES to SheetJS `xlsx` 0.20.3 from
  cdn.sheetjs.com and pdfkit 0.21.0, with `@types/pdfkit` dev-only · Q16-b YES, PDF for those 9 reports;
  the other 10 lists get .xlsx only · Q16-c print "Rs" in headings and plain numbers, NO extra font file
  (pdfkit's built-in font has no rupee glyph) · Q16-d PDF tests with NO extra package: write test PDFs
  uncompressed and check the totals appear in the text. **Approved but NOT yet installed.**
  **B3 — R14 (v35):** "approve the recommended Active / Inactive rule and all defaults" — R14-Q1
  customers, suppliers, items, fairs AND chart accounts (one rule everywhere) · R14-Q2 stands as ruled in
  S18-2, two states only · R14-Q3 open drafts/quotations BLOCK · R14-Q4 a draft whose customer went
  inactive can still be saved but cannot be finalized until the customer is reactivated or changed ·
  R14-Q5 a fair is "ended" when its end date has passed, and a fair with no end date cannot be made
  inactive until one is set · R14-Q6 an import row naming an inactive customer is REJECTED with
  "reactivate first", history rows before the opening date still allowed · R14-Q7 any signed-in user may
  do it and the audit log records who · R14-Q8 a recurring invoice whose customer went inactive is
  SKIPPED with a note, the other templates still run. **Read the pack's B3 with S18-2 in force: wherever
  it says "archive"/"archived", that now means making the master INACTIVE — there is no third state.**
  **B5 — F2 RULED:** "require confirmation for overlapping opening sets and reversing the last set." Both
  doors warn with a count and require an explicit confirm; documents already posted are left alone; the
  history flag stays frozen.
  *Still not answered, not blocking the build:* Part C's five "calls made without you" (due at REV),
  reports 7d and 8c accepted on trust with no hand check, and R6 with no recorded status in any source.

- **S18-2 (2026-11-22) — HIS RULING ON "INACTIVE" (R14, replaces R14-Q2 default):** "No Inactive shall
  mean user cannot carry out any work on it! They need to be activated - they are not visible only on the
  UI but exists." So INACTIVE = hidden from the screens and frozen: NO work of any kind until it is
  activated again. The record stays in the database. Follow-ups ruled the same day: (a) making a master
  Inactive is REFUSED while anything is open on it (balance incl. opening, open credit/refund, stock on
  hand, draft/quotation, active recurring template, un-ended fair, hosted live fair). (b) TWO STATES ONLY:
  Active / Inactive; no "Archived" (replaces FD §F's third state). (c) Past invoices and payments KEEP
  showing in reports for old periods, so the books tie. R14 = make the existing `active` flag real (add it
  to fairs; chart accounts keep their own guards), not a new status column.

- **S18-1 (2026-11-22) — HIS RULING ON THE S17-10 EDGE: "refuse it".** A bill discount EQUAL to the stock
  value on an all-stock bill (nothing payable) is REFUSED AT SAVE with: "The bill discount equals the whole
  bill, so nothing is payable. Record free stock as a stock adjustment instead." Option (b), a nil bill, is
  rejected. **BUILT 22 Nov:** refused when payable = 0 (lines − discount + extra charge ≤ 0), at create
  and at finalize; there is no draft-edit door for bills. The old test pinning "saves but cannot post" was replaced.

- **S18 (2026-11-22) — ASKED; ANSWERED 22 Nov — now ruled, see S18-3 and S18-4 above.** The I-1 mini-spec (GST per line + round-off, I-Q1..10),
  the Q16 installs (SheetJS 0.20.3 from the CDN + pdfkit 0.21.0, Q16-a..d), and the R14-1 mini-spec
  (archive, R14-Q1..8) were put to him with their recommended defaults. The full text and the
  hand-worked figures are in `book-buddha/REVIEW_PACK_S18.md`. Two research findings: customers,
  suppliers and items ALREADY have an `active` flag, though no document door checks it; and the
  `ROUNDING` account is cash-view only, so the plan is a NEW `ROUND_OFF` account. Migrations stay
  v34 = I and v35 = R14. **Superseded 22 Nov:** v35 is bill/expense round-off (I-Q6, confirmed and
  built) and R14 moved to **v36**, because I-Q6 was confirmed first and a migration takes the next
  free number in the order it is actually built.

- **S17-13 (2026-11-22) — HIS RULINGS FOR THE REMAINING PLAN.** (1) G back-dating tests: the app gets a
  settable "today" (clock); each test pins its own month — the October ACCEPTANCE test may change its
  SETUP only (pin today), never figures or request bodies. (2) D's expenses-import defaults KEPT as built
  (blank payment account → Payables if a supplier is named, else Cash; one amount per expense).
  (3) Old React screen `web/src/App.tsx`: remove the invoice-number and credit-note-number boxes as a small
  fix (like Q22); no other screen work. Full plan + briefs: `book-buddha/BUILD_PLAN_S18.md`.

- **S17-12 (2026-11-22) — HIS RULINGS ON F (pre-opening history): his answers to the four questions
  below. The F plan's other defaults were NOT ruled by him: the frozen flag; a warning with a count
  before saving an opening set dated after posted documents; the same before reversing the last opening
  set. They are open as F2 in `book-buddha/BUILD_PLAN_S18.md` §1.**
  (1) A payment dated AFTER the opening date on a history invoice/bill is REFUSED: "record it as a receipt
  against the customer's / settlement against the supplier's opening balance". (2) A credit note or
  purchase return against a history document is REFUSED, pointing to the opening balance. (3) A history
  document CAN be cancelled: status Cancelled + audit event, posts nothing. (4) An opening-balance
  receipt/settlement dated ON or before the opening date is REFUSED ("already included in the opening
  balance") — was allowed on the date itself.

- **S17-11 (2026-11-22) — HIS RULING: Progress.md ≤ 60 LINES (WHOLE FILE); Testing.md ≤ 200 LINES,
  STRUCTURED/TABULAR.** "I said 50 is the upper limit, raising it now to 60, rest transfer all the test
  details to Testing file … keep that under 200 lines only." He chose whole-file (not summary-only).
  Progress.md = summary + the live briefs of the current session only (one or two lines each); test
  details → Testing.md (tables); slice definitions → architecture.md; rules/lessons and open spec
  questions → decisions.md; closed briefs dropped (git history keeps them). CLAUDE.md rule 10 updated.

- **S17-10 (2026-11-22) — HIS RULING: A BILL DISCOUNT LARGER THAN THE BILL'S STOCK VALUE IS REFUSED**
  ("Refuse it"), instead of spilling the excess to Discount received. Follows from S17-7 (discount is on
  stock items only), so a discounted bill with NO stock lines is refused too (stock value 0) — told him.
  Built after S17-E leaves repository.ts. **Agreed messages (400, shown on screen):** (1) "The bill discount
  (Rs 800.00) is more than the value of the stock items on this bill (Rs 700.00). A bill discount applies to
  stock items only — lower the discount or check the lines." (2) No stock lines: "This bill has no stock
  items, so it cannot carry a bill discount. A bill discount applies to stock items only." Checked at save
  AND finalize.

- **S17-9 (2026-11-22) — HIS RULINGS: NUMBER FORMAT + OCTOBER TEST LABELS.** (1) Format `INV-001/25-26`
  (TRF style), per business, restarting each financial year; prefixes INV, QUO, CN, PR (RV/PV/TRF already
  built). (2) **The October ACCEPTANCE test may be edited for LABELS ONLY** — typed numbers removed for
  app-created documents (4 invoices, CN-001, PR-001) and the app's numbers expected (e.g. INV-004/25-26);
  every approved figure unchanged; PB-001/PB-002/EXP-001 keep their own numbers.

- **S17-8 (2026-11-22) — HIS RULING: AN APP DOCUMENT GETS ITS NUMBER WHEN FIRST SAVED** (not at finalize).
  Offered: finalize keeps the GST series gap-free (drafts can't be deleted, so an abandoned draft keeps
  its number); he chose first save. Completes S17-4.

- **S17-4 (2026-11-22) — HIS RULING: NO MANUAL NUMBERING; THE APP NUMBERS WHAT IT CREATES (replaces
  S16-9(2)).** His words: "app shall give normal numbering only but screen will have an option to open the
  linked quotation … No manual numbering in the app anywhere where a doc is been created else it may
  disturb the accounting flow." And: "App given number only on document created through the app, all
  rest identified from their respective document number only." So: (a) documents the app ORIGINATES get
  the next number in the app's series (quotation conversion and recurring runs included; the "refuse a
  taken number" path and the optional `number` on convert go away); (b) an invoice made from a quotation
  stores a LINK to it (backend: the quotation id on the invoice, readable both ways) so the screen can
  jump to it; (c) documents that originate ELSEWHERE keep their own number — imported past documents keep
  their old number; a supplier's bill is identified by the supplier's own bill number (typed from the
  paper). Orchestrator's reading, to confirm at the mini-spec: series = `TRF`-style `<PREFIX>-001/26-27`
  per business per financial year (reuse `nextDocumentNumber`); number given at FINALIZE (no gaps from
  deleted drafts, GST practice), drafts unnumbered; expenses follow the supplier-bill rule (vendor's
  receipt number).
- **S17-5 (2026-11-22) — HIS RULING: Q16, Q17, Q18, Q23 AND THE 2 SLOW TESTS JOIN THIS SESSION'S AIM**
  ("Then let's aim to complete this too!"). Q16 installs still need each package named + sized and his yes.
- **S17-6 (2026-11-22) — HIS RULINGS: R13 = DIRECT METHOD ONLY; sections as proposed** — Capital, Opening
  Balance Equity, Loans → Financing; an asset account he creates asks for a section (default Operating);
  everything else Operating. Needs a per-account section setting (migration). S15-4 (OD/CC) and 12c
  (internal transfers are not cash flows) apply.
- **S17-7 (2026-11-22) — HIS RULING: BILL DISCOUNT IS ON STOCK ITEMS ONLY.** "The discount is assumed to be
  on stock items only and not for related expenses" — spread pro-rata by value across the STOCK lines only,
  per unit in whole paise, remainder on the last unit (Q1); non-stock lines keep their full price.

- **S17-1 (2026-11-22) — HIS ORDER: BUILD → REVIEW → TESTS (replaces "tests FIRST" in S16-11).** His
  words: "Build this pending work and then review and then write the tests." Builders still finish with
  tsc 0, the EXISTING suite green and the October ACCEPTANCE green; old-behaviour tests that an S16
  ruling deliberately reverses may be updated; an ACCEPTANCE test is never edited. New tests are written
  after the orchestrator's review. Step 1 (S16-9) shown to him again for review while the build starts.
- **S17-2 (2026-11-22) — HIS RULING: NO SUB-CUSTOMER LIST/REPORT FOR FAIR BUYERS.** "As fair comes under
  Project feature of our app, hence, No sub-customer wise report needed for customers under project."
  Closes the open half of S16-9(3). Buyer name/contact on each fair invoice stays as recorded.
- **S17-3 (2026-11-22) — HIS RULING: R14 (archive) ONLY IF R13 IS COMPLETED THIS SESSION.** Otherwise
  stays deferred (S12-4). Told him the backend list also holds Q16 (.xlsx/PDF, install), Q17 expenses
  import, Q18 every report exports, Q23 rupee round-off line, plus the 2 slow tests — all verified
  unbuilt in the code on 22 Nov; asked where they fit.

- **S16-11 (2026-11-21) — HIS ORDER FOR SESSION 17.** Aim: "complete the full backend in next session,
  with all or little pending tests". Order: (1) first he completes the "taken invoice numbers refused"
  change (S16-9; already committed 1196954 and pushed — ask him what is left); (2) then the tests for the
  work not built yet (S16 slice, bill discount, GST per line, cash flow) and the two slow tests to watch;
  (3) then build those features. R10 leftovers (.xlsx/PDF need an install, expenses import) are not in
  his list — ask where they fit. R14 archive stays deferred (S12-4).
- **S16-10 (2026-11-21) — HIS RULING: THE SEVEN PARKED ACCEPTANCE SLICES ARE CLOSED.** His words: "Close
  those slices for now! As acceptance tests were already done." **R1, R2, R4, R4b, R5, R7, R8 are
  ACCEPTED** under S12-1 (accounting logic is the bar) on the S16 evidence: the all-together run S12-3
  asked for (1,060 tests green) and the October 2025 end-to-end ACCEPTANCE test on his approved figures
  (S16-5), green on both bases. Offered first and declined: a slice-by-slice map to the test proving each.
  "For now": anything found later is a defect (S12-1), not a re-opened slice. The "figures unconfirmed"
  labels on the R4/R4b ACCEPTANCE tests are removed; no figure changed. R3, R4c stay hand-verified;
  7d, 8c stay on trust. **No acceptance backlog remains** ("No backlog probably should now remain"): the
  slices built after the pause and marked "parked" (R9 documents, R10 import/export, R11 backup, R12
  banking, §13 reports 1–6, S10-4 write-down) were in the same all-together run and are closed on the
  same basis — told to him in the same turn, to object if he wants any re-opened. He also asked that no
  temporary files remain.
- **S16-9 (2026-11-21) — HIS ANSWERS ON S16-8.** (1) **Supplier payments follow S16-7(3)** — a supplier
  payment cancelled in a later month leaves the earlier month alone: CONFIRMED as built. (2) **A taken
  invoice number is REFUSED, never renumbered** ("Refuse, I'll number it"): quotation conversion now takes
  an optional `number` (default `INV-<quotation number>`) and refuses a taken one; a recurring run whose
  number is taken is refused and reported as that template's failure (its next run date does not move).
  This REPLACES S16-8(3). (3) **Fair sales stay under the fair's host customer**; his words: "Host
  customer and book sold to each already enables app to collect data of customers at that time so those
  will be sub customers" — the buyer recorded on each fair invoice (buyerName/buyerContact) is a
  sub-customer of the host. Whether that needs its own sub-customer list/report is NOT yet asked — ask
  when the fair/customer screens are planned. S16-8(2), (4), (5) needed no ruling (no real alternative).
- **S16-8 (2026-11-21) — MY CALLS IN THE DEFECT FIXES, AWAITING HIS CONFIRMATION.** Built while fixing
  D1–D16 (all 16 now fixed; 1,059 tests green). (1) **S16-7(3) extended to SUPPLIER payments:** a supplier
  payment cancelled in a later month also leaves the earlier month alone (cash P&L shows the take-back in
  the cancel month) — same principle, same code path. (2) **Document cancelled after its payments were
  cancelled:** the cash view takes back whatever is still recognised on the document's cancellation date
  (without it, that sequence threw a rounding error). (3) **D11 numbering helpers:** quotation conversion
  and recurring invoices now pick the next FREE number (`INV-<n>`, then `-2`, `-3`) instead of failing; an
  imported duplicate is a FAILED row. (4) **D5:** cancelling a credit note takes back the note's OWN
  restored lot first (like a purchase return from its bill's lot); refused if that lot has gone out again.
  (5) **D12:** deactivating any CASH/BANK account with a non-zero balance is refused on the generic route
  too, with the bank route's wording.
- **S16-7 (2026-11-21) — HIS RULINGS: D9, D11, D16 (answered in one go, all as recommended).**
  (1) **D9, cash basis, purchase return:** the part set against an open bill lowers what is still owed
  from the return date (months already reported never move); the part already paid (a supplier credit)
  is recognised as a negative on the **refund** date — "June, refund month". Mirrors customer credit notes.
  (2) **D11, invoice numbers:** unique **per business**; a **cancelled invoice keeps its number** (no reuse,
  GST practice); quotations are a separate series. No DB unique index this pass (scan data first).
  (3) **D16, cancelled payment on cash basis:** **closed months never change** — January keeps its 100 and
  the cancellation month shows −100. **This REPLACES S8-1's retroactive vanishing** for the cash P&L.
  S13-1 (no customer-statement row for a cancelled payment) is a statement rule and is NOT changed.
- **S16-6 (2026-11-21) — HIS RULING: CASH-BASIS OCTOBER CHECKS STAY AS A KNOWN DEFECT.** His words:
  "Keep as known defect". The October acceptance test (`src/e2e/october.e2e.test.ts`) matches every
  approved figure except the cash-basis P&L, which the app refuses for these books (400 "out of
  tolerance: 1,800,000 moved, 1,650,000 recognised" on PB-001 — a purchase return on a PAID bill
  breaks the cash view; same root as known defect D9, wider). The two cash cases (net 11,750; R2's 0
  for 1–7 Oct and 11,800 to 8 Oct) stay `it.fails` with the approved figures unchanged; they go red
  when the fix lands, then flip to `it`. Recommended as the first defect fix. Still open: whether
  walk-in buyers at a fair are booked under the host (the app requires it, repository.ts:4858; no
  figure changes) — the workings' "walk-in customer" wording waits on his yes.
- **S16-5 (2026-11-21) — HIS RULING: OCTOBER END-TO-END FIGURES APPROVED.** `book-buddha/E2E-WORKINGS.md`
  sections 2–5 approved as written ("approved your given figures"): TB 123,860 · HDFC 71,966 · Cash
  8,550 · Receivables 5,000 · Inventory 15,550 · accrual profit 13,850 · cash profit 11,750 · BS
  102,110. With them, as recommended: customer-returned stock goes to the BACK of the FIFO queue at
  original cost; stock returned to a supplier leaves from that bill's OWN lot. He then asked that the
  external audit reports in `Desktop\Book Buddha Accounting Audit\` (all but the screen plan) be read
  by Haiku workers so the October test can also cover any real gaps they name.

- **S16-4 (2026-11-21) — HIS RULINGS: THE 26-QUESTION ROUND.** (Q-numbers from the session-16 list.)
  **Bill discount (unblocked):** Q1 spread across units in whole paise, remainder on the LAST unit
  (7 × Rs 100 less Rs 150 → 6 at 78.57 + 1 at 78.58 = 550.00). Q2 a discount ON THE BILL = trade
  discount, reduces stock cost; a discount taken AT PAYMENT = settlement, booked as "Discount
  received" income.
  **R12 calls, all confirmed as built:** Q3 over-payment match refused (use Add) · Q4 rules never target
  Uncategorised · Q5 Add/Split/Uncategorise post RV/PV vouchers · Q6 an empty re-import still logs an
  import row + audit event · Q7 a document match gives the line the document's business · Q8 posted-line
  matches exact amount only · Q9 rule delete is a hard delete, audited · Q10 a transfer rule can't target
  its own bank · Q11 matched money is cancelled by undoing the bank line first.
  **S16 slice details:** Q12 back-dated = dated in an EARLIER CALENDAR MONTH than today (credit-note rule,
  everywhere) · Q13 history items show in party history and document lists marked "Before opening",
  excluded from every total and report · Q14 add to S16: restore writes an audit event; zero-cost
  write-down checks the FY lock · Q15 stock comes in only via a bill, opening stock or a "stock
  adjustment" posting Dr Inventory / Cr Stock adjustment (closes S7-1(d)).
  **Imports/exports:** Q16 installs for .xlsx and PDF approved IN PRINCIPLE — name each package and size
  and ask again before installing · Q17 expenses import IS in V1 · Q18 every report exports (P&L, BS,
  six §13 reports).
  **Housekeeping:** Q19 the other session's work (3 commits on 19 Nov, none since: /status skill, IMPLEMENTATION_PROGRESS
  write-up, report-routes brief) — **KEEP IT** (closes S13-3) ·
  Q20 keep base64 uploads (S11-19 closed) · Q21 backend-only through R13, then screens · Q22 minimal
  update of `web/src/App.tsx` for the v22 stock types approved.
  **Older spec:** Q23 books keep exact paise; invoice total rounded to the rupee with a "Round off" line ·
  Q24 **GST PER LINE** — mixed rates on one invoice happen (larger change; plan it as its own slice) ·
  Q25 packaging decided later, Tauri the lean choice · Q26 two people work on this from separate PCs;
  both repo paths are right — ignore.

- **S16-3 (2026-11-21) — HIS RULING: REPEATED PAYMENTS IN IMPORTS (replaces S16-1(b)).** Equal
  payments (same document, amount, date) WITHIN ONE FILE all import. An equal payment already in
  the books from an EARLIER file is skipped as a duplicate (re-import stays safe). Add a small
  banner showing the last import date so the user sees what was already brought in. The S16 rulings
  form one backlog slice ("S16 slice"), to be planned before building.

- **S16-2 (2026-11-21) — HIS RULINGS, round two (not yet built).**
  (a) **On-account documents can't name a bank — KEPT.** The bank goes on each payment.
  (b) **Editing a document never changes its money account unless the user sends a new one** — "bank
  changes only if user wills to". Aim: keep the app generic. Fixes Builder B behaviour 3.
  (c) **Pre-opening-date payments: warn, don't refuse** — he wants the history (documents, payments,
  details) visible in the app, not only an opening balance. OPEN RISK raised with him: posting them
  counts them twice against the opening balances. **HIS RULING: "Yes, history only."** Items dated
  on/before the opening date are kept as HISTORY: visible, linked to party/fair, searchable, marked
  "before opening date", NEVER posted to the journal. Opening balances stay the books' only figure.
  Applies to imported documents too (softens S14-3(2) from refuse → keep as history).
  (d) **Back-dating warning EVERYWHERE**, not only credit notes. Current rule (credit notes,
  `finalizeCreditNote`): an entry dated in an earlier calendar month than today needs an explicit
  confirm. Extend the same rule to every dated entry; imports show it per row in the preview.
  Supersedes S16-1(d), which is now part of this.

- **S16-1 (2026-11-21) — HIS RULINGS ON OPEN ITEMS (not yet built).**
  (a) **Refund account is the user's choice.** A credit note / purchase return on a document paid at
  once into a bank may refund through ANY money account the user picks — not forced to the original
  bank (overrides Builder B's behaviour 1). Proposed: default = the original account, user may change.
  (b) **Repeated payments must all import** — "that's not necessary" (to collapse them). Re-run safety
  is kept by the 12e occurrence rule: the k-th equal payment in a file is skipped only when ≥ k already
  exist (proposed; to confirm).
  (c) **Attachment upload/delete must write an audit event** (closes S13-2).
  (d) **Purchase-return back-dating needs a warning**, like credit notes (closes S11-21).
  (e) `context/AGENT_BRIEF_R9_ROUTES.md` deleted on his instruction (untracked, never committed).
  Still open, explained to him: Builder B 2 and 3; R10 choices 2 and 3; the R12 set-two calls.

- **S15-6 (2026-11-21) — HIS RULING: ONE COMMIT POINT FOR ALL OF R12.** "No commit, full R12
  altogether." Set one (12a–12d) stays UNCOMMITTED in the working tree; set two (12e–12g) is built
  on top; commits are announced once, when 12a–12g are all reviewed and green.
- **S15-5 (2026-11-21) — R12 SET ONE (12a–12d) BUILT, REVIEWED, WIRED.** Four Sonnet builders in
  parallel; orchestrator re-ran each, wired migrations v25 bank_accounts / v26 money_movements /
  v27 bank_reconciliations and the routes, wrote `src/banking/r12-set-one.e2e.test.ts` (HDFC
  October end to end over HTTP). Gates: tsc 0 · 919 tests / 76 files · vite 1.18s. Open for him:
  three behaviours Builder B added unasked (see Progress.md → 12b status).
- **S15-4 (2026-11-21) — HIS RULING: OD/CC.** Borrowing by default; Balance Sheet = current
  borrowing/liability. Cash flow: an overdraft counts as cash only if repayable on demand AND part
  of everyday cash management; a cash credit does not qualify merely for being short-term. Built
  as chart type LIABILITY + role BANK; `bank_accounts.part_of_cash_management` defaults 0 for
  OD/CC, 1 for current/savings, set by the user, audit-logged.
- **S15-1..3 (2026-11-21) — HIS RULINGS: R12 SCOPE.** (1) "R12" means the QBO bank categorisation
  (12e–12g); 12a–12d are its foundation, built first. (2) A payment can go through ANY cash or bank
  account, with a payment mode (NEFT, RTGS, UPI, …, editable list). (3) Transfers are named
  **Internal Transfers**. Delivery: two sets, briefs first, builders released together, orchestrator
  reviews each set; every brief names the tests to pass; builders loop until green.

- **S14-4 (2026-11-20) — R10 IMPORT/EXPORT BUILT, NOT PUSHED.** Four commits: `9037872` codec,
  `098ce15` exports, `d2fa92b` import engine + masters + documents + routes, `aecc96a` end-to-end
  checks. Gates on the final tree: tsc 0 · 856 tests / 64 files · vite 1.23s; migration still v22.
  Orchestrator choices awaiting his confirmation: equal payments in one file import once; payments
  also refused on/before the opening date; imported credit notes auto-confirm back-dating. Not
  built: .xlsx/PDF (install), expenses import.

- **S14-3 (2026-11-20) — HIS RULINGS FOR R10 IMPORT.** (1) Imported past invoices and bills are
  **posted** (finalized on their own dates), not left as drafts. (2) A document dated **on or
  before** the opening-balance date is **refused** and listed — it would count twice against the
  opening receivables/payables. (3) An imported invoice line naming an item **reduces stock** by
  FIFO like a normal invoice (short stock → that invoice refused). (4) A customer/supplier whose
  name or GSTIN already exists is **skipped and listed**. He asked about creating sub-customers
  instead; that would change the finished customer slice (schema), so the recommended option
  stands. Also set by the orchestrator, not him: a failed document is skipped and collected
  (spec §14.1 wins over the finishing plan's "atomic"); the unit of atomicity is one document;
  dates use the format chosen in the column map, never guessed; CSV + JSON only (xlsx/PDF =
  install, ask). Full design: Progress.md → Definitions → R10.

- **S14-2 (2026-11-20) — HIS RULING: R13 CASH FLOW STATEMENT COMES AFTER THE ALL-TOGETHER TEST
  RUN.** He spotted that R13 was missing from Progress.md's slice table. It is not built (only the
  account-class groundwork exists, `chart-accounts-schema.ts`). The S12-3 standing order stops at
  R12, so asked whether R13 joins the build before testing: **no**. Order stays R10 → bill
  discount → R12 → test everything together → **then R13**.

- **S14-1 (2026-11-20) — HIS SETUP: ORCHESTRATOR AND WORKERS, CLOSED CONTEXT FOLDER.** Main
  session plans, briefs and checks; Sonnet/Haiku workers; context folder closed to ten files;
  `Progress.md` (≤50-line summary + working area) auto-loaded with HOT; CBM first for all agents.
  Nine leftover context files merged into Progress.md and removed. Autocompact left at 300K by
  his choice. Commit `b81cdcf`.

- **S13-5 (2026-11-19) — PAUSED BY HIM, NOTHING HALF-BUILT, EVERYTHING PUSHED.** Session 13 built
  and pushed six slices: reports 1–3 (`9cd1838`), report 6 (`cf84fe9`), routes for all four +
  `getReceivables` fair filter (`9cd503c`), R9 attachment routes 2–5 (`fa4ab42`), S10-4 stock-entry
  correction / v22 (`2cb332f`), R11 backup-verify-restore (`2952c28`). Final tree: tsc 0 · 714
  tests, 56 files · vite built. Resume at **R10 import/export, design first.**

- **S13-4 (2026-11-19) — MY CALL: R11 BUILT BEFORE R10.** R10 needs a shared import → review →
  post engine designed before any code; R11 was self-contained and low accounting risk, so it ran
  in parallel with stock correction instead. Same scope, order swapped. Restore has **no HTTP
  route on purpose**: replacing the open database belongs to the app shell (`src/backup/backup.ts`
  header). Restore never overwrites — it takes a pre-restore backup, moves the old file aside,
  migrates, re-verifies, rolls back on failure. "Sanitise settings" turned out to mean only
  discarding saved sign-in sessions; the schema has nothing else to sanitise and no logo.

- **S13-3 (2026-11-19) — FINDING: A SECOND CLAUDE SESSION COMMITS IN THIS SAME CHECKOUT.** Between
  23:09 and 23:10 it made `6e0369e` (/status skill), `a5c20cb` (IMPLEMENTATION_PROGRESS write-up)
  and `7d3d71e` (committed my in-flight routes brief "as a plan"). No collision this time; two
  sessions committing in one working tree can. **Ask him whether it is his and should continue.**

- **S13-2 (2026-11-19) — FINDING FOR HIM: ATTACHMENT UPLOAD AND DELETE WRITE NO AUDIT LOG.**
  `storeAttachment` / `deleteAttachment` leave no tamper-evident trace, and the audit log is a
  fixed part of this product. Deliberately NOT added by the build agent — it is his call. Also:
  `createdBy` is stored null (the signed-in user is not yet passed to the engine).

- **S13-1 (2026-11-19) — DEFINITIONS INCONSISTENCY, RESOLVED BY THE RULES: A CANCELLED PAYMENT HAS
  NO STATEMENT ROW.** The hand table in `REPORT_DEFINITIONS_S12.md` §1 said the cancelled 11 Apr
  receipt shows "both rows netting to nil"; the same section's row rules (and `getReceivables`)
  say a cancelled payment never settled anything and is excluded. The rules were followed; the
  balance is 18,000 either way. Also found: `getReceivables` never had the fair filter 0a said it
  would get "for free" — added in `9cd503c`, behaviour without a fair unchanged.

- **S12-7 (2026-11-19) — PAUSED MID-SLICE, NOTHING HALF-BUILT.** He asked to pause. The four
  remaining §13 reports (customer statement, balance detail, collections, item profitability) are
  **fully specified and not yet coded**. The Sonnet build agent was dispatched and died at its
  first step on the account's 5-hour rate limit, **writing nothing to the repo** — verified with
  `git status`. So the resume point is clean: start the build, do not look for partial work.
  Brief: `context/BRIEF_customer_reports.md`; spec: `context/REPORT_DEFINITIONS_S12.md`.

- **S12-6 (2026-11-19) — MY FINDING, NOT HIS RULING: A `SALE` STOCK ROW IS NOT ALWAYS AN INVOICE,
  AND A CANCELLATION IS DATED THE DAY IT HAPPENS.** Read out of `repository.ts` before coding
  report 6, because the definitions flagged it as unverified. `consumeInvoiceStock` writes `SALE`
  under the INVOICE's id; `restoreInvoiceStock` (cancellation) writes `SALE_REVERSAL` under the
  **same invoice id**; `restoreCreditNoteStock` writes `SALE_REVERSAL` under the **NOTE's** id; and
  `cancelCreditNote` writes `SALE` under the **NOTE's** id. So a COGS query that assumes
  `movement_type = 'SALE'` implies an invoice will silently drop rows. Also: `cancelInvoice` stamps
  its reversal `entryDate: istDateOf()` — the cancellation day, never the invoice's date — which is
  why report 6's COGS tie-out is asserted **with no date filter only**. Written up in full as
  RESOLUTION R7 in `context/REPORT_DEFINITIONS_S12.md`.

- **S12-5 (2026-11-19) — A REAL DATING BUG WAS FOUND IN THE POSTED BOOKS AND FIXED (`fadb6c8`).
  HE SHOULD KNOW THIS ONE.** `saveDraft` dated an invoice that carried no explicit date by
  `new Date().toISOString().slice(0, 10)` — the **UTC** calendar — while the whole app's business
  date is **IST (UTC+5:30)**, a rule already written into `journal-dimensions-schema.ts`. An
  invoice entered between 00:00 and 05:29 IST was therefore stored a day early; `invoiceEntryDate`
  reads that column back, so the **posted journal entry**, the P&L period, the General Ledger and
  the ageing reports all carried the wrong day. Across 31 March the sale landed in the financial
  year that had just closed. Treated as a bug against an already-settled rule rather than an open
  accounting question, so it was fixed (`istDateOf()`) with three tests
  (`src/database/invoice-date-ist.test.ts`) rather than stopping to ask. **Two read fallbacks
  remain** (`repository.ts:1678` and `:2374`) that still default a legacy NULL `invoiceDate` to a
  raw `created_at` timestamp — not fixed this session, recorded here so it is not forgotten.

- **S12-4 (2026-11-19) — R14 (ARCHIVE A CLOSED YEAR) IS DEFERRED TO A FUTURE VERSION.** His words:
  *"R14 is not needed, mark it for future versions."* It leaves the V1 scope entirely. **The build
  target is now R12 (banking)**, with R13 (cash flow) immediately after it in the pasted order.
  Nothing in R1–R13 depends on R14, so this removes work without leaving a hole.

- **S12-3 (2026-11-19) — THE STANDING ORDER FOR EVERY SESSION, IN HIS OWN WORDS, AND ACCEPTANCE
  REPORTS ARE PAUSED UNTIL THE BUILD REACHES R12.** His words: *"Pause on acceptance tests, do the
  tests in the above prompt, then will continue with development work and build everything till R12.
  Then till R12 will run all the tests for pending ones and the newly build and check the backend
  end to end."* and *"Mark this for every session."*
  **So the order is fixed, and supersedes S11-14's "one acceptance slice at a time" pacing:**
  (1) BUILD through R12 in his pasted order — the five missing R7 reports, the attachment API,
  stock-entry correction, the bill-discount inventory treatment, CSV/JSON import-export, backup and
  restore with integrity checks, then banking; (2) ONLY THEN run every test together — the seven
  pending acceptance slices AND everything newly built — and check the backend end to end.
  **The seven outstanding acceptance reports (R1, R2, R4, R4b, R5, R7, R8) are therefore PARKED,
  not cancelled**, and R7's acceptance now waits on R7 actually being finished (S12-2).
  **S12-1 still governs HOW they are run when they resume** (accounting logic is the bar, Sonnet or
  Haiku writes the tests by complexity, I review every figure and run every gate myself).
  **One conflict in the pasted prompt, flagged not silently resolved:** it asks for UI alongside each
  slice ("Add repository, API, UI, and tests") and for the frontend at item 9, while
  `context/RESUME_PROMPT.md` records that he builds the frontend himself. His own "check the backend
  end to end" settles it for now — **backend first through R12**; the frontend items (9 and 10) sit
  past R12 and will be put to him when the build reaches them.

- **S12-2 (2026-11-19) — R7 IS NOT FULLY BUILT, AND WAS WRONGLY CARRIED AS "BUILT, ACCEPTANCE
  OUTSTANDING". FIVE OF THE §13 REPORTS DO NOT EXIST.** Found while building the backend status
  table he asked for. Built and reachable: A/P ageing, sales by item / customer / business / tax,
  credit-note report, sales-return report, stock movement, transaction detail by account,
  transaction list by date, open invoices, inventory valuation. **Absent, with no function anywhere
  in `src/`:** (1) **customer statements** — `getSupplierStatement` exists, the customer side never
  did; (2) **stock ageing**; (3) **item profitability**; (4) **Collections** (the only
  `invoiceCollections` in the repo is internal cash-view plumbing at `repository.ts:481`, not the
  report); (5) **Customer Balance Detail**. The item and customer FILTERS that `REMAINING_BUILD_PLAN.md`
  listed as missing ARE built. **Consequence:** R7 acceptance can only cover what exists; the five
  absent reports are new development, not acceptance, and must be re-planned as a slice of their own.

- **S12-1 (2026-11-19) — ACCEPTANCE NOW MEANS "THE ACCOUNTING LOGIC IS SATISFIED", AND THE TESTS
  THEMSELVES ARE DELEGATED TO SONNET/HAIKU BY COMPLEXITY, WITH ME REVIEWING EVERY FIGURE.** His
  words: *"From now on acceptance report shall be meant accepted if it satisfies the accounting
  logic rest will be figured out later. So you can use sonnet/haiku depending on complexity to do
  the acceptance tests and finish this backlog. You review the work done and output of acceptance
  yourself and close this backlog."*
  **What this changes from S11-14:** (a) acceptance no longer waits on HIS signature of each figure
  — a slice is accepted when the accounting is demonstrably right, and anything else found later is
  a separate defect; (b) **R8 is NO LONGER BLOCKED behind the discount slice (S11-1)** — its
  accounting logic (purchase returns, payment cancellation by reversal, bill discount as posted) can
  be accepted on its own, and the odd-paise remainder stays an open build question, not an
  acceptance blocker; (c) the model choice is mine to make per slice, and I review and run every
  gate myself. **What it does NOT change:** I still derive the expected figures from the accounting
  BEFORE looking at what the code returns (S11-14), and **an `ACCEPTANCE` test he has personally
  signed — R3, R4c — is still untouchable** (`CLAUDE.md`).

- **S11-22 (2026-11-18) — ITEM 16 / S11-11 BUILT AS A VISIBLE ROUNDING LINE ON THE CASH P&L, NOT AS
  A POSTED ENTRY. His words were not buildable literally, and this records why.** He said *"adjust
  automatically through a designated rounding account where necessary, ensuring the final
  transaction balances exactly. Never silently ignore discrepancies."* **There is no transaction to
  balance.** The gap lives ONLY in the derived CASH view; the posted ledger is already exact to the
  paise because `postJournalEntry` refuses an unbalanced entry. **Posting a journal entry to close
  the gap was rejected and must stay rejected:** it would be a posting created because a REPORT was
  run, carrying whatever date the report ran on, which breaks S1-6 (a reported month cannot move).
  So the adjustment belongs in the report. **His principle is honoured where the gap actually is.**
  **The mechanism, for whoever reads this cold:** a payment recognises each line as
  `round(line x paid / total)` (`allocateProportionally`, `accounting/engine.ts:351`). Each line is
  rounded on its own, so the shares need not sum to the cash that moved. **Worked by hand, not read
  off the code:** a Rs 118 invoice (SALES 10000, CGST 900, SGST 900 paise) part-paid Rs 50 gives
  4237 + 381 + 381 = **4999 paise against 5000 collected** — one paise short. It is
  self-correcting: `allocateProportionally` telescopes, so at full collection every line is exact.
  **His ruling, asked as a straight either/or with both reports drawn out: SHOW THE ROUNDING LINE.**
  Income and GST keep their true proportional shares and a visible `ROUNDING` line carries the
  difference, so the cash P&L ties to cash exactly. He rejected absorbing the paise into the
  largest line — that also balances and loses no money, but you cannot see it, and "never silently
  ignore" is his own phrase. The line vanishes once invoices are fully collected.
  **Three things the build must get right, each a trap:** (a) the account is ONE `ROUNDING` account
  and the amount is **signed** — the gap goes both ways (a Rs 118 invoice part-paid 7 paise
  recognises 8), so a negative rounding line is correct and must not be split into an income side
  and an expense side; (b) **the tolerance is checked PER DOCUMENT, never on the report total.**
  Each line can round by at most half a paise, so one allocation cannot be adrift by more than
  about half its line count — but a report covering many documents legitimately sums many such
  gaps, so a bound applied to the aggregate would fire on correct arithmetic. Beyond the per-document
  bound it is NOT rounding, it is a defect, and it must raise rather than absorb — that is the
  "never silently ignore" half; (c) it applies to **every document type in the cash view**, not just
  invoices: a bill's expense and input-GST shares are rounded the same way, and if they are left
  alone the cash view's expenses stop tying to the cash actually paid out.
  **Accrual basis is untouched** — it has no gap to close.

- **S11-21 (2026-11-18) — BACK-DATING INTO AN ALREADY-REPORTED MONTH IS ALLOWED, BUT NEVER
  SILENTLY.** He chose "allow it, but warn" over allowing it silently and over refusing it. The
  date he types is honoured; the app says plainly that it falls in a month already passed and that
  those figures will change, and he confirms. **Refusing was rejected for a reason worth keeping:**
  goods that genuinely came back in January must be recordable in January, and a rule that forbids
  it would make the books less true, not safer. **Silence was rejected because of S11-3** — "do not
  silently rewrite historical reports". **Backend shape, since there is no UI:** finalizing a note
  dated in a calendar month earlier than the current IST month is REFUSED unless the caller passes
  an explicit confirmation flag, and the refusal names the date and the month it will move. The
  same two-step shape as S11-7 (a bank match asks before posting). The financial-YEAR lock is
  unchanged and still absolute — this warning only governs an earlier month inside an OPEN year.
  **An inconsistency this creates, to put to him later:** a purchase return (v19) already carries
  its own date and can be back-dated with no warning at all. Either it gets the same guard or the
  difference needs a reason. **Not changed in this slice** — he was asked about credit notes.

- **S11-20 (2026-11-18) — A CREDIT NOTE WITH NO DATE TYPED STILL POSTS AT FINALIZE. S4-8 SURVIVES
  AS THE DEFAULT; S11-4 IS OPT-IN.** Settling a real collision between two of his own rulings,
  found when the v20 build turned `ACCEPTANCE S4-8` in `customer-credits.test.ts` red (it expected
  the entry on 2026-02-10 and got 2026-01-25 — the amounts were all correct, only the month moved).
  **The history matters:** originally a note took its date from `created_at`, the draft-save
  stamp, which back-dated a February finalisation into January and re-measured it (January's cash
  expenses jumped from 2,400 to 3,257.14 after the fact). On 2026-11-17 he ruled **S4-8 — date it
  at finalize** — and explicitly accepted the trade-off, buying the S1-6 guarantee that a reported
  month cannot move. S11-4 hands that ability back.
  **His ruling: no date typed means the note posts on the day it is FINALIZED, exactly as now.**
  A note is back-dated only when he deliberately types a date. **Why this is the right split, in
  his own words' terms:** he asked that the transaction date be *"specified independently"* —
  specified, not guessed. Defaulting to the draft-save date (the other option, and what the first
  build did) guesses a transaction date out of a creation timestamp, which is the precise confusion
  his own S11-4 tells us to separate. **Consequences:** `ACCEPTANCE S4-8` passes UNCHANGED and
  needs no re-signing, so no figure he has accepted moves; `note_date` must be left **NULL** when
  no date is given, and `getCreditNote` must NOT fall back to `created_at` for NULL (the first
  build's fallback is what produced the failure); `finalizeCreditNote` posts on `note_date` when
  it is set and `istDateOf()` when it is not. **The test's title and doc comment must be amended**
  to say it now pins the DEFAULT rather than the only behaviour — the figures stay untouched.

- **S11-19 (2026-11-18) — ITEM 9, R9 ATTACHMENTS USE BASE64 INSIDE ORDINARY JSON. Taken as the
  default because he did not answer it.** His message for item 9 repeated the accounting block
  already recorded as S11-1 to S11-5 — evidently a paste in place of an answer, not an answer. The
  default needs **nothing from him**: base64 installs no package, and `@fastify/multipart` would
  need his hands because npm is not on PATH in a tool shell, which hard rule 2 would require him to
  approve anyway. **So base64 is the choice that respects "ask before installing" by not needing to
  ask.** One consequence to build: Fastify's default `bodyLimit` is **1 MB** and base64 inflates a
  file by about 33%, so a 1 MB PDF arrives as ~1.4 MB and would be rejected — `bodyLimit` must be
  raised deliberately on the attachment routes. If he ever wants large attachments, swapping to
  multipart stays contained inside `src/attachments/`. **This closes the R9 gate.**

- **S11-18 (2026-11-18) — ITEM 8, `.gitignore`: he has relaxed the question, and it is already
  committed.** His words: *"If it is not needed, or if it is not meant to be committed, or push,
  you can keep it local. Thats not a issue."* It went in as **f4f252f** at the close of session 10
  (S11-12), which is the right outcome regardless: ignoring `.codebase-memory/` belongs in the
  repo, because the folder is a machine-local search index that no clone should ever carry. **It
  stays committed.** Not reverted — reverting a correct commit on his general "not an issue" would
  be reading permission into a shrug.

- **S11-17 (2026-11-18) — ITEM 7 ANSWERED AND CLOSED: THE SLOW FIRST PUSH *WAS* A SIGN-IN WINDOW,
  AND HE CLEARED IT BY HAND.** His words: *"Yes, I myself by hand fixed this push issue by signing
  into the Github when needed. And now you are able to make the push."* So of the two explanations
  carried out of session 8, the first is the true one: Git Credential Manager opened a GitHub
  sign-in window, the 60-second attempt was it waiting on him, and he completed it at the screen.
  **What follows, and must not be lost:** the credential is his and was renewed by hand, so it
  **can lapse again** — and when it does, a push will block on a pop-up he may not be there to
  click. **Therefore: never leave a push in the foreground (the tool timeout kills it and the
  failure looks like "pushing does not work" — the exact false fact S8-5 had to undo); always run
  it in the background; and always ask him first** (hard rule 4 — "yes, commit" is not "yes,
  push"), even though he has now twice said pushing is fine.

- **S11-16 (2026-11-18) — ITEM 6 CLOSED: THERE IS NO REAL DATABASE, SO THE R4c BACKFILL HAS NOTHING
  TO RUN AGAINST.** His words: *"Whatever db files are there, its on repo only, However, that
  session said something about making of a temporary database and meet the test on it, and then
  have, may have removed that Database file."* **His recollection is correct and it is verified:**
  a search of the whole repo for `*.db` and `*.sqlite*` (excluding `node_modules`) returns
  **nothing**, `git ls-files` tracks no database at all, and the default path
  (`src/api/main.ts:4` — `BOOK_BUDDHA_DATABASE ?? "book-buddha.db"`) does not exist on disk. The
  throwaway database session 10 built for the R4c scenarios was in the scratchpad and is gone, as
  intended. **So scenario 2's figures stay what `R4C-WORKINGS.md` already says they are —
  invented, demonstrating the shape of the problem, not his books.** The item reopens only when he
  has real books: then the dry run goes against a **copy**, read-only, he reads his own numbers,
  and he decides. **His live file is never touched, and the copy is never made by me** —
  `BOOK_BUDDHA_DATABASE` may point outside this repo.

- **S11-15 (2026-11-18) — ITEM 13, THE FEATURE DESIGN IS APPROVED AS THE V1 DESIGN.** His word:
  *"Agreed on 13 too."* `Feature Design - Bank Categorization, Bill OCR & Archive (V1).md`
  (repo root, sections A–H) is no longer "unapproved" — it is the V1 design for **R12 banking**,
  **bill OCR**, and **R14 archive**, on the basis of S11-6 (archive = masters only), S11-7 (a bill
  match asks before posting) and S11-8 (auto-created holding accounts). **One amendment follows
  from S11-8:** §D6 of that document assumes a SINGLE `Uncategorized` account; he asked for two,
  an income side and an expense side, so §D6 must be amended before the slice is built. Approval
  builds nothing by itself — it moves the document out of "blocked on the owner" (closing the
  three §H open items carried since S1-2) and queues the tidy-up pass through the Design Document
  (§1.5/§17), APP_FLOW, PRD and Features List that the document's own status line calls for.

- **S11-14 (2026-11-18) — ITEM 18, HOW THE REMAINING SEVEN SLICES GET ACCEPTED: I BUILD THE
  WORKINGS, SONNET WRITES THE TESTS, I REVIEW, AND HE READS ONE PLAIN-ENGLISH REPORT PER SLICE.**
  His words: *"Can you yourself make the tests for each and give me the report at the end. Make
  sonnet do the test you give to him and you review and if still unsure ask them else can move on.
  However, make a simple plain english report file of all the test that you will run to understand
  what you did, what test you run, what you actually tested, expected and actual output and
  difference. In simple readable format."* And on pace: *"Keep the order and pace default: one
  slice at a time."*
  **The loop per slice, fixed by this:** (1) I derive the expected figures from the spec and the
  accounting, NOT from what the code currently returns — deriving them from the code would only
  prove the code agrees with itself; (2) Sonnet writes the tests to those figures; (3) I run them
  and review; (4) **I escalate to him only where I am genuinely unsure**, otherwise I move on;
  (5) a **plain-English report file per slice** — what the slice does, each test run, what it
  actually tested, expected vs actual, and the difference where they disagree. Format follows
  `R4C-WORKINGS.md`, which he accepted, but in his language, not test language.
  **Order: R4 (opening balances) first**, because the default "R8 first" is now blocked behind
  S11-1; then one at a time through R4b, R1, R2, R5, R7, and **R8 last**, after the discount slice.
  **What this changes about acceptance:** his standing rule in `CLAUDE.md` is *"Acceptance = the
  user's hand-worked figures, not a passing technical test."* He has delegated the working-out,
  not the judgement — the report is what he judges, and a disagreement I find must be reported as
  a disagreement, never quietly reconciled.

- **S11-13 (2026-11-18) — ITEM 17, 7d AND 8c ARE ACCEPTED ON TRUST, NOT HAND-VERIFIED. RECORD THE
  DIFFERENCE.** His words: *"Unsure of this figures but can proceed if everything is working
  well."* The figures were his own, given on 2026-11-15, and the app reproduces all of them as
  `ACCEPTANCE` tests — but he did **not** re-work them this time. **So 7d and 8c are NOT the same
  grade of sign-off as R3 and R4c**, which he worked through figure by figure (and in R4c's case
  found a real defect doing it). They are recorded as **accepted on trust, conditional on the
  slice genuinely working** — the condition he attached. They come back to him if anything later
  contradicts them. **Hand-verified: R3, R4c. Accepted on trust: 7d, 8c. Outstanding: R1, R2, R4,
  R4b, R5, R7, R8** — seven, down from nine.

- **S11-12 (2026-11-18) — ITEM 19 AND ITEM 8 ARE CLOSED BY ACTION: both were committed at the end
  of session 10, before he was asked.** His question was *"Commit is now done, right?"* — **yes.**
  `git status` is clean, branch `autonomous/book-buddha-finish`, nothing unpushed. The trial-balance
  fix is **d23a609** *"Trial balance: report balances, not gross movements (owner-found)"* (the
  seven files of item 19); `.gitignore` went on its own as **f4f252f** (item 8's default); the
  context files followed as **06bbfa2** and **f5213f5**. So the RESUME_PROMPT text *"HE DID NOT
  ANSWER THIS, SO IT IS STILL UNCOMMITTED"* was already stale when it was written. **Nothing has
  been pushed, and nothing will be without asking him again.**

- **S11-11 (2026-11-18) — ITEM 16, the one-paise gap: NOT acceptable as-is. A tolerance plus a
  named rounding account.** His words: *"Allow minor rounding differences within a defined
  tolerance. Automatically adjust through a designated rounding account where necessary, ensuring
  the final transaction balances exactly. Never silently ignore discrepancies."* This **overrides
  the default** ("acceptable, it is exact once fully collected"). Work implied: a `ROUNDING`
  account in the chart, a stated tolerance, and the adjustment posted — not absorbed.

- **S11-10 (2026-11-18) — ITEM 15, the general ledger shows the TRANSACTION DATE he entered.**
  Default approved: *"Display the actual transaction date entered by the user. Maintain the
  posting/creation timestamp separately for audit purposes."* `GeneralLedgerRow.date` = `entryDate`;
  the posting timestamp stays stored and available to the audit trail. Same principle as S11-4.

- **S11-9 (2026-11-18) — ITEM 14, a report for a fair that does not exist returns an ERROR.**
  Default approved: *"Return a clear error explaining that the selected fair does not exist. Do not
  generate an empty report that could be mistaken for zero sales."*

- **S11-8 (2026-11-18) — ITEM 12, the holding accounts are AUTO-CREATED and renameable.** His
  words: *"Automatically create appropriate default accounts, such as Uncategorized Income and
  Uncategorized Expense. Allow users to rename them while preserving their account types."* Note he
  split one account into **two** — an income side and an expense side — which the default did not
  say. The rename must not be allowed to change `type`.

- **S11-7 (2026-11-18) — ITEM 11, a bank line that matches a bill ASKS BEFORE POSTING.** Default
  approved: *"Ask for confirmation before posting - Agreed."* Consistent with his no-auto-post rule
  (FD §H, D5).

- **S11-6 (2026-11-18) — ITEM 10, archive covers MASTERS ONLY in V1.** His words: *"Masters only in
  V1; retain documents and audit history."* Documents and the audit log are never archived away.

- **S11-5 (2026-11-18) — ITEM 5, income accounts: one default sales account NOW, but the design
  must carry an income account PER ITEM.** His words: *"Keep one default sales account initially,
  but support income account mapping at the item/service level so different product categories can
  eventually use separate income accounts without requiring manual account selection on every
  invoice."* This goes **further than the default** ("one income account now, revisit when he wants
  the split"): the mapping lives on the item master, not on the invoice screen — he never wants to
  pick an account while invoicing. **Consequence for what is already built:** the hardcoded
  `SALES` debit in `finalizeCreditNote` (`repository.ts:1401`) is latent today but becomes a real
  defect the moment item mapping exists — a credit note must credit back the SAME income account
  the invoice used. Fix it when the mapping slice is built, not before.

- **S11-4 (2026-11-18) — ITEM 4, A CREDIT NOTE GETS ITS OWN DATE. Default approved, and it is
  build work.** His words: *"Maintain a separate transaction date and creation/finalisation
  timestamp. Allow the transaction date to be specified independently."* One migration (**v20**);
  existing notes keep their finalise date as their transaction date. The pattern to copy is the
  purchase return (v19), which already carries its own date. Same principle as S11-10.

- **S11-3 (2026-11-18) — ITEM 3, cancelling a receipt: keep the original, keep the trail, respect
  the lock.** His words: *"Preserve the original transaction and its audit trail. Do not silently
  rewrite historical reports. Record cancellations and reversals in the appropriate accounting
  period, respecting closed-period restrictions."* The default (leave as built, warn in the R13
  cash-flow report) satisfies "do not silently rewrite" only if the warning is actually built —
  **so the warning is now required, not optional.** The harder half is "respecting closed-period
  restrictions": today the cash view is derived from live receipts and nothing is posted for the
  financial-year lock to refuse, so cancelling an October receipt in December still moves October's
  cash profit. Settling that is its own slice, to be scoped with R13.

- **S11-2 (2026-11-18) — ITEM 2, freight on a purchase return: reverse only what is actually
  refunded.** His words: *"Non-refundable freight should remain an expense. Reverse only amounts
  actually refunded or recoverable. If freight was capitalised into inventory, account for it
  accordingly."* The built behaviour (no clawback of freight) **matches this for freight that was
  expensed** — which is what `PURCHASE_EXTRA_CHARGES` does today. The second sentence is the live
  part: once S11-1 moves discount into inventory cost, the same question is asked of freight, and
  capitalised freight must come back out of the layer on a return. **This item is downstream of
  S11-1 and is scoped with it.**

- **S11-1 (2026-11-18) — ITEM 1, THE DEFAULT IS OVERRULED: A TRADE DISCOUNT MUST REDUCE THE COST OF
  THE STOCK, NOT BE BOOKED AS INCOME.** His words: *"Trade discounts must reduce the actual
  inventory purchase cost rather than being recorded as income. Distinguish these from
  early-payment or settlement discounts, which may have different accounting treatment."* This is
  AS 2 and it reverses what v18 built. **What is built today:** `postPurchaseBill`
  (`accounting/engine.ts:264`) credits the whole discount to `PURCHASE_DISCOUNT` ("Discount
  Received", INCOME) and the stock layer is carried at the FULL list cost — so until the goods
  sell, both inventory and this year's income are overstated by the discount.
  **What this answer requires:** (a) the discount is spread into the goods cost before the layer is
  written; (b) `PURCHASE_DISCOUNT` survives but only for **settlement / early-payment** discounts,
  which are a financing gain and stay income — so the bill needs to tell the two kinds apart;
  (c) the ACCEPTANCE figures in `src/database/bill-discount.test.ts` change, so R8 cannot be put to
  him for sign-off until this is done. **The hard part, named in session 9 and not solved:** a
  stock layer stores an integer `unit_cost_paise` (`purchasing-schema.ts:83`), so Rs 150 off a
  7-unit bill does not divide into equal whole-paise unit costs. The remainder must be put
  somewhere deliberately — it cannot be rounded away, because the layer value must still tie to the
  INVENTORY balance to the paise. **This is a build slice of its own, and it is the largest piece
  of work his nineteen answers have created.** S11-2 rides on it.

- **S10-7 (2026-11-18) — HOW THE REST OF THE BACKLOG GETS CLEARED: he answers it cold, in
  writing, as the opening message of session 11.** His words: *"Pause on this, I will answer all of
  them, as my starting prompt in next session."* Session 10 put every remaining open item to him as
  **one numbered batch of nineteen questions**, each carrying a default he can approve in a word —
  his own instruction earlier in the session was *"Ask all the queries together"*, which overrode
  the one-at-a-time rule in `RESUME_PROMPT.md` for this batch. **The nineteen questions, verbatim
  and with their defaults, are the top block of `context/RESUME_PROMPT.md`.** They are NOT
  duplicated here, so that there is only ever one copy to go stale. Each answer he gives becomes
  its own **S11-n** entry in this file, dated, in the words he used; a default he waves through in
  a batch is recorded as approved by batch, with the default's wording, not written up as though
  he had argued it out. Items 1, 4, 5 and 9 of that list can change code that already exists, so
  they get said out loud the moment his answer lands. **Nothing in the batch may be re-asked from
  scratch and the list must not be re-derived** — it took a session to assemble, and three of its
  items (Subscriptions, the four R4c decisions, S7-2) were only kept out of it because the record
  showed he had already ruled.
- **S10-6 (2026-11-18) — R4c IS SIGNED OFF. OWNER ACCEPTANCE, the SECOND slice to get there after
  R3.** He reviewed the R4c figures, **rejected one and accepted the rest**. The rejection became
  S10-5 (the trial balance printed gross movements; now Rs 15,250 a side). The six figures he
  signed, in his own words "all other validated figures": opening stock **Rs 10,000** credited to
  `OPENING_BALANCE_EQUITY` · stock adjustment **Rs 1,250** credited to `STOCK_ADJUSTMENT` ·
  **accrual net profit Rs 2,750** · **cash net profit Rs 1,500** · **closing inventory Rs 8,750**,
  equal to the stock valuation to the paise · **balance sheet Rs 12,750**. `ACCEPTANCE R4c` in
  `stock-journal.test.ts` is retitled from "(figures unconfirmed)" to **"(CONFIRMED S10-6)"** and
  `R4C-WORKINGS.md` is headed APPROVED, with the correction and the old figures kept visible.
  **With S10-1 to S10-4 settling its four decisions, R4c is fully closed except one thing: the
  backfill has still never been run against his real database, and must not be without his
  explicit say-so.** **Acceptance still outstanding for NINE slices** — 7d, 8c, R1, R2, R4, R4b,
  R5, R7, R8 — **and none of them has a workings document yet**, so none can be signed in
  conversation until one is written per slice. (Both HOT and the session-9 resume brief said
  "nine slices await, only R3 signed off"; the list named TEN. The count was wrong, not the list.)

- **S10-5 (2026-11-18) — OWNER-FOUND DEFECT, FIXED: THE TRIAL BALANCE WAS PRINTING GROSS
  MOVEMENTS, NOT BALANCES. He caught it in the R4c acceptance figures.** Reviewing R4c he said the
  trial balance must total **Rs 15,250** a side, not Rs 17,750, and that the extra Rs 2,500
  duplicated on each side had to go while the report still reflected the journal entries.
  **He was right.** `getTrialBalance` (`repository.ts`) passed `getReportAccountRows` straight
  through, and that helper returns `SUM(debit_paise)` and `SUM(credit_paise)` **per account** — the
  gross movement. So INVENTORY read **Dr 11,250 / Cr 2,500** instead of the **Dr 8,750** actually
  held, and every account with activity on both sides inflated BOTH totals by the same figure.
  **Why it survived nine sessions and 528 tests: it always balanced.** The R4c acceptance test
  asserted only `debits === credits`, which is true of a gross trial balance too. A balanced
  report is not a correct one — the lesson to carry.
  **THE FIX, presentation only:** `getTrialBalance` now nets each account to `debit - credit` and
  puts the result on ONE side, zeroing the other. An account netting to exactly nil is **kept at
  0/0** (his sub-choice, so the report still shows it had activity). **Nothing else changed:** the
  P&L already netted (`creditPaise - debitPaise`), the balance sheet works from `balancePaise`, and
  the UI's R4c tie-out computes `debitPaise - creditPaise` — identical before and after. No
  posting, no migration, no other report.
  **FOUR tests went red; all four pinned the OLD gross shape and none was an `ACCEPTANCE` test**
  (every `ACCEPTANCE` test passed untouched, so no figure he has accepted moved):
  `report-filters` and `report-fair-filter` each compared the report against a raw
  `SUM/GROUP BY` query — now netted the same way, regression intent unchanged · `purchasing` (API)
  pinned PAYABLES Dr 3,800 / Cr 11,800, now **Cr 8,000**, and an EXPENSE booked-then-cancelled,
  now the 0/0 row · `repository.test` pinned INVENTORY Cr 3,500, now **Cr 1,500**.
  **That last one is worth knowing:** in that fixture inventory nets to a CREDIT while stock is
  held, because a bare `PURCHASE` movement posts nothing yet FIFO still consumes it (S7-1(d)).
  Netting makes that hole **visible** instead of hiding it in the gross columns.
  **The R4c acceptance test now pins Rs 15,250 a side and the INVENTORY row at Dr 8,750** — the
  assertion that would have caught this. Gates after the fix: **528/528 in 44 files, tsc clean,
  vite build clean.** `R4C-WORKINGS.md` corrected, with the old figures and the reason kept visible.

- **S10-4 (2026-11-18) — OWNER RULING: BUILD THE STOCK-REVERSAL SLICE, AND BUILD IT BEFORE R9.
  This closes R4C-WORKINGS decision 4 AND the carried finding S7-2 — one answer, both items.**
  His words: "Yes, before R9." **The gap:** `addStockMovement` requires a POSITIVE quantity and
  there is no reversal or delete — the only public operations are add and list. So shrinkage and
  breakage have no way in, and since R4c a mistyped opening quantity is wrong in the stock reports
  **and** in `OPENING_BALANCE_EQUITY`, with no correction path. That sits against
  **cancel-with-reversal**, a fixed rule of this project.
  **Scope as put to him and accepted:** a negative adjustment plus a reversal for an existing
  movement, posting `Dr STOCK_ADJUSTMENT / Cr INVENTORY`; **refusing to remove more than the FIFO
  layers actually hold**; **refusing a locked financial year**. Sized to him as roughly R9's size.
  **BUILD-ORDER CHANGE, recorded here because it supersedes the session-9 brief:** the order is now
  **stock reversal → R9 attachments → R10 → R11 backup → R12 banking → R13 cash flow → R14
  archive.** The slice takes the next free migration version if it needs one (v20 was free at the
  close of session 9). Note for whoever builds it: the removal side must respect `getStockLayers`'s
  replay semantics (S10-2) — a reversal is NOT a back-dated layer.

- **S10-3 (2026-11-18) — OWNER RULING: a stock recount STAYS OUT of the cash-basis P&L.**
  R4C-WORKINGS decision 3 of 4, settled. His words: "Leave it out." The figures put to him are the
  app's own, from R4C-WORKINGS scenario 1 (produced by running it, not hand arithmetic): a recount
  finding 5 atlases at Rs 250 credits `STOCK_ADJUSTMENT` Rs 1,250, so **accrual net profit
  Rs 2,750** while **cash net profit is Rs 1,500** — the recount is absent from the cash view.
  Rationale accepted: a recount moves no money, so a cash-basis statement has nothing to recognise.
  This confirms S7-1's "pinned in a test, deliberately not changed" as deliberate POLICY rather
  than an assistant's default. **No code change, no rework.** If it is ever reversed, the cash-basis
  walk would have to visit `STOCK_MOVEMENT`-sourced entries, which it never does today.

- **S10-2 (2026-11-18) — OWNER RULING: a back-dated stock entry dates the ENTRY ONLY; the stock
  LAYER stays at the end of the FIFO queue.** R4C-WORKINGS decision 2 of 4, settled. His words:
  "Keep it as built." **Why it is not cosmetic, verified in the code this session:**
  `getStockLayers` (`repository.ts:3886`) stores nothing about which lot a sale consumed — it
  REPLAYS every movement from scratch, `ORDER BY occurred_at, rowid`, on every call. So a layer's
  date decides, today and retrospectively, what the app believes a sale months ago consumed.
  **The figure put to him** (worked from the code, not from a run, and labelled as such when
  asked): buy 10 @ Rs 250 on 1 Sep, sell all 10 on 20 Sep (COGS Rs 2,500 posted, inventory nil),
  then on 10 Nov enter 10 older atlases @ Rs 180 as opening stock dated 1 Apr. **As built:** ledger
  inventory Rs 1,800, stock report Rs 1,800, **out by Rs 0.** **If the layer were back-dated too:**
  the April lot jumps ahead of the September sale, the stock report says Rs 2,500 against a ledger
  of Rs 1,800 — **a Rs 700 hole**, with Rs 2,500 of COGS already posted on an issued invoice and no
  document to explain the gap. Keeping the layer at the end is the only version where the INVENTORY
  account and the stock valuation agree **by construction**, which is R4c's whole purpose.
  **The cost he accepted:** the stock-movement report lists such a movement in ENTRY order (10 Nov)
  while its journal entry is correctly dated 1 Apr, so the two reports disagree about where it sits
  in time. No figure is wrong; it is presentation, and fixable separately by sorting that report on
  the entry date. **No code change, no rework: this confirms what is built.**

- **S10-1 (2026-11-18) — OWNER RULING: opening stock KEEPS the one-business rule and the
  refusal.** R4C-WORKINGS decision 1 of 4, carried five sessions, now settled. An item belongs to a
  *company* but a journal entry needs a *business*, so R4c's `Dr INVENTORY / Cr
  OPENING_BALANCE_EQUITY` has to be filed under one business and the item alone does not say which.
  **As built, and now confirmed:** with exactly ONE business on the company the app uses it
  silently; with TWO OR MORE it **refuses and names them** rather than guessing. His words: "Keep
  the refusal." Rationale put to him and accepted: the refusal is the safe half — it never files
  capital (Rs 10,000 of Opening Balance Equity on the 40-atlas example) under the wrong business.
  **The consequence he accepted deliberately: opening stock can no longer be entered before a
  business exists**, and the app says so in plain words. Rejected: always requiring the business to
  be typed — safer in theory, needlessly fiddly in the common one-business case. The rule stays in
  the single helper `resolveStockMovementBusiness`, so reversing it is a one-line change.
  **No code change, no rework: this confirms what is built.**

- **S9-1 (2026-11-18) — ASSISTANT FINDING, OWNER DECISION PENDING: a bill discount (v18) does
  not reduce what the stock is carried at.** The discount credits its own INCOME account
  (`PURCHASE_DISCOUNT`) and INVENTORY is debited at FULL line cost. Netting it into the goods cost
  was ruled out by the data model, not by preference: a stock layer holds an **integer**
  `unit_cost_paise`, so a header discount cannot be pushed into it exactly, and a bill of pure
  stock lines has **no expense debit** to net against - netting there drives EXPENSE to a credit
  balance, the same shape as the SALES-in-debit hole closed in session 8. Debiting INVENTORY in
  full is also what keeps the INVENTORY ledger equal to the stock-layer value **by construction**.
  **The trade-off for him to rule on: under AS 2 a trade discount normally reduces the cost of
  the inventory.** Net profit is identical either way; what differs is the timing (discount income
  now, versus a lower COGS when the goods sell) and the balance-sheet carrying value.

- **S9-2 (2026-11-18) — ASSISTANT DECISION, OWNER MAY OVERRULE: a purchase return claws back the
  bill's DISCOUNT in proportion, but NOT its EXTRA CHARGE.** Returning a discounted bill in full
  must give back exactly what was owed, so the discount comes back with the goods (and the return
  that completes the bill absorbs the remaining headroom, so it lands on nil rather than stranding
  a paisa). Freight **in** is treated differently: it was really incurred on the inward journey
  and a supplier does not refund it because the goods later went back. Say if it should be
  reversed in proportion too - it is a small change.

- **S9-3 (2026-11-18) — CORRECTION OF A RECORDED FACT: S7-2 never blocked purchase returns.**
  HOT.md carried "purchase returns are BLOCKED on S7-2 (stock cannot go out in reverse)" from
  session 8. That was wrong: `getStockLayers` already understands `PURCHASE_REVERSAL` and removes
  the purchase's **own lot** (matching source id AND unit cost), never the oldest layer, which is
  the only correct behaviour when goods go back to the supplier they came from. **S7-2 itself
  still stands exactly as written** - there is no reversal path for a *user-entered*
  `addStockMovement`. Only the "blocks R8" inference was false, and nothing had to be built.

- **S9-4 (2026-11-18) — CORRECTION OF A RECORDED FACT: there is no separate `web` tsc gate.**
  HOT.md listed "web tsc clean" as a fourth gate. `web/tsconfig.json` does not exist and the root
  `tsconfig.json` has `"include": ["src"]`, so `tsc.cmd -p web/tsconfig.json` exits 2. The web
  side is covered by the **vite build**. Three gates, not four.

- **S8-5 (2026-11-17) — A FALSE FACT CORRECTED: pushing DOES work from a tool shell.** Sessions
  4-8 carried "a tool shell CANNOT push (no tty for the credential manager)" in the resume brief
  and acted on it for four sessions. Nobody re-tested it. Measured today, dry-run only, on
  `autonomous/book-buddha-finish`: with `GIT_TERMINAL_PROMPT=0` alone it exited 0 on a clean
  fast-forward but took **over 60s** and the tool timeout killed it first — which is exactly what
  "cannot push" looks like from the inside. Re-run with Git Credential Manager's own interactivity
  also off (`GCM_INTERACTIVE=never`, `-c credential.interactive=false`) it exited 0 in **3
  seconds**. So a credential is stored under `credential.helper=manager` and works with every
  prompt shut off; `gh` is not logged in and is not needed. **STILL UNRESOLVED:** whether the slow
  first attempt was GCM opening a sign-in window that the owner completed at the screen, or just a
  slow first fetch — ask him. If a window appeared, the credential can lapse and the next first
  push would block on a popup, so never run one in the foreground. **The lesson generalises: a
  hung command is not a broken capability.** A timeout was written down as an impossibility and
  inherited as fact. Re-run in the background before recording a limitation. **Permission is
  unchanged — ask him before every push, feature branch only, never `main`.**
- **S8-4 (2026-11-17) — ASSISTANT FINDING, NOT FIXED: a credit note has no date of its own, so a
  return cannot be back-dated.** `CreditNote` (`src/accounting/types.ts`) carries no date field, so
  its journal entry is dated the day it is FINALIZED. A return against a May invoice therefore
  lands in today's month, and a return that belongs in a closed period cannot be entered there at
  all. Found while wiring the sales reports: a date-filtered sales report nets off a credit note
  that the filter should have excluded. **Pinned in a test** (`reports-wiring.test.ts`) with the
  reason rather than changed — giving credit notes a date is a schema change, not report wiring.
- **S8-3 (2026-11-17) — `GeneralLedgerRow.date` IS NOW `postedAt`; the ledger presents
  `entryDate`.** The carry-over from S5-7 is settled. The field held the POSTING timestamp while
  being called "date" and rendered as one, so a back-dated entry appeared under today — visible on
  screen with four invoices dated 2025-03 to 2026-06 all showing 11/17/2026. **Renamed rather than
  redefined**, so the compiler found every reader; the only one was the ledger table. `entryDate`,
  the transaction date, already existed beside it.
- **S8-2 (2026-11-17) — THE AGEING REPORTS' `asAtDate` AGES, IT DOES NOT RECONSTRUCT.** A document
  dated after the as-at date is excluded, but **settlement is counted as it stands today**. So the
  report answers "how old is what is still owed, counted from this date", NOT "what was owed on
  that date": an invoice raised in March and paid last week reads as settled even when asked as at
  April. A true as-at position needs the open-items query to date settlements too. **Stated on the
  type**, not implied away. Also: the exclusion applies **only when a date was asked for** — with
  none, an invoice dated tomorrow is still owed now, and dropping it would hide a real debt.
- **S8-1 (2026-11-17) — R8 AS BUILT: cancelling a payment corrects ACCRUAL today but rewrites the
  CASH view's ORIGINAL period. THE ASSISTANT'S CHOICE, OPEN TO REVERSAL — a decision for the
  owner.** `cancelPayment` marks the row, leaves the original entry exactly as posted and posts a
  reversing entry dated TODAY, so accrual is corrected in the current period and the old one is
  untouched. But the **cash view is DERIVED from the documents, not posted**: a cancelled receipt
  simply stops being recognised, so the cash P&L of the month the money came in changes
  retrospectively — and **the financial-year lock does not protect it, because nothing is posted
  for the lock to refuse**. Proved live: May's cash profit went 100,000 → 0 on cancellation while
  accrual stayed 100,000. **Pinned in a test, deliberately not changed.**

- **S7-2 (2026-11-17) — ASSISTANT FINDING, NOT FIXED: a stock movement cannot be reversed,
  deleted or entered negative, and R4c makes that hurt more.** The only public operations are
  `addStockMovement` and `listStockMovements`; there is no reversal and quantity must be positive
  (the upward-only gap first flagged in **S5-3**). Before R4c a mistyped opening quantity was wrong
  in the stock reports alone; now it is also wrong in `OPENING_BALANCE_EQUITY`, with no correction
  path — which sits badly against **cancel-with-reversal**, a fixed rule of this project.
  **Recommended as its own small slice** (negative adjustment + movement reversal, `Dr
  STOCK_ADJUSTMENT / Cr INVENTORY`, refusing to remove more than the FIFO layers hold and refusing
  a locked year). Put to the owner as decision 4 of `book-buddha/R4C-WORKINGS.md`. **Not built.**
- **S7-1 (2026-11-17) — R4c AS BUILT (`b932d26`, `c844e90`): hand-entered stock reaches the ledger.
  FOUR CHOICES WERE THE ASSISTANT'S, inside the owner's S5-3 ruling, and all four are open to
  reversal — they are decisions 1–4 of `book-buddha/R4C-WORKINGS.md`, awaiting his word.**
  (a) **NO MIGRATION, so v17 is still free.** `journal_entries.source_type` has no CHECK in SQLite,
  so `"STOCK_MOVEMENT"` is a TypeScript widening; a movement counts as posted exactly when an entry
  carries its id, which is also what makes the backfill idempotent — no link table needed.
  (b) **`businessId` is derived when the item's company has exactly one business, and REFUSED
  (naming them) when it has more.** Items belong to a company; a journal entry needs a business.
  Consequence: **opening stock can no longer be entered before a business exists** — refused in
  plain words, now asserted at the API level. The rule lives in ONE helper
  (`resolveStockMovementBusiness`) so reversing it is a one-line change.
  (c) **`occurredOn` dates the JOURNAL ENTRY only; `stock_movements.occurred_at` stays the
  insertion instant.** FIFO consumes layers `ORDER BY occurred_at`, so a back-dated layer would
  jump the queue and silently re-measure COGS already posted on issued invoices. The FY lock
  applies through the door on `occurredOn`.
  (d) **A bare `PURCHASE` movement still posts nothing** (the bill posts it, so posting here would
  double-count) — and that is now the ONE remaining way inventory moves with no entry, so the
  backfill plan **counts those rows** rather than letting a tie-out report claim agreement.
  Also: the cash-basis walk never visits these entries, so a recount shows on accrual and is absent
  from cash. **Pinned in a test, deliberately not changed** — decision 3 for the owner.
- **S6-5 (2026-11-17) — ASSISTANT FINDING, CORRECTED: headroom cannot compress in the Claude
  DESKTOP app at all, so a zero compression count is not evidence an agent ignored it.**
  *First diagnosis in this session was WRONG and is corrected here.* The MCP tool initially
  reported its proxy at `127.0.0.1:8787` as unreachable, and that was taken at face value.
  `headroom doctor` then showed the opposite: **the proxy is running and healthy** (up 2h 14m,
  v0.40.0, `/readyz` ready, routing installed for this project, kompress ready). The real cause is
  one line of its output — **`claude desktop: agent sessions bypass the proxy (Desktop overwrites
  ANTHROPIC_BASE_URL)`**, with the note *"Desktop routing is not supported yet (see #869); use the
  terminal Claude Code CLI for proxy-routed sessions."* `headroom_stats` confirms it: **0 API
  requests**. A direct `headroom_compress` probe on a deliberately compressible payload also came
  back byte-identical with `transforms: ["router:noop"]`.
  **Consequence:** in the desktop app, headroom compression is impossible for the orchestrator AND
  every subagent, no matter how forcefully a brief insists on it. **Session 5's conclusion that four
  of five agents ignored headroom was therefore almost certainly wrong — they could not have used
  it.** Do not instruct agents to "turn headroom on" in a desktop session; it cannot be done from
  inside. **To actually get compression, run the session from the terminal Claude Code CLI**, where
  `doctor` already reports claude routed and hooks installed. CBM, by contrast, works normally here
  and is the real context-saving lever in the desktop app.
- **S6-4 (2026-11-17) — ASSISTANT FINDING, NOT FIXED: nothing type-checks `web/`.** The only
  `tsconfig.json` has `include: ["src"]` and `rootDir: "src"`, so `tsc.cmd` never sees the UI, and
  `vite build` is esbuild transpile-only, which reports syntax and unresolved-import errors but no
  type errors. So the UI is outside the gate. A standalone check run by hand
  (`tsc --noEmit --jsx react-jsx --module esnext --moduleResolution bundler --lib ES2022,DOM,DOM.Iterable
  --strict --skipLibCheck web/src/main.tsx`) exits 0 today, so the tree is clean — it is simply
  unguarded. Folding `web/` into the gate needs its own `tsconfig.web.json`, because `rootDir: "src"`
  forbids adding it to the existing one. **Not done: it is a build change, not part of the auth fix.**
- **S6-3 (2026-11-17) — `/auth/recover` WILL REQUIRE A RECOVERY CODE ISSUED AT SETUP. Owner ruled.**
  Today `recoverPassword` (`repository.ts:4352`) resets the admin password on a bare `googleSub` or
  `email` match against the admin row, with no secret fixed at setup, and it revokes every live
  session as it goes. It must stay public to be useful, so auth is not fully fixed while it stands.
  The handler's comment says the caller must have verified the Google identity already, but over
  HTTP the endpoint IS the trust boundary, so nothing verifies it. **Ruling:** setup generates a
  one-time recovery code, shows it once to be written down, and stores only its hash; `/auth/recover`
  then requires it. Rejected: requiring the old password (that is change-password without a session
  and cannot help with a FORGOTTEN password, which is the only case recovery exists for) and dropping
  recovery (backup and restore are unbuilt — R11 — so a forgotten password would lose the database).
  **Consequence: this consumes migration v16, so R4c's migration becomes v17.**
  **AS BUILT** (`7ab89fe`, after `a1ac6bd` and `e69860f`). Three choices were the assistant's,
  made INSIDE the owner's ruling and open to reversal: (a) **using a code burns it** — a replacement
  is issued in the same transaction and returned once, so a code read over a shoulder cannot be
  replayed and the owner is never left with no way in; (b) a new **authenticated** `POST
  /auth/recovery-code`, requiring the current password as well as a session, since without it a
  database set up before v16 could never obtain a code at all; (c) a NULL `recovery_code_hash`
  **refuses** rather than falling back to the old email match, because falling back for exactly
  those rows would leave the hole open on the owner's own database. The code is 150 bits over an
  alphabet without 0/O/1/I, normalised for case, dashes and spaces. At that entropy no attempt limit
  was added and the login lockout is untouched. Proven live over HTTP, not only in tests: wrong code
  refused, the real code accepted in lower case with dashes stripped, old password dead, spent code
  refused on replay, minting without a session refused. The migration is mutation-proofed — making
  it a no-op turns the recovery tests red with "no column named recovery_code_hash".
- **S6-2 (2026-11-17) — A MINIMAL SETUP/LOGIN GATE WAS ADDED TO THE PROOF-OF-CONCEPT PAGE. Owner
  ruled.** Enforcing auth broke `web/src/App.tsx` outright: it had no login screen, its `api()`
  helper sent no authorization header, and all fourteen endpoints it calls are non-public. The owner
  chose to add the gate now rather than leave the only working page dead until the real UI.
  Built as `web/src/AuthGate.tsx` plus `web/src/session.ts`, with a one-line change to `api()` and
  three lines in `main.tsx`, so it can be deleted in one piece later rather than unpicked.
  **The token is held in module scope and is NOT persisted** — the owner chose the minimal version
  over the localStorage one, so a page refresh signs you out. Verified by driving the real app in a
  browser against a throwaway database: first-run setup, mismatched passwords, the server's own
  password-policy message, sign-in, a wrong password showing the lockout counter, and
  `GET /api/companies` returning 200 only once the token was attached.
- **S6-1 (2026-11-17) — THE API HAD NO AUTHENTICATION AT ALL; IT NOW FAILS CLOSED. Assistant
  finding, design agreed with the owner before building.** All 101 routes were registered with no
  `onRequest`/`preHandler` hook of any kind; only `/auth/logout`, `/auth/session` and
  `/auth/change-password` read the bearer token, inside their own handlers. Every invoice, payment,
  report, cancellation and opening-balance route answered an unauthenticated caller. The session
  machinery already worked — nothing enforced it — so this was a defect, not a missing feature.
  **Design:** one `onRequest` hook in `buildApi`, deny by default. A route is public only when it
  carries `config: { public: true }`, read from the matched route's own config and NEVER matched on
  URL strings. Public set is exactly `GET /health`, `GET /auth/status`, `POST /auth/setup`,
  `POST /auth/login`, `POST /auth/recover`. An unconfigured database refuses with **409** rather than
  falling open; missing, malformed, revoked, expired and never-issued tokens get **401**.
  **Measured on Fastify 5.12.8, not assumed:** the hook DOES run for a path matching no route, where
  the route config is absent, so an unknown path is denied instead of 404-leaking which paths exist.
  The derived route table holds 146 entries — 101 real routes plus 45 auto-generated HEAD mirrors —
  so the public set surfaces as SEVEN literals, not five (`HEAD /health`, `HEAD /auth/status`).
  **Test opt-out:** `buildApi(repo, { __unsafeDisableAuthForTests: true })`, opt-in, default off,
  unreachable from `createApi`, `main.ts`, any env var and any config file. Used at the 28 existing
  call sites across 11 test files. Signing each world in instead would have written audit events and
  session rows, shifting the audit-chain sequence assertions and the fake-clock files.
  **Mutation-proofed twice:** making the hook a no-op left 136 of the 139 non-public
  routes answering unauthenticated callers (the 3 exceptions — `POST /auth/logout`, `GET` and `HEAD /auth/session` — authenticate inside
  their own handlers; `/auth/change-password` parses its body BEFORE checking the token, so it
  answered 400 and counted as leaked); wrongly marking one route public is caught by name against the
  literal public list. Both restored byte-identically, proven with `cmp`. Commit `a1ac6bd`.
  **Side benefit:** `onRequest` runs before body parsing, so an unauthenticated bad-payload request
  to `/auth/change-password` now gets 401 instead of a 400 that revealed the schema.
- **S5-11 (2026-11-17) — CROSS-FAIR CREDIT APPLICATIONS USE INTER-FAIR CLEARING ENTRIES. OWNER
  RULING, after a correction by the assistant.**
  The measured facts: a credit note raised on a Fair A invoice carries Fair A. `applyCreditNote`
  tagged its single entry with the TARGET invoice's fair (`repository.ts:1682-1689`), so
  `CUSTOMER_CREDITS` was created in Fair A and discharged in Fair B, netting to zero only
  company-wide. On a fair-filtered Trial Balance, Fair A showed a Rs 400 credit and Fair B a Rs 400 debit.
  **Assistant's framing error, corrected:** the owner was first told that "cash profit moves Rs 400
  from Fair A to Fair B", which implied profit was misattributed. It was not. Fair A going Rs 1,000
  to Rs 600 is goods coming back from a Fair A sale; Fair B going Rs 0 to Rs 400 is its own invoice
  settled by credit rather than cash. Each fair records its own event, and fair-wise P&L was already
  accurate on both bases. On that framing the owner first chose a per-line fair dimension; once
  corrected, he chose clearing entries instead.
  **Ruling:** when the source note's fair differs from the target invoice's fair, the application
  posts TWO single-fair balanced entries through a new `INTER_FAIR_CLEARING` account (ASSET, no role,
  seeded by migration v15): `Dr CUSTOMER_CREDITS / Cr INTER_FAIR_CLEARING` tagged with the SOURCE fair,
  then `Dr INTER_FAIR_CLEARING / Cr RECEIVABLES` tagged with the TARGET fair. The cross-fair movement
  becomes visible and named, not hidden in a customer-liability account. Untagged counts as a
  different fair from tagged, so those split too; both untagged does not split.
  **Why it is safe:** the cash view reads applications from the `credit_note_applications` table,
  not from journal-entry ids (`repository.ts:2363`), so splitting the entry leaves every cash-basis
  figure identical. Journal dimensions are per ENTRY: `fair_id` is on `journal_entries` (added by
  v6, `project-dimension-schema.ts:46-48`), and `journal_lines` has no fair column (`schema.ts:109-116`),
  so one entry cannot carry both fairs.
- **S5-10 (2026-11-17) — MIGRATION v11 MUST NOT OVERWRITE AN ACCOUNT NAME THE OWNER CHOSE. OWNER
  RULING.**
  v11 renames `UNCATEGORIZED` to its explicit expense name (S4-4). The first version matched
  `name <> target`, so it overwrote ANY name without a trace, including one the owner had chosen. It
  now matches `name = <the v9 default>` (`customer-credits-schema.ts:162-165`), which keeps a custom
  name. It is idempotent by construction: after the rename the name no longer equals the default, so
  a re-run matches nothing. Both names are derived from the frozen seed lists rather than retyped,
  so they cannot drift from the seeds. `V9_SEED_ACCOUNTS` (`chart-accounts-schema.ts:73`) was
  exported for that, its contents untouched. The old pin was inverted, and a second test covers the
  other direction (`migration-v11-realistic-chart.test.ts`, S5-10 cases).
  **Carry-over the owner must know:** a database that has ALREADY run v11 while carrying a custom
  name has already lost that name. This protects only a database that has not yet reached v11;
  v11 will not re-run on one that has.
- **S5-9 (2026-11-17) — BOTH R3 FIGURE SETS CONFIRMED. OWNER RULING, after reviewing the workings.**
  He asked to see the derivation first. `book-buddha/R3-WORKINGS.md` was written from instrumented
  runs of the real app, and he approved both scenarios after reviewing the event sequence, the
  journal entries, the monthly cash figures and the year-to-date reconciliation.
  - **APPLY accepted:** March nets to zero (minus Rs 400 on invoice A, plus Rs 400 on invoice B,
    no cash moved). **His condition:** the remaining Rs 600 is recognised WHEN COLLECTED, now a
    guarded step in the acceptance test (collected 10 April; April shows Rs 600; cash year to date
    reaches Rs 1,600 and equals accrual; January and March do not move).
  - **SPLIT accepted:** January income Rs 14,000 / COGS Rs 5,600; February income Rs 0 / COGS Rs 400;
    March income minus Rs 1,500; April income minus Rs 2,500; year to date converges on accrual at
    income Rs 10,000 / COGS Rs 6,000.
  - **Policy confirmed:** allocation is ACCOUNT-WIDE and proportional, NOT line by line. Every income
    account moves by the same fraction, and every cost account by the same fraction.
  - **Wording correction, applied:** after the full Rs 5,000 note, the revised invoice value is
    Rs 10,000, not Rs 14,000. Three figures are now separated: Rs 10,000 is the revised invoice value
    (accrual); Rs 14,000 is the bill net of only the Rs 1,000 that came off it, the other Rs 4,000
    being a liability recognised when refunded; and Rs 14,000 is also the January cash income
    already recognised.
  - The "figures unconfirmed" marking is removed from both ACCEPTANCE tests. No approved figure was
    changed.
  - **Standing instruction:** do not change approved figures or introduce further accounting
    adjustments without identifying the reason and obtaining approval.
- **S5-8 (2026-11-17) — ASSISTANT FINDING, NOT FIXED: `finalizeCreditNote` hardcodes the `SALES`
  account.** A credit note always debits the account code `SALES`, whatever income account the
  original sale went to. Confirmed at `src/database/repository.ts:1401`, inside `finalizeCreditNote`
  (lines 1364-1439). If invoice income ever lands in a user-created income account, the note still
  debits `SALES`, so per-account figures would be wrong. Report totals would still tie to the Profit
  & Loss, because both sides move together. It is **latent today**: no invoice path can post to a
  user-created income account. **OPEN QUESTION for the owner:** how an invoice chooses its income
  account. The fix needs that ruling. It is not urgent while the invoice path cannot reach a user
  account.
- **S5-7 (2026-11-17) — ASSISTANT FINDING: four existing reports are thinner than their names.**
  Found while building R7. Bringing these four up to standard is part of finishing R7.
  - `/reports/fair-sales` (`src/api/server.ts:1080`; `getFairSales`, `repository.ts:2060`) takes only
    an optional `fairId`. It has no dates and ignores `businessId`. It ignores credit notes and
    recomputes gross-with-GST from invoice lines rather than reading the journal. It lists only fairs
    that exist, so an invoice with no fair is silently dropped.
  - `/reports/sales-by-item` (`server.ts:1067`; `getSalesByItem`, `repository.ts:998`) has no filters.
    It sums invoice lines before discount, extra charge and GST. It ignores credit notes. It
    inner-joins `items`, so a line with no item is dropped.
  - `/reports/receivables`, `/reports/low-stock` and `/reports/inventory-valuation` (`server.ts:1077`,
    `1066`, `1065`) take no filters.
  - The journal-anchored reports (Trial Balance, Profit & Loss, Balance Sheet, General Ledger) DO take
    date filters. **Carry-over:** `GeneralLedgerRow.date` (`repository.ts:460`) still exposes the
    posting timestamp, not the transaction date. The new reports in `reports-sales.ts` and
    `reports-transactions.ts` deliberately key on `entry_date` instead.
- **S5-6 (2026-11-17) — ASSISTANT NOTE: two report filters cannot be built as asked, and why.**
  - An **item** filter is impossible on the sales, tax and transaction reports. The journal has no
    item dimension, and item-level sales would need an invented rule for spreading discount, extra
    charge and GST across lines. Those reports now refuse an item filter outright (`refuseItemFilter`,
    `reports-sales.ts:135`; `refuseFilter`, `reports-transactions.ts:103`) rather than silently
    ignoring it. `itemId` DOES work on `creditNoteReport`, `salesReturnReport` and
    `stockMovementReport`.
  - A **business** filter is impossible on `stockMovementReport`: stock movements are not recorded
    per business. It refuses one (`stockMovementConditions`, `reports-transactions.ts:259`).
  - **OWNER DECISION, not a build task:** a per-line item dimension, or a stated rule for apportioning
    discount and GST, is what would unblock item-level sales reporting.
- **S5-5 (2026-11-17) — ASSISTANT FINDING: a deterministic fuzz test was mistaken for flakiness.**
  The test "never posts a negative or zero line and lands on accrual totals (fuzz)", in
  `src/database/purchasing.test.ts:684`, runs 60 rounds and builds a freshly migrated database in
  each. It is deterministic (fixed seed `12345`), but it exceeded vitest's 5-second default whenever
  another suite ran at the same time. That produced the one-off `331/332` result seen earlier in the
  session. It now carries an explicit 30-second timeout (`purchasing.test.ts:743`). **This was a
  timeout under load, NOT a real failure.** Only the orchestrator should run the full suite; agents
  run their own files, so concurrent runs stop causing it.
- **S5-4 (2026-11-17) — YEAR CLOSE IS DERIVED; THE LOCK IS THE CLOSE. Owner ruled.** No closing
  journal entry is ever posted. Retained earnings is COMPUTED as income less expenses whenever the
  Balance Sheet is drawn, which `getBalanceSheet` already does (`RETAINED_EARNINGS` is derived and
  deliberately has no row in `chart_accounts`, so nothing can post to it). Owner chose this over
  the textbook closing entry, which would put lines on INCOME/EXPENSE accounts that every report
  and the cash-view walk would then have to learn to exclude. **Consequence:** R5-rem shrinks from
  a build to a presentation change — splitting the derived figure into retained earnings BROUGHT
  FORWARD and profit FOR THE YEAR at the financial-year boundary. Nothing is posted, so no month
  can move and S1-6 is safe by construction.
- **S5-3 (2026-11-17) — OPENING STOCK IS EQUITY; A STOCK ADJUSTMENT IS AN EXPENSE. Owner ruled.**
  Opening stock posts `Dr INVENTORY / Cr OPENING_BALANCE_EQUITY`. A mid-year ADJUSTMENT
  (shrinkage, breakage, a recount) is a current-year event and posts against a stock-adjustment
  EXPENSE account instead, so it reaches this year's P&L rather than sitting in equity forever.
  Owner chose this over the build plan's wording, which sent both to `OPENING_BALANCE_EQUITY`.
  Needs one new seed account. **Gap found while building, NOT covered by this ruling:**
  `addStockMovement` rejects a non-positive quantity, so stock can only ever be adjusted UPWARD.
  Shrinkage and breakage — the owner's own examples — cannot be entered at all today. Flagged to
  him; stock-out adjustments are deliberately NOT in R4.
- **S5-2 (2026-11-17) — AN OPENING RECEIVABLE SHOWS INCOME ONLY IF OPENING SALES SIT BEHIND IT.
  Owner ruled, in his own words:** “Can show as an income only if that sale or sale related details
  are entered in the opening balance of Sales i.e. user shows credit sales and receivables of same
  or proportionate amount - any and then based on that related working shows income, if there's no
  opening sale balance for the debtor amount then treat it as no income and simply is a balance
  sheet movement only.” So an opening customer balance of Y carries an income figure X (0 ≤ X ≤ Y);
  collecting it recognises X × collected/Y on the cash basis, and X = 0 makes the collection a pure
  balance-sheet movement. Assistant's design for encoding it is recorded with the R4 build.
- **S5-1 (2026-11-17) — ~~R3 IS STILL NOT SIGNED OFF~~ SUPERSEDED BY S5-9, which signs it off.
  Kept for the record: the owner asked to SEE THE WORKINGS before ruling.**
  Shown the APPLY figures (March nets to zero) and the SPLIT figures (Rs 1,000 offset / Rs 4,000
  refundable, February expense Rs 400), he chose neither “correct” nor “wrong” but asked for the
  derivation line by line before ruling. `book-buddha/R3-WORKINGS.md` is written for that purpose,
  from instrumented dumps of the real walk rather than hand arithmetic. **Both ACCEPTANCE tests
  keep their “figures unconfirmed” marking until he rules.** Two further R3 rulings are also open:
  the cross-fair cash shift (S5-5 candidate, pinned in `credit-apply-cross-fair.test.ts`) and the
  silent overwrite of a renamed UNCATEGORIZED (pinned in `migration-v11-realistic-chart.test.ts`).
- **S4-8 (2026-11-17) — A CREDIT NOTE IS DATED AT FINALIZE. OWNER RULED; BUILT in `1977466`.**
  Owner chose (a) over giving a note its own document date and over refusing to finalize into
  a reported month. **Trade-off he accepted:** a note finalized late lands in the month it was
  FINALIZED, not the month the goods came back; in exchange a closed month can never move.
  The refund and apply date guards now date from the note's POSTED entry, not its draft row.
  The pinned defect test became `ACCEPTANCE S4-8`. Original finding, for the record: `finalizeCreditNote` dates its entry from the note's
  `created_at`, which is stamped when the DRAFT is saved. A note drafted in January and finalized
  in February is therefore back-dated into January, where it re-measures any payment falling
  between the two dates. Reproduced: two payments of Rs 3,000 on 20 and 30 Jan, a freight note
  drafted 25 Jan and finalized 10 Feb — January cash expenses jump **2,400 → 3,257.14**, a month
  already reported moved by a February action. That is **S1-6 broken by an ordinary workflow**
  (raise the paperwork, finalize it later), and it predates this session. Three ways out, and the
  choice is yours because it decides what date a credit note HAS: **(a)** date it at FINALIZE —
  simplest, January can never move, but a note raised late lands in the month it was entered;
  **(b)** give a credit note its own document date as an invoice has, defaulting to today — most
  faithful to the paperwork, but a schema change (v13) and a new input; **(c)** keep draft dating
  and REFUSE to finalize into a month already reported. Pinned in `customer-credits.test.ts` as an
  open test holding today's behaviour; it becomes the acceptance test for whichever you pick.
- **S4-7 (2026-11-17) — CREDIT-NOTE CANCELLATION: three rules, assistant's design.** Completes
  S4-1 and closes the dead end where one mistaken note froze its invoice for good. Correction by
  REVERSAL (both entries negated on the cancel date, restored stock sent back out), never
  deletion, so no reported month moves. (1) **Newest note first** — each note's split was taken
  against the balance outstanding at ITS OWN moment, so undoing an earlier one first leaves the
  later splits unjustifiable. (2) **Nothing already refunded or applied** — that money is gone,
  and reversing a REFUND is still unbuilt, so a discharged note can never be cancelled. Tell the
  owner if that bites in practice; it is the obvious next gap. (3) **The returned stock must
  still be on hand** — if it has been sold on, cancelling would drive the item negative.
- **S4-6 (2026-11-17) — THE REFUND MONTH IS THE CASH MONTH. Owner acceptance figures.**
  Invoice Rs 11,800 (10 units, 18% GST), cost Rs 6,000, PAID IN FULL on 20 Jan. Two units come
  back on 10 Feb (note Rs 2,360, cost Rs 1,200). Refunded in cash on 5 Mar. Owner confirmed:
  **Jan** income 10,000 / GST 1,800 / COGS 6,000; **Feb** nothing at all; **Mar** income -2,000 /
  GST -360 / COGS -1,200; year to date then equals accrual (8,000 / 1,440 / 4,800). Confirms
  S1-6 against the alternative of recognising when the GOODS return. Held as `ACCEPTANCE` tests.
- **S4-5 (2026-11-17) — BOTH DISCHARGE ROUTES SHIP IN R3. Owner ruled.** A credit note can be
  settled either by refunding cash or by holding the credit and setting it against the customer's
  NEXT invoice. Owner chose both now over refund-only, accepting that it touches the cash-view
  walk twice in one slice. Per S1-6 an applied credit is recognised on the APPLICATION date.
- **S4-1 (2026-11-17) — BUILD THE REFUND PATH. Owner ruled the WHAT; the HOW below is the
  assistant's design, not the owner's instruction.** Supersedes the refusal in S3-3.
  A credit note may now exceed what is still unpaid. The excess becomes a real liability to the
  customer and is discharged by a recorded refund. Shape: the note's settlement credit SPLITS —
  `RECEIVABLES` up to what is still outstanding, a new `CUSTOMER_CREDITS` account for the excess —
  so receivables land on zero instead of going negative, and the money owed back is visible as a
  liability rather than hidden behind `getReceivables`' `outstanding > 0` filter. A refund is its
  own dated event (`Dr CUSTOMER_CREDITS / Cr CASH|BANK`) in its own table, so the `CHECK IN
  ('CASH')` on `payments.payment_account` is not in the way. Per S1-6 the REFUND, not the note,
  is the cash-view event: it reduces revenue in the refund month. The slice also gives credit
  notes a CANCELLED path (the status exists in the type and nothing sets it), which is what makes
  an invoice carrying a note cancellable again.
- **S4-2 (2026-11-17) — THE S2-2/S3-5 RE-BASE FIGURES ARE CONFIRMED.** Owner's figures for a
  Rs 11,800 invoice, a Rs 2,360 note raised before any collection (Rs 9,440 owed) and Rs 5,900
  collected: cash income Rs 5,000, COGS Rs 3,000, GST Rs 900 — 62.5% of the after-return lines,
  not 50% of the original bill. `cash-view.test.ts` "ACCEPTANCE re-base" is now a CONFIRMED
  acceptance figure, not a pending one.
- **S4-3 (2026-11-17) — A CREDIT NOTE THAT CLEARS THE BALANCE IS A SETTLEMENT EVENT. AMENDS
  S2-2.** Owner ruled on the stranded-cost gap. S2-2 said nothing hits the cash P&L on a note's
  date; that holds for the note's OWN lines, but when the note extinguishes what is owed, the
  lines the customer KEPT are fully settled and their remaining recognition lands in the note's
  month. Mechanically this is a true-up of `current − recognised` per account at the note's date,
  which also reverses any share already attributed to a line the note later waived. Consequence
  the owner accepted: the note's month can show an expense with no cash moving (Rs 2,000 in the
  pinned case). This closes the open test in `cash-view.test.ts` and makes the cash view converge
  on accrual whenever a document is fully settled, by note or by payment.
- **S4-4 (2026-11-17) — `UNCATEGORIZED` SPLITS INTO INCOME AND EXPENSE. Settles S3-2.** Owner
  chose the split over leaving one expense account: an uncategorised bank RECEIPT sitting in an
  expense account reads as a negative expense and misstates both halves of the P&L. One migration,
  landing ahead of R4. Nothing posts to the account yet, so there is no data to move.
- **S3-5 (2026-11-16) — S2-2 is implemented as an EVENT-ORDERED WALK, not a net denominator.
  This supersedes S3-4.** The first attempt simply divided by (invoice less credit notes).
  That looked equivalent and was not: it re-measures every EARLIER payment against the new
  lines, so returning a line that carried no COGS raised the COGS of an already-reported
  month (reproduced: January cash expenses 120,000 → 180,000 from a February note). The
  derivation now replays each invoice's notes and payments in date order; at a note the
  remainder is re-based and recognitions already emitted are never revisited, which is what
  your wording in S2-2 actually describes ("the REST of the invoice is then recognised
  against that smaller balance"). Notes sort before payments on the same date. It still
  converges on the accrual figure at full settlement.
- **S3-4 (2026-11-16) — S2-2 implemented as a NET DENOMINATOR in the cash view.** The
  derivation recognised each document's lines in proportion to cash received over the
  document total; the lines were netted for credit notes but the denominator was not, so the
  cash view never converged on accrual (settling the net 944,000 of a 1,180,000 invoice gave
  80% of the net lines, and the gap never closed). The denominator is now invoice total less
  finalized credit notes. Safe only because of S3-3: a note can no longer invalidate a
  payment already recognised in a closed month, which is what S1-6 forbids. **Figures moved
  in one pinned test — income 400000→500000, expenses 240000→300000, GST 72000→90000 —
  and need your confirmation.**
- **S3-3 (2026-11-16) — A credit note may NOT exceed what is still UNPAID, and an invoice
  carrying a credit note cannot be CANCELLED. Needs your ruling.** Note the asymmetry: a
  CASH invoice can still be credited, because that refunds through CASH and leaves nothing
  negative. S1-6 also treats "issued but not refunded" as a normal state, so refusing is a
  departure from your own wording — allowing it means building the refund path in the same
  slice. Crediting an invoice the customer had already paid drove RECEIVABLES negative:
  the books said money was due back, and no refund path exists to pay it. `getReceivables`
  then hid the row behind its "outstanding > 0" filter. Refusing is the same choice
  `cancelInvoice` already makes ("an invoice with recorded payments cannot be cancelled"),
  and it also removes the S1-6 contradiction that `cash-view.test.ts` had pinned with a
  decision pending. **Cost: a genuine return-after-payment is blocked until the refund path
  is built.** If you would rather allow it, the refund path has to land in the same slice.
- **S3-2 (2026-11-16) — `UNCATEGORIZED` is seeded as an EXPENSE. ASSUMPTION, needs your
  nod.** S2-1 approved the code but not its class. It is the landing account for an
  uncategorised bank line, and the large majority of those are costs. If you would rather
  have both an uncategorised income and an uncategorised expense account, say so — it is a
  seed-row change plus one more migration, not a rework.
- **S3-1 (2026-11-16) — `chart_accounts` carries a nullable `role` column. DEPARTURE from
  `ARCHITECTURE_AND_DATABASE.md:299`, recorded deliberately.** The doc's shape is
  `(company_id, code, name, type, parent_id, active)`. Two readers need something `type`
  cannot express: (a) `gstOnSalesPaise` must pick out output GST, which is a LIABILITY like
  payables, and (b) the cash view must exclude the settlement accounts — cash, bank,
  receivables, payables — while keeping inventory and GST, which no classification by the
  five classes can distinguish. S2-1 already requires the table to know which accounts are
  control accounts ("cannot be user-created"), so the column was needed regardless. S2-1's
  "derived from the class" rule is unaffected: it governs USER accounts, which never have a
  role. `parent_id` is also named `parent_code`, because it references `code` (the primary
  key) rather than a surrogate id.
- **S2-2 (2026-11-16) — A credit note on an unpaid/part-paid invoice RE-BASES the
  remainder.** The note reduces what is still owed; the rest of the invoice is then
  recognised against that smaller balance as cash arrives, and **nothing hits the cash P&L
  on the note date**. Owner chose this over "settle on the note date" and over "no effect
  until money moves". Reason: it is the only one of the three that converges to the accrual
  figure when the returned goods carry a **different margin** from those kept — the other
  two leave COGS permanently wrong on a part-paid invoice. Fills the gap in S1-6, which did
  not cover the commonest case (a note raised before the invoice is settled).
- **S2-1 (2026-11-16) — SUPERSEDES S1-4. Build a real `chart_accounts` table; do NOT
  hardcode the account list.** Owner asked whether the app lets a user create accounts; the
  spec says it must, in five places: DD line 14 ("starts blank — you create … chart of
  accounts") and §3.4; Features List ("pick a ready-made set **or** build your own; add/
  rename anytime"); APP_FLOW §1.4 ("blank list with 'Add account'") and §11.4; DD line 138
  ("create an account and set its opening balance directly"). `ARCHITECTURE_AND_DATABASE.md`
  line 299 already specifies the table: `chart_accounts (company_id, code, name, type,
  parent_id, active)`. The prototype's fixed 13-code SQL `CHECK` therefore **contradicts the
  approved spec**, and is self-defeating: a CHECK value cannot be added at runtime, so
  "add/rename anytime" is impossible by construction. Shape:
  - `journal_lines.account` **stays the TEXT code** — no data rewrite, existing queries keep
    working. `code` is immutable and UNIQUE; renaming changes `name` only.
  - Drop the code `CHECK`; enforce with a `BEFORE INSERT` **trigger** plus an FK. A trigger
    fires on every connection whatever `PRAGMA foreign_keys` says — the one property the
    CHECK had. `postJournalEntry` must look the account up in the DB, not a static set.
  - Reports group by the table's `type` through a JOIN, **never** a hardcoded code list, so
    "a new code is silently dropped and unbalances the sheet" becomes structurally impossible.
  - **DEPARTURE from the architecture doc, recorded deliberately:** system accounts are
    seeded ONCE with `company_id` NULL, not per company. The prototype allows several
    companies; per-company seeding would duplicate codes and make an FK on `code` impossible.
    User accounts carry their own `company_id`.
  - Seeded accounts (owner-approved this session): the existing 13 plus `UNEARNED_REVENUE`,
    `BANK`, `UNCATEGORIZED`, `OPENING_BALANCE_EQUITY`, `CAPITAL`, `LOANS`, `OTHER_ASSETS`,
    `OTHER_LIABILITIES`, `OTHER_INCOME`.
  - A user account picks exactly one of the five classes; normal side, cash-view inclusion
    and cash-flow bucket are DERIVED from the class, never chosen. Control accounts (cash,
    bank, receivables, payables, inventory, GST) cannot be user-created.
  - The account-creation **page** is UI, deferred with all other UI; the backend lands now.
- **S1-6 (2026-11-15) — Credit notes in the cash view are recognised when the adjustment
  ACTUALLY happens, never retroactively.** Owner's wording: recognise on the date a note is
  **refunded or applied**, not pro rata against the original invoice's collections. Issued
  but not refunded/applied → **no** cash-P&L impact. Refund issued → reduce revenue **in the
  refund month**. Credit applied to a later invoice/payment → reduce revenue **when used**.
  A previously collected invoice → **never rewrite an earlier month's cash figures**.
  Principle: cash reports reflect the period the adjustment occurs in. Same principle as
  S1-1's reversal dating. **The code currently does the OPPOSITE** (`deriveCashView` folds a
  note into its invoice pro rata), so this is a build item — `REMAINING_BUILD_PLAN.md` S3,
  which also needs a refund path.
- **S1-5 (2026-11-15) — Subscriptions / deferred revenue DEFERRED; a new "all report
  formats" slice added.** DD §11.6 still has three open items (early-closure behaviour,
  statement layouts, refund-vs-carry-forward default). Owner instead wants a slice building
  out the full report set (§13) — `REMAINING_BUILD_PLAN.md` S7.
- **S1-4 (2026-11-15) — Chart of accounts: add ALL FOUR new codes in ONE migration.**
  `UNEARNED_REVENUE`, `BANK`, `UNCATEGORIZED`, `OPENING_BALANCE_EQUITY`. The `journal_lines`
  account `CHECK` is a fixed list rebuilt by migration, so one rebuild beats three or four.
  Answers the long-open gate question (3). This also forces a latent fix: the hardcoded
  account lists in `getBalanceSheet` / `getProfitAndLoss` / `deriveCashView` must become one
  classification map, because a code missing from one of them silently unbalances the sheet.
- **S1-3 (2026-11-15) — No more per-slice plan files.** One consolidated
  `book-buddha/REMAINING_BUILD_PLAN.md` replaces `SLICE_n_PLAN.md`; the assistant scopes the
  work itself and builds, rather than gating each slice on a written plan.
- **S1-1 (2026-11-15) — Cash vs accrual = ACCRUAL-ALWAYS posting + a Cash/Accrual toggle
  at the report level.** Resolves conflict **#10** (`todos.md`) toward DD §4.5 / QBO. The
  engine **always** posts accrual (AR/AP kept accurate) regardless of a company's preferred
  method; the company's preference is only the **default report setting**, never a posting
  restriction. Cash-basis reports are **derived from actual payment allocations** (partial
  payments supported); no duplicate journals. This **supersedes** the per-company
  posting-time deferral built in Slices 1–6 and in commit `5576a21`, which is refactored
  away in **Slice 7b**; existing data preserved, regression tests added.
  **BUILT 2026-11-15** as Slice 7 (`5fc5aa8`, `4db437a`, `fbd358c`, `710d4f6`): the toggle
  applies to the **P&L only** — Trial Balance and Balance Sheet stay accrual-only, because
  keeping AR/AP on the books (owner's rule) means a cash Balance Sheet cannot balance until
  there is an Unearned Revenue account (Subscriptions). Acceptance figures reproduced but
  **not yet confirmed** by the owner.
- **S1-2 (2026-11-15) — Banking is its own slice; bank categorization + bill OCR live
  there.** Confirms conflict **#4** toward V1 scope, but the Feature Design (FD) is still
  **UNAPPROVED** with 3 open items (FD §H, below) — recorded as blocked on the owner, not
  scheduled, until those are settled.

## Foundational / scope (DD)
- **One company per install**, one DB file. Phase 1 = single-user **Admin**; Phase 2 =
  invoicing-only users (create & cancel, never delete, scoped data). (DD §1.4, §2.3–2.4)
- **Auth:** Google sign-in for setup/recovery; app password daily, ≥8 chars with
  letters+numbers; lockout 15 min after 5 tries; auto sign-out after 1 h idle. (DD §15.2)
- **Fair = a first-class Project** tied to one customer, with its own P&L (no per-fair
  Balance Sheet). Tags are a separate, lighter system. (DD §3.3, §10, §12.1, §13.3)

## The 15 questions (DEC, 9 Nov)
- **M1** — track-stock books: stock arrives by ordinary data entry; leaves via a
  challan for subscriptions, else at the invoice.
- **M2** — no-stock magazines: handled like M1 under subscription accounting.
- **M3** — credit customers: ordinary credit sale, payment when received, no
  challan-first.
- **M4** — challan↔invoice link: **DEC marks PENDING**, but DD §11.4 records it as
  DECIDED (invoice first; one invoice→many challans; one challan→one invoice;
  multi-invoice challans in v2). → **conflict, see `todos.md`.**
- **Q1** — customer credit: two ledgers (advances + credit notes), one combined
  balance shown.
- **Q2** — customer **merge is in V1** (merges identities, not transactions).
- **Q3** — P&L supports both **cash and accrual**.
- **Q4** — eight fixed reports + a simple report builder. *(DD §12 later lists ~17
  fixed reports; Build Plan still says 8 → conflict.)*
- **Q5** — payment amount & customer **frozen after save**; corrections are
  reverse-and-re-enter.
- **Q6** — partial / deposit on an invoice allowed, with its own due date.
- **Q7** — archive as a third state **skipped in v1 (DEC)** — **FD later reverses this
  into V1** → conflict.
- **Q8** — date tokens `:MONTH`, `:QUARTER`, `:YEAR` in v1 (also `:WEEK`, DD §13.5).
- **Q9** — tamper-evident **hash-chain audit log in v1**.
- **Q10** — low-stock threshold per item, business-level fallback.
- **Q11** — numbering resets with the FY, per document type.
- *(1A, 3C, 4A, 5A are referenced by DEC but DEFINED in DD/FD, not DEC.)*

## Other settled decisions (DD)
- **Stock:** per-item Track Yes/No; Yes→No blocked while stock remains. FIFO for
  tracked; untracked expensed at purchase. Negative stock blocked. (DD §6)
- **Posting source:** the document decides who posts — direct invoice posts all;
  linked challan recognises delivery; standalone challan posts nothing. (DD §6.5)
- **Rounding:** invoice/quotation totals round to the nearest whole rupee (≥50p up);
  receipts keep paise. *(DD §7.4, "adopted 12 Nov from Magazine PRD v4" — CONTESTED;
  ANTI & TEST say exact paise → conflict, see `todos.md`.)*
- **Invoice numbering:** `INV-001/26-27`, per business, reset each FY; number used on
  first save even as draft. Autosave with a leave-warning on unfinalised drafts.
  (DD §7.2–7.3)
- **Customers:** classification required; category SCH/LIB/CLG/RET/GEN auto-numbered
  from 0001; duplicate warn-but-allow; up to two contacts. (DD §5)
- **Payments:** methods Cash / Bank Transfer / UPI / Cheque / Other; `PMT-001/26-27`.
  (DD §9)
- **Subscriptions:** generic deferred revenue (not a magazine mode); price history by
  date; supply-date rate applies; **settlement/variance engine in V1** (refund /
  carry-forward / balance-due). (DD §11)
- **Credit notes:** separate, visually distinct document; issuance raises the credit
  pool, application creates a Credit-type payment. (DD §8.2)
- **Challan:** a real document, linked or standalone. (DD §8.3)
- **Import/Export:** real .xlsx + CSV; two-phase preview→column-map; failed rows
  skipped & collected. Backup scope user-selectable; restore sanitises settings.
  (DD §14)

## Bank categorization / OCR / archive (FD, 13 Nov — AWAITING OWNER APPROVAL)
- Moved **v2 → V1** (FD §A; H13 §3). Rationale: cut repetitive data entry.
- **Intake (D1):** CSV/Excel (primary, offline) · digital PDF (offline, no OCR) ·
  scanned PDF (offline Tesseract fallback, flagged "please check") · optional cloud OCR
  only when online and chosen.
- **Review queue (D2–D3):** imported lines aren't in the books until accepted; each
  line → **Add** (new bill/income) or **Match** (to open invoice/bill = a payment, or
  to an existing entry); app suggests, user confirms.
- **Bank rules (D5):** pre-fill only, **no auto-post in V1**. Helpers: split, transfer,
  Uncategorized holding account, exclude+undo (D6).
- **OCR for supplier bills (E):** same engine pre-fills a Bill for review; source file
  attached; never auto-posts.
- **Archive (F):** **SUPERSEDED BY S18-2 (22 Nov): TWO STATES ONLY, Active / Inactive — there is no
  Archived state.** Inactive = hidden from the screens, still in the database, and frozen (no work of
  any kind until it is activated again); refused while anything is open on it; past figures keep
  showing in reports. Reversible and audit-logged, as the third-state plan had it.
- **Rejected (G):** live bank feed, reconciler-only role, auto-posting, one bank
  account per business.


## Not a decision
`reference/` (Invoice Ninja inspection) is **reference-only** — where it differs from
our rules (their cancel doesn't restore stock; they edit locked invoices; they recycle
numbers), **our rules win**. See `reference/Inspection summary …`.
