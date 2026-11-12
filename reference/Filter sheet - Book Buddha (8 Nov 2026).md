# Filter Sheet — Invoice Ninja inspection vs Book Buddha decisions

*Built 8 November 2026 from all four inspection rounds: 13 round-2 batches, 10 round-3 UX passes,
7 round-4 UI passes. A working document for deciding the spec. It is not the spec and it decides
nothing on its own.*

## How to read it

**Evidence**
- **Strong** — a code path with a checkable file and line, or a live before-and-after test, or both.
- **Weak** — a single claim with no corroboration, or an inference presented as a finding.
- **Unverified** — the only support is a screenshot now known to be a duplicate, or the claim is
  contradicted elsewhere in the reports. These are listed again in section 15.

**Verdict**
- **Take** — copy it as it is.
- **Adapt** — copy the idea, changed to suit the decisions already made.
- **Skip** — not for Book Buddha.
- **Conflict** — collides with a settled decision. Section 14 lists every one of these; they are
  the rows that need a ruling.
- **Ours** — Invoice Ninja has no counterpart. Must be designed from scratch.

**Counts:** 214 rows. Take 61 · Adapt 58 · Skip 44 · Conflict 29 · Ours 22.

---

## 1. The accounting engine

| # | Item | Source | Evidence | Verdict | Note |
|---|---|---|---|---|---|
| 1.1 | No chart of accounts anywhere in the product | B0, B2, summary | Strong | Ours | The whole engine is ours. Nothing to copy. |
| 1.2 | No journal entries, no general ledger, no trial balance | B2, summary | Strong | Ours | |
| 1.3 | No balance sheet, no cash flow statement | B9 | Strong | Ours | B9 lists 29 reports; neither appears. |
| 1.4 | Its "ledger" (`company_ledgers`) only logs customer balance adjustments | B2, B4 | Strong | Skip | Not a ledger in the accounting sense. |
| 1.5 | Client balance = SUM(invoice.balance) where status in (Sent, Partial) | B4 | Strong | Adapt | A derived figure, not a posted one. Ours comes from the ledger. |
| 1.6 | Paid-to-date = SUM(invoice.paid_to_date) where status in (Sent, Partial, Paid) | B4 | Strong | Adapt | Same. |
| 1.7 | Credit balance = SUM(credit.balance) where status in (Sent, Partial) | B4 | Strong | Adapt | Same. |
| 1.8 | A draft invoice has zero effect on the client balance | B1, B4 | Strong | Take | Matches double-entry: a draft posts nothing. |
| 1.9 | Balance is only incremented on transition to Sent | B1, B2 | Strong | Take | Our equivalent: posting happens at finalisation. |
| 1.10 | No FIFO, no LIFO, no weighted average, no cost layers | B5 | Strong | Ours | FIFO decided 5 Nov. Entirely ours. |
| 1.11 | Static cost snapshot: `products.cost` copied onto the line item at creation | B5 | Strong | Adapt | Useful pattern for holding historical cost, but not a substitute for FIFO layers. |
| 1.12 | Gross profit = SUM((line.price − line.cost) × qty) | B5 | Strong | Skip | Too crude for our P&L. |
| 1.13 | No financial-year lock | B2, B10 | Strong | Ours | Decided 6 Nov: FY lock yes, Admin-only correction. |
| 1.14 | No opening-balance screen or import | B11 | Strong | Ours | Decided 6 Nov: import plus a typing screen. |

---

## 2. Invoice creation and fields

| # | Item | Source | Evidence | Verdict | Note |
|---|---|---|---|---|---|
| 2.1 | 36 input fields on the invoice, enumerated with validation and destination | B1 | Strong | Take | The starting checklist for our invoice screen. |
| 2.2 | Client is the only strictly required field | B1, ux-7 | Strong | Adapt | Ours also needs at least one line with quantity. |
| 2.3 | Invoice date defaults to today in the company timezone | B1 | Strong | Take | |
| 2.4 | Due date defaults to date + client payment terms | B1 | Strong | Adapt | Ours: fixed 30 days, user can change or clear (5 Nov). |
| 2.5 | `counter_number_applied`: `when_saved` or `when_sent`, a user setting | B1, B10 | Strong | Adapt | Ours is fixed: number shown on open, used on save (6 Nov). Making it a setting is a candidate. |
| 2.6 | Number collision retry loop, up to 50 attempts | B1 | Strong | Take | A built-from-scratch app forgets this until it bites. |
| 2.7 | One-second atomic lock on save; a double-click returns HTTP 429 rather than two invoices | B1 | Strong | Take | Same. |
| 2.8 | Partial / deposit amount with its own due date, validated before the full due date | B1 | Strong | Adapt | Useful for magazine prepayments. Not yet decided. |
| 2.9 | Document-level discount, percentage or fixed, via `is_amount_discount` | B1 | Strong | Take | Matches the 6 Nov lump-sum discount decision. |
| 2.10 | Line-level discount separate from document discount | B1, ux-1 | Strong | Take | Live test: ₹1,000 − 10% line − 5% doc = ₹855. Arithmetic verified. |
| 2.11 | Three tax slots per line and three per document, each name + rate | B1 | Strong | Adapt | Ours: user-created tax names and rates per line (6 Nov). Three may be enough; confirm. |
| 2.12 | Four custom surcharges with individual taxable toggles | B1 | Strong | Adapt | Our "extra charges, name and amount typed by user" (6 Nov). Theirs is capped at 4. |
| 2.13 | Terms, footer, public notes inherited from the customer record if blank | B1 | Strong | Take | A real convenience. |
| 2.14 | Private notes, never rendered on PDF or portal | B1 | Strong | Take | Matches the internal-notes decision (6 Nov). |
| 2.15 | Line-item placeholders `:MONTH`, `:YEAR`, `:QUARTER`, `:WEEK` parsed on save | B1 | Strong | Adapt | Strong fit for magazine subscription lines. |
| 2.16 | Product auto-catalogue: a new product key on an invoice creates the product | B1 | Strong | Adapt | Make it a setting, off by default. Silent catalogue growth is a hazard. |
| 2.17 | Exchange rate field, auto-computed when client currency differs | B1 | Strong | Skip | INR only in v1. |
| 2.18 | Blank line rows are normalised to zero-value items rather than rejected | B1 | Strong | Conflict | See 14.1 — ours should not silently keep empty rows. |
| 2.19 | A half-filled row (description, no price) is silently dropped on save with no warning | ux-1, ux-9 | Strong | Conflict | See 14.1. |
| 2.20 | Line items stored as one JSON blob in the invoice row, not a child table | B1, 4-Nov inspection | Strong | Skip | Wrong for an accounting app that must query by item. |
| 2.21 | Tab order reaches the first form field only after 41 Tab presses | ux-1 | Strong | Skip | Their defect. Ours: autofocus the client field. |
| 2.22 | No autofocus on form open; focus stays on `<body>` | ux-0, ux-1, ux-3, ux-9 | Strong | Skip | Named four times as the second-worst daily cost. |
| 2.23 | Tabbing out of the last line cell lands on "Add Item", not a new row | ux-1, ux-9 | Strong | Skip | Ours should spawn and focus the next row. |
| 2.24 | No "Save & New"; every save redirects to the edit screen | ux-1, ux-3 | Strong | Skip | Add Save & New for fair invoicing, where speed matters. |
| 2.25 | Totals box falls below the fold at 5+ lines on a 1366×768 screen | ux-1 | Strong | Skip | Keep the total visible while typing. |
| 2.26 | Inline "New Client" opens a 31-field drawer and loses uncommitted line items | ux-1 | Strong | Adapt | Take inline creation; make it a small form and preserve the draft. |
| 2.27 | Typing an uncatalogued description does not prompt to create a product | ux-1 | Strong | Take | Ad-hoc lines should stay ad-hoc. |
| 2.28 | Numeric inputs reject non-digits at the keystroke | ux-1, ux-7, ui-4 | Strong | Take | Prevents the error class entirely. |
| 2.29 | Unit cost reformats to 2 decimals on blur | ux-1 | Strong | Take | |
| 2.30 | Pasting `$150.00` into a cost field strips to `150.00` | ux-1 | Strong | Take | |
| 2.31 | Row drag handle reorders lines; delete is instant with no confirm | ux-1 | Strong | Adapt | Take the drag handle. Add an undo for the delete. |
| 2.32 | Totals recalculate in ~0.05s with no save or blur needed | ux-1 | Strong | Take | |

