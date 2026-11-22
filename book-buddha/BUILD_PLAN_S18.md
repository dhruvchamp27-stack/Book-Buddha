# Build plan from session 18 — every remaining backend part, with builder briefs

Written 22 Nov 2026 at the end of session 17 (commit 451f9ab, pushed). **Supersedes
`REMAINING_BUILD_PLAN.md` (15 Nov) for everything still open.** One plan for everything, as the owner
asked. Rulings referred to here (S17-1 … S17-13, Q12–Q24, S16-2, S11-6) are in `context/decisions.md`.

**How to use it next session:** read `context/HOT.md` and the top of `context/Progress.md` (the hook
loads both). Then run the baseline gates (§0) and dispatch the parts in the order of §1. Each brief in
§3 is ready to paste into a worker prompt as it stands. The orchestrator note under each brief is for
the main session, not the worker. Note each live brief in `Progress.md` in one or two lines (rule 10).

---

## §0 Baseline (start of session)
Branch `autonomous/book-buddha-finish`, never `main`. From `book-buddha/`, never through a pipe, read
the counts:
1. `.\node_modules\.bin\tsc.cmd --noEmit -p .` → exit 0
2. `.\node_modules\.bin\vitest.cmd run --root .` → expect **1,134 tests / 97 files**, all green
3. `.\node_modules\.bin\vite.cmd build` → builds (about 1.2 s)

Migration in place is **v33** (`before_opening`). Reserved: **v34 = I (GST per line + round-off)**,
**v35 = bill/expense round-off (I-Q6, BUILT 22 Nov)** and **v36 = R14 (archive)** — R14 moved up a
number because I-Q6 was confirmed and built first. Builders write the `*-schema.ts` body; **only the
orchestrator registers a
version in `migrations.ts`.**

## §1 Order and lanes
`repository.ts` (about 7,600 lines) is SERIAL: one builder at a time. Read-only research runs in
parallel with anything.

| Step | Part | Kind | Touches repository.ts | Can run alongside |
|---|---|---|---|---|
| 1 | P1 old-screen number boxes · P2 `/imports/last` company filter | small builders | no | each other, G, research |
| 2 | **G** clock + back-dating confirm everywhere | builder | **yes** | P1, P2, I-1, Q16-1, R14-1 |
| 2 | **I-1** GST per line + round-off: mini-spec | read-only | no | G |
| 2 | **Q16-1** .xlsx/PDF packages: research | read-only | no | G |
| 2 | **R14-1** archive: mini-spec | read-only | no | G |
| 3 | Owner approvals: I mini-spec · Q16 install (name, size) · R14 mini-spec | Dhruv | — | — |
| 4 | **I-2** GST per line + round-off build (v34) | builder | **yes** | Q16-2 |
| 5 | **Q16-2** .xlsx import/export + PDF export (after install approval) | builder | no | I-2 |
| 6 | **R14-2** archive build (v36) | builder | **yes** | — |
| 7 | **REV** whole-build review (3 read-only reviewers) → **FIX** builder | review | fix: yes | — |
| 8 | **TST** tests: gap map, new tests, hand-check workings for Dhruv | builder | no | — |
| 9 | Session end: context files, commit (announce), push (ask) | orchestrator | — | — |

**Not yet ruled. Ask Dhruv, then run brief F2 (serial on repository.ts, after G):**
- **F2: opening sets vs documents already posted.** Saving an opening set dated ON or AFTER documents
  that were already posted is not checked today (`saveOpeningBalances`, `saveOpeningCustomerBalance`,
  `saveOpeningSupplierBalance`, repository.ts about 7214, 7417, 7647), so those documents count twice
  silently. Reversing the last live opening set (`reverseOpening*`, about 7323, 7508, 7706) leaves
  history items with no opening figure behind them.
- **Proposed in the F plan; he has NOT ruled:**
  - Warn with a count, and require a confirm, before saving an opening set dated on or after posted
    documents. The documents are left alone.
  - Show the count of history items, and require a confirm, before reversing the last live set.
  - The flag stays frozen; nothing flips automatically.

**On hold (no brief until Dhruv rules):**
- S17-10 edge: a bill discount equal to the stock value on an all-stock bill. The options are in
  `decisions.md`; refusing it is recommended.

**Review items the REV step must look at:**
- The settlement discount is stored only on the posted entry; consider a column.
- F's own calls, listed under the "F plan" entry in `decisions.md`. Example: a history finalize returns
  an unstored `history-…` entry with no lines.

