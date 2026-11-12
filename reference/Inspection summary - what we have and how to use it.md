# Invoice Ninja inspection: what we have, and how we use it

*Written 8 November 2026, for the Book Buddha project. A reference, not a decision document.
Nothing here changes any decision already made.*

---

## 1. Why we are inspecting Invoice Ninja at all

We need to write an **App flow document** for Book Buddha: numbered steps, a diagram per flow,
and what happens on every tap. Writing that from a blank page means inventing hundreds of small
decisions - what a screen holds, what a field is called, what happens when the user does
something wrong - and getting many of them wrong.

Invoice Ninja is a mature invoicing and receivables product that has already made all those
small decisions and been corrected by real users for years. So we use it as a **reference map**,
not a model to copy. We harvest everything it does, then filter each item against decisions you
have already made: Take, Adapt, Skip, or Conflict.

Two things were settled early and still hold:

- **It is a reference only.** The accounting engine and everything else is built on your own
  design. You will not modify its files.
- **Why it, and not QuickBooks Online.** Its licence (Elastic License 2.0, read on 4 November)
  contains no reverse-engineering prohibition; its limits are hosted services, the licence key
  and notices. QBO's terms do prohibit it, which is why we never did this with QBO. The
  standing note remains: ask a lawyer before giving away or selling anything.

---

## 2. The rounds, and what each was for

| Round | Prompt | Purpose | Status |
|---|---|---|---|
| 1 | `Prompt - Invoice Ninja full flow and feature extraction.md` | First broad map | Done, largely unusable |
| 2 | `Prompt 2 - Invoice Ninja re-inspection (batched).md` | The real harvest: data, fields, side effects | **Complete, 13 batches** |
| 3 | `Prompt 3 - Invoice Ninja UX and daily-use pass.md` | How it feels to use, and its exact wording | Written, not yet run |
| 4 | `Prompt 4 - Invoice Ninja visual and frontend layer.md` | Colours, type, components, PDF templates | Written, not yet run |

**Round 1 failed** for specific reasons worth remembering, because they are what Prompt 2 was
built to prevent: it stripped every file path on purpose, so no claim could be checked; it
delivered zero flows, which was the main thing needed; it summarised lists that had to be
exhaustive; and it hedged ("stored in X or Y"). Its surviving value is the menu and settings
tree, and the confirmation that a delivery note is only a PDF view of an invoice with prices
stripped - not a document, and it moves no stock.

**Round 2 worked.** Repository-relative paths with line numbers, quoted code, and before-and-
after tests on a live Docker instance. It also retracted round 1's errors rather than defending
them.

**Rounds 3 and 4 exist** because prompts 1 and 2 asked an engineer's questions. Neither asked
what using the product is like, nor what it is made of visually. Those are separate harvests.

---

## 3. What each batch gave us, and how we use it

### Batch 0 - The four conflicts
Settled four points where round 1 contradicted an earlier inspection.
- Stock decrements **immediately on invoice save, including a draft**, not on Draft→Sent. Eight
  callers enumerated. Live test: 50 → 48 on draft save, still 48 after marking sent, back to 50
  on delete.
- An **overpayment** on a single invoice line is blocked by a validator. A payment total may
  exceed what it is allocated to, and the surplus sits in `clients.payment_balance`, computed as
  `SUM(payments.amount - payments.applied)`. No credit note is created. Badge reads "Partially
  Unapplied".
- **Import accepts csv, txt and zip only.** `.xlsx` is not accepted for import anywhere; it
  appears only as a permitted attachment and in report export.
- **Session expiry** returns HTTP 412 and the SPA shows a password modal over the current
  screen, so typed form state survives.

**How we use it:** the stock finding is the opposite of your 5 November decision and confirms
there is nothing to copy there. The overpayment mechanism is a useful shape for your "keep it as
customer credit" decision. The import finding tells us real `.xlsx` import is entirely ours to
build. The password-modal pattern is worth copying for your 1-hour sign-out: never throw away
typed work.

### Batch 1 - Invoice creation
36 input fields on the invoice, with validation rules and destinations. The draft pipeline step
by step. Number assignment timed by a `counter_number_applied` setting (`when_saved` or
`when_sent`). Collision protection that retries up to 50 times. A one-second atomic lock that
returns HTTP 429 on a double-click rather than creating two invoices.

**How we use it:** the field list is the starting checklist for your invoice screen. The
`counter_number_applied` setting is your 6 November decision made user-choosable - a candidate to
adapt. The double-click lock and the number-collision retry are both things a built-from-scratch
app forgets until it bites.

