Resume Book Buddha — autonomous backend finish, session 9.

## READ THIS BLOCK BEFORE ANYTHING ELSE

**THE OWNER'S STANDING INSTRUCTION, GIVEN IN SESSION 8:**
**Do not build UI.** He will design the frontend himself once the API, database and backend work
properly. Build backend only. Screenshots are still wanted, but only of something that genuinely
works — if a slice has no screen, say so plainly rather than sending a picture of something else.

**THE ORDER HE SET FOR THIS SESSION, 2026-11-17, in his own words:**
> "first will fix fair-sales first then R8 and R9 if possible or R8 with another R which small to
> complete."

So: **fair-sales → R8 → R9 if possible; if R9 turns out not to be possible, R8 plus a different
small R.** Do not reorder this on your own judgement. BUILD ORDER below says what each means.

**R<n> IS S<n> in `book-buddha/REMAINING_BUILD_PLAN.md`.** "R9" appears nowhere in `spec/` or
`context/` — the letter changed, the numbering did not. R9 = S9 Attachments, R10 = S10
Import/export, R11 = S11 Backup, R12 = S12 Banking, R13 = S13 Cash flow, R14 = S14 Archive.

**MODEL USE (his instruction):** Sonnet writes code, Opus (the orchestrator) does the testing,
Haiku with CBM updates and searches files and docs. **Session 8 did NOT follow this** — every
slice landed in `repository.ts` and only one agent may hold that file at a time, so the
orchestrator wrote it all. **This session finally has work outside that file: `src/attachments/`
(R9) is self-contained — that is the slice to hand to Sonnet.**

**NEXT MIGRATION VERSION IS v18. v17 IS TAKEN** (`payment_cancellation`, session 8).

**HEADROOM CANNOT WORK IN THE CLAUDE DESKTOP APP. Do not spend a turn on it** (S6-5). CBM is the
context lever here: project id `C-Users-Admin-Desktop-Book-Buddha-book-buddha`, **re-index first**
(`index_repository`, mode `fast`). `src/database/repository.ts` is ~6,000 lines and
`src/api/server.ts` ~1,400: **never read either end to end.** `get_file_outline` to enumerate,
`search_graph` for symbols, `get_code_snippet` for ONE body, grep only for literals.
**CAVEAT: `fast` mode does not index `*.test.ts`**, so `callers: N` is blind to tests — grep the
test files separately before changing any signature. `repository.ts` line 53 fails to parse.

## ORIENT
1. `context/HOT.md` — auto-loaded, accurate as of session 8. Trust it.
2. `git branch --show-current` must be `autonomous/book-buddha-finish`; tip **`4427078`** or later.
3. `context/decisions.md` — read **S8-1 … S8-4**, then S7-1, S7-2. S5-x and S6-x still apply.
4. **EVERY commit on this branch is UNPUSHED and that is deliberate.** Count it, never quote a
   number out of this file: `git log --oneline @{u}..HEAD | wc -l`. A tool shell CANNOT push (no
   tty for the credential manager). Only the owner pushes, from his own terminal. **Ask, never
   retry.**
5. Gates (npm is NOT on PATH), from `book-buddha/`:
   `./node_modules/.bin/vitest.cmd run --root .` · `tsc.cmd` · `vite.cmd build`
   **Baseline: 41 files, 487 tests, tsc clean, build clean.**
   ⚠️ **NEVER pipe a gate into `tail` and read `$?`** — that is tail's exit code. Run it unpiped.
   ⚠️ **vitest does NOT type-check** (esbuild transpiles). A test file can pass vitest and fail
   `tsc`. Session 8 claimed "tsc clean" in a commit before running it, and was wrong.
   ⚠️ **READ the test count out of the run before writing it in a message.** Session 8 wrote a
   guessed count into two commit messages and had to amend both.
6. **`web/` is type-checked by NOTHING** (S6-4). After touching it, run by hand:
   `tsc.cmd --noEmit --jsx react-jsx --target ES2022 --module esnext --moduleResolution bundler
   --lib ES2022,DOM,DOM.Iterable --strict --skipLibCheck web/src/main.tsx`