## §2 Hard rules every brief restates (copy into each worker prompt)
- **CBM first:** codebase-memory MCP tools (project `C-Users-Admin-Desktop-Book-Buddha-book-buddha`):
  `search_graph`, `get_code_snippet`, `get_file_outline`, `trace_path`, `query_graph`. Use Grep/Read
  with offset+limit only for literals and SQL. Never read `repository.ts` whole. The graph's line
  numbers can be stale, so confirm with Grep.
- Change ONLY the files listed. Never touch `migrations.ts`, `context/`, or (unless listed) `web/`.
- Never open `.env`, secrets, `config.json` or any `*.db`. No git write commands. No installs.
  Use the Edit tool for edits.
- The October ACCEPTANCE test `src/e2e/october.e2e.test.ts` must stay green. Never change its figures
  or request bodies. G may change its SETUP only (S17-13). If it goes red: STOP and report.
- Done = tsc exit 0 + vitest all green (report the counts) + vite builds when `web/` is touched.
- Report: each file changed with a one-line why, the exact user-facing messages, tests added,
  existing tests changed and why, and every call you made yourself.

---

## §3 Briefs

### P1 — Old React screen: remove the typed document numbers (S17-13(3))
**Goal:** `web/src/App.tsx` still sends `number` when creating invoices (about line 295) and credit
notes (about line 465). The API now answers 400 "The app numbers this document; leave the number
out." (S17-4). Remove the invoice-number and credit-note-number inputs (about lines 681 and 704),
their state, and the `number` field in both request bodies. Show the number the app returns, where
the screen already shows a saved document. No other UI change (Q21: screens come later).
**Read:** `web/src/App.tsx` (offset/limit around those lines); the `invoiceInput` and credit-note
schemas in `src/api/server.ts`.
**May change:** `web/src/App.tsx` only.
**Done when:** tsc 0 · vitest green (unchanged count) · `vite.cmd build` builds · Grep finds no
`number:` in the invoice or credit-note POST bodies in App.tsx.
*Orchestrator:* Haiku or Sonnet. Runs in parallel with G (disjoint files).

### P2 — `GET /imports/last` must be company-filtered
**Goal:** the last-import banner route (Builder B, `src/api/import-routes.ts`) reads the latest
`import.committed` audit event across ALL companies. Filter it to the caller's company, using the
same company resolution the other import routes use. Add a test: two companies, each sees only its
own last import.
**May change:** `src/api/import-routes.ts`, `src/api/import-routes.test.ts`.
**Done when:** tsc 0 · vitest green (count +1 or more).
*Orchestrator:* Sonnet, small. In parallel with G.

### G — Back-dating confirm on every dated entry, with a settable "today" (Q12, S16-2(d), S17-13(1))
**Goal:**
1. **Clock.** The app gets one settable "today" (IST). Add an option to the repository, for example
   `new AccountingRepository(path, { today?: () => string })` (ISO `YYYY-MM-DD`, default
   `istDateOf()`), plus a pass-through in `buildApi`. Route EVERY "today" decision in the backend
   through it.
   - There are 29 non-test calls to `istDateOf()`; list each and say whether it is a "today" decision.
   - ALSO sweep `new Date()` used as "today": for example `generateDueInvoices` defaults `asOfDate` to
     `new Date().toISOString().slice(0, 10)`. Note that this gives the UTC date, not IST.
   - Do not change `istDateOf(instant)` calls that convert a stored timestamp. Do not change
     `new Date().toISOString()` used as an audit timestamp.
   - **Wall-clock tests to pin:**
     - `src/database/purchase-returns.test.ts` expects `PR-001/26-27`. It follows the real date and goes
       red on 1 April 2027.
     - `src/api/server.test.ts` matches its invoice and CN numbers with a regex for the same reason.
     - Pin both through the clock.
2. **Rule (Q12).** An entry is back-dated when its date is in an EARLIER CALENDAR MONTH than today.
   Posting it needs an explicit confirm, `confirmBackdatedMonth: true`. Today only `finalizeCreditNote`
   has this (repository.ts about 2378). Mirror its message style for every door:
   `This <document> is dated <readable date>, in a month that has already passed. Posting it will
   change the figures already reported for <month>. If that is what you want, confirm and <verb> it
   again.`
3. **Doors.** Inventory every door that posts a dated entry and apply the rule to each:
   - documents: invoice, bill, expense, credit note (exists), purchase return
   - money: customer payment, supplier payment, refunds, credit applications, opening-balance
     receipts and settlements
   - banking: vouchers (`vouchers.ts`), internal transfers (`internal-transfers.ts`), statement-line
     posting (Add, Split, Uncategorise)
   - stock: adjustments and movements, write-downs and their reversals
   - opening-balance saves
   - cancellations that post a reversal on a date, if the reversal date can be back-dated
   List the doors in your report.