**Two errors in it, corrected by later batches:** it says stock lives in `products.quantity`
(Batch 5: it is `in_stock_quantity`; `quantity` is the default line quantity), and it gives the
wrong activity-log type numbers (Batch 11 proves invoice-created is type 4, not 5).

### Batch 2 - Invoice lifecycle
The full state machine: Draft, Sent, Partial, Paid, Cancelled, Reversed, plus Overdue and Unpaid
as calculated filters rather than stored states. Then every action - mark sent, email, mark paid,
cancel, reverse, archive, delete, restore, clone, convert - with what each writes and whether it
can be undone. Plus the `lock_invoices` setting: four options, and a hard HTTP 422 on any attempt
to edit a locked invoice, with payment recording as the single exception.

**How we use it:** the biggest single source for your cancel-with-reversal rule, and for the
difference between four things you have been treating as two. Cancel is reversible there and
restores nothing to stock; delete restores stock and renames the number; archive touches nothing
financial; reverse is permanent and auto-issues a credit note for anything already paid. Overdue
as a calculated state rather than a stored one is worth copying - it matches your magazine PRD
rule that no due date means never overdue.

**Conflicts with your decisions:** their cancel does not return stock (yours does); their lock
hard-blocks editing and keeps no prior version (yours allows editing with history kept); their
delete recycles the number (yours never reuses one).

### Batch 3 - The invoice list
44 selectable columns (counted and confirmed), 7 showing by default. Every status filter and
lifecycle filter as actual SQL. A deep search that reaches inside the line-items JSON. Natural
numeric sorting so `0010` does not sort before `002`. A weighted status sort that floats overdue
and unviewed invoices to the top. 16 bulk actions. Column choices stored per user.

**How we use it:** the column catalogue is your menu of what an invoice list could offer. The
natural-sort trick and the weighted status sort are small, non-obvious things worth copying. The
deep search into line items is a real capability to decide on. Per-user column choices matter
less to you now (Phase 1 is Admin only) but will matter in Phase 2.

### Batch 4 - Clients
33 fields across four tabs. 12 sub-tabs on the customer record. Unlimited contacts, not a
capped number. Attachments up to 100 MB with 22 permitted extensions. The statement engine with
its aging buckets. A genuine **merge** that re-parents 15 related tables, reconciles duplicate
contacts, purges the source and recalculates balances. Archive vs delete vs purge, where purge is
a hard cascade across all 15 child tables. The exact formulas for balance, paid-to-date and
credit balance.

**How we use it:** the 12 sub-tabs are the best available answer to "what should a customer
record show". Merge is something you have not discussed at all and will want, because duplicate
customers are inevitable once you allow duplicate names - which you decided on 6 November.
Their three-level archive/delete/purge is more nuanced than your current Admin-only delete.
Note their contact limit is unlimited, where you chose 2 by default with more addable.

### Batch 5 - Products, stock and valuation
Settled the conflict I had flagged: `track_inventory` is a **company-level** master switch, not
a per-product checkbox. The product holds only `in_stock_quantity`, `stock_notification` and
`stock_notification_threshold`. Round 1's "Prevent Negative Stock" setting **does not exist** -
stock goes negative freely, tested to −3, shown in red. A concurrency guard that strips the
stock field from an update unless the user actually touched it. Which documents move stock:
invoice decrements on save, purchase order increments on receipt, quote does nothing until
converted, credit note never, delivery note never. **No FIFO, no LIFO, no weighted average, no
cost layers** - only a static cost snapshot onto the line item.

**How we use it:** this batch mostly tells us what we must build alone. Your per-item "Track
stock: Yes/No", your block on short stock, and your FIFO costing have no counterpart there. The
concurrency guard is a genuinely good idea worth copying: never let a stale form overwrite a
stock figure that moved while the form was open. The document-by-document stock matrix is a
useful checklist against your per-business stock setting.

### Batch 6 - The other documents
Quotes with six states including a calculated Expired. Conversion mechanics, including an option
to carry the quote's number onto the invoice. Credit notes in two accounting phases - issuance
raises the customer's credit pool without touching receivables, application creates a payment
record of type Credit linked to both the invoice and the credit. Recurring invoices with 12
frequencies, an interlock that stops generating if an earlier one is unpaid, and auto-bill that
gives up after 3 failures. Purchase orders with five states, increasing stock on receipt and
converting to an expense. Delivery notes confirmed again as a PDF view only. Statements with six
aging buckets.

**How we use it:** the credit-note accounting is the clearest model for your 6 November decision
that credit notes must give proper accounting effects. The recurring-invoice interlock answers
part of your pending question 3 about credit customers. The quote-number-sharing option is a
real design choice you have not faced yet. Their delivery note is **not** your challan - yours
is a real document that can move stock, theirs is a printout.

