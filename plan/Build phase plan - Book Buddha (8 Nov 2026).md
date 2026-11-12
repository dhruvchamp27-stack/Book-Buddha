# Book Buddha — Build Phase Plan

*Written 8 November 2026. This is a process plan, not a spec and not an implementation plan.
It fixes the order of work and the definition of done for each stage. It decides nothing about
the product.*

## The standing rule

1. **Spec first.** No plan until the spec is confirmed.
2. **Plan second.** No build until the plan is confirmed.
3. **Build third.** Nothing is written as code before stages 1 and 2 are signed off.

This rule governs everything below and overrides any stage that appears to permit otherwise.

---

# Section 1 — The documentation phase (writable now)

Six stages. Each has an owner, an output, and a definition of done. A stage is not done because
a document exists; it is done when the test below passes.

## Stage 1.1 — The filter sheet

**Purpose.** Turn roughly 500 KB of Invoice Ninja inspection output into decisions. This is the
bridge between the inspection and the spec, and it is the thing that has been offered three
times and not yet made.

**Output.** One table. Every item the inspection returned, one row each, with:

| Column | What goes in it |
|---|---|
| Item | The finding, in one line |
| Source | Batch or pass number, so it can be traced back |
| Evidence | Strong / Weak / Unverified — see below |
| Verdict | Take / Adapt / Skip / Conflict |
| Note | Why, in one line. For Conflict: which of my decisions it collides with |

**Evidence grades.** Strong = code path with a checkable line, or a live before-and-after test.
Weak = a single claim with no corroboration. Unverified = the only support is a screenshot now
known to be a duplicate, or a claim contradicted elsewhere in the reports.

**Definition of done.** Every item has a verdict; no row is blank. Every Conflict row names the
decision it conflicts with. Every Unverified row is listed again at the end as a short "ask the
other AI" list. I can read the Verdict column alone and know what the app does.

**Not done if:** it summarises rather than enumerates, or it marks something Take on the
strength of evidence graded Unverified without saying so.

## Stage 1.2 — The four pending accounting questions

**Purpose.** Unblock App flow sections 4, 5 and 11.

**Output.** Four answers from me, in the lettered-option format, one decision per question:
cost of books sold; cost of magazines with no stock; how a credit customer's cycle invoice is
built and how it relates to recurring invoices; how a challan links to an invoice.

**Definition of done.** All four answered and written into the design document. Anything my CA
must confirm is recorded as an open item against my name, not treated as settled.

## Stage 1.3 — The design document, restructured

**Purpose.** The single statement of what Book Buddha is. Replaces Draft 1 of 1 November, which
predates the generic-core direction.

**Output.** One document covering: the generic core (blank start, user-named businesses, user-set
fields, layouts, numbering, chart of accounts, tags); the fixed parts that cannot be customised
away (double-entry, audit log, cancel with reversal); the company-and-businesses structure; login;
items and stock; the document set; tax; reports; import, export and backup; and the phase split.

**Definition of done.** Every decision in sections 6.1 to 6.6 of the 8 November handoff appears
in it, with its date. Every Take and Adapt row from the filter sheet is reflected. It says
"local web app on one PC" in plain words. It contains no decision I have not made. Open items
are listed as open, not silently resolved. I have read it and approved it.

## Stage 1.4 — The App flow document

**Purpose.** What happens on every screen and every tap. This is what makes the build possible
without inventing hundreds of small decisions badly.

**Output.** Twelve sections, in the approved format: numbered steps, a simple diagram per flow,
and what happens on every tap. Written **one section at a time**, each approved by me before the
next is started.

**Definition of done, per section.** Every screen names its fields and its exact on-screen
wording. Every tap says what happens, including what is saved, what is logged, and what the user
sees next. Every error path is covered: what is blocked, what is warned, what is allowed. No
section is marked done on my silence — only on my explicit approval.

**Definition of done, overall.** All twelve approved. Drafts written before the generic-core
direction (sections 3 and 4) have been rechecked against it, not merely carried over.

## Stage 1.5 — PRD and Features List, updated

