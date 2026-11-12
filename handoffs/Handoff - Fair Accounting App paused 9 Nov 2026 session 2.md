# Handoff – Fair Accounting App / "Book Buddha" (paused 9 Nov 2026, session 2)

Paste or share this at the start of a new chat in the Billing Project. It carries forward the
9 Nov (session 1) handoff and the 8 Nov session 2 handoff. The full confirmed-decision list lives
in `Handoff - Fair Accounting App paused 8 Nov 2026 session 2.md` section 7 and in
`Decisions - 9 Nov 2026 (the 15 questions).md` — both in this folder. Only the deltas from this
session are written out in full below.

## 1. Where we stopped

We are in the superpowers brainstorming process. Nothing is built until I approve the full spec.

**The design-document restructure is the current step, and the 20-section OUTLINE IS APPROVED
(see section 6).** Nothing is waiting on me. The next action is to **write the restructured design
document, Section 1 first, then each section one at a time, full content in the message, each
approved by me** — the same way we worked the App flow.

**Resume point for the new session: start writing the design document from Section 1 of the
approved outline.** Mark the five pending items (section 3.3) as OPEN wherever they appear; do not
guess them.

## 2. How to work with me (unchanged)

- Short answers, one step at a time, confirm before moving on. I am a finance professional,
  no-code background, not an engineer.
- Always tell the truth, cite real sources, say "I cannot confirm this" when unverifiable. No guessing.
- Superpowers brainstorming for planning. Spec first, plan second, build third. No implementation
  plan until I confirm the spec; no code until I confirm the plan.
- Questions in sets of 5, one decision each, lettered options; I answer "1A, 2B".
- Put full section content in the message. End long drafts with a plain-text question, not a card.
- "What is suggested as per accounting logic?" → search, cite, label opinion, say what is unverified.
- When I paste another AI's answer, check it against real sources; say what is verified and what is not.
- "Go the Invoice Ninja way" → check its docs, report, flag conflicts. "Check the magazine PRD" →
  read `PRD_Magazine_Subscription_Management_v4` and report exactly what it says and does not say.
  "See how any accounting software does it" → check QBO / Tally / Zoho and cite pages.
- Files live in `C:\Users\Admin\Desktop\Book Buddha`. Save handoffs/prompts there, not as project files.
- Design principle: the app must leave me free to manage things my own way; no strict built-in rules.
  Fixed parts: double-entry, audit log, cancel with reversal.

## 3. What happened on 9 Nov (session 2)

### 3.1 Subscription accounting — pasted note verified, treatment accepted
- I pasted a detailed accounting note (from another AI) on annual magazine/journal subscriptions.
  Claude verified its citations against real sources. **Accepted as correct, except the four items
  I am re-answering (3.3).** Verified points are in section 4.
- **To my CA (not settled by the note):** principal vs agent — do I book the full subscription
  value or only my margin; and GST classification and timing.
- **Design stance unchanged (7 Nov):** the app stays generic; there is NO hardcoded subscription
  rule. I manage unearned revenue with my own accounts plus an optional repeat template. The
  verified accounting is how I will USE the app, not a rule the app enforces. If any part of the
  app were to move money from unearned to earned automatically, that is a design change to flag.
- **M4 (challan ↔ invoice link) — proposed shape, to confirm when writing Section 11:** invoice
  first (full-year) → one or many challans raised against it; one challan belongs to one invoice in
  v1 (a challan spanning several invoices is a v2 item); stock moves once, on the chosen document
  (challan or invoice, per the per-business stock setting).
- **Note:** I did not type my own free-form subscription answer; the verified note stands in for
  it. Section 11 of the design document is where it folds in, and where I give any changes.

### 3.2 Reports additions — ACCEPTED into V1 (beyond the already-decided 8 reports)
- **Extra reports:** Customer Balance Detail, Open Invoices, Collections, Sales by Customer,
  Transaction Detail by Account, Transaction List by Date, Inventory Valuation Detail (I already
  had the Summary), and a stock / quantity-on-hand report.
- **A "Customize" panel on every report:** General (accounting method cash/accrual, period, number
  format), Rows/Columns, Filter (customer, account, vendor, product/service), Header/Footer.
- **Filtering, saving, sharing:** filter by Book Fair tag and by business (QBO's class/location
  job, done with my own tags); save a customized report and re-run; group; schedule by email;
  export to PDF and Excel.
- **Caveat:** scheduled email reports need internet + an email account in Settings (rides on the
  optional-email decision). Everything else here is offline.
- **NOT folded in — stays under Q4 (pending):** the deeper report-builder (pivot tables,
  group-by-up-to-3-columns, grouping a report by custom fields).

