# Review pack — session 18 (22 Nov 2026)

Everything waiting on Dhruv, in one place. Each item gives **what you decide**, the **recommended
default**, and, where it matters, a hand-worked example. Answer by number (for example "I-1: all
defaults; Q16: yes; R14 Q3: end date + 7 days").

Gates after this session's fixes: tsc 0 · **1,135 tests / 97 files**, all green · vite builds ·
migration still **v33**. Nothing installed. Nothing committed yet.

---

## Part A — Done this session (for your information)

| Brief | What changed | Checked by orchestrator |
|---|---|---|
| **P1** | Old screen `web/src/App.tsx`: the invoice-number and credit-note-number boxes are gone and no number is sent. A saved invoice shows the app's number, read-only. | Diff is only App.tsx · no `number` in either POST · vite builds |
| **P2** | `GET /imports/last` now needs `?companyId=` and shows only that company's last imports (400 if missing or unknown). New test with companies A, B and C. | Diff is only the 2 import-route files · test fails when the filter is removed · 1,135 green |

---

## Part B — Decisions that unblock the remaining build

### B1. GST per line + rupee round-off (I-1 mini-spec, rulings Q24 / Q23), migration v34

**Hand-worked invoice (credit sale, CGST+SGST, no discount):**

| Line | Qty × price | Taxable | Rate |
|---|---|---|---|
| Notebooks | 4 × 75.00 | 300.00 | 5% |
| Sets | 7 × 99.00 | 693.00 | 18% |
| Pen | 1 × 86.29 | 86.29 | 18% |

GST summary by rate: 5% → taxable 300.00, CGST 7.50 + SGST 7.50 = 15.00 · 18% → taxable 779.29 × 18% =
140.2722 → **140.27** (CGST 70.13 + SGST 70.14). Total before round-off **1,234.56** → invoice
**Rs 1,235.00**, round-off **+0.44**.

Journal: Dr Receivables 1,235.00 · Cr Sales 5% 300.00 · Cr Sales 18% 779.29 · Cr Output CGST 77.63 ·
Cr Output SGST 77.64 · Cr Round off 0.44. (Balances: 1,235.00 = 1,235.00.)

Credit note returning the Pen only: tax 86.29 × 18% = 15.53 (7.76 + 7.77), note **101.82**, no
round-off; the invoice still owes 1,235.00 − 101.82 = **1,133.18**. A full return also reverses the
0.44, so the invoice clears to exactly zero.

| # | You decide | Recommended default |
|---|---|---|
| I-Q1 | Rate per **line** on invoice, credit-note, bill, return and recurring-template lines; tax TYPE stays per document (place of supply) | Yes. Old document rate kept only as the fallback for lines that state none |
| I-Q2 | Item master gets an optional **default GST rate** that pre-fills the line | Yes; pre-fill only, never changes posted documents |
| I-Q3 | Tax rounded **per rate group** (not per line) | Per group: ties to the GST return. Two lines of Rs 10.10 at 5% → 1.01 (per line would give 1.02) |
| I-Q4 | **Discount and freight/extra charge** with mixed rates | Spread pro rata over the lines, so each rate is charged on its share. *GST judgment: please confirm with Puneet / Manish* |
| I-Q5 | **Round-off on invoices** (incl. cash invoices) | Yes: nearest rupee, 50 paise and over rounds up (PRD) |
| I-Q6 | **Round-off on bills and expenses** | Optional typed amount under Rs 1 (match the supplier's printed total), default 0 |
| I-Q7 | **Which account** takes the round-off | A NEW income account **"Round off"**, signed. The existing "Rounding" account stays a cash-view-only figure (nothing posts to it) |
| I-Q8 | **Credit notes** and round-off | Partial notes in exact paise; only the note that completes the invoice reverses the round-off |
| I-Q9 | **Exempt (0%) lines** on a taxed invoice | Allowed, shown separately in the GST summary |
| I-Q10 | **Old invoices** | Never re-rounded; posted figures stand (round-off 0) |

Builder notes (no decision needed): journal lines get a rate tag so GST-by-rate reports stay
ledger-based; credit-note lines get a link to the invoice line they reverse; the October acceptance
test must be checked first for any invoice total with paise (it would gain a round-off line).

### B2. .xlsx and PDF packages (Q16-1) — install approval (hard rule 2)

Figures re-checked by the orchestrator against the npm registry and the SheetJS server today.

| Package | For | Version | Size | Extra packages | Licence | Advisories |
|---|---|---|---|---|---|---|
| **SheetJS `xlsx`** (from cdn.sheetjs.com) | .xlsx import + export | 0.20.3 | 8.1 MB (download 2.4 MB) | **0** | Apache-2.0 | none |
| **pdfkit** | PDF report export | 0.21.0 | 4.8 MB (about 10.6 MB with its deps) | about 12 | MIT | none |
| *rejected:* exceljs | xlsx | 4.4.0 | 21.8 MB (about 26 MB) | about 73 | MIT | old dependency tree |
| *rejected:* npm `xlsx` | xlsx | 0.18.5 | 7.5 MB | 7 | Apache-2.0 | **2 high** (prototype pollution, ReDoS) |
| *rejected:* pdfmake | PDF | 0.3.15 | 12.0 MB (about 23 MB) | about 16 | MIT | none, but twice the size; built on pdfkit anyway |

Install commands, run by the orchestrator only after your yes:
```
npm install https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz
npm install pdfkit
npm install -D @types/pdfkit
```

| # | You decide | Recommended default |
|---|---|---|
| Q16-a | Approve SheetJS 0.20.3 + pdfkit 0.21.0 (+ its type definitions, dev only) | Yes |
| Q16-b | Which exports get PDF: the **9 reports** (trial balance, P&L, balance sheet, customer statement, customer balance detail, collections, stock ageing, inventory valuation detail, item profitability). The other 10 lists get .xlsx only | Yes, those 9 |
| Q16-c | The ₹ sign: pdfkit's built-in font has no ₹ glyph | Print "Rs" in headings and plain numbers; no extra font file |
| Q16-d | PDF tests | No extra package: write test PDFs uncompressed and check the totals appear in the text |

### B3. Archive masters (R14-1 mini-spec, S11-6 / FD §F), migration v35

Finding: customers, suppliers and items **already have an Active/Inactive flag** (used only to filter
lists; nothing refuses an inactive one on a new document). Fairs have none. Chart accounts have one,
with guards. So R14 adds the third state, Archived, and makes Inactive actually mean something.

| State | Lists / pickers | New document | Past documents and reports |
|---|---|---|---|
| Active | shown | allowed | shown |
| Inactive | listed, flagged | **refused** | shown |
| Archived | hidden (unless "show archived") | **refused** | shown |

Every move is reversible and audit-logged. Archiving is **blocked** while: an open receivable or
payable (including opening balances) or open credit/refund · stock on hand · an open draft, quotation
or active recurring template uses it · the fair has not ended · the customer hosts a fair that is not
archived. Cancelling old documents and receiving payment on an old open invoice always work.

| # | You decide | Recommended default |
|---|---|---|
| R14-Q1 | Masters covered | Customers, suppliers, items, fairs **and** chart accounts (one rule everywhere) |
| R14-Q2 | **RULED S18-2:** Inactive = hidden from the screens, still in the database, and NO work of any kind until it is activated again. Making a master Inactive is refused while anything is open on it. **Two states only** (Active / Inactive; no Archived). Past figures keep showing in reports | ruled |
| R14-Q3 | Open drafts / quotations: block archiving, or just warn | Block |
| R14-Q4 | A draft whose customer later went inactive | Edits can still be saved; it cannot be finalized until you reactivate or change the customer |
| R14-Q5 | When is a fair "ended"? | Its end date has passed; a fair with no end date cannot be archived until one is set |
| R14-Q6 | An import row naming an archived/inactive customer | Rejected with a clear message ("reactivate first"); history rows before the opening date still allowed |
| R14-Q7 | Who may archive | Any signed-in user (there is one admin login); the audit log records who |
| R14-Q8 | Recurring invoice whose customer went inactive | Skipped with a note; the other templates still run |

### B4. RULED S18-1: "refuse it" — bill discount equal to the whole stock value (S17-10 edge)
An all-stock bill whose discount equals the stock value leaves nothing payable; it saves but cannot
finalize. **(a) Refuse at save (recommended):** "The bill discount equals the whole bill, so nothing is
payable. Record free stock as a stock adjustment instead." · (b) Allow a nil bill with no journal entry
(clashes with the audit and cancel-with-reversal rules).

### B5. F2 — opening sets vs documents already posted (not yet ruled)
Today, saving an opening set dated on or after documents already posted is not checked, so those
documents count twice silently. Reversing the last opening set leaves history items with no opening
figure behind them. **Recommended:** warn with a count and require a confirm in both cases; the
documents are left alone; the "history" flag stays frozen.

---

## Part C — Built, waiting for your review (BUILD → REVIEW → TESTS, S17-1)

These are built and green. The three-reviewer pass (REV) and your hand-check workings (TST) come after
G, I, Q16 and R14 are built, so nothing here needs action now unless you want to look early.

| Slice | What it does |
|---|---|
| S17 numbering | App numbers INV / QUO / CN / PR-001/25-26; quotation link; edit guard |
| S16 slice (A, B) | Refund account, money account kept on edit, repeated payments, audit, FY lock, stock adjustment |
| F | Pre-opening items kept as history, never posted |
| R13 | Cash Flow Statement, direct method |
| R8 (S17 parts) | Bill discount on stock only, settlement discount, the S17-10 refusal |
| R10 (D) | Expenses import (Q17), every report export (Q18) |

**Calls made without you, to confirm at REV (say "fine" or change any):**
1. The settlement discount is stored only on the posted entry (no column of its own).
2. Refund default account = the account of the latest live payment (A).
3. Opening entries are never cash flows in the Cash Flow Statement (C).
4. A return on a mixed bill claws back no discount (H).
5. F builder: a history finalize/cancel returns an empty, unstored entry id · a payment on/before the
   opening date against a POSTED document is refused · a history supplier payment cannot carry a
   settlement discount · credit/return refusals also at draft save · applying credit to or refunding
   a history document is refused · a note/return dated pre-opening against a posted document is itself
   history · the importer ignores a "Before opening" column (decided from the date).

**Loose ends in the status table:** reports 7d and 8c (cash-basis invoice, bill and P&L figures) are
accepted "on trust", with no hand check yet · R6 has no recorded status in any source.

---

## Part D — Next build that needs nothing from you
**G — back-dating confirm on every dated entry + a settable "today" (Q12, S17-13).** Fully ruled; the
largest remaining builder. It can start on your word, in parallel with your answers to Part B.
