Resume Book Buddha — autonomous backend finish, session 8.

## READ THIS BLOCK BEFORE ANYTHING ELSE

**FIRST TASK, THE OWNER'S OWN INSTRUCTION, BEFORE ANY SLICE WORK:**
**Delete the "Offline-first accounting" tag.** It appears three times, all in the UI:
`web/src/App.tsx:542` (the page header), `web/src/AuthGate.tsx:160` and `web/src/AuthGate.tsx:207`
(the setup and sign-in screens). Remove the whole `<p className="eyebrow">Offline-first
accounting</p>` element each time; **keep `<h1>Book Buddha</h1>`, the surrounding `<div>`/`<header>`
and the "Local workspace" status chip.** Nothing else uses that string. Then: the standalone web
type-check (below, `web/` is in NO gate), `vite.cmd build`, and **show him a screenshot of the
header and of the sign-in screen** before moving on — he asked to see each finished piece on screen
from now on. Commit it on its own, one idea.

**HEADROOM CANNOT WORK IN THE CLAUDE DESKTOP APP. Do not spend a turn on it** (settled in **S6-5**:
the proxy is healthy, but Desktop overwrites `ANTHROPIC_BASE_URL`, so agent sessions bypass it;
`headroom_stats` shows 0 API requests). For compression, run Claude Code from the terminal CLI.

**CBM IS THE CONTEXT LEVER HERE — USE IT, ORCHESTRATOR AND EVERY SUBAGENT.** Project id
`C-Users-Admin-Desktop-Book-Buddha-book-buddha`; **re-index first** (`index_repository`, mode
`fast`) — session 7 did NOT re-index at the end. `src/database/repository.ts` is ~5,200 lines and
`src/api/server.ts` ~1,300: **never read either end to end.** `get_file_outline` to enumerate,
`search_graph` for symbols, `get_code_snippet` for ONE body, grep only for literals.
**CAVEAT: `fast` mode does not index `*.test.ts`, so `callers: N` is blind to tests — always grep
the test files separately before changing any signature.** `repository.ts` line 53 fails to parse.

## ORIENT
1. `context/HOT.md` — auto-loaded, accurate as of session 7. Trust it.
2. `git branch --show-current` must be `autonomous/book-buddha-finish`; tip **`0425717`** or later.
3. `context/decisions.md` — read **S7-1, S7-2** (newest first). S5-x and S6-x still apply.
4. **~47 commits are UNPUSHED and that is deliberate.** A tool shell CANNOT push (no tty for the
   credential manager). Only the owner pushes, from his own terminal. **Ask, never retry.**
5. Gates (npm is NOT on PATH), from `book-buddha/`:
   `./node_modules/.bin/vitest.cmd run --root .` · `tsc.cmd` · `vite.cmd build`
   **Baseline: 37 files, 458 tests, tsc clean, build clean.**
   ⚠️ **NEVER pipe a gate into `tail` and read `$?`** — that is tail's exit code. Run it unpiped.
6. **`web/` is type-checked by NOTHING** (S6-4). After touching it, run by hand:
   `tsc.cmd --noEmit --jsx react-jsx --target ES2022 --module esnext --moduleResolution bundler
   --lib ES2022,DOM,DOM.Iterable --strict --skipLibCheck web/src/main.tsx`
7. `node` is not on bash's PATH but **is** available to PowerShell as `node.bat`.

## WHAT SESSION 7 DID (R4c is built — do not rebuild it)
- **`b932d26` — R4c.** Opening stock posts `Dr INVENTORY / Cr OPENING_BALANCE_EQUITY`; an
  ADJUSTMENT posts `Cr STOCK_ADJUSTMENT` (S5-3). **NO MIGRATION WAS NEEDED, so v17 is STILL FREE:**
  `journal_entries.source_type` has no CHECK, so `"STOCK_MOVEMENT"` is a TypeScript widening, and a
  movement counts as posted exactly when an entry carries its id — which is also the backfill's
  idempotency, so there is no link table. A bare PURCHASE still posts nothing (its bill does) and is
  COUNTED as uncovered. `businessId` is derived only when the company has ONE business, else refused
  by name. `occurredOn` dates the ENTRY only — the FIFO layer stays append-only, so posted COGS is
  never re-measured. Movement + entry are ONE transaction.
  Plus `planStockJournalBackfill` / `backfillStockJournals` and `POST /inventory/journal-backfill`:
  **dry run unless `apply: true`**, idempotent, refuses locked years and lists each refusal, posts
  the ORIGINAL layer value.