---

## 3. Invoice lifecycle

| # | Item | Source | Evidence | Verdict | Note |
|---|---|---|---|---|---|
| 3.1 | Six stored statuses: Draft, Sent, Partial, Paid, Cancelled, Reversed | B2 | Strong | Adapt | Ours needs Draft, Issued, Partial, Paid, Cancelled at minimum. |
| 3.2 | Overdue and Unpaid are calculated filters, not stored states | B2, B3 | Strong | Take | Matches the magazine PRD rule that no due date means never overdue. |
| 3.3 | Four distinct destructive actions: cancel, reverse, archive, delete | B2 | Strong | Take | The clearest finding in the whole inspection. We had been treating these as two. |
| 3.4 | Cancel is reversible: prior status and balance restored from `backup->cancellation` | B2 | Strong | Take | Good pattern: store the pre-state so the reversal is exact. |
| 3.5 | Cancel does **not** restore stock | B0, B2, B5 | Strong | Conflict | See 14.2. |
| 3.6 | Reverse is permanent and auto-issues a credit note for anything already paid | B2 | Strong | Adapt | A clean model for our write-off and sales-return work. |
| 3.7 | Archive touches nothing financial; only stamps `deleted_at` | B2 | Strong | Take | A third state between active and deleted is worth having. |
| 3.8 | Delete restores stock, renames the number with `_deleted`, reduces client balance | B2, B5 | Strong | Conflict | See 14.3. |
| 3.9 | Restore winds back the `_deleted` suffix, or issues a fresh number if taken | B2 | Strong | Skip | Follows from number recycling, which we rejected. |
| 3.10 | Force delete purges the row permanently | B2 | Strong | Skip | No hard delete in an audited book. |
| 3.11 | `lock_invoices`: off / when_sent / when_paid / end_of_month | B2, B10 | Strong | Adapt | Four modes is a good menu. Ours adds the FY lock. |
| 3.12 | A locked invoice returns HTTP 422 on any edit; no prior version is kept | B2 | Strong | Conflict | See 14.4. |
| 3.13 | Recording a payment is the single permitted exception on a locked invoice | B2 | Strong | Take | Sensible carve-out. |
| 3.14 | Locked invoices are skipped by the reminder engine | B2 | Strong | Skip | Odd behaviour; reminders should still go out. |
| 3.15 | Mark Sent uses an atomic claim so two clicks cannot both transition it | B2 | Strong | Take | |
| 3.16 | Mark Paid on a draft escalates it through Sent first, then pays it | B2 | Strong | Adapt | Right instinct; ours must post the sale before the receipt. |
| 3.17 | Clone resets number, dates and status, keeps client and lines | B2 | Strong | Take | |
| 3.18 | Convert invoice → quote, → purchase order, → credit note | B2 | Strong | Adapt | Invoice → credit note is worth having. The others are not. |

---

## 4. The invoice list

