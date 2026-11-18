Resume Book Buddha — autonomous backend finish, session 11.

## READ THIS BLOCK BEFORE ANYTHING ELSE

**THE OWNER'S STANDING INSTRUCTION, GIVEN IN SESSION 8 AND STILL IN FORCE:**
**Do not build UI.** He will design the frontend himself once the API, database and backend work
properly. Build backend only. Screenshots only of something that genuinely works — if a slice has
no screen, say so plainly rather than sending a picture of something else.

**THE OWNER'S INSTRUCTION FOR THIS SESSION, GIVEN 2026-11-18 AT THE CLOSE OF SESSION 10:**
> "Pause on this, I will answer all of them, as my starting prompt in next session."

"All of them" is **THE NINETEEN QUESTIONS BELOW.** They were put to him as one numbered batch at
the end of session 10, each with a default he can approve in a word. He chose to answer them in
writing, cold, as his opening message here. **SO THIS SESSION OPENS BY TAKING HIS ANSWERS, NOT BY
RE-ASKING.** If his first message says "approve all", or "all except 3, 9", or answers by number,
that is the backlog cleared — treat it as such and move.

**WHAT TO DO WITH HIS ANSWERS, IN THIS ORDER:**
1. Write each answer into `context/decisions.md` as its own **S11-n**, dated, in the words he
   gave, newest first. A default he approved in a batch is still his ruling — record it as
   approved by batch, with the default's wording, not as if he had argued it out.
2. **Say at once which answers change something already built.** Items **1, 4, 5 and 9** can.
3. Then do the work the answers require, smallest first. Items **4** (credit-note date, one
   migration, **v20**) and **8** (`.gitignore`) are the only ones that are certainly work.
4. Items **17 and 18 are the acceptance block** — seven slices still need his figures once 7d and
   8c are confirmed. That is a conversation, not a build; run it the way R4c ran, which worked.
5. Only when the list is genuinely empty — or he parks the rest — move to BUILD ORDER.

**HE HAS ALREADY RULED ON THESE. DO NOT RE-ASK THEM.**
- The four R4c decisions → **S10-1** keep the one-business refusal · **S10-2** date the entry, not
  the layer · **S10-3** a recount stays out of the cash P&L · **S10-4** build the stock-reversal
  slice, and build it **before R9**.
- **S7-2 is CLOSED by S10-4.** The reversal slice *is* the answer to it.
- **R4c scenario 1 is SIGNED OFF (S10-6)** — the second slice through acceptance after R3. The
  backfill (scenario 2) is NOT signed off and has never touched his real database.
- **Subscriptions is DEFERRED by his own S1-5** (early closure · statement layouts ·
  refund-vs-carry-forward). It is not an open question; do not put it to him again.
- **Pushing works and nothing is unpushed.** The old "3 unpushed commits" was false — re-verified
  in session 10: `git log --oneline @{u}..HEAD | wc -l` → **0**.

---

## THE NINETEEN QUESTIONS — as put to him, with the default attached to each

### Accounting — these can change what is built
1. **Discount on a purchase bill (S9-1).** Rs 1,000 bill, Rs 150 off: stock is carried at Rs 1,000
   and the Rs 150 credits PURCHASE_DISCOUNT (income). AS 2 would carry the stock at Rs 850. Profit
   is identical once the goods sell; until then stock *and* this year's income are each Rs 150
   high. → **DEFAULT: keep as built.** Pushing the discount into goods cost cannot come out exact
   (a layer holds an integer unit cost) — it is a slice of its own. **If he overrules this, v18's
   posting changes and the stock-layer problem must be solved, not side-stepped.** Figures are in
   the ACCEPTANCE block of `src/database/bill-discount.test.ts`.
2. **Freight when goods go back (S9-2).** Freight in was really incurred and the supplier does not
   refund it, so a return claws back the discount in proportion but not the extra charge.
   → **DEFAULT: keep as built, no clawback.** Hangs on item 1 — the same cost-of-inventory question.
3. **Cancelling a receipt moves an earlier month's cash profit (S8-1).** The cash view is derived
   from receipts as they stand now, not posted, so cancelling an October receipt in December
   changes October's cash profit — and the financial-year lock cannot refuse it, because nothing
   is posted for it to refuse. → **DEFAULT: leave as built; when R13 cash flow is built, the
   report warns that a document in its range was cancelled later.**