7. `node` is not on bash's PATH but **is** available to PowerShell as `node.bat`. A one-off script
   that needs `better-sqlite3` must live INSIDE `book-buddha/`, or module resolution fails.
8. **Stop dev servers BY PORT**, never `Get-Process node | Stop-Process` — that kills every node
   process on his machine, his own included.

## WHAT SESSION 8 DID (do not rebuild)
- **`e945a7f`** — removed the "Offline-first accounting" tag from all three screens.
- **`a89f7fc` + `9ede5e4` — R5-rem DONE.** The derived retained earnings is split at the
  financial-year boundary into brought forward and profit for the year, **as a NEW
  `retainedEarnings` field on `BalanceSheetReport`, not by replacing the derived row** —
  `chart-accounts.test.ts` pins that row, and replacing it would risk double-counting equity. One
  cut at the FY start; the upper bound mirrors the sheet's own, so the two parts partition the
  figure exactly. Consolidated / no FY / uncovered date → `split: null` with a plain-English
  reason, never a guessed year.
- **`0797270` — R7b wiring.** `reports-sales.ts` and `reports-transactions.ts` had no caller
  outside their own tests; nine repository methods and nine routes now reach them.
  **`GeneralLedgerRow.date` → `postedAt` (S8-3)**, so nothing called "date" is a posting
  timestamp; the ledger presents `entryDate`.
- **`a2758de` + `1af0dc2` — R7b ageing.** `/reports/receivables-ageing` and `/payables-ageing`,
  0-30/31-60/61-90/over-90, off the SAME open-items query as `getReceivables`/`getPayables`, which
  themselves gained business/party/as-at filters and no longer age off the wall clock. See
  **S8-2** for what `asAtDate` does and does not mean.
- **`6ad504c` + `f4773ab` — R8 payment cancellation, migration v17.** `cancelPayment` /
  `cancelSupplierPayment`: the row is marked, never deleted; the reversal is the posted entry's
  own lines FLIPPED (never rebuilt from the document — `recordPayment` still hardcodes CASH,
  S5-8), dated today. Closed a real dead end: a paid invoice refused cancellation and the payment
  could not be undone. Then closed two holes it opened — **SALES could finish on a DEBIT balance**
  when a note had gone to CUSTOMER_CREDITS, and the supplier statement kept counting a cancelled
  payment. Proved live on a genuine v16→v17 upgrade of a throwaway database.

## BUILD ORDER — his order, not yours to change
### 1. FIX fair-sales. This is first.
`/reports/fair-sales` (`server.ts:1390`) and `/reports/sales-by-item` (`server.ts:1355`) ignore
credit notes and take no filters, so **`/reports/fair-sales` answers 60,000 where the newer
`/reports/sales-by-fair` answers 40,000 on the same books — two routes, two answers to the same
question.** He said **fix**, so fix them; do not retire or delete a route to make the discrepancy
go away.
- **Reproduce both figures before changing a line.** Seed the books, call both routes, write the
  two numbers down. You cannot prove a fix you never saw fail.
- **Before changing any response shape, grep `web/src` AND every test file for both route paths
  and both method names.** `web/` is in no gate, so a renamed field there fails silently at
  runtime; CBM's `fast` index does not see test files at all.
- **If an `ACCEPTANCE …` figure moves, STOP and look.** Do not edit the expectation. In session 8
  a red test was right and the new code was wrong.
- `getSupplierStatement` still has no customer equivalent. Worth adding here if time allows; say
  so plainly if you skip it.

### 2. R8 — three of four AT BEST, and that is not R8 closed.
- **Bill discount** — header-level discount / extra charge on a purchase bill, mirroring the
  invoice. Needs its own migration, **v18**. On a bill with tracked-stock lines, check the
  INVENTORY ledger still equals the stock-layer value afterwards.
- **Supplier refunds** — the mirror of `recordCreditNoteRefund`.
- **Purchase returns — BLOCKED on S7-2.** They take stock OUT, and a stock movement still cannot
  be reversed or entered negative. **R8 cannot be reported as finished until he rules on S7-2.**
  Put it to him in finance terms early in the session; do not start purchase returns without it.

