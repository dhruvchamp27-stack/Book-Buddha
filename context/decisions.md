# decisions.md — Book Buddha

*On-demand allied file. Seeded 2026-11-14 from the repo docs (DD = Design Document,
DEC = plan/Decisions — the 15 questions, FD = Feature Design V1, H13 = 13 Nov handoff).
These pre-date this harness, so they keep their original IDs. **Future** decisions made
in a session use the harness convention `S<session>-<n>` (e.g. S1-1), newest at the top.*

## Session decisions (harness convention, newest first)

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
- **Archive (F):** third state (Active/Inactive/**Archived**) — hidden, retained,
  reversible, audit-logged; blocked while live stock or an open balance exists.
- **Rejected (G):** live bank feed, reconciler-only role, auto-posting, one bank
  account per business.


## Not a decision
`reference/` (Invoice Ninja inspection) is **reference-only** — where it differs from
our rules (their cancel doesn't restore stock; they edit locked invoices; they recycle
numbers), **our rules win**. See `reference/Inspection summary …`.