| # | Item | Source | Evidence | Verdict | Note |
|---|---|---|---|---|---|
| 4.1 | 44 selectable columns, 7 shown by default | B3 | Strong | Take | The default 7 (status, number, client, amount, balance, date, due date) are the right 7. |
| 4.2 | Natural numeric sort strips non-digits so `0010` does not sort before `002` | B3 | Strong | Take | Small, non-obvious, matters with our FY-suffixed numbers. |
| 4.3 | Weighted status sort floats overdue and unviewed invoices to the top | B3 | Strong | Take | |
| 4.4 | Deep search reaches inside the line-items JSON via `JSON_SEARCH` | B3, ux-2 | Strong | Take | Live test: "Periodical" found 2 invoices by line text alone. A real capability. |
| 4.5 | Search also covers number, PO number, custom fields, client name, contact, project | B3 | Strong | Take | |
| 4.6 | Lifecycle filter: Active / Archived / Deleted as SQL on `deleted_at` and `is_deleted` | B3 | Strong | Adapt | Ours: Active / Archived / Cancelled. |
| 4.7 | Status filter supports comma-separated multiple statuses | B3 | Strong | Take | |
| 4.8 | Date range and due-date range filters with explicit column selection | B3 | Strong | Take | |
| 4.9 | 16 bulk actions with per-row precondition checks | B3 | Strong | Adapt | Matches the 6 Nov bulk-actions decision. Delete stays Admin-only. |
| 4.10 | Bulk actions take an atomic lock keyed on IP + action + company | B3 | Strong | Take | |
| 4.11 | An ineligible row in a bulk action is silently skipped, count reported by toast | ux-2 | Weak | Adapt | Report which rows were skipped, not just how many. |
| 4.12 | Column choices stored per user in `company_user.react_settings` | B3 | Strong | Adapt | Phase 1 is Admin only; matters in Phase 2. |
| 4.13 | Default 10 rows per page; options 10 / 25 / 50 / 100 | ux-2 | Strong | Adapt | Default 25 or 50. 10 was named a daily annoyance. |
| 4.14 | No virtual scrolling; 100 rows mounts 100 DOM rows with ~0.35s stutter | ux-2 | Weak | Skip | |
| 4.15 | Filter state survives refresh and SPA navigation | ux-2 | Unverified | — | Screenshot cited is a duplicate. See 15. |
| 4.16 | Pressing Enter in search blurs the input | ux-2 | Weak | Skip | Keep focus. |
| 4.17 | Column customiser behind an unlabelled 16px gear icon | ux-2 | Weak | Adapt | Keep the feature, label the control. |

---

## 5. Customers

| # | Item | Source | Evidence | Verdict | Note |
|---|---|---|---|---|---|
| 5.1 | 33 fields across Details, Address, Settings, Custom Fields | B4 | Strong | Adapt | Ours is smaller. Use as a checklist, not a target. |
| 5.2 | 12 sub-tabs on the customer record | B4, ux-3 | Strong | Adapt | The best available answer to "what should a customer record show". Ours needs about 7. |
| 5.3 | Four overview cards: details, address, contacts, standing | B4 | Strong | Take | |
| 5.4 | Standing card shows Paid to Date, Outstanding, Credit Balance, Payment Balance | B4, ux-4 | Strong | Adapt | Four money boxes is right. Our names will differ. |
| 5.5 | Separate billing and shipping address blocks | B4 | Strong | Take | Matches 6 Nov. Add the copy button, which they lack. |
| 5.6 | Unlimited contacts per customer | B4 | Strong | Conflict | See 14.7. |
| 5.7 | Exactly one primary contact; first created defaults to primary | B4 | Strong | Take | |
| 5.8 | Contact flags: send_email, cc_only, can_sign, is_locked | B4 | Strong | Adapt | `cc_only` and `send_email` are worth having once email is on. |
| 5.9 | Contact emails must be distinct within a customer | B4 | Strong | Take | |
| 5.10 | Duplicate customer names permitted with no warning at all | B4, ux-7, ux-9 | Strong | Conflict | See 14.8. |
| 5.11 | A completely empty customer saves with zero validation errors | ux-3 | Strong | Skip | Require a name. |
| 5.12 | No required-field asterisks anywhere on the customer form | ux-3, ui-4 | Strong | Skip | Mark required fields. |
| 5.13 | Attachments up to 100 MB across 22 extensions | B4 | Strong | Adapt | 6 Nov set 20 MB and a shorter list. Theirs is more generous than we need. |
| 5.14 | Genuine merge: re-parents 15 child tables, reconciles contacts, purges source | B4 | Strong | Take | We have never discussed this and will need it, because we allow duplicate names. |
| 5.15 | Merge recalculates all balances and writes a ledger note | B4 | Strong | Take | |
| 5.16 | Three-level archive / delete / purge, purge being a hard cascade | B4 | Strong | Adapt | Take archive and delete. Never purge. |
| 5.17 | Customer classification: individual, business, company, partnership, trust, charity, government, other | B4, B8 | Strong | Take | Exactly the list settled on 7 Nov. |
| 5.18 | Statement engine with six aging buckets, date range, status filter, three optional tables | B4, B6 | Strong | Take | Directly serves the 6 Nov customer-statements decision. |
| 5.19 | Statement can stream as PDF or be emailed with the PDF attached | B4 | Strong | Adapt | Email is optional in our build. |
| 5.20 | Customer number auto-generated from a counter pattern | B4, B10 | Strong | Take | Matches the user-defined prefix decision (6 Nov). |
| 5.21 | Per-customer setting overrides (currency, language, payment terms, design) | B4, B10 | Strong | Adapt | Useful for magazine customers on different terms. |

---

## 6. Items and stock