4. **A credit note has no date of its own (S8-4).** It always lands in the month it is finalised.
   A purchase return (v19) does carry its own date — that is the pattern to copy.
   → **DEFAULT: fix it.** One migration (**v20**); existing notes keep their finalise date.
5. **Which income account a sale uses (S5-8).** `finalizeCreditNote` always debits `SALES`
   (`repository.ts:1401`), whatever the invoice credited. Latent today: no invoice path can reach
   a user-created income account, and report totals still tie because both sides move together.
   The real question is his: **should an invoice be able to pick its income account** (Book Sales /
   Magazine Sales / Fair Sales)? → **DEFAULT: one income account now, revisit when he wants the
   split.** No code change on the default.

### His data and his machine
6. **The R4c backfill.** On 15 Nov there was no real `.db` file at all (`todos.md`). **ASK FIRST
   whether one exists now.** If not, this item closes. If it does → **DEFAULT: dry-run on a COPY,
   show him his own numbers, he decides.** **NEVER his live file.** Do not propose copying it
   yourself — `BOOK_BUDDHA_DATABASE` may point outside the repo.
7. **The sign-in window on 2026-11-17.** Nothing in this repo opens one. → **DEFAULT: log it as
   unexplained and move on**, unless it has happened again.

### Build plumbing
8. **`.gitignore`** (it adds `.codebase-memory/`) has been modified and deliberately uncommitted
   since session 9. → **DEFAULT: commit it on its own.**
9. **R9 attachments needs file upload.** Either install `@fastify/multipart`, or send the file as
   base64 inside JSON. **npm is not on PATH here, so an install needs his hands.**
   → **DEFAULT: base64 — no install, no new dependency.** About 33% more bytes in transit, which
   is nothing for a local app. This is the R9 gate: settling it unblocks R9.

### FD §H — bank categorization / OCR / archive, still unapproved as a design
10. **Archive scope:** masters (customers/suppliers/items) only, or documents too with a
    hide-from-default filter? → **DEFAULT: masters only in V1.**
11. **A bank line matches a bill:** record the payment automatically, or require a confirm?
    → **DEFAULT: require a confirm** — consistent with his no-auto-post rule (FD §H, D5).
12. **The `Uncategorized` holding account:** auto-created, or owner-named?
    → **DEFAULT: auto-created, renameable later.**
13. **Approve FD §H as the V1 design** on that basis? → **DEFAULT: yes.**

### Three small calls carried since session 5
14. **A fair that does not exist**, asked for in a report → error, or empty report?
    → **DEFAULT: error.** An empty report reads as "no sales at that fair", which is a lie.
15. **Which date the general ledger shows** (`GeneralLedgerRow.date`) — the transaction date he
    entered (`entryDate`), or the posting timestamp? → **DEFAULT: the transaction date.**
16. **A 1-paise gap** between gross and (net + GST) part-way through collection in the cash P&L.
    → **DEFAULT: acceptable** — it is exact once fully collected.

### Acceptance — the biggest carried block
17. **7d and 8c need one line from him, not a workings pack.** He GAVE these figures on 2026-11-15
    and the app reproduces them as `ACCEPTANCE …` tests: cash invoice gross **590000**, GST
    **90000**, net **500000**, COGS **300000**, receivable **590000** · cash bill expense
    **50000**, inventory **250000**, ITC **54000**, payable **354000** · net profit accrual
    **300000** vs cash **150000** · Fair A sales **40000**, costs **23000**, profit **17000** ·
    Fair B sales **20000**, costs **12000**, profit **8000**.
    → **DEFAULT: he confirms these as given and both slices are signed off.**
18. **The other seven: R1, R2, R4, R4b, R5, R7, R8.** R4c was signed off on a seven-line table and
    that format worked. R4 and R4b already have `ACCEPTANCE` tests (`opening-balances.test.ts`,
    `opening-sub-ledger.test.ts`) to draw a pack from; R8 has `bill-discount.test.ts`.
    → **DEFAULT: one short table per slice, one at a time, R8 first** — unless he would rather
    hand over his own scenario to run. **Acceptance = his hand-worked figures agreeing with the
    app. Never a passing test.**

