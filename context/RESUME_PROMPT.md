Resume Book Buddha — autonomous backend finish, session 12.

## READ THIS BLOCK BEFORE ANYTHING ELSE

**THE OWNER'S STANDING INSTRUCTION, GIVEN IN SESSION 8 AND STILL IN FORCE:**
**Do not build UI.** He will design the frontend himself once the API, database and backend work
properly. Build backend only. Screenshots only of something that genuinely works — if a slice has
no screen, say so plainly rather than sending a picture of something else.

**THE NINETEEN QUESTIONS ARE CLOSED. DO NOT RE-ASK THEM AND DO NOT RE-DERIVE THE LIST.**
He answered all nineteen in session 11, cold and in writing. Every answer is recorded in
`context/decisions.md` as **S11-1 … S11-22**, in his own words, dated 2026-11-18. The old question
block has been deleted from this file on purpose — `decisions.md` is the record now.
**Item 9 he never actually answered** (his message repeated the accounting block); the default was
taken and recorded as **S11-19**, and that is the one answer he may want to revisit.

**START HERE: `context/HOT.md`**, then `context/decisions.md` **S11-1 … S11-22** newest-first.
S11-1, S11-2, S11-3, S11-5 and S11-22 are the ones that still carry unbuilt work.

## WHAT SESSION 11 DID

He answered the nineteen questions; the whole backlog is cleared. Four small items followed from
them and **all four are finished, tested, committed and pushed**:
1. **Item 14 → S11-9.** A report for a fair that does not exist now raises a clear error instead of
   returning no rows (which read as "no sales at that fair"). Guarded at the choke points, so all
   fourteen report entry points are covered. 43 tests in
   `book-buddha/src/database/report-unknown-fair.test.ts`.
2. **Item 15 → S11-10. NO WORK NEEDED** — already correct, fixed back in R7b. Do not rebuild it.
3. **Item 4 → S11-4 / S11-20 / S11-21.** A credit note may carry its own transaction date
   (migration **v20**). No date given leaves `note_date` **NULL** and the note posts on the day it
   is finalized, so **`ACCEPTANCE S4-8` passes with no assertion changed** — no signed figure moved.
   A date in an earlier month is refused until the caller confirms; the financial-year lock stays
   absolute and a confirmation cannot override it. 10 tests in `credit-note-date.test.ts`.
4. **Item 16 → S11-11 / S11-22.** The derived cash view now ties to the cash that actually moved,
   to the paise, through a **visible signed `ROUNDING` line** (migration **v21**). 9 tests in
   `cash-rounding.test.ts`; plain-English workings in `book-buddha/CASH-ROUNDING-WORKINGS.md`.

**Two rulings he gave by choosing between drawn-out options** — both already built, both recorded:
an undated credit note posts on the **finalise** date (S11-20), and back-dating into an
already-reported month inside an open year is **allowed but warned about** (S11-21).

**A correction worth inheriting:** I told the agent the rounding tolerance guard was missing. It
was already built, and the agent said so rather than building it twice. Check before asserting.

## WHERE THE PENDING WORK IS WRITTEN DOWN — read these, do not re-derive

| What | File | What is in it |
|---|---|---|
| Every ruling S11-1..S11-22 | `context/decisions.md` | His answers, in his words, with the traps named |
| Current status, blockers, next step | `context/HOT.md` | Under 50 lines, always loaded |
| The task list | `context/todos.md` | Slice-by-slice |
| The biggest unbuilt slice | `context/decisions.md` **S11-1** | Discount into inventory cost; **blocks R8 acceptance** |
| Acceptance loop and order | `context/decisions.md` **S11-14** | R4 first, R8 last, seven slices outstanding |
| Banking / OCR / archive design | `Feature Design - Bank Categorization, Bill OCR & Archive (V1).md` | Approved as V1 by S11-15; **§D6 must be amended to TWO Uncategorized accounts per S11-8** |
| Item 4's workings, his format | `book-buddha/CASH-ROUNDING-WORKINGS.md` | Plain English, rupees and paise |
| R4c workings, the format he accepted | `book-buddha/R4C-WORKINGS.md` | Model every future report on this |