4. **Ordering rules.**
   - The financial-year lock is checked FIRST and stays absolute (`assertPeriodOpen`).
   - History items (F, `before_opening`) post nothing, so they need NO back-dating confirm.
   - The F confirm (`confirmBeforeOpening`) and this one are independent.
5. **API.** Add optional `confirmBackdatedMonth` to every matching route schema in `src/api/*.ts`.
6. **Imports.** The preview shows the warning PER ROW: "dated in a month already reported". Committing
   the previewed file is the confirmation (R10 rule kept), and the commit result counts back-dated
   rows.
7. **Tests.**
   - Pin "today" in tests through the clock. Each existing test that posts 2025 dates pins a "today"
     inside its own month, so that it passes unchanged.
   - October ACCEPTANCE test: SETUP only. Pin today to its last working date. Find it in the file,
     for example 2025-10-31; check whether any step needs a November date. No figure or request body
     changes.
   - New `src/database/backdating.test.ts`, per door:
     - refused without the confirm, with the exact message;
     - posts with the confirm;
     - same month posts freely;
     - a locked FY refuses even with the confirm;
     - a history item is not asked.
   - HTTP: one route returns 400, then 200 with the confirm.
   - Import: the preview flags a back-dated row; the commit posts it.
**Read:** `finalizeCreditNote` and its route (`server.ts` about 1181), `ist-date.ts`, `ledger.ts`
(`assertPeriodOpen`), `import-documents.ts`, `vouchers.ts`, `internal-transfers.ts`, the
statement-import and review-queue posting code.
**May change:** `src/database/repository.ts`, `src/database/ist-date.ts` (only if needed),
`src/banking/*.ts`, `src/api/*.ts`, `src/import-export/import-documents.ts`, `src/accounting/types.ts`,
`src/database/purchasing-types.ts`, all `*.test.ts` (setup or clock pinning only, unless a test pinned
the old behaviour; list each), the October e2e (SETUP only), and new test files.
**Done when:**
- tsc 0;
- vitest all green, count reported, October 22/22;
- the report lists every door and every `istDateOf()` call with its decision.
*Orchestrator:* Sonnet. The largest builder left; expect a long run.
- **Check in the diff that the October test's only change is the clock pin.**
- Run the full gates yourself.

### I-1 — GST per line + rupee round-off: mini-spec (READ-ONLY) (Q24, Q23)
**Goal:** a mini-spec for Dhruv to approve. Write no code.
- **Today:** tax sits on the DOCUMENT: `invoices.tax_type` (NONE, CGST_SGST or IGST) and
  `tax_rate_basis_points` (`schema.ts` about 66), and the same on bills and expenses
  (`purchasing-schema.ts` about 121 and 154).
- **Q24:** GST PER LINE, because mixed rates on one invoice happen.
- **Q23:** the books keep exact paise; the invoice total is rounded to the rupee with a "Round off"
  line. A `ROUNDING` income account already exists (`chart-accounts-schema.ts` about 221); check what
  uses it (the cash view).
The mini-spec must answer, each with a recommended default and a hand-worked example:
1. **Where the rate lives.** Rate per line on invoice, bill, credit-note, purchase-return and expense
   lines. Should a default rate come from the item (an `items` column)? The tax TYPE stays per
   document (place of supply).
2. **Rounding.** Round tax per line, or per rate group? Show the invoice GST summary by rate.
3. **Round-off.** Which documents carry it (invoices only, or bills too)? Which account takes it: the
   existing `ROUNDING` account, or a new expense/income pair? How does a credit note against a
   rounded invoice behave? How do part payments and the cash view treat the round-off?