### Housekeeping
19. **Commit the trial-balance fix?** **HE DID NOT ANSWER THIS, SO IT IS STILL UNCOMMITTED.** Seven
    files, on `autonomous/book-buddha-finish`, message *"Trial balance: report balances, not gross
    movements (owner-found)"*: `book-buddha/src/database/repository.ts` ·
    `book-buddha/src/api/purchasing.test.ts` ·
    `book-buddha/src/database/report-fair-filter.test.ts` ·
    `book-buddha/src/database/report-filters.test.ts` ·
    `book-buddha/src/database/repository.test.ts` ·
    `book-buddha/src/database/stock-journal.test.ts` · `book-buddha/R4C-WORKINGS.md`.
    One idea: the trial balance now reports balances, not gross movements. `context/*` is held
    back for its own commit. **Ask again before pushing — "yes, commit" is not "yes, push".**

---

**R<n> IS S<n> in `book-buddha/REMAINING_BUILD_PLAN.md`.** "R9" appears nowhere in `spec/` or
`context/` — the letter changed, the numbering did not. R9 = S9 Attachments, R10 = S10
Import/export, R11 = S11 Backup, R12 = S12 Banking, R13 = S13 Cash flow, R14 = S14 Archive.

**MODEL USE (his instruction):** Sonnet writes code, Opus (the orchestrator) does the testing,
Haiku with CBM updates and searches files and docs. **Sessions 8 AND 9 did not follow this** —
every slice landed in `repository.ts`, and only one agent may hold that file at a time, so the
orchestrator wrote it all. That excuse finally expires: **R9 lives in `src/attachments/`, outside
`repository.ts`. It is the slice to hand to Sonnet.**

**NEXT MIGRATION VERSION IS v20.** v18 = `bill_discount`, v19 = `purchase_returns` (both session
9). Versions are owned by `src/database/migrations.ts`; schema files never self-register.

**CONTEXT LEVERS.** CBM project id `C-Users-Admin-Desktop-Book-Buddha-book-buddha`, **re-index
first** (`index_repository`, mode `fast`). `src/database/repository.ts` is now **~5,300 lines**
and `src/api/server.ts` ~1,500: **never read either end to end.** `get_file_outline` to enumerate,
`search_graph` for symbols, `get_code_snippet` for ONE body, grep only for literals.
**CAVEAT: `fast` mode does not index `*.test.ts`**, so `callers: N` is blind to tests — grep the
test files separately before changing any signature. On headroom, see **S6-5**; do not spend a
turn re-diagnosing it.

## ORIENT
1. `context/HOT.md` — auto-loaded, accurate as of session 9. Trust it.
2. `git branch --show-current` must be `autonomous/book-buddha-finish`; tip **`fec2d2a`** or later.
3. `context/decisions.md` — read **S9-1 … S9-4** first (two of them CORRECT facts earlier sessions
   recorded wrongly), then S8-1 … S8-4. S5-x, S6-x and S7-x still apply.
4. **Count the unpushed commits, never quote a number out of this file:**
   `git log --oneline @{u}..HEAD | wc -l`. It was **3** at the close of session 9; nothing has
   been pushed to the remote on this branch for three sessions.
   **PUSHING WORKS FROM A TOOL SHELL.** Measured 2026-11-17, dry-run, twice: with
   `GIT_TERMINAL_PROMPT=0` alone it took over 60s and the tool timeout killed it — the exact shape
   of "cannot push" that sessions 4–8 wrote down as fact. With Git Credential Manager's own
   interactivity off as well (`GCM_INTERACTIVE=never`, `-c credential.interactive=false`) it
   exited 0 in **3 seconds**. A credential IS stored under `credential.helper=manager`. `gh` is
   NOT logged in and is not needed.
   **STILL UNRESOLVED, and it matters when he is away:** whether that slow first attempt was GCM
   opening a sign-in window he completed at the screen (he was there), or just a slow first fetch.
   **Ask him whether a sign-in window appeared.** If it did, the credential can lapse and the next
   push will block on a popup — so never leave one in the foreground.
   **None of this changes permission: ASK HIM BEFORE EVERY PUSH, and only to this feature branch,
   never `main`.** "Yes, commit" is not "yes, push". After a push, confirm
   `git log --oneline @{u}..HEAD` is empty.
