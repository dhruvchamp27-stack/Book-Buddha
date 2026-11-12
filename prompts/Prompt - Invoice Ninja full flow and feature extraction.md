# Prompt for the AI that has the working Invoice Ninja clone

## Your task

You have a working Invoice Ninja clone (self-hosted, v5) on this PC, plus its source code.
I need a **complete, factual map of the product**: every screen, every flow, every field,
every button, every setting, and every behaviour.

This is a reference-gathering exercise. I am designing a different application and I will
decide later what to adopt. **Do not design anything, do not recommend anything, and do not
adapt your answers to any other product.** Describe Invoice Ninja exactly as it is, in its
own terms and with its own names for things.

## Rules of evidence (important)

1. Every factual claim must be backed by either:
   - a **file path and the exact lines** from the code, or
   - a **screen you actually opened** in the running app (say which URL/route and what you saw).
2. If you cannot find something, write **"not found"** and list what you searched
   (search terms, directories, routes). Do not guess, do not infer, do not fill gaps.
3. Mark every statement with one of:
   - `[CODE]` - read in the source, with path
   - `[APP]` - seen in the running app
   - `[DOCS]` - from Invoice Ninja's own documentation, with URL
   - `[INFERRED]` - your reasoning, not directly observed (use sparingly and say why)
4. Where the code and the running app disagree, say so and give both.
5. Do not summarise generously. If a screen has 23 fields, list 23 fields.

## Answer format

Work through the areas in the order below. For every **screen** use this template:

```
### Screen: <name as the app calls it>
- Route / how reached:
- Purpose in one line:
- What is displayed (sections, panels, tables, totals):
- Fields (one row each): name | type | required? | default | validation | notes
- Buttons and actions (one row each): label | what it does | where it goes next | confirmation dialog?
- Statuses or states this screen can show:
- What gets saved, and to which database table:
- Side effects (stock, balances, emails, numbering, logs):
- Keyboard shortcuts, inline-add, or hidden behaviours:
- Evidence: <paths / routes>
```

For every **flow** (a sequence across screens) use this template:

```
### Flow: <name>
1. Step - screen - what the user does - what the app does
2. ...
- Decision points and branches:
- What happens on cancel / back / browser close mid-way:
- What is written to the database at each step:
- Evidence:
```

## Areas to cover

Cover all of these. If an area does not exist in the product, say "does not exist" with
what you searched.

**A. Navigation map.** The complete menu tree exactly as it appears: every top-level item,
every sub-item, every settings tab. Give it as an indented list.

**B. First-run and setup.** What happens on a brand-new install: account creation, company
creation, any wizard or onboarding steps, what is mandatory before you can issue a document,
what sample or default data is created (default chart of anything, default tax names,
default payment types, default email templates).

**C. Login and session.** Login screen, registration, password reset, two-factor,
failed-attempt handling, session length and timeout behaviour, what the user sees when a
session expires mid-edit.

**D. Dashboard / home.** Every panel, card, chart and number on it; what each one counts
and over what period; what each one links to; date-range and filter controls.

**E. Clients (customers).** List screen and detail screen. All tabs on the client record.
All fields including every optional one. Contacts: how many, what each contact holds, portal
access. Addresses. Classification. Custom fields. Documents/attachments. Statements. How
balance and paid-to-date are calculated and where they are stored. Merge, archive, delete -
and what each does differently.

**F. Products / items.** All fields. Tax fields. Cost vs price. Stock/inventory fields if
any. Custom fields. How an item behaves when added to a document (what copies over, what
stays linked).

**G. Invoices - the whole life cycle.** This is the most important area, go deep.
- Creating: how the number is chosen and when it is committed, date and due-date behaviour,
  payment terms, the line-item editor (every column, drag-reorder, blank lines, inline item
  creation), discounts (line, percentage, total), surcharges/custom charges, taxes (line and
  total level, inclusive/exclusive, how many rates), currency and exchange rate, PO number,
  public notes, private notes, terms, footer, attachments, project/task linkage, recurring
  conversion, auto-bill.
