# Invoice Ninja re-inspection, round 2 (batched)

You produced a first map of Invoice Ninja. It was useful for the menu tree and the
screens you actually opened. It was not usable as a flow document, and much of it
cannot be checked. This round fixes that. Read Part 0 to Part 2 fully before you start.

---

## Part 0 - What to correct from round 1

1. **You removed every file path.** You wrote: "All local file paths have been removed
   from the reference citations." That made every `[SOURCE: ...]` claim uncheckable.
   Use **repository-relative paths** - `app/Models/Product.php:L118-134` - never absolute
   machine paths. Relative paths reveal nothing about this PC.
2. **You delivered no flows.** The template asked for step-by-step flows across screens,
   with branches and what happens on cancel, back, or closing the browser mid-entry. There
   were none. Flows are the main thing I need.
3. **You summarised lists that had to be exhaustive.** "Complete inventory" of settings came
   back as tab names with a few sample fields. A list of 8 reports where the product has more.
   Import targets given as three entities where the product supports more.
4. **You hedged.** For example: overpayment stored in "`clients.paid_to_date` or unallocated
   credit pool". Two alternatives is not an answer. Resolve it in the code or say "not found".
5. **Your final Unverified list named only two external items**, while most of the document
   was unsourced. The Unverified list must honestly reflect what you could not prove.

None of this is a complaint about effort. It is the standard for round 2.

---

## Part 1 - Hard rules

**Evidence.** Every factual claim carries exactly one label:
- `[CODE path:Lstart-Lend]` plus the **quoted lines**. Paths relative to the repo root.
- `[APP route]` plus what you saw on that screen.
- `[DOCS url]` for Invoice Ninja's own documentation.
- `[INFERRED]` is allowed only for reasoning you label as such. Never use it for a fact.

**No guessing.** If you cannot find something, write **"not found"** and list your search
terms and the directories or routes you searched. A clean "not found" is a good answer.

**No hedging.** One answer per question. If the code and the running app disagree, give both
and say which you trust and why.

**No summarising.** If a screen has 23 fields, list 23. If a settings tab has 31 settings,
list 31.

**Completeness check.** End every list with one line: *"Completeness check: N items,
enumerated by <method>"* - for example "by reading the component file", "by reading the
database migration", "by opening the Columns picker and reading every checkbox". A list
produced from memory or from clicking around casually is not acceptable; say so if that is
what happened.

**Retractions.** If a round 1 claim will not re-verify, write "retracted: <claim>" and what
you now find. I would rather have a retraction than a defended guess.

**One batch per run.** Deliver one batch, then stop and wait for me to say "next". Do not
compress two batches into one message. If a batch is too long for one message, split it and
say "part 1 of N".

**Output.** Write each batch to its own file, `IN-batch-<number>-<name>.md`, and give me the
path. Paste the content in the message too if it fits.

---

## Part 2 - Do this first: four conflicts to settle

Round 1 contradicts an earlier inspection on four points. Settle each with quoted code
before starting Batch 1. Deliver these as `IN-batch-0-conflicts.md`.

1. **When does stock actually decrement?** Earlier inspection: on invoice **save, including a
   draft**. Round 1: only on **Draft to Sent**. Find the code that changes
   `products.stock_quantity`, quote it, and name every caller and the condition each caller
   checks. Then test it in the running app: create a draft with a tracked product, re-open the
   product, report the number before and after; then mark it sent and report it again.
2. **Where does an overpayment go?** Find the column or table that holds it, quote the code
   that writes it, and give its exact name. Then test it: pay more than an invoice's balance
   and report what you see on the client and on the payment.
3. **Which file extensions does import accept?** Quote the validation rule. Earlier
   inspection: csv, txt, zip. Round 1: csv, json. Also state plainly whether `.xlsx` is
   accepted anywhere.
4. **What happens when a session expires mid-edit?** Round 1 claims a password modal that
   preserves unsaved form state. Quote the code that implements it, or retract it. Then test
   it if you can.

---

## Part 3 - The batches

Each batch below is a full area. Deliver every item in it.

**Batch 1 - Invoice creation, as a flow.**
Click it, do not read it. Create a real invoice from the dashboard to a finalised document.
Every step, every screen, every click, what changed on screen, what was written to the
database. Then cover: exactly when the invoice number is assigned and when it is committed;
whether there is autosave and what triggers it; what appears if you navigate away mid-entry;
what appears if you close the browser tab mid-entry; whether line items can be drag-reordered;
whether a blank line can be left; inline product creation; inline client creation; how many tax
rates a line can carry and where that is configured; inclusive versus exclusive tax and where
it is set; currency and exchange rate handling; attachments; linking a project or task; the
Settings tab on the invoice editor and every field in it.

**Batch 2 - Invoice lifecycle and the destructive actions.**
For each of: Mark Sent, Email, Mark Paid, Enter Payment, Cancel, Reverse, Archive, Delete,
Clone, Convert - give what it does, what it writes, and what happens to the invoice number,
the client balance, the stock, any linked payment, and the audit log. State the exact
difference between Cancel, Reverse, Archive and Delete. Then: editing an issued invoice -
what is allowed, every option of the invoice lock setting, and whether any prior version is
retained anywhere at all. Test a cancel on an invoice with a tracked product and report the
stock before and after.