5. Gates (npm is NOT on PATH), from `book-buddha/`:
   `./node_modules/.bin/vitest.cmd run --root .` · `tsc.cmd` · `vite.cmd build`
   **Baseline at the close of session 9: 44 files, 528 tests, tsc clean, build clean.**
   **There are THREE gates, not four (S9-4).** HOT.md used to list "web tsc clean" as a fourth;
   `web/tsconfig.json` does not exist and the root `tsconfig.json` has `"include": ["src"]`, so
   `tsc.cmd -p web/tsconfig.json` exits 2. The web side is covered by the vite build.
   ⚠️ **NEVER pipe a gate into `tail` and read `$?`** — that is tail's exit code. Run it unpiped.
   ⚠️ **vitest does NOT type-check** (esbuild transpiles). A test file can pass vitest and fail
   `tsc`. Session 8 claimed "tsc clean" in a commit before running it, and was wrong.
   ⚠️ **READ the test count out of the run before writing it in a message.** Session 8 wrote a
   guessed count into two commit messages and had to amend both.
6. **`web/` is type-checked by NOTHING** (S6-4) — the vite build bundles it without checking it.
   After touching it, run by hand:
   `tsc.cmd --noEmit --jsx react-jsx --target ES2022 --module esnext --moduleResolution bundler
   --lib ES2022,DOM,DOM.Iterable --strict --skipLibCheck web/src/main.tsx`
7. `node` is not on bash's PATH but **is** available to PowerShell as `node.bat`. A one-off script
   that needs `better-sqlite3` must either live INSIDE `book-buddha/`, or import it by absolute
   `file:///.../book-buddha/node_modules/better-sqlite3/lib/index.js` URL — a scratchpad script
   cannot resolve the bare module name.
8. **Stop dev servers BY PORT**, never `Get-Process node | Stop-Process` — that kills every node
   process on his machine, his own included.

## WHAT SESSION 10 DID — no build slice, by his instruction
1. **HE FOUND A REAL DEFECT AND IT IS FIXED.** Reviewing the R4c figures he rejected the trial
   balance: it totalled **Rs 17,750** a side because every two-sided account printed **gross**
   (`SUM(debit)` and `SUM(credit)`) instead of its balance — INVENTORY read Dr 11,250 / Cr 2,500
   rather than the Dr 8,750 actually held. `getTrialBalance` was passing `getReportAccountRows`
   straight through. **It survived nine sessions and 528 tests because a gross trial balance still
   balances, and `debits === credits` was the only assertion anywhere.** Now netted; totals are
   **Rs 15,250**; the R4c acceptance test pins both the totals and the INVENTORY row. Ruling
   **S10-5**. Presentation only — the P&L, balance sheet and the UI tie-out all already netted.
2. **Four tests went red and all four were pinning the old gross shape** — `purchasing.test.ts`,
   `report-filters.test.ts`, `report-fair-filter.test.ts`, `repository.test.ts`. **None was an
   `ACCEPTANCE` test**, so no figure he had ever accepted moved. Each carries its reason in the
   file now. `repository.test.ts` additionally made the **S7-1(d)** gap visible: a bare `PURCHASE`
   movement posts nothing yet FIFO still consumes it, which the gross columns had been hiding.
3. **R4c scenario 1 signed off (S10-6)** and its four decisions settled (**S10-1**..**S10-4**),
   which also closes **S7-2**. `book-buddha/R4C-WORKINGS.md` is headed **SCENARIO 1 APPROVED** —
   the backfill in scenario 2 is explicitly not signed off.
4. **Two carried facts were false and are corrected.** Nothing is unpushed (it was never 3). And
   the list of slices awaiting acceptance has **ten** names, not nine — now **nine**, with R4c
   done. Also re-filed the misplaced **S9-1..S9-4** block from the bottom of `decisions.md` into
   the newest-first top block where it belonged.
5. **Honest caveat on the Rs 15,250 table he was shown:** it came out of the R4c acceptance test
   running the real repository on an in-memory throwaway database — not a separate HTTP run
   against a file database, which is what had been promised. The figures are the app's own; that
   is just the route they came by. He was told.

## WHAT SESSION 9 DID (do not rebuild any of it)
- **`8a16b88` — R7 fair-sales FIXED, not retired.** `/reports/fair-sales` and
  `/reports/sales-by-item` ignored credit notes and took no filters, so fair-sales answered
  **60,000** where `/reports/sales-by-fair` answered **40,000 on the same books**. Both figures
  were reproduced before a line was changed. The three routes that answer one question now agree.