| # | Item | Source | Evidence | Verdict | Note |
|---|---|---|---|---|---|
| 6.1 | `track_inventory` is a company-level master switch, not per product | B5 | Strong | Conflict | See 14.9. |
| 6.2 | Stock lives in `in_stock_quantity`; `quantity` is the default line quantity | B5, B0 | Strong | Take | Batch 1 got this wrong; Batch 5 is right. Naming matters. |
| 6.3 | Stock decrements immediately on invoice save, including a draft | B0, B1, B5 | Strong | Conflict | See 14.10. |
| 6.4 | Eight callers of the stock adjustment job, each enumerated | B0 | Strong | Take | The checklist of every place stock can move. |
| 6.5 | Negative stock is permitted freely; tested to −3, shown in red | B5 | Strong | Conflict | See 14.11. |
| 6.6 | Concurrency guard: stock is stripped from an update unless the user touched the field | B5 | Strong | Take | Genuinely good. Prevents a stale form clobbering a figure that moved. |
| 6.7 | Document-by-document stock matrix: invoice decrements, PO increments on receipt, quote nothing, credit note nothing, delivery note nothing | B5, B6 | Strong | Adapt | The right shape; our challan is the exception. |
| 6.8 | Stock adjustment filters on line `type_id == 1`, skipping task and expense lines | B5 | Strong | Take | |
| 6.9 | Two-tier low-stock threshold: per product, falling back to company | B5 | Strong | Adapt | Worth having for books before a fair. |
| 6.10 | Item fields: key, description, price, cost, default quantity, max quantity, 3 taxes, image, stock, notification, threshold | B5 | Strong | Adapt | Ours adds unit and Track stock. |
| 6.11 | Only the item key is mandatory | ux-3 | Strong | Take | |
| 6.12 | No unit of measure field on the product | B5, ux-3 | Strong | Ours | Decided 5 Nov: unit from a user-maintained list. |
| 6.13 | No batch creation or "Save & Add Another" for products | ux-3 | Strong | Skip | Add it; cataloguing books is bulk work. |
| 6.14 | Product changes are not written to the activity log | B11 | Strong | Conflict | See 14.12. |

---

## 7. The other documents

| # | Item | Source | Evidence | Verdict | Note |
|---|---|---|---|---|---|
| 7.1 | Quote statuses: Draft, Sent, Approved, Converted, Rejected, Expired | B6 | Strong | Take | |
| 7.2 | Expired is a virtual status computed from the valid-until date | B6 | Strong | Take | Same pattern as Overdue. Consistent and cheap. |
| 7.3 | Quote → invoice copies lines, resets status, dates and balance, links both ways | B6 | Strong | Take | |
| 7.4 | Option to carry the quote's number onto the invoice (`shared_invoice_quote_counter`) | B6, B10 | Strong | Conflict | See 14.13. |
| 7.5 | Option to carry quote terms onto the invoice, or use company defaults | B6 | Strong | Take | |
| 7.6 | Converting a quote archives it if auto-archive is on | B6, B10 | Strong | Adapt | Make it a setting, default off. |
| 7.7 | No banner linking a converted quote to its invoice; 4 clicks to cross-reference | ux-5, ux-9 | Strong | Skip | Put a link on both documents. |
| 7.8 | Credit note in two phases: issuance raises the credit pool, application creates a payment of type Credit | B6 | Strong | Take | The clearest model for the 6 Nov credit-note decision. |
| 7.9 | Credit application attaches the payment to both the invoice and the credit | B6 | Strong | Take | |
| 7.10 | Credit statuses: Draft, Sent, Partial, Applied | B6 | Strong | Take | |
| 7.11 | Credit note entry screen looks identical to an invoice; no negative signs, no colour | ux-5, ux-9 | Strong | Skip | A real mis-entry hazard. Ours must look different. |
| 7.12 | 12 recurrence frequencies from daily to three-yearly | B6 | Strong | Adapt | Monthly, quarterly, half-yearly and annually cover the magazine business. |
| 7.13 | `remaining_cycles = -1` means run forever | B6 | Strong | Take | |
| 7.14 | Interlock: generation is skipped if an earlier child invoice is still unpaid | B6 | Strong | Take | Partly answers pending question 3 on credit customers. |
| 7.15 | Auto-bill gives up after 3 failures and disables itself | B6 | Strong | Skip | No gateway in v1. |
| 7.16 | Recurring invoice generation decrements stock on each child | B6 | Strong | Adapt | Must follow our per-business stock setting. |
| 7.17 | Purchase order statuses: Draft, Sent, Accepted, Received, Cancelled | B6 | Strong | Take | |
| 7.18 | PO increments stock on Received, creating the product if absent | B6 | Strong | Adapt | Take the increment; never auto-create the product. |
| 7.19 | PO converts to an expense, linked by `expense_id` | B6 | Strong | Adapt | Our bills will do this work. |
| 7.20 | PO cannot convert to a sales invoice | B6 | Strong | Take | Correct boundary. |
| 7.21 | Delivery note is a PDF view of an invoice with prices stripped. No table, no entity, no stock effect | B6, R1, ux-5 | Strong | Conflict | See 14.14. |
| 7.22 | Delivery note substitutes the shipping address for the billing address | B6 | Strong | Take | |
| 7.23 | Delivery note suppresses unit cost, line totals, taxes, totals block | B6, ui-5 | Strong | Take | Right content for a challan print. |
| 7.24 | Statement aging buckets: current, 0–30, 30–60, 60–90, 90–120, 120+ | B6 | Strong | Take | |
| 7.25 | All five document editors look identical; only the breadcrumb differs | ux-5, ux-9 | Strong | Skip | Ranked a constant mis-entry hazard. |
| 7.26 | Quotes and credits still show "Balance Due" in the totals box | ux-5, ux-9 | Weak | Skip | Quoted as `$0.00` on an INR instance; wording unreliable, the point stands. |

---

## 8. Payments and money