4. **Migration v34.** Columns, backfill (existing lines take their document's rate), and CHECKs.
5. **Every read path that changes:** engine posting (`src/accounting/engine.ts` invoice, purchase,
   credit-note and return entries), reports that read tax (`reports-sales.ts`,
   `reports-profitability.ts`, `cash-flow.ts`, the cash view), imports and exports (the per-line rate
   column), and the API schemas.
6. **Test plan:** an invoice with lines at 5% and 18% and its exact journal; a rounded total
   (Rs 1,234.56 → Rs 1,235.00, round-off Rs 0.44); a credit note on it; the October e2e still green
   (single rate, no change).
**Output:** a report of at most about 120 lines with `file:line` citations.
*Orchestrator:* Sonnet, parallel with G.
- Put the mini-spec to Dhruv briefly: questions in the chat, the full text into `decisions.md`.
- After his yes, write the I-2 brief from it. Pattern: like the F research → plan → S17-12 → build.

### Build-brief skeleton (use it for I-2, Q16-2, R14-2, F2 and FIX)
These five briefs CANNOT be written yet, because each depends on a mini-spec, an install approval, a
ruling or the review findings. Fill this skeleton once that input exists. It is the shape the F builder
used in session 17.
```
You are the builder for <part> on Book Buddha (TypeScript / better-sqlite3 / Fastify),
repo C:\Users\Admin\Desktop\Book Buddha\book-buddha. Work only inside that folder. Backend only
unless stated.
## Goal — rulings <ids from decisions.md>
<what the owner ruled, in his words where possible; the hand-worked example>
**Schema is DONE by the orchestrator — do not change it:** <schema file + migration vN, columns>
## Behaviour to build
1. <each door / method, file:line (approximate; confirm with Grep)>, refusal messages word for word
2. <read paths that must change, file:line>  3. <API schema fields>  4. <imports/exports>
5. Out of scope: <list>
## Tests (new file <name>.test.ts + an HTTP case)
- hand figure: <figures> · each refusal with its exact message · each read path · October stays green
## Rules (hard) — paste §2 of BUILD_PLAN_S18.md
Files you MAY change: <list>. Do NOT touch migrations.ts, *-schema.ts, october.e2e.test.ts,
context/, web/.
## Done when
tsc exit 0 · vitest all green (was <n> tests / <f> files; report new count).
Report: files changed + why, read paths changed (file:line), exact messages, tests added,
existing tests changed + why, your own calls.
```

### I-2 — GST per line + round-off: build (v34)
**Ruled by Dhruv 22 Nov: S18-3 (I-Q1..I-Q10; I-Q4 is OPEN) and S18-5 (I-Q11..I-Q14).** Read both entries
in `context/decisions.md` before starting. ONE builder, SERIAL on `repository.ts`.

**Schema is DONE by the orchestrator — do not change it.** `src/database/line-tax-schema.ts`, registered
as v34 in `migrations.ts`:
- `tax_rate_basis_points INTEGER NOT NULL DEFAULT 0 CHECK(0..10000)` on `invoice_lines`,
  `credit_note_lines`, `purchase_bill_lines`, `purchase_return_lines` and
  `recurring_invoice_template_lines`, each backfilled from its document — notes and returns join through
  to the parent invoice or bill, which is where their rate lives today.
- `items.default_tax_rate_basis_points INTEGER NULL` — pre-fill only, never changes a posted document (I-Q2).
- `invoices.round_off_paise INTEGER NOT NULL DEFAULT 0` and `invoices.total_paise` — the STORED rounded
  total (I-Q12).
- `credit_note_lines.reverses_invoice_line_id` and `purchase_return_lines.reverses_bill_line_id` (I-Q14).
- New seed account `ROUND_OFF`, name "Round off", type INCOME, **ROLELESS** (I-Q11) — the role CHECK
  is frozen at v9, so a role would force a `chart_accounts` rebuild. It is excluded from the income
  aggregates BY CODE, via the exported `ROUND_OFF_ACCOUNT` constant.

#### Behaviour to build, in this order
1. **Engine — `src/accounting/engine.ts`.** `totalInvoicePaise` (:21) and `taxLines` (:61) take the rate
   from each LINE. Tax is summed PER RATE GROUP and rounded ONCE per group (I-Q3), never per line. The
   document keeps `taxType` only. His hand figure: 4 x 75.00 at 5%, 7 x 99.00 and 1 x 86.29 at 18% gives
   5% taxable 300.00 (CGST 7.50 + SGST 7.50) and 18% taxable 779.29, tax 140.27 (CGST 70.13 + SGST 70.14);
   total before round-off 1,234.56 becomes invoice **1,235.00**, round off **+0.44**. Journal:
   Dr Receivables 1,235.00 . Cr Sales 5% 300.00 . Cr Sales 18% 779.29 . Cr Output CGST 77.63 .
   Cr Output SGST 77.64 . Cr Round off 0.44.
   - The CGST half stays `Math.floor(groupTaxPaise / 2)` PER GROUP; SGST takes the remainder (:69). That
     rule is NOT cumulative — see the lesson in `decisions.md`.
   - A ZERO round-off line MUST BE OMITTED: the `journal_lines` CHECK rejects it
     (`chart-accounts-schema.ts:346`).
   - Nearest rupee, 50 paise and over rounds up (I-Q5).
2. **Round-off on invoices only** (I-Q5), cash invoices included. Bills and expenses get an OPTIONAL typed
   amount under Rs 1, default 0 (I-Q6) — a field and its posting, NOT an automatic calculation.
3. **The stored total (I-Q12).** `invoiceTotal` (`repository.ts:4677`), `templateTotalPaise` (:217) and the
   raw SQL at `open-items.ts:90-91` must all READ `invoices.total_paise` instead of recomputing. Grep for
   every other recompute before you finish; `:5730` and `:6573` are the bill and expense mirrors, and the
   cash view uses the total as its p/T denominator (`:3932`).
4. **Credit notes (I-Q8, I-Q14).** Partial notes in EXACT PAISE with no rounding; only the note that
   COMPLETES the invoice reverses the round-off, so the invoice clears to exactly zero. Each note line
   links to the invoice line it reverses and takes THAT line's rate. `creditNoteTaxLines` (:4759) becomes
   per-group. `listCreditNotes` (:2884-2895) must read the POSTED journal figure instead of recomputing
   from the header. The round-off goes into `refundable_paise` at write time (:2458).
5. **Purchase returns (I-Q14).** Each return line links to the bill line it reverses, and `lotKey`
   (:6279-6286, :6378-6385) gains the rate so matching stays unique when one item is sold at two rates.
6. **Reports (I-Q11).** `ROUND_OFF_ACCOUNT` (imported, never a bare string) is EXCLUDED from
   `salesByTax` net sales
   (`reports-sales.ts:205`), `creditNoteReport` taxable (:336) and P&L gross sales
   (`repository.ts:3664-3670`). `salesByTax` (:268-290) groups by the journal line's rate tag, not the
   invoice header. Reported sales must NOT move for any single-rate invoice.
7. **API (I-Q13).** `invoiceLine` (`api/server.ts:32-37`) gains an optional rate — it is shared by invoice,
   bill, credit note, return and recurring template, so one change covers all five. The superRefine at
   :179-184 moves to line level: the document keeps the TYPE, a 0% line is ALWAYS allowed, and an invoice
   with a tax type but only exempt lines is allowed.
8. **Import and export.** The rate becomes a PER-ROW column, not a header one
   (`import-documents.ts:317-318, :323, :349, :365`; `exports.ts:190, :204-205`). Drop the "must agree
   across rows" rule for the RATE; keep it for the TYPE.
9. **Out of scope:** expenses have no lines table, so their rate stays document-level. No UI, no `web/`.

#### I-Q4 IS NOT RULED (S18-4)
Discount and freight on a mixed-rate document spread PRO RATA over the lines, each rate charged on its
share. Build it behind ONE clearly named helper, test it, and put a comment at the top of that helper
saying it rests on an UNCONFIRMED GST reading pending Puneet or Manish. Never cite it as settled.

#### Tests — new `src/database/line-tax.test.ts` plus an HTTP case
- His hand figure above, asserted line by line against the posted journal.
- A credit note for the Pen only: 86.29 x 18% = 15.53 (7.76 + 7.77), note 101.82, invoice still owes
  1,133.18. A FULL return also reverses the 0.44 and the invoice clears to exactly 0.
- Two lines of Rs 10.10 at 5%: per GROUP gives 1.01 where per line would give 1.02 (I-Q3).
- An exempt 0% line on an 18% invoice, shown separately in the GST summary (I-Q9).
- An invoice whose total is already whole rupees posts NO round-off line.
- An old invoice is never re-rounded (I-Q10): round_off 0, posted figures stand.
- Receivables, the customer statement and ageing agree with the ledger to the paise (I-Q12).
- The October ACCEPTANCE test stays green and unchanged.

#### Rules (hard) — §2 above applies, with ONE amendment
**CBM IS DOWN this session, and its graph is keyed to the old machine's path. Use Grep plus Read with
offset+limit; NEVER read `repository.ts` (about 7,600 lines) whole.** The repo folder is
`D:\dhruv-book-accounting-app\Book-Buddha-github\book-buddha`, NOT the `C:\Users\Admin\Desktop` path in
the skeleton above. Everything else in §2 stands.

**Files you MAY change:** `src/accounting/engine.ts`, `src/accounting/types.ts`,
`src/database/repository.ts`, `src/database/open-items.ts`, `src/database/reports-sales.ts`,
`src/api/server.ts`, `src/import-export/import-documents.ts`, `src/import-export/exports.ts`,
`src/import-export/codec.ts`, and the test file for each. Do NOT touch `migrations.ts`, any `*-schema.ts`,
`october.e2e.test.ts`, `context/` or `web/`.

#### Done when
tsc exit 0 . the October ACCEPTANCE test green . vitest run with the new count REPORTED.

**THE BASELINE YOU START FROM**, measured 22 Nov with v34 in place and nothing else changed:
**1,268 passed / 1 failed of 1,269, in 99 files, in 76-91s.** Two consecutive runs agreed. `tsc` exit 0.
`vite build` 1.82s. October alone 22/22 in 4.98s.

**The ONE allowed red** is `src/import-export/r10-integration.test.ts:238` ("2,000 single-line invoices
commit in well under 10 seconds"), a wall-clock budget this machine does not meet: it has measured
12.31s, 13.90s, 14.06s, 17.28s, 17.61s and 29.37s across the session on UNCHANGED code, and it was the
single red in the very first baseline run before any of this work. Do NOT touch it and do NOT loosen its
threshold. Treat every OTHER red as yours.

**If a test TIMES OUT, say so and re-run that file alone before touching anything.** Timeouts used to be
endemic here - a run on 22 Nov came back with 19 of them - because every test replayed all 34 migrations
(~147 ms each, ~186 s across the suite). `AccountingRepository` now restores an in-memory database from a
migrated image instead (~2.4 ms), and timeouts went to zero. So a timeout now means the machine is loaded,
not that you broke something. NEVER raise a timeout, loosen an assertion or delete a case to get a green
run: a wrong figure is yours to fix, a slow clock is not. . every existing test you changed listed with WHY. Expect about seven test files
that assert a rate or a total: `cash-rounding.test.ts`, `cash-view.test.ts`, `credit-note-defects.test.ts`,
`recurring.test.ts:163`, `import-documents.test.ts:375`, `reports-sales.test.ts:276-282`,
`repository.test.ts:186`.

*Orchestrator:* Sonnet, SERIAL on `repository.ts` — nothing else runs on that file. Write
`line-tax-schema.ts` and register v34 BEFORE dispatching. R14-2 waits for this to land.

### I-3 — bill and expense round-off: build (v35)
**Ruled by Dhruv 22 Nov: I-Q6, recorded as S18-6 in `context/decisions.md`.** His words: optional ·
default zero · whole paise · bills and expenses ONLY · kept separate from existing document totals ·
old posted bills and expenses unchanged · no historical document re-rounded.

**Schema is DONE by the orchestrator — do not change it.** `src/database/bill-round-off-schema.ts`,
registered as v35, proven by 6 tests in `migration-v35-bill-round-off.test.ts`: one signed
`round_off_paise` column on `purchase_bills` and `expenses`, `NOT NULL DEFAULT 0`, with
`CHECK (round_off_paise > -100 AND round_off_paise < 100)` so "under Rs 1" is enforced by the database.

#### The ONE thing to get right: nothing is calculated
An invoice ROUNDS ITSELF to the nearest rupee (I-Q5). A bill does NOT. The owner TYPES a round-off to
make the bill match the total the supplier printed. There is no `roundToRupee` call anywhere in this
slice. If you find yourself computing a bill's round-off, stop — you have misread the ruling.

#### Sign convention — the same definition as invoices, mirrored
`round_off_paise = the total the owner wants - the total the lines compute to`. On an invoice the
settlement line is a DEBIT (Dr RECEIVABLES), so a positive round-off balances with `Cr ROUND_OFF`. On a
bill the settlement line is a CREDIT (Cr PAYABLES or CASH), so a positive round-off — a bill worth more
than its lines — balances with `Dr ROUND_OFF`, which is correct: paying more than computed is a cost.
Negative mirrors it. Import `ROUND_OFF_ACCOUNT` from `chart-accounts-schema.ts`; a bare `"ROUND_OFF"`
literal anywhere in your diff is a defect.

#### Behaviour to build
1. **`purchaseEntry` in `src/accounting/engine.ts`** takes an optional signed round-off. The settlement
   credit becomes `computedTotal + roundOff`, and a `ROUND_OFF` line carries the difference. A ZERO
   round-off posts NO line — `journal_lines` rejects a zero line (`chart-accounts-schema.ts:346`).
2. **Bills** (`finalizePurchaseBill`) and **expenses** (`finalizeExpense`) in `repository.ts` pass the
   stored value through. `getPurchaseBill` (:5937-area) and `getExpense` (:6573-area) read it back
   alongside the computed subtotal, tax and total, as its own field — NOT folded into any of them.
3. **API** `src/api/server.ts`: `purchaseTaxFields` / `purchaseBillInput` / `expenseInput` gain an
   optional `roundOffPaise`, an integer, refused outside ±99 with a message in the house style. The
   stored total stays computed; this is a separate figure.
4. **Cancellation** already mirrors every line (`engine.ts` `reverseEntry`), so a cancelled bill
   reverses its round-off with no extra work — assert it rather than adding code.
5. **Out of scope:** no re-rounding of anything; no round-off on purchase RETURNS or credit notes
   (I-Q6 is bills and expenses only, and the v35 test pins that); no import/export column; no UI.

#### Tests — new `src/database/bill-round-off.test.ts`
- A bill of 100 x Rs 25.00 at 18%: subtotal 2,500.00, tax 450.00, computed total 2,950.00. With a typed
  round-off of **+37 paise** the entry is `Dr INVENTORY 250000 · Dr INPUT_CGST 22500 · Dr INPUT_SGST
  22500 · Dr ROUND_OFF 37 · Cr PAYABLES 295037`, and it balances.
- The same bill at **−37 paise**: `Cr PAYABLES 294963` and `Cr ROUND_OFF 37`.
- A round-off of **0** posts NO `ROUND_OFF` line at all.
- An expense of Rs 2,000.00 with a +15 paise round-off, posted and then cancelled: every account nets
  to zero, round-off included.
- ±100 is refused at the API with the exact message you chose, and by the CHECK at the database.
- A bill finalized BEFORE v35 (round_off 0) is unchanged and posts no round-off line.
- The October ACCEPTANCE test stays green and untouched.

#### Rules (hard) — §2 above applies, with the same amendment as I-2
CBM is DOWN; use Grep plus narrow Read, never read `repository.ts` whole. Repo is
`D:\dhruv-book-accounting-app\Book-Buddha-github\book-buddha`. Do NOT touch `migrations.ts`, any
`*-schema.ts`, `october.e2e.test.ts`, `context/`, `web/`, or the `emptyMigratedDatabase` block at the
top of `AccountingRepository`.

**Files you MAY change:** `src/accounting/engine.ts`, `src/accounting/types.ts`,
`src/database/repository.ts`, `src/database/purchasing-types.ts`, `src/api/server.ts`, and the test
file for each.

#### Done when
tsc exit 0 · the October ACCEPTANCE test green · vitest with the new count reported. Baseline going in:
**1,300 passed / 1 failed of 1,301** (I-2 plus the 6 v35 migration tests), the one red being the
pre-existing `r10-integration.test.ts:238` wall-clock budget. Report every file changed with a why,
every existing test changed with why, the exact messages, and every call you made yourself.

*Orchestrator:* Sonnet, SERIAL on `repository.ts`. Runs after I-2 has landed, not alongside it.

### Q16-2 — .xlsx and PDF build (after Dhruv approves the installs)
Fill the skeleton from the Q16-1 recommendation:
- xlsx read and write through the codec (`codec.ts`), with the same field mapping as CSV;
- PDF export for every report (Q18);
- tests that round-trip an xlsx file and check each PDF opens and carries its totals.
The files are `src/import-export/*`, `src/api/export-routes.ts` and `import-routes.ts`, plus tests.
No `repository.ts`.

### R14-2 — archive build (v36)
Fill the skeleton from the approved R14-1 mini-spec. The schema file is
`src/database/master-status-schema.ts` (the orchestrator registers it as v36).

### F2 — opening sets vs posted documents and history (after Dhruv rules; see §1)
Fill the skeleton from his ruling. The doors are the three save and three reverse opening-balance
methods. Confirm flags go on their routes.

### FIX — after REV
Fill the skeleton with the findings the orchestrator has verified, one numbered item each:
file:line, failure scenario, required fix, and a test that fails before the fix and passes after.

### Q16-1 — .xlsx and PDF packages: research (READ-ONLY, no install) (Q16)
**Goal:** Q16 was approved IN PRINCIPLE: name each package and its size, then ask before installing.
Today R10 does CSV and JSON only (`src/import-export/codec.ts`, `exports.ts`,
`src/api/export-routes.ts`, `import-routes.ts`).
Recommend ONE package for .xlsx read/write and ONE for PDF report export. For each give:
- name and exact version;
- unpacked install size, and the number of dependencies it pulls in;
- licence;
- known vulnerabilities (for example the npm `xlsx` 0.18.5 advisories against the SheetJS CDN build;
  `exceljs`);
- whether it runs offline in Node with no native build step;
- the exact install command.
Compare at least `exceljs` against SheetJS for .xlsx, and `pdfkit` against `pdfmake` for PDF.
Sketch how each plugs into the codec and export routes, which reports get PDF (Q18: every report
export), and what the tests would be.
**Output:** a short table plus a recommendation.
*Orchestrator:*
- Show Dhruv each package with its size and ask (hard rule 2). Only after his yes, run the install
  yourself.
- Then write Q16-2: a builder that adds xlsx import/export through the codec, PDF export for every
  report, and tests.

### R14-1 — Archive (masters only): mini-spec (READ-ONLY) (S11-6, FD §F, S17-3)
**Scope:**
- **S17-3 condition:** "R14 only if R13 completes this session". R13 is built (C, v30), so R14 is in.
- **S11-6:** archive covers MASTERS ONLY in V1. Documents and the audit log are never archived.
- **FD §F:** a third state, Active / Inactive / Archived: hidden, retained, reversible,
  audit-logged, and blocked while live stock or an open balance exists.
- **Today:** customers, suppliers, items and fairs have no active/inactive state at all (`schema.ts`
  about 24–49, `purchasing-schema.ts` about 95).
The mini-spec must answer, each with a recommended default:
1. **Which masters.** Customers, suppliers, items, fairs/projects; chart accounts? (These already
   have an `active` flag.)
2. **What each state means:**
   - Inactive: still listed (filterable) but cannot be used on a NEW document.
   - Archived: hidden from lists and pickers but kept in history and reports for past periods.
   - Moving between states, and who may do it.
3. **The "blocked while…" checks, exactly:**
   - open receivable or payable balance (including opening balances);
   - stock on hand;
   - open drafts, quotations or recurring templates referencing it;
   - an un-ended fair.
4. **Migration v36:** a `status` column per master (ACTIVE, INACTIVE or ARCHIVED), default ACTIVE,
   additive.
5. **Every path that must respect it:** document create/save doors, imports (an archived customer
   named in an import row), list endpoints (`?includeArchived`), and reports (past data keeps
   showing).
6. **Audit events, API routes and tests.**
**Output:** at most about 100 lines with `file:line` citations.
*Orchestrator:*
- Put it to Dhruv briefly, then write R14-2 (schema `src/database/master-status-schema.ts`, which
  the orchestrator registers as v36).
- R14-2 runs after I-2, because both are serial on repository.ts.

### REV — Whole-build review (READ-ONLY, three reviewers in parallel)
**Goal:** S17-1 is BUILD → REVIEW → TESTS. Review every change since `87fb711`, using
`git diff 87fb711..HEAD -- book-buddha/src`, plus whatever G, I, Q16 and R14 add. Look for:
correctness bugs, money and rounding, journal balance, double counting, FY lock and back-dating
order, missing audit events, unfiltered company or business reads, and refusals that leak a 500.
Each reviewer reports findings as file:line + failure scenario + suggested fix, ranked by severity.
- **Reviewer A, sales side:** numbering (S17-4/8), quotation link and edit guard, credit notes, F
  history on the sales side, receivables and statements, sales reports.
- **Reviewer B, purchase and stock side:** bill discount (S17-7, S17-10), settlement discount, lots
  and returns, stock adjustment (Q15), zero-cost FY lock, F history on the supplier side, payables.
- **Reviewer C, reports and I/O:** R13 cash flow (direct method, opening entries), exports (Q18),
  expenses import (Q17), repeated payments and the last-import banner, attachment and restore audit,
  G's doors, GST per line, archive.
Each reviewer must also check the two review items in §1.
*Orchestrator:*
- Verify every finding yourself before accepting it.
- Batch the confirmed ones into one FIX builder brief (serial on repository.ts).
- Put any finding that needs a ruling to Dhruv.
- Re-run the gates.

### TST — Tests after the review (S17-1)
**Goal:**
1. **Gap map:** a table, ruling → test(s) that prove it, for S17-4 … S17-13, Q12–Q24 and S16-2. Mark
   each "proved" or "gap".
2. **Fill every gap** with tests.
3. **One new end-to-end ACCEPTANCE-style test over HTTP**, `src/e2e/s17-walk.e2e.test.ts`. A small
   business walks through:
   - an opening balance and one history invoice;
   - a numbered invoice from a quotation;
   - a bill with a stock discount and a settlement discount;
   - a back-dated entry with its confirm;
   - a mixed-rate GST invoice with round-off;
   - an archived customer;
   - a cash flow statement that ties to the ledger.
4. **Workings file:** every figure is hand-worked first in `book-buddha/S17-WALK-WORKINGS.md`, in the
   style of `E2E-WORKINGS.md`, for Dhruv to check by hand. The test is marked ACCEPTANCE only after
   he approves the figures.
**May change:** test files only, plus the new workings file.
**Done when:** tsc 0, vitest green, gap map shows no "gap", and the workings file is written.
*Orchestrator:* show Dhruv the workings (his acceptance = his hand figures). Record his approval as a
ruling.
