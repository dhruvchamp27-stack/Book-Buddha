# decisions.md — Book Buddha

*On-demand allied file. Seeded 2026-11-14 from the repo docs (DD = Design Document,
DEC = plan/Decisions — the 15 questions, FD = Feature Design V1, H13 = 13 Nov handoff).
These pre-date this harness, so they keep their original IDs. **Future** decisions made
in a session use the harness convention `S<session>-<n>` (e.g. S1-1), newest at the top.*

## Session decisions (harness convention, newest first)

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
- **Archive (F):** third state (Active/Inactive/**Archived**) — hidden, retained,
  reversible, audit-logged; blocked while live stock or an open balance exists.
- **Rejected (G):** live bank feed, reconciler-only role, auto-posting, one bank
  account per business.

## Not a decision
`reference/` (Invoice Ninja inspection) is **reference-only** — where it differs from
our rules (their cancel doesn't restore stock; they edit locked invoices; they recycle
numbers), **our rules win**. See `reference/Inspection summary …`.