### Batch 7 - Payments and money
27 columns on a payment, 6 statuses, 54 shipped payment types. Multi-invoice allocation through
a pivot table. Overpayment blocked at the line, permitted in total. The refund engine with
exact state transitions for partial and full refunds, including restoring the invoice balance
and the customer's debt, and switching auto-bill off. **No write-off entity exists** - bad debt
is handled by cancelling the invoice or issuing a credit note. Payment deletion rolls back every
balance it touched. After the fact, the amount and the customer cannot be changed, but the date,
the allocation, the method and the reference can.

**How we use it:** directly feeds four of your 6 November decisions - one payment split across
invoices, overpayment kept as credit, refunds in v1, bad-debt write-off in v1. Note the last one
has no counterpart: you decided to have a real write-off, and they do not, so that is yours to
design. Their immutability rule - amount and customer frozen, everything else editable - is a
clean, defensible answer to a question you have not yet been asked.

### Batch 8 - Purchases and banking
Vendors with their own contacts and portal. Expenses whose **status is calculated at runtime**
from four fields rather than stored - logged, pending, invoiced, paid. Billable expenses flowing
onto an invoice as a special line type, and unlinking themselves when the invoice is deleted.
**No markup engine** - any markup is typed by hand. **No separate "bills" document** - payables
are expenses and purchase orders only. Vendor payments recorded on the expense itself, not in
the payments table. Recurring expenses with a token system that writes "November 2026" into the
note automatically. A bank screen with rules that match incoming transactions and can auto-
convert them into expenses or match them to invoices.

**How we use it:** the runtime-calculated expense status is a pattern worth considering - fewer
stored states means fewer ways to be wrong. Their having no separate bill document is worth
knowing, because your decision list includes bills; you will be designing that alone. The
recurring-expense date tokens are a small kindness worth copying. Bank rules are well beyond
your v1 but show where this kind of product eventually goes.

### Batch 9 - Reports
29 report controllers, 28 in the dropdown. Two architectures: a generic export builder covering
20 entities with over 200 selectable columns, cross-entity column injection, grouping with
automatic subtotals, and CSV, JSON, PDF and XLSX output; and a set of dedicated financial
reports. Report scheduling by email. And the headline: **their Profit and Loss can switch
between cash basis and accrual basis** via two flags, defaulting to accrual.

**How we use it:** the cash/accrual toggle is the most directly useful finding in the batch,
because it is a question you will face and they have a working answer. The generic export
builder - pick your entity, pick your columns, group it, export it - is a strong candidate to
adapt, since it would give you far more reporting than eight fixed reports for not much more
work. Their tag filtering works across the generic exports but **not** on Profit and Loss, which
is exactly the fair-wise P&L you need, so that remains ours.

**One thing to distrust in it:** the live P&L test prints an expense figure of
₹4,677,434,614,745,189,376 - roughly 4.6 quintillion rupees - and a different absurd figure in
the cash run. Something is broken in their test data or in that aggregation, and the report did
not flag it. Treat the P&L expense numbers from that run as meaningless; the revenue figures and
the accrual-versus-cash behaviour still stand.

### Batch 10 - Settings
26 tabs, 13 basic and 13 advanced, each named with its route and its main fields. The number-
generation engine in full: 14 pattern tokens, 12 counter reset frequencies, 13 entities that get
numbers, and shared-counter options. 15 email templates and 17 subjects. Four reminder tiers.
Late fees that insert a real line item and therefore **compound** on later reminders. The four
invoice-lock modes. Custom fields: exactly 4 per entity across 10 entities, with five field
types defined by a pipe-delimited string. Localisation. Group settings that can override any
company setting. Three levels of account destruction.

**How we use it:** the number-generation engine is the richest single find for you, because your
invoice numbering decision (`INV-001/26-27`, per-business prefix, restart each year) is exactly
what their token system expresses generically. Their five custom-field types are a concrete
answer to your "custom fields, no limit" decision - though note they cap at 4 per entity and you
did not. The compounding late fee is a trap worth knowing about rather than copying.

**This batch under-delivered.** The prompt said "every setting in every tab, with its options
and its default", said "if a settings tab has 31 settings, list 31", and told them to split it
because it would be long. It came back unsplit, claiming 268 properties and listing perhaps 90.
This is the one place where round 1's failure recurred, and it matters: those tabs are the
reference for your own Settings screens. **A Batch 10 part 2 is worth asking for.**