- Saving: draft vs issued, autosave if any, what warning appears on leaving, what the
  database holds for a draft.
- Sending: email flow, templates, preview, what is attached, what is logged.
- Payment: all ways money gets recorded against it.
- Editing after issue: what is allowed, what is locked, lock settings, whether a prior
  version is kept anywhere.
- Status model: every status, what triggers each transition, how overdue is computed.
- Cancel vs delete vs archive vs reverse: the exact difference, and what happens to the
  number, the balance, the client ledger and any stock.
- The list screen: every column, every filter, every sort, every bulk action, every
  per-row action in the dropdown, export options.
- Printing/PDF: layout designer, templates, what is configurable.

**H. Other documents.** For each of these, same depth as far as it differs from invoices:
quotes/estimates (and conversion to invoice, and what happens to the quote), credit notes,
recurring invoices (schedule options, what happens on each run, pausing, end date),
delivery notes / packing slips, purchase orders, statements.

**I. Payments and money.** Recording a payment, the payment screen's fields, payment types
list, applying one payment across several invoices, partial payments, overpayment handling,
client credits and how they are applied, refunds (full and partial), what a refund does to
the invoice and the payment, write-offs if any, deleting vs archiving a payment.

**J. Purchases side.** Vendors, expenses (all fields, categories, billable expenses,
recurring expenses, attaching to invoices), bills if separate, purchase orders, vendor
payments if any.

**K. Inventory and stock.** Exactly when and where quantity changes, which documents affect
it, whether it can go negative, whether there is any cost tracking or valuation method,
stock adjustment screens if any.

**L. Reports and exports.** The full list of reports available. For each: what it shows,
what filters it accepts, what formats it exports, whether it can be scheduled. Also: the
generic export/report builder if there is one, which columns it offers, and which filters
(especially whether tags/custom fields can filter each report).

**M. Import.** Every import path, accepted file formats, the column-mapping step, duplicate
handling, preview and error reporting, what can and cannot be imported.

**N. Settings - complete inventory.** Go through every settings tab and list every single
setting with its options and default. Include: company details, localisation, numbering
(every token and pattern option, counters, reset rules), taxes, payment terms, email
templates and reminders (every reminder, its schedule options, late fees), invoice design
and layout, custom fields, workflow/automation, user management and permissions, integrations,
data/backup/export, account management.

**O. Users, roles and permissions.** The permission model, what granularity it offers,
what a limited user can and cannot do, how actions are attributed.

**P. Activity log / audit.** What is recorded, what is not recorded, whether it is editable,
what it shows the user and where.

**Q. Backup and restore.** What a backup contains, how it is produced, how restore works,
what is not covered.

**R. Email and notifications.** All outbound email types, templates, variables available,
reminders, scheduled sends, what requires internet, what fails silently.

**S. Behaviours an accountant would notice.** List anything that departs from strict
bookkeeping discipline: numbering gaps, editing issued documents, deleting financial records,
negative stock, no period locking, rounding rules, how a cancelled document is treated, and
anything else of that kind. State plainly for each whether it is a deliberate design choice
you can evidence, or just how the code behaves.

**T. What the product does NOT have.** Be explicit and thorough. Search for and confirm the
absence of: chart of accounts, journal entries, general ledger, trial balance, balance sheet,
cash flow statement, double-entry posting of any kind, financial-year locking, opening
balances, inventory valuation (FIFO/weighted average), cost of goods sold. For each, say what
you searched and what you found instead.

**U. Nice touches worth noting.** Small usability details that make the product pleasant:
keyboard handling, inline creation, defaults that save a step, warnings and confirmations,
empty states, anything you noticed while clicking around.

## Finally

End with two lists:

1. **Verified** - what you confirmed with code or the running app.
2. **Unverified** - what you could not confirm, and what you searched.

Do not add opinions about what I should build. Just the map.