### 3. R9 attachments — CONDITIONAL, and genuinely small. Check the gate FIRST.
The storage engine **already exists and was built in session 2** (`4033ecb`, migration v7):
`src/attachments/attachments.ts`, 267 lines — `storeAttachment`, `listAttachments`,
`getAttachment`, `getAttachmentPath`, `deleteAttachment`, plus `ATTACHMENT_ENTITY_TYPES` and a
10 MB default cap. Its table is in `src/database/attachments-schema.ts` and is already migrated.
**It has NO importer anywhere outside its own folder — zero routes, zero repository calls.** This
is exactly the hole R7b had: built, tested, unreachable. What remains is wiring plus HTTP tests,
which is why it is the small one.
- **FIRST STEP, before planning anything: grep `book-buddha/package.json` for `multipart` and
  `busboy`. There is no `@fastify/multipart` and no multipart parser of any kind.** So a real file
  upload needs either a dependency install — **which needs his say-so, so ask and wait** — or a
  base64 JSON body, which is honest for a 10 MB offline app and needs no install.
- **If it needs an install and he is not there to approve it, this is where his fallback applies:
  "or R8 with another R which small to complete."** Say plainly that R9 is gated on an install and
  take the smallest other R instead, rather than installing anything unasked.
- `src/attachments/` is **outside `repository.ts`** — the one slice this session can hand to Sonnet
  without two agents fighting over the same file.

### 4. After that
**R10** import/export · **R11** backup/restore · **R12** banking · **R13** cash flow ·
**R14** archive. Their one-paragraph definitions are in `book-buddha/REMAINING_BUILD_PLAN.md`
under S10–S14.

## OWNER ACTION OUTSTANDING
- **S7-2 is the one to put to him first this session**, because it is what stops R8 closing: a
  stock movement cannot be reversed, deleted or entered negative, so a mistyped opening quantity
  is wrong in equity with no correction path — and purchase returns cannot be built over it.
- **`book-buddha/R4C-WORKINGS.md` HAS FOUR DECISIONS FOR HIM**, plus the R4c acceptance figures.
- **S8-1 — put this to him in finance terms:** cancelling a receipt corrects the ACCRUAL books
  today, but the CASH view is derived rather than posted, so **the cash-basis profit of the month
  the money came in changes retrospectively**, and the financial-year lock does not stop it
  because nothing is posted for the lock to refuse. Pinned in a test, deliberately not changed.
- **S8-4** — a credit note has no date of its own, so a return cannot be back-dated; it always
  lands in today's month.
- **ACCEPTANCE for 7d, 8c, R1, R2, R4, R4b, R4c, R5 and R7 all await him. Only R3 is signed off.**
- **The R4c backfill has NEVER touched his real database and must not without his say-so.**
- If his database predates v16 it has **no recovery code** — sign in, `POST /auth/recovery-code`.
- 13 test files are dirty with **CRLF-only churn** (zero content diff). Offer `git checkout --` on
  those explicit paths. `book-buddha/.codebase-memory/` is untracked — ask about `.gitignore`.
- **Known flake, pre-existing:** the fuzz test in `src/accounting/engine.test.ts`
  ("allocateProportionally … fuzz") can exceed its 5000ms per-test limit under full-suite parallel
  load, then passes alone. Timing-fragile, not wrong.

## ENGINEERING TRAPS (sessions 4–8 hit all of these)
- **FIFO consumes layers `ORDER BY occurred_at`**, so a back-dated layer re-measures posted COGS.
  R4c's rule: date the ENTRY, never the layer. Keep it.
- **The frozen seed lists are frozen on purpose** — `V9_*`, `V11_*`, `V13_ADDED_ACCOUNTS`,
  `V15_ADDED_ACCOUNTS`. Each migration seeds from the list frozen AT ITS OWN VERSION. A new
  account means a NEW frozen list and a NEW migration.
- **A migration test that runs the whole chain on an empty DB tests NOTHING.** Build to v<n-1>
  with `migrations.filter(m => m.version <= n-1)`, insert survivors by raw SQL, then apply v<n> by
  calling `applyXSchema(db)` DIRECTLY (a second `runMigrations` is a no-op). Then mutation-prove.
- **Any rebuild of `chart_accounts` must drop and replay EVERY trigger whose body mentions it**,
  including `journal_lines_account_exists`, which lives on `journal_lines`.