- **`1e57882` — R8 bill discount, migration v18.** Header discount and extra charge on a purchase
  bill. The discount credits its own INCOME account (`PURCHASE_DISCOUNT`), the extra charge debits
  its own EXPENSE account (`PURCHASE_EXTRA_CHARGES`), and **INVENTORY is debited at FULL line
  cost**. Netting the discount into goods cost was ruled out by the DATA MODEL, not by taste: a
  stock layer holds an integer `unit_cost_paise` so it cannot absorb a header discount exactly,
  and a bill of pure stock lines has no expense debit to net against — netting there drives
  EXPENSE to a credit balance, the same shape as the SALES-in-debit hole closed in session 8.
  Debiting INVENTORY in full is also what keeps the INVENTORY ledger equal to the stock-layer
  value **by construction**. **The AS 2 trade-off is S9-1 and is HIS to rule on.**
- **`fec2d2a` — R8 purchase returns + supplier refunds, migration v19. R8 IS NOW COMPLETE.**
  Tables `purchase_returns`, `purchase_return_lines`, `supplier_refunds`; one new account
  `SUPPLIER_CREDITS` (**ASSET** — the mirror of `CUSTOMER_CREDITS` being a LIABILITY; a return the
  supplier has not refunded is money owed to US). Seven repository methods, six routes, 20 tests.
  Three things it had to get right, each with its own test:
  - **INVENTORY stays equal to the stock-layer value.** A return must use the price the bill
    charged, because that is exactly what the layer holds.
  - **PAYABLES never goes into DEBIT.** Returning a PAID bill books the excess to
    `SUPPLIER_CREDITS`, so payables lands on zero instead of carrying a phantom receivable. This
    is the THIRD time that shape has appeared (S4-1 on RECEIVABLES, session 8 on SALES).
  - **A fully returned DISCOUNTED bill gives back exactly what was owed.** The discount is clawed
    back in proportion and the return that completes the bill absorbs the remaining headroom, so
    it lands on nil rather than stranding a paisa.
  A return carries its **OWN date**, unlike a credit note (S8-4). Proved on a real v18→v19
  upgrade of a throwaway database.

## BUILD ORDER — **not until the backlog above is cleared**
### 1. R9 attachments — small, and the last easy one. CHECK THE GATE FIRST.
The storage engine **already exists and was built in session 2** (`4033ecb`, migration v7):
`src/attachments/attachments.ts`, 267 lines — `storeAttachment`, `listAttachments`,
`getAttachment`, `getAttachmentPath`, `deleteAttachment`, plus `ATTACHMENT_ENTITY_TYPES` and a
10 MB default cap. Its table is in `src/database/attachments-schema.ts` and is already migrated.
**It has NO importer anywhere outside its own folder — zero routes, zero repository calls.** This
is exactly the hole R7b had: built, tested, unreachable. What remains is wiring plus HTTP tests.
- **FIRST STEP, before planning anything: grep `book-buddha/package.json` for `multipart` and
  `busboy`. As of session 9 there is no `@fastify/multipart` and no multipart parser of any
  kind.** A real file upload therefore needs either a dependency install — **which needs his
  say-so, so ASK AND WAIT** — or a base64 JSON body, which is honest for a 10 MB offline app and
  needs no install. **Put both options to him with the trade-off and let him pick.**
- **If he is not there to approve an install, do not install anything unasked.** Say plainly that
  R9 is gated and take the smallest other R instead.
- `src/attachments/` is **outside `repository.ts`** — hand it to Sonnet.

### 2. After that
**R10** import/export · **R11** backup/restore · **R12** banking · **R13** cash flow ·
**R14** archive. Their one-paragraph definitions are in `book-buddha/REMAINING_BUILD_PLAN.md`
under S10–S14. R11 backup/restore is the one with the most real-world value to him and the
least new accounting risk; R12 banking is the largest.

## OWNER ACTION OUTSTANDING
**Everything he owes is now THE NINETEEN QUESTIONS in the block at the top of this file**, which
he has said he will answer as his opening message. Do not maintain a second copy of that list
here — it goes stale. Only these two items sit outside it:
- **If his database predates v16 it has no recovery code** — sign in, `POST /auth/recovery-code`.
  This is a thing for HIM to do on his own machine, not a question to answer.