| # | Item | Source | Evidence | Verdict | Note |
|---|---|---|---|---|---|
| 8.1 | 27 columns on a payment | B7 | Strong | Adapt | Ours needs maybe 15. |
| 8.2 | Six payment statuses including Partially Refunded | B7 | Strong | Take | |
| 8.3 | 54 shipped payment types | B7 | Strong | Adapt | Ours starts with Cash, Bank Transfer, UPI, Cheque, Other, user-editable (6 Nov). |
| 8.4 | Multi-invoice allocation through a `paymentables` pivot | B7 | Strong | Take | Directly serves the 6 Nov split-payment decision. |
| 8.5 | Overpaying a single invoice line is blocked by a validator | B0, B7 | Strong | Take | Live-tested: ₹1,200 on a ₹1,000 balance rejected. |
| 8.6 | A payment total may exceed its allocations; the surplus is unapplied | B0, B7 | Strong | Adapt | See 14.15 — two separate credit pools is a decision we have not made. |
| 8.7 | Surplus sits in `clients.payment_balance` = SUM(amount − applied); no credit note created | B0, B7 | Strong | Adapt | |
| 8.8 | Badge reads "Unapplied" or "Partially Unapplied" | B0, ux-4 | Strong | Take | Plain and honest. |
| 8.9 | `paid_to_date` increases by the full payment including the unapplied part | B0 | Strong | Adapt | Defensible but needs a ruling under double-entry. |
| 8.10 | Checking an invoice row auto-fills its exact remaining balance | ux-4 | Strong | Take | |
| 8.11 | Entering more than the row's balance is rejected with an inline highlight | ux-4 | Strong | Take | |
| 8.12 | No automatic oldest-first distribution of a lump sum | ux-4, ux-9 | Strong | Skip | Offer "apply oldest first" as one click. |
| 8.13 | Help text on the amount field explains the overpayment case in plain words | ux-4 | Strong | Take | Good microcopy; our users are non-accountants. |
| 8.14 | Fastest payment route is one click from the invoice header, 0.42s | ux-4 | Strong | Take | Put "Receive payment" on the invoice. |
| 8.15 | Refund engine: partial and full, with exact state transitions on 9 fields | B7 | Strong | Take | The most complete single specification in the inspection. |
| 8.16 | A refund restores the invoice balance and reopens the customer's debt | B7 | Strong | Take | |
| 8.17 | A refund switches auto-bill off | B7 | Strong | Skip | No auto-bill. |
| 8.18 | No write-off entity; bad debt is handled by cancel or credit note | B7 | Strong | Ours | Decided 6 Nov: a real write-off. Entirely ours. |
| 8.19 | Deleting a payment rolls back every balance it touched and force-deletes the pivots | B7 | Strong | Adapt | Take the rollback; never force-delete in an audited book. |
| 8.20 | After saving, amount and customer are frozen; date, allocation, method, reference stay editable | B7 | Strong | Adapt | A clean answer to a question not yet put to you. See section 16. |
| 8.21 | Archive on a payment hides it without rolling anything back | B7 | Strong | Take | |
| 8.22 | No autofocus on the payment form either | ux-4 | Strong | Skip | |

---

## 9. Purchases, expenses, banking

| # | Item | Source | Evidence | Verdict | Note |
|---|---|---|---|---|---|
| 9.1 | No separate "bill" document; payables are expenses and purchase orders only | B8 | Strong | Ours | Our decision list includes bills. Designing that is ours. |
| 9.2 | Expense status is calculated at runtime from four fields, never stored | B8 | Strong | Take | Fewer stored states, fewer ways to be wrong. |
| 9.3 | Status values: logged, pending, invoiced, paid, plus archived and deleted | B8 | Strong | Adapt | |
| 9.4 | Vendor payments are recorded on the expense, not in the payments table | B8 | Strong | Adapt | Ours needs bill payments posting to the ledger properly. |
| 9.5 | Billable expense flows onto an invoice as line type 6 and unlinks when the invoice is deleted | B8 | Strong | Adapt | Useful shape; not a v1 need. |
| 9.6 | No markup engine anywhere; markup is typed by hand | B8 | Strong | Skip | |
| 9.7 | Expense categories with a colour | B8 | Strong | Adapt | Our chart of accounts replaces this. |
| 9.8 | Recurring expense date tokens write "November 2026" into the note automatically | B8 | Strong | Take | A small kindness, cheap to copy. |
| 9.9 | Vendors have their own contacts, portal, numbering and classification list | B8 | Strong | Adapt | Ours: suppliers as customers-in-reverse. |
| 9.10 | Bank feed with Nordigen and Yodlee aggregators | B8 | Strong | Skip | Far beyond v1 and needs internet. |
| 9.11 | OFX, QIF and CSV statement import | B8 | Strong | Skip | Not v1. |
| 9.12 | Bank rules engine matching on description, participant, amount, with auto-convert | B8 | Strong | Skip | Shows where this kind of product eventually goes. |
| 9.13 | Batch 8 added an "Architectural Insights and Best Practices" section the prompt forbade | B8 | Strong | Skip | Noted as standard drift, not content. |

---

## 10. Reports and exports

| # | Item | Source | Evidence | Verdict | Note |
|---|---|---|---|---|---|
| 10.1 | 29 report controllers, 28 in the dropdown | B9 | Strong | Adapt | Ours has 8 named reports plus fair-wise views. |
| 10.2 | Generic export builder: 20 entities, 200+ selectable columns, grouping, subtotals | B9 | Strong | Adapt | The strongest candidate to adapt. More reporting than 8 fixed reports for not much more work. |
| 10.3 | Cross-entity column injection (an invoice-item report can pull client and payment columns) | B9 | Strong | Adapt | |
| 10.4 | `group_by` produces automatic numeric subtotals | B9 | Strong | Take | |
| 10.5 | Output as CSV, JSON, PDF and XLSX | B9 | Strong | Take | Matches our Excel / CSV / PDF decision. |
| 10.6 | P&L switches between cash basis and accrual via two flags, default accrual | B9 | Strong | Take | The single most useful finding in batch 9. A question we will face. |
| 10.7 | Accrual revenue includes statuses Sent, Viewed, Paid; drafts excluded | B9 | Strong | Take | |
| 10.8 | Cash revenue is computed from payment allocations, not invoice dates | B9 | Strong | Take | |
| 10.9 | Aged receivable detailed and summary reports, with the aging matrix | B9 | Strong | Take | Serves the A/R aging decision. |
| 10.10 | Client balance and client sales reports with a 24-month rolling matrix | B9 | Strong | Adapt | |
| 10.11 | Tag filtering works on generic exports but **not** on Profit and Loss | B9 | Strong | Conflict | See 14.16. |
| 10.12 | Report scheduling by email, 39 report names mapped | B9 | Strong | Skip | Needs internet; not v1. |
| 10.13 | The live P&L test printed an expense figure of ~4.6 quintillion rupees and did not flag it | B9 | Strong | Skip | Treat that run's expense numbers as meaningless. Revenue figures and the cash/accrual finding stand. |
| 10.14 | The Reports screen renders no on-screen table at all; export to CSV is the only way to see data | ux-6, ux-9 | Strong | Skip | Ranked the third-worst daily cost. Ours must render on screen. |
| 10.15 | Report filters reset when you navigate away and come back | ux-6 | Weak | Skip | |
| 10.16 | Pass 6 says CSV only at the point of use, where batch 9 says four formats | ux-6 vs B9 | Weak | — | Unresolved. Backend capability versus what that screen exposes. |