- **`c844e90` + `8556daf`** — `book-buddha/R4C-WORKINGS.md` (the sign-off document) and three fixes
  found reviewing my own work: the route had never executed in a test; the document wrongly called
  its second scenario the owner's real data; and S7-2 (below) was found. **Five mutations proved the
  new tests can fail**, each restored byte-identically.
- **`732e903` — R4c ON SCREEN** (`web/src/App.tsx`, `web/src/styles.css`): Add stock now names the
  reason (opening / adjustment / purchase) and states what it will post before the button is
  pressed; a second card shows the inventory-vs-ledger tie-out and runs the backfill, check-only
  first with posting disabled until then. Reports now load on arrival; money is Indian-grouped with
  the minus before the ₹. Driven live in the browser; screenshots were sent to the owner.
- `context/` updated: **S7-1** (R4c as built — the four choices that were the assistant's), **S7-2**
  (no way to reverse a stock movement), HOT.md, and an architecture.md section on the stock→ledger
  wiring.

## OWNER ACTION OUTSTANDING
- **`book-buddha/R4C-WORKINGS.md` HAS FOUR DECISIONS FOR HIM** and the R4c acceptance figures.
  **R4c stays "built, figures unconfirmed" until he rules.** The four: (1) deriving the business
  when a company has one; (2) dating the entry but never the stock layer; (3) whether a stock
  recount should show on the CASH P&L (it does not today); (4) shrinkage — which, with **S7-2**,
  means a movement cannot be entered negative, reversed or deleted, so a mistyped opening quantity
  is now wrong in equity too with no correction path. That sits against **cancel-with-reversal**,
  a fixed rule. **Recommended as its own small slice; he chooses when.**
- **The backfill has NEVER touched his real database and must not without his explicit say-so.**
  Offer the DRY RUN on it (read-only) whenever he wants his own figures.
- Still unconfirmed: 7d, 8c, R1, R2, R4, R4b, R5. **Only R3 is signed off (S5-9).**
- **If his database predates v16 it has NO recovery code** — sign in, `POST /auth/recovery-code`
  with the password to mint one. There is no forgot-password or mint FORM in the UI.
- 15 test files are dirty with **CRLF-only churn** (zero content diff) from a session-6 `sed`.
  Offer `git checkout --` on those explicit paths. Session 7 did not touch them.
- `book-buddha/.codebase-memory/` is untracked and probably belongs in `.gitignore` — ask.

## BUILD ORDER — AFTER THE TAG REMOVAL
1. **R5-rem — year close, presentation only.** `getBalanceSheet` already DERIVES
   `RETAINED_EARNINGS` and nothing may post to it, so per **S5-4** no closing entry is ever posted.
   Split that one derived figure into retained earnings BROUGHT FORWARD and profit FOR THE YEAR at
   the financial-year boundary, with an invariant test that the two still sum to today's figure.
   Needs a `businessId` to pick the FY; the consolidated view has none — decide and say so.
   It will show on the Balance Sheet card, so **screenshot it**.
2. **R7b — wire the reports and fix the thin ones.** `reports-sales.ts` and `reports-transactions.ts`
   take a `db` handle and are **unreachable** — no importer outside their own tests. Give them
   repository methods and routes, then fix the reports in **S5-7** that are thinner than their
   names. New ageing / statement / open-invoice / customer-balance reports must read
   `getOpenCustomerItems` / `getOpenSupplierItems` (still no non-test caller), so there is ONE
   definition of what is owed. **Settle `GeneralLedgerRow.date` here:** it still shows the POSTING
   timestamp, so a back-dated opening entry appears under today's date — now plainly visible on
   screen in the R4c screenshots.
3. **R8** — purchase returns, supplier refunds, payment cancellation, bill discount.
4. Then **R10** import/export · **R11** backup/restore · **R12** banking · **R13** cash flow ·
   **R14** archive. **8 R items remain** (R4c is built).

## ENGINEERING TRAPS (sessions 4–7 hit all of these)
- **FIFO consumes layers `ORDER BY occurred_at`** (`getStockLayers`), so a back-dated layer
  re-measures posted COGS. R4c's rule: date the ENTRY, never the layer. Keep it.
- **The frozen seed lists are frozen on purpose** — `V9_*`, `V11_*`, `V13_ADDED_ACCOUNTS`,
  `V15_ADDED_ACCOUNTS`. Each migration seeds from the list frozen AT ITS OWN VERSION. A new account
  means a NEW frozen list and a NEW migration. **Next free version is v17.**
- **A migration test that runs the whole chain on an empty DB tests NOTHING.** Build to v<n-1> with
  `migrations.filter(m => m.version <= n-1)`, insert survivors by raw SQL, then apply v<n> by
  calling `applyXSchema(db)` DIRECTLY (a second `runMigrations` is a no-op). Then mutation-prove it.
- **Any rebuild of `chart_accounts` must drop and replay EVERY trigger whose body mentions it**,
  including `journal_lines_account_exists`, which lives on `journal_lines`.
- Account codes are **not** a fixed union. **Reports must group by `chart_accounts.type`/`role` via
  JOIN**, never a hardcoded code list.
- Reports key on **`entry_date`**, not `created_at`. `payments.payment_account` is still
  `CHECK IN ('CASH')`. `recordPayment` hardcodes CASH; `finalizeCreditNote` hardcodes `SALES` (S5-8).
- **Fastify tests cannot use fake timers.** Age a session out with `validateSession(token, future)`.
- **A new API route is protected automatically** (absence of `config` = deny). If one must be
  public, add it to `PUBLIC_ROUTES` in `src/api/auth-enforcement.test.ts` deliberately.

## HOW TO WORK (this is what worked in sessions 6–7 — keep doing it)
- **Reproduce every suspected defect before fixing it**, and **mutation-test the important ones**:
  break the implementation, watch the test fail, restore it, watch it pass. **Back the file up to
  the scratchpad and restore with `cmp` to prove a byte-identical restore — NEVER `git checkout` to
  undo a mutation while the work is uncommitted.**
- **Prove it against the RUNNING system, not only the harness.** Seed a throwaway database in the
  scratchpad, `node.bat dist/api/main.js` (port 3000) + `node_modules/.bin/vite.cmd` (5173), sign in
  through the real gate, drive the browser. **NEVER point it at his real database.**
- **THE OWNER WANTS SCREENSHOTS.** Standing instruction from session 7: when a piece of work is
  finished and gated, show him images of how it looks in the app. If a slice has no screen, say so
  plainly and offer to build one rather than sending a picture of something unrelated.
- **Triage every test your change turns red** into: pins the old behaviour (update deliberately,
  with a reason in the file) · incidental count (update, with a reason) · **an `ACCEPTANCE` figure
  moved — STOP and look, do not edit it.** In R4c the owner's bill figure was preserved by measuring
  the bill's OWN entries instead of the account total.
- **Guard every sweep against passing vacuously.** Assert known anchors are present; collect
  failures into an array asserted `toEqual([])`.
- Max 2 agents; **NEVER both in `repository.ts`.** The orchestrator owns `migrations.ts`, assigns
  versions, and **alone runs the full suite** (S5-5). **Review what agents hand back — read the
  code, do not take the report on trust.**
- **Advisor = Fable. Discuss the plan BEFORE building and again before declaring done.** In session
  7 it caught the backfill route that no test had ever executed, the workings document claiming
  invented figures were the owner's real data, and the missing fair-tag test.
- Stage by **explicit path**, never `git add -A`. One commit = one idea. **Put the honest limits in
  the commit message.** Committing locally is pre-authorised; **ASK BEFORE PUSHING.**
- `context/HOT.md` stays **under 50 lines** — session 7 wasted four commits discovering that
  reflowing text does not reduce a line count. **Delete words, then count.**

## WHERE THE PRODUCT ACTUALLY STANDS — do not over-report progress
Roughly **48% of a first working MVP**, about **76% of the backend**. **16 migrations (v17 free),
103 routes, 37 test files, 458 tests green.** Auth is real and enforced; opening stock now reaches
the ledger and has the only purpose-built screen in the app. The UI is otherwise still ONE
proof-of-concept page plus the login gate — no routing, and no screens for purchases, payments,
credit notes, reports, opening balances or settings. **PDF/print, import, export, backup and restore
do not exist at all.** Estimated **45–65 hours** to a usable MVP, of which 25–40 is the UI.

REALISM — fewer slices done properly beats all of them rushed. Say exactly where you stopped and
what is unverified; **report nothing as done that is not gated.**
