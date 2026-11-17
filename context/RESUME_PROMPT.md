Resume Book Buddha — autonomous backend finish, session 7.

## READ THIS BLOCK BEFORE ANYTHING ELSE

**HEADROOM — stop trying to turn it on in the desktop app. It cannot work there.**
Session 6 settled this with `headroom doctor`. The proxy is **healthy and running** (v0.40.0 on
`127.0.0.1:8787`, `/readyz` ready, routing + hooks installed for this project). The blocker is one
line: **`claude desktop: agent sessions bypass the proxy (Desktop overwrites ANTHROPIC_BASE_URL)`**,
with the note *"Desktop routing is not supported yet (see #869); use the terminal Claude Code CLI
for proxy-routed sessions."* `headroom_stats` confirms **0 API requests**. A direct
`headroom_compress` probe returned the payload byte-identical with `transforms: ["router:noop"]`.
**So: in the Claude Desktop app, compression is impossible for the orchestrator AND every subagent,
however hard a brief insists.** Session 5's conclusion that "four of five agents ignored headroom"
was almost certainly wrong — they could not have used it. **Do not spend turns on it, and do not
scold agents about it.** → **If you want headroom compression this session, launch Claude Code from
the terminal CLI instead of the desktop app.** Otherwise accept zero and move on. See **S6-5**.

**CBM IS THE REAL CONTEXT LEVER HERE — USE IT ACTIVELY, ORCHESTRATOR AND EVERY SUBAGENT.**
Project id: `C-Users-Admin-Desktop-Book-Buddha-book-buddha`. **Re-index first** (`index_repository`,
mode `fast`). `src/database/repository.ts` is ~4,900 lines and `src/api/server.ts` ~1,250 — **never
read either end to end.**
- `get_file_outline` to enumerate declarations (page with offset/limit)
- `search_graph` for symbols · `get_code_snippet` for ONE body · `trace_path` for reachability
- `search_code` / grep **only** for literals
- **CBM CAVEAT, learned the hard way in session 6:** `fast` mode **does not index `*.test.ts`**, so
  `callers: N` is **blind to tests**. `setupAdmin` reported `callers: 1` while 11 test files used
  it. **Always grep the test files separately before changing any signature.**
- Also: `repository.ts` line 53 fails to parse (`parse_partial`), so constructs there under-report.
- `detect_changes` compares against `main`, and this branch is 37 commits ahead, so its
  `changed_total` is NOT a staleness signal. Just re-index.
**Put CBM in EVERY agent brief in hard terms, with the test-blindness caveat.**

## ORIENT
1. `context/HOT.md` — auto-loaded, **current and accurate as of session 6**. Trust it.
2. `git branch --show-current` must be `autonomous/book-buddha-finish`. Tip **`ceb0db7`**.
3. `context/decisions.md` — read **S6-1 … S6-5** (newest first). S5-1…S5-11 still apply.
4. **37 commits are UNPUSHED and that is deliberate.** A tool shell CANNOT push (no tty for the
   credential manager). Only I push, from my own terminal. Ask if it matters; **never retry**.
5. Gates (npm NOT on PATH), from `book-buddha/`:
   `./node_modules/.bin/vitest.cmd run --root .` · `tsc.cmd` · `vite.cmd build`
   **Baseline: 36 files, 442 tests, tsc clean, build clean.**
   ⚠️ **NEVER pipe a gate into `tail` and read `$?`** — that is *tail's* exit code, not the tool's.
   Session 6 reported "tsc exit: 0" twice on no evidence. Run it **unpiped**, or read
   `${PIPESTATUS[0]}`.
6. `node` is NOT on bash's PATH but **is** available to PowerShell as `node.bat` — that is how to
   run the real app end to end.

## WHAT SESSION 6 DID (auth is CLOSED — do not reopen it)
- **`a1ac6bd`** — the API had **no authentication at all**: 102 routes, no hook. Now ONE
  `onRequest` hook in `buildApi`, **fail closed**. Public only via `config: { public: true }`, read
  from the matched route's own config, **never** a URL string. 5 public routes (7 table entries —
  Fastify mirrors HEAD onto every GET). Unconfigured DB → 409, bad token → 401, unmatched path
  denied not 404-leaked (all measured on Fastify 5.12.8, not assumed). Test opt-out
  `__unsafeDisableAuthForTests` — opt-in, default off, unreachable from `createApi`/`main.ts`/env —
  at 28 call sites. The sweep is **derived** from an `onRoute` hook via `app.authRoutes`.