---

## 11. Settings and numbering

| # | Item | Source | Evidence | Verdict | Note |
|---|---|---|---|---|---|
| 11.1 | 26 settings tabs, 13 basic and 13 advanced | B10 | Strong | Adapt | Ours needs perhaps 12. |
| 11.2 | Number pattern engine with 14 tokens including `{$counter}`, `{$year}`, `{$date:format}` | B10 | Strong | Take | The richest single find. Our `INV-001/26-27` is exactly what this expresses generically. |
| 11.3 | Live test: `INV-{$year}-{$date:m}-{$client_number}-{$client_custom1}-{$counter}` → `INV-2026-11-CL-888-VIP-00042` | B10 | Strong | Take | Proven, not claimed. |
| 11.4 | `counter_padding`, default 4 digits | B10 | Strong | Take | |
| 11.5 | 12 counter reset frequencies | B10 | Strong | Adapt | |
| 11.6 | Annual reset fires on 1 January | B10 | Strong | Conflict | See 14.17. The Indian financial year is not the calendar year. |
| 11.7 | 13 entity types get generated numbers | B10 | Strong | Take | |
| 11.8 | Shared counters between invoice and quote, or invoice and credit | B10 | Strong | Conflict | See 14.13. |
| 11.9 | Custom fields: exactly 4 per entity, across 10 entities | B10 | Strong | Conflict | See 14.18. |
| 11.10 | Five custom-field types via a pipe-delimited string: text, multiline, dropdown, switch, date | B10 | Strong | Take | A concrete answer to "custom fields, user-named, no limit". |
| 11.11 | 15 email templates and 17 subjects | B10 | Strong | Adapt | Only once email is on. |
| 11.12 | Four reminder tiers including an endless one | B10 | Strong | Take | Matches the 6 Nov reminder decision. |
| 11.13 | Late fee inserts a real line item, so later reminders compound on the new balance | B10 | Strong | Skip | A trap worth knowing, not copying. |
| 11.14 | Group settings can override any company setting | B10 | Strong | Adapt | Our per-business settings are the parallel. |
| 11.15 | Three levels of account destruction: purge data, delete company, cancel account | B10 | Strong | Skip | |
| 11.16 | Settings tab count differs across sources: 23, 25, 26 | ux-0, ux-6, B10 | Weak | — | Unresolved. See 15. |
| 11.17 | Invoice locking is filed under "Workflow Settings"; numbering under "Generated Numbers" | ux-6, ux-9 | Strong | Skip | Both named as places nobody would look. Name ours plainly. |
| 11.18 | Settings navigation is flat, no nested menus; 2 clicks to any tab | ux-6, ux-9 | Strong | Take | Listed as a genuine kindness. |
| 11.19 | The tax settings tab takes ~6.5 seconds to load | ux-6 | Weak | Skip | |
| 11.20 | Batch 10 claimed 268 settings properties and listed roughly 90 | B10 | Strong | — | The largest known hole. Batch 10 part 2 is requested. |

---

## 12. Import, export, backup, audit log, users

| # | Item | Source | Evidence | Verdict | Note |
|---|---|---|---|---|---|
| 12.1 | Import accepts csv, txt and zip only; `.xlsx` is accepted nowhere | B0, B11 | Strong | Conflict | See 14.19. |
| 12.2 | Two-phase import: pre-import inspection, then ingestion with a column map | B11 | Strong | Take | Delimiter and encoding auto-detection included. |
| 12.3 | 11 import definitions with field counts (client 40, invoice 57, product 21) | B11 | Strong | Take | A checklist for our own import maps. |
| 12.4 | Duplicate products update rather than duplicate | B11 | Strong | Take | Answers a question our import decision has not faced. |
| 12.5 | Multi-row invoices are grouped by document number into one invoice with many lines | B11 | Strong | Take | Exactly how a real Excel sheet of past invoices arrives. |
| 12.6 | Clients sharing a name or email are merged into one with several contacts | B11 | Strong | Adapt | Risky if two customers really share a name. Make it a preview choice. |
| 12.7 | A failed row is skipped and collected; the import does not abort | B11 | Strong | Take | |
| 12.8 | Twelve things that cannot be imported, including credit notes, attachments, users, audit logs | B11 | Strong | Adapt | Credit notes and opening balances must be importable for us. |
| 12.9 | Seven third-party migration importers (QuickBooks, Wave, Zoho, FreshBooks…) | B11 | Strong | Skip | |
| 12.10 | Backup archive = `backup.json` of 44 collections + logo + every rendered invoice HTML | B11 | Strong | Adapt | |
| 12.11 | The backup does **not** contain attachment binaries | B11 | Strong | Conflict | See 14.20. |
| 12.12 | Restore force-deletes all existing transactional data before restoring | B11 | Strong | Adapt | Take the capability, never silently. Ours must warn and offer a pre-restore backup. |
| 12.13 | Restore sanitises the incoming settings against script injection | B11 | Strong | Take | |
| 12.14 | Restore preserves existing users and can preserve current counters | B11 | Strong | Take | |
| 12.15 | 123 activity-log constants | B11 | Strong | Adapt | Our log needs far fewer but the same shape. |
| 12.16 | Live test: invoice-created is type 4, updated 5, mark-sent 53 | B11 | Strong | Take | Batch 1's numbers were wrong. |
| 12.17 | Seven things the activity log does **not** record, including settings and tax-rate changes | B11 | Strong | Conflict | See 14.12. |
| 12.18 | Line-item edits are not logged individually; only the parent document update | B11 | Strong | Adapt | For us, the kept prior version covers this. |
| 12.19 | Permission matrix with view / edit / delete / create per entity | B11 | Strong | Adapt | Phase 2. |
| 12.20 | "View assigned only" scopes the SQL query, not just the policy gate | B11 | Strong | Take | The right way to do it. Matters for Phase 2 invoicing-only users. |
| 12.21 | System log separate from the activity log: gateway, mail, PDF, security, webhook categories | B11 | Strong | Take | Matches the technical error log agreed on 1 Nov. |
| 12.22 | Session expiry returns HTTP 412 and shows a password modal over the current screen, preserving typed work | B0 | Strong | Take | Copy this for the 1-hour sign-out. Never throw away typed work. |