- Account codes are **not** a fixed union. **Reports must group by `chart_accounts.type`/`role`
  via JOIN**, never a hardcoded code list.
- Reports key on **`entry_date`**, not `created_at`. `payments.payment_account` is still
  `CHECK IN ('CASH')`. `recordPayment` hardcodes CASH; `finalizeCreditNote` hardcodes `SALES`.
- **Fastify tests cannot use fake timers.** Age a session out with `validateSession(token, future)`.
- **A new API route is protected automatically** (absence of `config` = deny). If one must be
  public, add it to `PUBLIC_ROUTES` in `src/api/auth-enforcement.test.ts` deliberately.
- **`perl -i -pe` interpolates `$` in the replacement.** Session 8 silently ate a `${item.date}`
  this way and tsc still passed, because the result was valid TypeScript and simply wrong. Use
  the Edit tool or a Python patch for anything containing `$`.
- **Write these markdown files with the Write tool, not a shell heredoc.** They are full of
  backticks and apostrophes; session 8 tried a heredoc here and bash died on an unmatched quote,
  and an UNQUOTED heredoc would have been worse — it runs each backticked span as a command and
  silently replaces it with the output. Same class as the `perl` trap, and nothing gates markdown.

## HOW TO WORK (this is what worked in sessions 6–8 — keep doing it)
- **Reproduce every suspected defect before fixing it**, and **mutation-test the important ones**:
  break the implementation, watch the test fail, restore it, watch it pass. **Back the file up to
  the scratchpad and restore with `cmp`/SHA256 to prove a byte-identical restore — NEVER
  `git checkout` to undo a mutation while the work is uncommitted.**
- **Prove it against the RUNNING system, not only the harness.** Seed a throwaway database in the
  scratchpad, `node.bat dist/api/main.js` (port 3000), sign in through the real gate, drive the
  routes. **Rebuild `dist/` with `tsc.cmd` and RESTART the API first**, or you will be testing
  stale code. **NEVER point it at his real database.**
- **Triage every test your change turns red** into: pins the old behaviour (update deliberately,
  with a reason in the file) · incidental count (update, with a reason) · **an `ACCEPTANCE` figure
  moved — STOP and look, do not edit it.** In session 8 a red test was right and the new code was
  wrong: it showed that excluding future-dated documents must only happen when a date was ASKED
  for, or a real debt is hidden.
- **Guard every sweep against passing vacuously.** Assert known anchors are present; collect
  failures into an array asserted `toEqual([])`.
- **Every new route needs a test that actually calls it over HTTP.** Session 7 shipped a route no
  test had ever executed.
- Max 2 agents; **NEVER both in `repository.ts`.** The orchestrator owns `migrations.ts`, assigns
  versions, and **alone runs the full suite** (S5-5). **Review what agents hand back — read the
  code, do not take the report on trust.**
- **Advisor = Fable. Discuss the plan BEFORE building and again before declaring done.** In
  session 8 it caught an ungated "vite build clean" claim, the receivables/ageing as-at
  disagreement, and the SALES-in-debit hole that payment cancellation had opened.
- Stage by **explicit path**, never `git add -A`. One commit = one idea. **Put the honest limits
  in the commit message.** Committing locally is pre-authorised; **ASK BEFORE PUSHING.**
- `context/HOT.md` stays **under 50 lines**. **Delete words, then count** — reflowing does nothing.

## WHERE THE PRODUCT ACTUALLY STANDS — do not over-report progress
Roughly **52% of a first working MVP**, about **82% of the backend**. **17 migrations (v18 free),
116 routes, 41 test files, 487 tests green.** Auth is real and enforced; opening stock reaches the
ledger; the sales and transaction reports are finally reachable; receivables and payables age
properly; a payment can be undone. The UI is still ONE proof-of-concept page plus the login gate —
**and that is deliberate: the owner will build the frontend himself.** PDF/print, import, export,
backup and restore do not exist at all, and attachments exist but cannot be reached over the API.

REALISM — fewer slices done properly beats all of them rushed. Say exactly where you stopped and
what is unverified; **report nothing as done that is not gated.**