- **`e69860f`** — `web/src/AuthGate.tsx` + `session.ts`: setup/login gate, since auth broke
  `App.tsx` outright. Token in module scope, **not persisted** (refresh signs out — owner's choice).
- **`7ab89fe`** — recovery code, **migration v16**. Recovery is by 150-bit code only; the old
  email/googleSub match is gone. Using a code **burns** it and reissues. New **authenticated**
  `POST /auth/recovery-code` (needs the current password too).
- **`ceb0db7`** — fixed three defects found reviewing my own work: the v16 migration tests never
  actually exercised v16; the original attack was pinned only through a cast where it passed on a
  `TypeError`; and `AuthGate` **discarded the recovery code** if sign-in failed after setup.

**NOT RE-VERIFIED:** the browser tools stopped being approvable after that last `AuthGate` change,
so the UI was driven live only *before* it. Type checks and build are clean; **nothing tests `web/`.**

## OWNER ACTION OUTSTANDING
- **If my database already has an admin, it predates v16 → NO recovery code → recovery REFUSES**
  (fail closed, deliberate). I sign in and call `POST /auth/recovery-code` with my password to mint
  one. **There is no forgot-password or mint FORM in the UI** — API call only. Offer to build one.
- **ACCEPTANCE R4 and R4b figures still await me.** Put worked examples to me the way
  `book-buddha/R3-WORKINGS.md` did: instrumented dumps of the real app, in rupees, plain English,
  ending in the specific numbers to check. **That document is the pattern for every sign-off.**
- 15 test files are dirty with **CRLF-only churn** (zero content diff) from a session-6 `sed`.
  Offer to restore them with `git checkout --` on those explicit paths. **Scope any future `sed` to
  `grep -l` matches**, never all `*.test.ts`.

## BUILD ORDER — NEXT
1. **R4c — opening stock and stock adjustments. NEXT FREE MIGRATION IS v17** (v16 went to recovery).
   Opening stock posts `Dr INVENTORY / Cr OPENING_BALANCE_EQUITY`; a mid-year ADJUSTMENT posts to
   `STOCK_ADJUSTMENT` (EXPENSE, seeded at v13) per **S5-3**. Then an **idempotent backfill** for the
   OPENING/ADJUSTMENT movements already in my database with no GL entry — through the ledger door,
   refusing movements in locked years and listing them, **never run on my data without my say-so**.
2. **R5-rem — year close, presentation only.** `getBalanceSheet` ALREADY derives
   `RETAINED_EARNINGS` and nothing may post to it, so per **S5-4** no closing entry is ever posted.
   Split that one derived figure into retained earnings BROUGHT FORWARD and profit FOR THE YEAR at
   the financial-year boundary, with an invariant test that the two still sum to today's figure.
   Needs a `businessId` to pick the FY; consolidated has none.
3. **R7b — wire the reports and fix the thin ones.** `reports-sales.ts` and
   `reports-transactions.ts` take a `db` handle and are **unreachable** — no importer outside their
   own tests. Give them repository methods and routes. Then fix the reports in **S5-7** that are
   thinner than their names. Make the new ageing, statements, open-invoices and customer-balance
   -detail reports read `getOpenCustomerItems` / `getOpenSupplierItems` — the shared open-items
   query R4b built, which still has no non-test caller — so there is ONE definition of what is owed.
4. **R8** — purchase returns, supplier refunds, payment cancellation, bill discount.

## ENGINEERING TRAPS (sessions 4–6 hit all of these)
- **FIFO consumes layers `ORDER BY occurred_at`** (`repository.ts:3003`), so a BACK-DATED opening
  stock layer jumps ahead of layers already consumed and re-measures posted COGS. Refuse an opening
  movement when the item already has outgoing movements, or date only the journal entry.
- `addStockMovement` has **no `businessId`** and `insertJournalEntry` needs one. Items belong to a
  company, not a business, so it becomes a new input — and the backfill has nothing to attribute old
  movements to. **Decide this explicitly and put it to me.**
- **The frozen seed lists are frozen on purpose.** `V9_ACCOUNT_ROLES`, `V9_SEED_ACCOUNTS`,
  `V11_SEED_ACCOUNTS`, `V13_ADDED_ACCOUNTS`, `V15_ADDED_ACCOUNTS` — each migration seeds from the
  list frozen AT ITS OWN VERSION. Widening an older one gives fresh databases the newer schema at
  the older version, the later migration's guard then skips, and its first real run is on MY
  database having never once run in a test. **A new account means a new frozen list and a new
  migration.**
- **Derive assertions from the lists; never restate a count or a version set.** Scope a migration's
  test to that migration, not the whole chain. The `[1,2,3,4]` / `[1,2,3,4,5]` lists are deliberate
  HISTORICAL states — leave them literal.
- **A migration test that runs the whole chain on an empty DB tests NOTHING.** Session 6 shipped two
  such tests and had to fix them. Build to v<n-1> with `migrations.filter(m => m.version <= n-1)`,
  insert the rows that must survive by **raw SQL**, then apply v<n>. A second `runMigrations` call
  is a **no-op** because `schema_migrations` already lists the version — to re-enter the guard, call
  `applyXSchema(db)` **directly**. Then mutation-prove it: make the migration a no-op and watch red.
- **Any rebuild of `chart_accounts` must drop and replay EVERY trigger whose body mentions it**,
  including `journal_lines_account_exists`, which lives on `journal_lines`. SQLite re-parses all
  triggers during `ALTER TABLE … RENAME` and the rename dies otherwise. Fingerprint-gate on
  triggers, indexes, row count AND row content.
- **Never call migration v4's `up` directly on a migrated DB.** Do NOT modify the `ACCOUNTS`
  constant at `src/database/purchasing-schema.ts:3`.
- Account codes are **not** a fixed union: `JournalLine.account` is a `string`. **Reports must group
  by `chart_accounts.type`/`role` via JOIN**, never a hardcoded code list, or a user-created income
  account is silently missed and sales are under-reported.
- In the cash-view walk, match entries by **exact id**, never by prefix — except credit-note sums,
  where the `je-credit-note-` prefix is deliberate so a cancellation nets back to zero.
- Reports and walks key on **`entry_date`** (the transaction date), not `created_at`.
  `GeneralLedgerRow.date` still exposes the posting timestamp — a standing carry-over.
- `payments.payment_account` and `supplier_payments.payment_account` are still `CHECK IN ('CASH')`.
- **Fastify tests cannot use fake timers** — they stall its async work and time the file out. To
  test session expiry, age the session out via `validateSession(token, farFutureIso)`, which revokes
  it, then prove the hook refuses the token.
- **A new API route is protected automatically** (absence of `config` = deny) and the derived sweep
  will cover it. If a route must be public, add it to `PUBLIC_ROUTES` in
  `src/api/auth-enforcement.test.ts` deliberately — that literal list is the guard.
- **`web/` is type-checked by NOTHING** (`tsconfig` is `include: ["src"]`, vite is transpile-only).
  After touching `web/`, run by hand:
  `tsc.cmd --noEmit --jsx react-jsx --target ES2022 --module esnext --moduleResolution bundler --lib ES2022,DOM,DOM.Iterable --strict --skipLibCheck web/src/main.tsx`

## HOW TO WORK (this is what worked in session 6 — keep doing it)
- **Reproduce every suspected defect before fixing it**, and prove each regression test fails on the
  old code. **Mutation-test the important ones**: break the implementation, watch the test fail,
  restore it, watch it pass. **Back the file up to the scratchpad and restore with `cmp` to prove a
  byte-identical restore — NEVER `git checkout` to undo a mutation when the work is uncommitted.**
- **Prove things against the running system, not only the test harness.** Session 6's strongest
  evidence came from starting the real API with `node.bat dist/api/main.js` against a **throwaway
  database in the scratchpad** and driving the real UI in the browser. **Never point it at my real
  database.**
- **Guard every sweep against passing vacuously.** A derived loop over an empty list passes. Assert
  known anchors are present, and collect failures into an array asserted `toEqual([])` so a failure
  names them.
- **Status codes alone prove little** when a handler returns the same code as the guard. Give the
  guard its own wording and assert on the body.
- Max 2 agents; **NEVER both in `repository.ts`.** One owns it, the other works only in new files.
  The orchestrator owns `migrations.ts` and assigns versions — agents export `applyXSchema(db)` and
  register nothing; have them append the pending version INLINE in their own test file and say so.
- **ONLY the orchestrator runs the full suite.** Agents run their own files (**S5-5**).
- **Review what agents hand back — read the code, do not take the report on trust.** Run the full
  gate yourself before every commit.
- **Advisor = Fable. Discuss the plan BEFORE building and again before declaring done.** In session
  6 it caught the `tail`/`$?` exit-code lie, the vacuous route sweep, the migration tests that never
  ran the migration, and the `AuthGate` bug that threw away a freshly issued recovery code. **Give
  its advice real weight.**
- Stage by **explicit path**, never `git add -A`. One commit = one idea. Announce each with
  WHY / WHAT / RISK / HOW TO VERIFY. **Committing locally is pre-authorised; ASK BEFORE PUSHING.**
- Put the **honest limits in the commit message** — what is not verified, what is left open.
- Acceptance is my hand-worked figures. Name such tests `ACCEPTANCE…` and record a slice as
  "built, figures unconfirmed" until I confirm.
- `context/*.md` are committed as of session 6 (I asked for it). HOT.md stays **under 50 lines**.
- **When a decision is mine, put real options to me with the trade-offs and your recommendation** —
  and say plainly when one of the options I suggested is a bad idea and why.

## WHERE THE PRODUCT ACTUALLY STANDS — do not over-report progress
Roughly **45% of a first working MVP**, about **72% of the backend**. **16 migrations, 102 routes,
36 test files, 442 tests green.** Auth is now real and enforced end to end. The UI is still **one
514-line `App.tsx` proof-of-concept page plus a ~215-line login gate** — invoice creation and a few
read-only views, no routing, no screens for purchases, payments, credit notes, inventory, reports,
opening balances or settings. **PDF/print, import, export, backup and restore do not exist at all.**
Estimated **50–70 hours** to a usable MVP, of which 25–40 is the UI. Keep that framing honest.

REALISM — fewer slices done properly beats all of them rushed. Tell me exactly where you stopped and
what is unverified; **report nothing as done that is not gated.**