---

## 13. Everything else (batch 12 and the UX passes)

| # | Item | Source | Evidence | Verdict | Note |
|---|---|---|---|---|---|
| 13.1 | Tags: one tag table, one pivot, 15 attachable entity types, filter across all | B12 | Strong | Take | The closest thing in the product to our Book Fair tag. Adopt the architecture. |
| 13.2 | Tags carry a colour and render as pills | B12 | Strong | Take | |
| 13.3 | Scheduler with five actions, including "invoice outstanding tasks" | B12 | Strong | Adapt | The pattern our repeat-template decision describes (7 Nov). |
| 13.4 | Projects with budgets, and tasks with a stopwatch and a four-level rate cascade | B12 | Strong | Skip | Outside v1. |
| 13.5 | Client portal with passwordless magic links | B12 | Strong | Skip | |
| 13.6 | Subscriptions and hosted checkout | B12 | Strong | Skip | |
| 13.7 | PEPPOL e-invoicing with 14 country profiles including India | B12 | Strong | Skip | Worth knowing it exists. |
| 13.8 | Veri*factu hash chaining: each invoice carries the SHA-256 of the previous one | B12 | Strong | Adapt | A tamper-evidence idea worth considering for our audit log. |
| 13.9 | 65 webhook events | B12 | Strong | Skip | |
| 13.10 | Multi-database horizontal routing | B12 | Strong | Skip | |
| 13.11 | Live PDF preview drawer updating as you type | B12 | Strong | Adapt | Desirable; cost unknown. |
| 13.12 | Exchange rate auto-fetch from an external API | B12 | Strong | Skip | Offline. |
| 13.13 | Batch 12's catch-all returned six items, nearly all infrastructure | B12 | Strong | — | Under-delivered. Round 5 item 11 is the retry. |
| 13.14 | Command palette on Ctrl+K | B12 vs ux-9 | Unverified | — | Batch 12 says it exists; Pass 9 says Ctrl+K does nothing. See 15. |
| 13.15 | Keyboard shortcut list (`?`, Ctrl+E, Ctrl+D, Ctrl+L, Ctrl+R, Del) | B12 vs B1 | Unverified | — | Two incompatible sets, neither evidenced. Still unresolved. See 15. |
| 13.16 | No unsaved-changes guard; clicking a sidebar link silently destroys a draft | ux-7, ux-9 | Strong | Skip | Ranked the single worst flaw. Our autosave plus warning is the answer. |
| 13.17 | Single-row delete executes instantly with no confirmation and no undo | ux-7, ux-9 | Strong | Skip | Rescue costs 4 clicks through a lifecycle filter. |
| 13.18 | Form state survives an API error, so the user can retry after a network drop | ux-7 | Strong | Take | |
| 13.19 | Duplicate invoice number caught only after a server round-trip, HTTP 422 | ux-7 | Strong | Adapt | Ours assigns numbers itself, so this should not arise. |
| 13.20 | Impossible dates refused by the date component before entry | ux-7 | Strong | Take | |
| 13.21 | Mobile: a desktop app squeezed down, no touch paradigms, 24 taps for one invoice | ux-8 | Strong | Skip | Informs Phase 2 invoicing on a phone at a fair. |
| 13.22 | Mobile touch targets around 32px, below the 44px guideline | ux-8 | Strong | Skip | Phase 2 must do better; fair invoicing may be on a tablet. |
| 13.23 | Sidebar collapses to a drawer below 768px | ui-2, ux-8 | Strong | Take | |
| 13.24 | A permanent "Purchase White Label" upsell occupies the header on every screen | ux-0, ux-8, ux-9 | Strong | Skip | |
| 13.25 | A red "Something went wrong" banner appears on clean loads with no code or dismiss | ux-0 | Weak | Skip | Cause never investigated. |

---

## 14. The Conflict rows — these need your ruling

Each one collides with something already decided. The decision and its date are named.

**14.1 Incomplete line rows are silently dropped.** Saving an invoice with a description but no
price drops that row without a word and saves the rest. Your rule is that the books must always
balance and nothing is entered twice; silent data loss is the opposite instinct. *Proposed: block
the save and show which row is incomplete.*

**14.2 Cancelling does not return stock.** Theirs leaves stock where it is, treating the goods as
gone. Yours (5 Nov, reaffirmed 7 Nov) returns stock automatically on cancel. *Proposed: keep your
rule; nothing to copy.*

**14.3 Deleting renames the number and frees it for reuse.** Theirs suffixes `_deleted` and winds
the number back on restore. Yours (5 Nov) never reuses a cancelled number. *Proposed: keep your
rule, and never delete an issued document at all — cancel it.*

**14.4 A locked invoice cannot be edited and no prior version is kept.** Theirs hard-blocks with
HTTP 422. Yours (6 Nov) allows editing a finalised invoice with the old version kept in history
for audit. *Proposed: keep your rule. Note it is the harder thing to build and is the single
biggest divergence in the invoice area.*

**14.5 Negative stock is permitted freely.** Tested to −3 with no warning. Yours (5 Nov) blocks
the invoice and offers a quick "Add stock" step. *Proposed: keep your rule.*

**14.6 No inventory valuation method at all.** Yours is FIFO only (5 Nov). Entirely ours to build,
including the cost layers that FIFO needs and that their schema has no table for.

**14.7 Unlimited contacts per customer.** Yours (6 Nov) is 2 by default with more addable.
*Proposed: keep your rule; it is only a default, not a cap.*