### 3.3 Five items parked — I will re-answer these
1. **Q4 — Reports:** the generic report-*builder* decision (recorded answer was "8 fixed reports
   plus a generic report builder, QBO/AppFolio style").
2. **Q7 — Archive as a third state** (recorded: skip in v1).
3. **Q8 — Line-item date tokens** `:MONTH`/`:QUARTER`/`:YEAR` (recorded: yes).
4. **Stock tracking** — the "Track stock: Yes/No" per-item switch plus the per-business
   "who reduces stock" setting (challan vs invoice), including how it reads for magazines (M1/M2).
5. **Report-builder inclusion** — whether pivot / group-by-3 / custom-field grouping is in V1.
   This is part of Q4.

### 3.4 QBO reports research done on 9 Nov (reference for Q4 — do not redo)
From Intuit's own current help pages (US/global, not an India-specific list):
- QBO groups reports into ~10 named categories (Business overview; Who owes you = A/R; Sales and
  customers; What you owe = A/P; Expenses and suppliers; For my accountant = the core accounting
  reports; Payroll; Sales tax).
- Report counts by tier: Simple Start 20+, Essentials 40+, Plus 65+, Advanced 100+. Inventory and
  budget reports are Plus-and-above.
- Customize panel sections: General (accounting method, period, number format), Rows/Columns,
  Filter, Header/Footer; filter by class/location (Plus tier); save customization; schedule email;
  export PDF/Excel.
- The true report-builder (Custom Report Builder, modern view) is QBO Advanced only: build from a
  wizard or from scratch, pivot tables, group by up to 3 columns, and group/filter by custom
  fields. That last point confirms a custom-field-aware builder is a known, working pattern.
- The QBO note itself was NOT saved to a file; it is in the session 2 chat only.

### 3.5 Design-document outline — APPROVED (20 sections)
Listed in section 6. The architecture is already settled across prior sessions and the filter sheet
resolved all ~20 conflicts in my favour, so the restructure is assembly, not fresh design. The
approval point was the structure; it is approved.

## 4. Subscription verification detail (sources checked 9 Nov — do not re-verify)
- **AS 9 (ICAI):** subscriptions for publications → revenue deferred, recognised either
  straight-line over time, or by the sale value of items delivered vs total sale value where issue
  values vary. VERIFIED (ICAI AS 9 text; Taxmann).
- **Ind AS 115:** an advance for a not-yet-performed obligation is a contract liability (paras
  105–106; B44 for prepayments). Principal vs agent at B34–B38; point-in-time recognition in the
  31–38 range. VERIFIED.
- **Applicability:** Ind AS 115 for companies on the MCA roadmap — listed (except SME-listed) any
  size, and unlisted at net worth ≥ ₹250 crore (Phase II, FY 2017-18 onward). Smaller / non-company
  entities stay on AS 9. VERIFIED.
- **GST:** Notification 66/2017 – Central Tax removes GST on advances for supply of GOODS for
  registered persons (other than composition); advances for SERVICES remain taxable; a receipt
  voucher is still required. VERIFIED. Exact classification (goods vs service) and timing → CA.
- Ind AS 2 / AS 2 (cost recognised when control transfers): principle sound; exact paragraph not
  re-verified.

## 5. Confirmed decisions (carried forward)
Unchanged and still current. See `Handoff - Fair Accounting App paused 8 Nov 2026 session 2.md`
section 7 (direction/build, 5 Nov, 6 Nov, 7 Nov decisions; transactions/reports) and
`Decisions - 9 Nov 2026 (the 15 questions).md` (magazine M1-M3, Block B Q1-Q11).
**Deltas this session:** reports additions accepted into V1 (3.2); subscription treatment accepted
and verified (3.1, 4).

## 6. The approved design-document outline (20 sections)
Sections marked *(PENDING #n)* carry one of the five parked items; write them as skeleton with the
item marked OPEN.

1. Purpose & scope
2. Core principles & the two phases
3. Company → businesses → Book Fair tag → chart of accounts
4. The accounting engine (double-entry, posting, FY lock, opening balances)
5. Customers (fields, contacts, addresses, classification, duplicates + merge, statements)
6. Items & stock *(PENDING #4)*
7. Invoices (fields, numbering, drafts/autosave, charges/discounts/tax, lifecycle,
   edit-with-history, bulk actions)
8. Other documents (quotations, credit notes, challans, recurring invoices, bills/expenses, POs)
9. Payments & money (methods, split allocation, overpayment/credit, refunds, returns, write-off,
   immutability)
10. Fairs (create, host customer, fair invoicing, buyer details)
11. Subscriptions / magazine handling *(subscription treatment + M4 fold in here)*
12. Reports *(accepted additions in; PENDING #1 and #5 — the builder)*
13. Tax, custom fields, tags, notes
14. Import / export / backup
15. Login, users & roles
16. Audit log & technical error log
17. Settings (numbering patterns, FY, stock setting, amount grouping)
18. Reliability — when things go wrong
19. How we verify it works (testing)
20. Open items (the 5 pending + the CA/legal items)

After all sections are approved, compile the document to a `.md` in this folder (unless I ask for
the artifact instead).

## 7. Open items not mine alone to settle
- CA: principal vs agent (full sale vs margin) and GST classification/timing for the magazine resale.
- Lawyer: buyers' personal data (India DPDP Rules 2025, staged start, sources differ on 13/14 May
  2027); and before giving away or selling the app.
- GST: the magazine PRD records "GST: Exempt" as my stated scope; Claude cannot confirm my position.

## 8. Files on disk (this session added only this handoff)
- This handoff.
- Source for the restructure: `Filter sheet - Book Buddha (8 Nov 2026).md` (full, read this session).
- Decision references: `Handoff - Fair Accounting App paused 8 Nov 2026 session 2.md`,
  `Decisions - 9 Nov 2026 (the 15 questions).md`, `Round 5 status note (9 Nov 2026).md`.
- Project file: `PRD_Magazine_Subscription_Management_v4`.
- The QBO reports note and the subscription-note verification are in the session 2 chat only.

## 9. Next steps
1. Write the design document, Section 1 first, then one section at a time, each approved by me.
2. Keep the five pending items (3.3) marked OPEN; fold my answers in as they arrive.
3. Fold the subscription treatment + M4 into Section 11; I confirm M4 there.
4. When all sections are approved, compile to a `.md` in this folder.
5. Then: App flow (12 sections, one at a time), update PRD and Features List, I confirm the spec.
6. **Only then** the implementation plan (writing-plans skill). Only after I confirm the plan, build.