### Batch 11 - Data, users and logs
11 import definitions with field counts, seven third-party migration importers, duplicate
handling that updates rather than duplicates products and groups multi-row invoices by number,
and errors collected per row without aborting the import. Then a list of 12 things that **cannot**
be imported, including credit notes, attachments, users and audit logs. The backup archive's
exact contents - a `backup.json` of 44 collections, the logo, and every rendered invoice HTML
snapshot - and what it explicitly does not contain, notably the attachment binaries. Restore
**force-deletes all existing transactional data first**. 123 activity-log constants, and a list
of seven things the log does **not** record, including product changes, tax-rate changes and all
settings changes. The permission matrix and exactly how "view assigned only" scopes a query.

**How we use it:** the importer's duplicate and grouping behaviour is a working answer to a
question your Excel-import decision has not faced yet. The "what the backup does not contain"
list is the better half of that batch - your backup decision lets the user choose what to
include, and attachment binaries are precisely the thing that gets silently left out. The
activity-log gap list is important: you decided every action is logged in a read-only audit log,
and they do not log settings changes at all. That is a real difference, and in your favour.

### Batch 12 - Everything else
Projects, tasks with a stopwatch and a four-level rate cascade, bank transactions, a tags system
covering 15 entity types through one pivot table, the client portal with passwordless magic
links, subscriptions and hosted checkout, schedulers with five actions, and e-invoicing for
Peppol and Spain.

**How we use it:** mostly outside your v1, with two exceptions. The **tags architecture** - one
tag table, one pivot, 15 attachable entity types, filtering across all of them - is the closest
thing in the product to your Book Fair tag, and it is a good shape to adapt. The scheduler's
"invoice outstanding tasks" action is the pattern your repeat-template decision describes.

**This batch also under-delivered**, on the part that mattered most: the catch-all asked for
every small convenience, explicitly including the ones that seem too minor, and returned six
items that were almost all infrastructure. Prompt 3's good-ideas list is the retry.

---

## 4. What the inspection can never give us

Invoice Ninja has **no chart of accounts, no journal entries, no general ledger, no trial
balance, no balance sheet, no cash flow statement, no financial-year lock, no opening balances,
no inventory valuation method, and no challan.** Its "ledger" only logs customer balance
adjustments.

So the following are ours to design regardless of how good the map turns out: the double-entry
accounting engine, the financial-year lock, FIFO costing, opening balances, the challan as a
real document, the per-business stock setting, fair-wise reporting, the write-off, and the
per-item Track stock switch.

That is not a small list. The map tells us what the screens around that engine should look like;
it does not tell us how to build the engine.

---

## 5. Errors and contradictions to carry forward

1. **Stock column name.** Batch 1 says `products.quantity`; Batch 0 and Batch 5 say
   `in_stock_quantity`. Batch 5 wins - `quantity` is the default line quantity.
2. **Does cancel restore stock?** Batch 1 says yes in one line; Batch 2, Batch 5 and Batch 0's
   live test all say no. Batch 1 is wrong.
3. **Activity-log type numbers.** Batch 1 says invoice-created is type 5 and sent is 9 or 10.
   Batch 11 lists the constants and tested it live: created is 4, updated is 5, mark-sent is 53.
   Batch 11 wins.
4. **Keyboard shortcuts.** Batch 1 and Batch 12 give completely different sets and neither
   carries any evidence. Unresolved; Prompt 3 Pass 1 settles it by pressing the keys.
5. **Batch 9's expense figures** are corrupt, as above.
6. **Two batches claimed "Could not verify: none"** (5 and 6) where every other batch named
   something. Batch 8 also added an "Architectural Insights and Best Practices" section, which
   the prompt had forbidden. Minor, but worth noting as the standard drifting late in the round.

---

## 6. Where this leaves us

**Done:** rounds 1 and 2. Thirteen batch files in `invoice-ninja-reports/`.

**Written, not yet run:** Prompt 3 (UX and daily use, ten passes) and Prompt 4 (visual and
front-end layer, seven passes).

**Worth asking for:** Batch 10 part 2, the settings enumerated properly.

**Still unanswered by you:** the four magazine accounting questions - cost of books sold, cost
of magazines with no stock, how a credit customer's cycle invoice is built, and how a challan
links to an invoice. Questions 1 and 4 block App flow sections 4, 5 and 11.

**Not yet made:** the filter sheet. Every item the inspection returned, marked Take, Adapt, Skip
or Conflict against your settled decisions. This is the thing that turns 250 KB of reports into
a design, and it is the obvious next step once the remaining passes are in.

**Then:** restructure the design document for the generic core, write the App flow sections one
at a time for your approval, update the PRD and Features List, and only then the implementation
plan. Nothing is built before that.