- **Known flake, pre-existing, not his to decide:** the fuzz test in
  `src/accounting/engine.test.ts` ("allocateProportionally … fuzz") can exceed its 5000ms
  per-test limit under full-suite parallel load, then passes alone. Timing-fragile, not wrong.

**The seven-file trial-balance commit is question 19 and is still UNCOMMITTED in the working
tree.** `context/*` changes are held back for their own commit. Nothing in the tree is lost, but
nothing is committed either — check `git status` before assuming a clean start.

## ENGINEERING TRAPS (sessions 4–9 hit all of these)
- **`getStockLayers` matches a `PURCHASE_REVERSAL` to its lot by `source_id` AND `unit_cost_paise`
  against the layer — and the layer carries the BILL's id.** Session 9 stamped a return's own id
  on the movement; it matched no layer, **removed no stock, and the ledger credited INVENTORY
  anyway.** tsc was clean and only the stock-equals-ledger assertion caught it. If you write a
  stock reversal, stamp the BILL, and assert the ledger equals the valuation afterwards.
- **`buildApi` takes TWO POSITIONAL arguments:**
  `buildApi(repository, { __unsafeDisableAuthForTests: true })`. Passing one object gives every
  route a 500 that looks like a route bug. Session 9 lost time to this.
- **FIFO consumes layers `ORDER BY occurred_at, rowid`**, so a back-dated layer re-measures posted
  COGS. R4c's rule: date the ENTRY, never the layer. Keep it. (Corollary found in v19: restoring
  stock puts the layer at the END of the queue, not back in its old position.)
- **The frozen seed lists are frozen on purpose** — `V9_*`, `V11_*`, `V13_ADDED_ACCOUNTS`,
  `V15_ADDED_ACCOUNTS`, `V18_ADDED_ACCOUNTS`, `V19_ADDED_ACCOUNTS`. Each migration seeds from the
  list frozen AT ITS OWN VERSION. A new account means a NEW frozen list and a NEW migration.
  **Adding one WILL turn `migration-v15-seeding.test.ts` red** — it pins the live chart to the
  concatenation of the frozen lists, which is the invariant it exists for. Add your list to it.
- **A new seeded account can break tests that have nothing to do with it.** v19's
  `SUPPLIER_CREDITS` made the count of debit-normal and credit-normal seeded accounts equal, and a
  helper in `chart-accounts.test.ts` that squared an entry off against CASH then tried to post a
  0/0 line the CHECK rightly refuses. **Triage before editing: no figure moved there.**
- **A migration test that runs the whole chain on an empty DB tests NOTHING.** Build to v<n-1>
  with `migrations.filter(m => m.version <= n-1)`, insert survivors by raw SQL, then apply v<n> by
  calling `applyXSchema(db)` DIRECTLY (a second `runMigrations` is a no-op). Then mutation-prove.
- **Any rebuild of `chart_accounts` must drop and replay EVERY trigger whose body mentions it**,
  including `journal_lines_account_exists`, which lives on `journal_lines`. An ADDITIVE migration
  (new tables, new seeded rows) rebuilds nothing and needs no replay — assert that in the test.
- Account codes are **not** a fixed union. **Reports must group by `chart_accounts.type`/`role`
  via JOIN**, never a hardcoded code list.
- Reports key on **`entry_date`**, not `created_at`. The journal-line FK column is
  **`jl.journal_entry_id`**, not `entry_id`. `payments.payment_account` is still
  `CHECK IN ('CASH')` — which is why credit-note refunds and supplier refunds each have their own
  table in order to reach BANK. `recordPayment` hardcodes CASH; `finalizeCreditNote` hardcodes
  `SALES` (S5-8).
- **The posting door rejects a 0/0 journal line.** Filter zero-amount lines out before posting.
- **Fastify tests cannot use fake timers.** Age a session out with `validateSession(token, future)`.
- **A new API route is protected automatically** (absence of `config` = deny). If one must be
  public, add it to `PUBLIC_ROUTES` in `src/api/auth-enforcement.test.ts` deliberately.
- **`perl -i -pe` interpolates `$` in the replacement.** Session 8 silently ate a `${item.date}`
  this way and tsc still passed, because the result was valid TypeScript and simply wrong. Use
  the Edit tool or a Python patch for anything containing `$`.