**Batch 3 - The invoice list screen, exhaustively.**
Every column available in the Columns picker, not only the visible ones. Every filter and its
options. Every sort. Every bulk action. Every action in the per-row dropdown. Pagination
options. Saved views or saved filters if any. Export options and formats. Whether column
choices are per user or shared.

**Batch 4 - Clients, exhaustively.**
The client **overview** record: every tab and what each shows. Every field on create and edit,
all four tabs. Contacts: maximum number, every field per contact, portal access. Documents and
attachments: accepted types, size limit, where stored. Statements: every option offered.
Merge: whether it exists and what it does to history. Archive versus delete versus purge.
How balance, paid-to-date and credit balance are each calculated and which column holds each.
Custom fields on clients.

**Batch 5 - Products, stock and valuation, exhaustively.**
Every product field. Every setting in Product Settings with its options and default, including
whether a "prevent negative stock" setting genuinely exists - quote it. Every route by which
stock can change, including any stock adjustment screen. What happens to stock for each
document type: invoice, quote, credit note, recurring invoice, purchase order, delivery note.
Whether stock can go negative and what the user sees. The low-stock notification threshold:
what it does and who is notified. Whether any cost layering or valuation exists at all.

**Batch 6 - The other documents, each as a flow plus a field delta.**
Quotes, credit notes, recurring invoices, purchase orders, delivery notes, statements. For each:
walk the flow in the app, then list only what differs from an invoice. For quotes: what
conversion does to the quote, and whether an expiry does anything automatically. For credit
notes: the exact accounting effect and how it is applied to an invoice. For recurring: every
frequency option, pause, resume, end date, remaining cycles, what one run does, and what
happens if a run fails. For purchase orders: whether receiving goods exists at all.

**Batch 7 - Payments and money, exhaustively.**
The complete payment types list as shipped. The payment screen's every field. Allocation across
several invoices. Partial payments. Overpayment. Client credits: how created, how applied, how
they appear in reports. Refunds: full and partial, what each writes, what it does to the
invoice and the payment. Whether a write-off exists. Delete versus archive on a payment and
what happens to the invoice it was applied to. Whether a payment can be edited after the fact.

**Batch 8 - The purchases and banking side, exhaustively.**
Vendors: every field, every tab. Expenses: every field, categories, billable expenses and the
full billable pipeline, markup, recurring expenses, attachments. Whether bills exist as a
document separate from expenses. Vendor payments. Transactions (the bank screen): what it is,
what it does, bank import formats, matching and categorisation rules.

**Batch 9 - Reports, exhaustively.**
Every report the product offers - open the Reports screen and read the dropdown, do not list
from memory. For each report: what it shows, every column, every filter it accepts, whether
tags and custom fields can filter it, every export format, and whether it can be scheduled.
Then the generic report or export builder if there is one: every entity it covers and every
column it offers. Then state plainly, for the Profit and Loss report, whether it is cash basis
or accrual basis, and quote the code that decides.

**Batch 10 - Settings, exhaustively. This will be long; split it.**
Every tab, basic and advanced. Every setting in every tab, with its options and its default.
Pay particular attention to: Generated Numbers - every available token, every pattern option,
the counter and every reset-interval option, per document type; Templates and Reminders - every
template, every reminder, every schedule option, late fees and how they are calculated;
Workflow Settings - every option including every invoice lock option; Custom Fields - how many
per entity and which field types; Localization - every format option; Group Settings - what a
group can override; Account Management - including purge and delete.

**Batch 11 - Data, users and logs, exhaustively.**
Every import path, every entity importable, accepted formats, the mapping step, duplicate
options, error reporting, and what cannot be imported. Every export path and format. Backup:
exactly what the archive contains and, explicitly, what it does **not** contain. Restore: how
it works and what it overwrites. The activity log: every event type recorded, and explicitly
what is **not** recorded. System logs: what they hold. Users: the invite flow, and the full
permission matrix - every permission, every entity, and what "view assigned only" changes.

**Batch 12 - Everything else, and the catch-all.**
First, the areas round 1 showed in the menu but never described: Projects, Tasks, Transactions,
Tags, Client Portal, Payment Links or subscriptions, Schedules, E-Invoicing. For each: what it
is, every screen, every field, what it is for.
Then the catch-all, which matters most: **list every feature, screen, field, setting, button,
shortcut or behaviour you encountered anywhere in this product that none of the batches above
asked you about.** Do not filter by what you think is important. Small conveniences count.
Anything you noticed and left out of round 1 because it seemed minor - put it here.

---

## Part 4 - Templates

For every screen:

```
### Screen: <name as the app calls it>
- Route / how reached:
- Purpose, one line:
- What is displayed (every section, panel, table, total):
- Fields: name | type | required? | default | validation | notes
- Buttons and actions: label | what it does | where it goes next | confirmation?
- States this screen can show:
- What is saved, and to which table:
- Side effects (stock, balances, numbering, email, logs):
- Shortcuts, inline-add, hidden behaviours:
- Evidence:
- Completeness check:
```

For every flow:

```
### Flow: <name>
1. Step - screen - what the user does - what the app does - what is written
2. ...
- Branches and decision points:
- On cancel:
- On back:
- On closing the tab mid-way:
- On a validation failure:
- Evidence:
```

---

## Part 5 - End of every batch

Close each batch with three lists:

1. **Verified by code** - with paths.
2. **Verified in the running app** - with routes.
3. **Could not verify** - what, and what you searched.

Add no opinions about what I should build. I only need the map, complete and checkable.