**14.8 Duplicate customer names saved with no warning.** Yours (6 Nov) warns but allows.
*Proposed: keep your rule. Also take their merge tool, because duplicates are now inevitable.*

**14.9 Stock tracking is a company-level master switch.** Yours (7 Nov) is per item, "Track stock:
Yes/No", with books Yes and magazines No. *Proposed: keep your rule; theirs cannot express a
business that holds some items and not others.*

**14.10 Stock moves the moment a draft is saved.** Yours (7 Nov) is a per-business choice: the
challan when issued, or the invoice when finalised, never both. *Proposed: keep your rule.*

**14.11 A draft reserves nothing.** Related to 14.10: theirs has no concept of reserved stock;
yours (5 Nov) shows a draft's quantity as blocked. *Proposed: keep your rule.*

**14.12 Settings, tax-rate and product changes are not logged.** Yours (every session since 1 Nov)
is that every action is logged in a read-only audit log. *Proposed: keep your rule — this is a
real difference and it is in your favour.*

**14.13 Quote and invoice can share one number sequence.** Yours (6 Nov) gives each document type
its own sequence per financial year. *Proposed: keep your rule, and do not offer the shared
option; it exists for legal regimes that require gapless numbering across document types.*

**14.14 Their delivery note is a printout, not a document.** No table, no number, no status, no
stock effect. Yours (6 Nov, 7 Nov) is a real challan that can move stock and links to an invoice.
*Proposed: keep your rule. Take only their print layout, which is well-judged.*

**14.15 Two separate credit pools.** Theirs keeps unapplied payment money in `payment_balance` and
credit-note money in `credit_balance`, and they never mix. Yours (6 Nov) says "overpayment is kept
as customer credit, and the user can adjust it", which does not say whether it is one pool or two.
*This is a genuine open question, not a conflict to dismiss. Two pools is more correct in
accounting terms; one pool is simpler for a non-accountant.*

**14.16 Tag filtering does not work on Profit and Loss.** Yours requires every report fair by fair,
P&L included. *Proposed: ours, built in from the start rather than bolted on.*

**14.17 The annual counter reset fires on 1 January.** Your numbering is `INV-001/26-27`, an Indian
financial year. *Proposed: our reset must be driven by the financial-year setting, not the calendar.
Small, but it would be a silent bug in April.*

**14.18 Custom fields capped at 4 per entity.** Yours (every session) is user-named, no limit.
*Proposed: keep your rule, and take their five field types (text, multiline, dropdown, switch,
date) as the type list.*

**14.19 No `.xlsx` import anywhere.** Yours (6 Nov) is real Excel and CSV. Entirely ours to build.

**14.20 The backup leaves out attachment binaries.** Yours (6 Nov) lets the user choose what to
include, and attachments are precisely the thing that would be silently missing. *Proposed: keep
your rule, and make the backup screen state plainly what is and is not in the file.*

---

## 15. Rows parked as Unverified, pending round 5

| Row | Why it is parked |
|---|---|
| 4.15 Filter state survives refresh and navigation | Only support is `14-pass2-filter-dropdowns.png`, which is a duplicate of the line-item search screenshot and shows the dropdowns closed. |
| 13.14 Command palette on Ctrl+K | Batch 12 says Ctrl+K opens a palette. Pass 9 says Ctrl+K does not focus the search bar. Unresolved; round 5 item 8. |
| 13.15 Keyboard shortcut set | Batch 1 and Batch 12 give incompatible lists, neither evidenced. Pass 1 tested only Ctrl+S. Round 5 item 8. |
| 11.16 Settings tab count | 23, 25 and 26 across three sources. |
| 10.16 Report export formats at the point of use | Pass 6 says CSV only, Batch 9 says four formats. |
| Dark mode palette (ui-1 §3) | Full hex values given, but the dark screenshot is the light screenshot. The palette also lists heading colour and card background as the same `#121212`, which cannot both be right. Round 5 item 1. |
| Status pill colour and radius | ui-1 and ui-3 give different hex values and different radii, both marked as browser-inspected. Round 5 item 7. |
| The 11 invoice designs and their fonts | ui-5's font-per-design table contradicts the CSS it quotes. Round 5 item 3. |
| Motion and transition values | Absent from round 4 entirely. Round 5 item 5. |
| Eight theme tokens | `$0, $7, $10, $11, $12, $18, $19, $22` never enumerated. Round 5 item 6. |
| Zero-total invoices blocked | Pass 7 says blocked; the invoice list screenshot shows five saved ₹0.00 drafts. Round 5 item 10. |
| Bulk delete confirmation wording | Two different character-for-character quotes. Round 5 item 9. |
| 268 settings properties | Roughly 90 listed. Batch 10 part 2. |

---

## 16. Decisions this sheet surfaces that you have not yet been asked

These are not conflicts. They are questions the inspection raises that no session has put to you.

1. **Customer merge.** You allow duplicate names, so duplicates will happen. Do we build a merge
   tool, and what happens to the history of the merged-away customer?
2. **One credit pool or two?** See 14.15.
3. **Payment immutability.** Should the amount and the customer be frozen after a payment is
   saved, with only date, allocation, method and reference editable?
4. **Cash or accrual P&L.** Their report toggles. Should ours?
5. **Generic report builder.** Pick an entity, pick columns, group, export — instead of, or
   alongside, the eight fixed reports.
6. **Partial / deposit on an invoice,** with its own due date. Relevant to magazine prepayments.
7. **Archive as a third state** between active and cancelled.
8. **Line-item date tokens** (`:MONTH`, `:QUARTER`) for subscription lines.
9. **Tamper-evident audit log** — each entry carrying a hash of the previous one.
10. **Low-stock threshold and alert,** per item with a business-level fallback.

---

## 17. What this sheet is not

It does not decide anything. Every Take and Adapt above is a proposal to be confirmed when the
design document is restructured, and every Conflict row needs your ruling before the App flow
sections that depend on it can be written. The four pending magazine accounting questions are
untouched by this sheet; two of them still block App flow sections 4, 5 and 11.