- **Do not build a code block inside a bash heredoc.** Session 9 lost a turn to bash dying on an
  unmatched quote in a TypeScript block full of apostrophes, and an UNQUOTED heredoc is worse — it
  runs each backticked span as a command. **Write the block to a file with the Write tool, then
  splice it in with a short Python script that asserts the anchor appears exactly once.**
- **Write these markdown files with the Write tool, not a shell heredoc**, for the same reason.
  Nothing gates markdown.

## HOW TO WORK (this is what worked in sessions 6–9 — keep doing it)
- **Reproduce every suspected defect before fixing it**, and **mutation-test the important ones**:
  break the implementation, watch the test fail, restore it, watch it pass. **Back the file up to
  the scratchpad and restore with `cmp`/SHA256 to prove a byte-identical restore — NEVER
  `git checkout` to undo a mutation while the work is uncommitted.**
- **Prove a migration on a REAL file, not only in memory.** Build a throwaway DB to v<n-1>, put
  real rows in it, then open it with the live repository so it upgrades on open, and check the
  survivors, the new behaviour, the INVENTORY-equals-valuation tie, that the whole ledger balances
  and that `PRAGMA foreign_key_check` is empty. v18 and v19 were both proved this way.
  **NEVER point any of this at his real database.**
- **Triage every test your change turns red** into: pins the old behaviour (update deliberately,
  with a reason in the file) · incidental count or stale snapshot (update, with a reason) · **an
  `ACCEPTANCE` figure moved — STOP and look, do not edit it.** In session 8 a red test was right
  and the new code was wrong.
- **Guard every sweep against passing vacuously.** Assert known anchors are present; collect
  failures into an array asserted `toEqual([])`.
- **Every new route needs a test that actually calls it over HTTP.** Session 7 shipped a route no
  test had ever executed.
- **Where a choice is forced by the data model, make it and say so; where it is an accounting
  policy, it is HIS.** v18 and v19 both took that split and it kept the build moving without
  taking a decision that was not the assistant's to take. Write the trade-off into the code AND
  the commit message, not only into a context file.
- Max 2 agents; **NEVER both in `repository.ts`.** The orchestrator owns `migrations.ts`, assigns
  versions, and **alone runs the full suite** (S5-5). **Review what agents hand back — read the
  code, do not take the report on trust.**
- **Advisor = Fable. Discuss the plan BEFORE building and again before declaring done.** In
  session 8 it caught an ungated "vite build clean" claim, the receivables/ageing as-at
  disagreement, and the SALES-in-debit hole that payment cancellation had opened.
- Stage by **explicit path**, never `git add -A`. One commit = one idea. **Put the honest limits
  in the commit message.** Committing locally is pre-authorised; **ASK BEFORE PUSHING**.
- **A hung command is not a broken capability.** "A tool shell cannot push" survived four sessions
  as fact because a 60s timeout was read as a failure and nobody re-tested it. **"Purchase returns
  are blocked on S7-2" survived two sessions the same way, and was never true** (S9-3). If a
  context file states a blocker, **verify it in the code before planning around it.**
- `context/HOT.md` stays **under 50 lines**. **Delete words, then count** — reflowing does nothing.

## WHERE THE PRODUCT ACTUALLY STANDS — do not over-report progress
Roughly **56% of a first working MVP**, about **87% of the backend**. **19 migrations (v20 free),
123 routes, 44 test files, 528 tests green.** Auth is real and enforced; opening stock reaches
the ledger; the sales and transaction reports are reachable and now agree with each other;
receivables and payables age properly; a payment can be undone; purchases carry discounts and
goods can go back to a supplier on their own dated document. **R8 is the last of the big
accounting slices** — what remains is plumbing (import/export, backup, banking, cash flow,
archive) rather than new double-entry.
The UI is still ONE proof-of-concept page plus the login gate — **and that is deliberate: the
owner will build the frontend himself.** PDF/print, import, export, backup and restore do not
exist at all, and attachments exist but cannot be reached over the API.

REALISM — fewer slices done properly beats all of them rushed. Say exactly where you stopped and
what is unverified; **report nothing as done that is not gated.** And note that **acceptance for
nine slices still awaits him** — only **R3 and R4c** are through. That backlog is a bigger risk to
this project than the next build slice is.