**Purpose.** Bring the two oldest documents into line so there is no stale version in
circulation.

**Output.** PRD and Features List rewritten from the approved design document and App flow.

**Definition of done.** Neither document contains anything the design document contradicts. Both
are dated and marked as superseding v0.1.

## Stage 1.6 — The spec is confirmed

**Purpose.** The gate.

**Definition of done.** I state in writing that the design document and the App flow together
are the spec, and that they are approved. Until that sentence exists, stage 2 does not begin.

---

# Section 2 — The coding phase (shape only)

**This section is deliberately a skeleton.** It cannot be filled in until the spec exists,
because an implementation plan argues from a spec and there is nothing yet to argue from.
What follows is the shape, the order, and what correct output means at each stage. Where a
decision is missing, it is named as missing rather than guessed.

## 2.0 — Gaps that must be closed before this section can be written

These are not minor. Each one changes what gets built:

- **The technology.** Not decided. "Local web app on one PC, one program, one database file,
  screens in a browser" is a shape, not a stack. Language, framework and database are all open.
  The inspection AI suggested SQLite; that was its opinion and I have not adopted it.
- **Who builds it.** An AI tool writes the code; which one, and how it is driven, is not settled.
- **How it is installed and started** on my PC, and what a non-engineer does to launch it.
- **What the tests run against**, given that nothing exists yet.

Until these four are answered, section 2 stays a skeleton.

## 2.1 — Order of build

Each stage produces something that works and can be checked before the next begins. Nothing
is built in one unchecked pass.

| # | Stage | What correct output looks like |
|---|---|---|
| 1 | The accounting engine | Every entry produces equal debits and credits. The Trial Balance always balances. No screen exists yet; this is proved by tests alone. |
| 2 | Company, businesses, chart of accounts | A company can be created with two businesses, each entry tagged with its business, one shared chart of accounts, and reports that separate and combine them correctly. |
| 3 | Customers and items | Records can be created, edited and deleted; duplicate names warn but allow; the Track stock switch exists and is blocked while stock remains. |
| 4 | Invoices and the stock rules | An invoice saves as a whole or not at all. Numbering follows the agreed pattern. The per-business stock setting decides what moves stock, and a linked challan and invoice never move it twice. |
| 5 | The rest of the document set | Quotations, credit notes, challans, recurring invoices, bills, payments, expenses, stock adjustments — each with its agreed accounting effect. |
| 6 | Cancel, edit history, audit log | Cancelling reverses sale, payment and stock. Editing a finalised invoice keeps the prior version. Every action appears in the read-only log. |
| 7 | The eight reports | Each runs per business, combined, and fair by fair. |
| 8 | Import, export, backup and restore | Excel and CSV import with a pre-check. Backup with the user's choice of contents. Restore produces identical report figures. |
| 9 | Login and the financial year lock | As decided on 7 November. |

## 2.2 — What "correct output" means at every stage, without exception

A stage is finished when all five hold:

1. **It balances.** Debits equal credits; the Trial Balance ties.
2. **It matches my figures.** I prepare sample transactions and work out the expected result by
   hand. The app's reports must match my numbers exactly. A passing technical test is not
   acceptance; my figures are.
3. **It reverses cleanly.** Cancelling returns sales, payment and stock to exactly where they
   were.
4. **It is logged.** The action appears in the audit log with who, what and when.
5. **I have used it.** Not a screenshot, not a test report — I have done the thing on screen and
   it did what the App flow says it does.

A stage that fails any of the five is not done, whatever the test output says.

## 2.3 — What is mine to build regardless of the inspection

The inspection cannot help with these, because Invoice Ninja has none of them: the double-entry
engine, the financial-year lock, FIFO costing, opening balances, the challan as a real document,
the per-business stock setting, fair-wise reporting, the write-off, and the per-item Track stock
switch. These carry the most risk and the least reference material, which is why stage 1 of the
build is the engine and nothing else.

## 2.4 — The gate out of the skeleton

This section is rewritten properly, as a real implementation plan with files, tasks and tests,
only after stage 1.6 and after the four gaps in 2.0 are closed. I confirm that plan before any
code is written.