## THE NEXT STEP

**The stock-reversal slice (S10-4)**, then **the discount-into-inventory-cost slice
(S11-1 + S11-2)** — the largest piece of work his answers created, and **it blocks R8 acceptance**
because the figures in `book-buddha/src/database/bill-discount.test.ts` change. Its hard part is
named in S11-1 and is NOT solved: a stock layer stores an integer `unit_cost_paise`, so Rs 150 off
a 7-unit bill does not divide into equal whole paise, and the remainder must be placed deliberately
because the layer value must still tie to the INVENTORY balance to the paise. **S11-22 is now the
precedent for how he wants that kind of remainder handled: show it, never absorb it silently.**

Then: **R9 attachments** — far further along than earlier plans assumed. `src/attachments/` is
already built with 24 passing tests and a registered migration; **only HTTP routes and their tests
are missing.** Base64 inside ordinary JSON per S11-19, and Fastify's default `bodyLimit` of 1 MB
**must be raised** because base64 inflates a file by about a third.
Then R10 → R11 backup → R12 banking → R13 cash flow (plus the S11-3 cancellation warning) → R14
archive.

## QUESTIONS WAITING FOR HIM — ask when a slice touches them, not as a batch

1. **A purchase return can still be back-dated with NO warning**, unlike a credit note after
   S11-21. Either returns get the same guard or the difference needs a stated reason.
2. **Item 9 / S11-19** was defaulted, not answered — base64 for attachments. Confirm at R9.
3. **Acceptance for seven slices** — R1, R2, R4, R4b, R5, R7, R8 — run as S11-14 sets out: R4
   first, R8 last. 7d and 8c are **accepted on trust, not hand-verified** (S11-13), a deliberately
   lower grade than R3 and R4c.

## ORIENT

1. `context/HOT.md` — auto-loaded. Trust it over anything written here.
2. `git branch --show-current` must be `autonomous/book-buddha-finish`. **Never `main`.**
3. `context/decisions.md` — **S11-1 … S11-22 first**, then S10-x. S5-x … S9-x still apply.
4. **Count the unpushed commits; never quote a number out of this file:**
   `git log --oneline @{u}..HEAD | wc -l`.
   **PUSHING WORKS, and the old mystery is SOLVED (S11-17).** He confirmed he signed into GitHub by
   hand when a window appeared. So the credential is his and **can lapse again** — when it does a
   push blocks on a pop-up he may not be there to click.
   **Therefore: never leave a push in the FOREGROUND** (the tool timeout kills it and the failure
   looks like "pushing does not work" — the exact false fact S8-5 had to undo). **Run it in the
   background.** And **ask him before every push**, to this feature branch only: "yes, commit" is
   not "yes, push". After a push, confirm `git log --oneline @{u}..HEAD` is empty.
5. Gates (npm is NOT on PATH), from `book-buddha/`:
   `tsc.cmd` **first** · `./node_modules/.bin/vitest.cmd run --root .` · `vite.cmd build`
   **Baseline at the close of session 11: 47 files, 590 tests, tsc clean, build clean.**
   **There are THREE gates, not four (S9-4).** `web/tsconfig.json` does not exist; the web side is
   covered by the vite build.
   ⚠️ **NEVER pipe a gate into `tail` and read `$?`** — that is tail's exit code. Run it unpiped,
   or read the true code out of `PIPESTATUS`.
   ⚠️ **vitest does NOT type-check** (esbuild transpiles). A test file can pass vitest and fail
   `tsc`, so run `tsc` FIRST.
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
9. **There is still NO real database** (S11-16, verified): no `*.db` anywhere outside
   `node_modules`, nothing tracked by git, and the default path `src/api/main.ts:4`
   (`BOOK_BUDDHA_DATABASE ?? "book-buddha.db"`) does not exist on disk. The R4c backfill has
   therefore never run against real books. **Never touch a real database; never copy his live
   file** — `BOOK_BUDDHA_DATABASE` may point outside this repo.

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

## BUILD ORDER — the backlog IS cleared (session 11); THE NEXT STEP above supersedes this list
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
