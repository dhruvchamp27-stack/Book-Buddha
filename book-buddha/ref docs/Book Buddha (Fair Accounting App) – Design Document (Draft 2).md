# Book Buddha (Fair Accounting App) – Design Document (Draft 2)

*Prepared 7 November 2026. Status: all ten sections were approved by you in chat. You will review the whole document once more. Nothing has been built.*

## 1. Purpose and direction

- Book Buddha (your name for the app; I could not find a product with that name online) is a **general accounting app**. It is a **local web app on one PC**: one program, one database file, screens in a browser, mostly one user, and offline use preferred.
- "SaaS" is only your word for it. It is not an online service for many customers.
- The app **starts blank**, with no built-in business types. You create Business 1, Business 2 and so on, and name them. You set the fields, document layouts, numbering, chart of accounts and tags.
- The users are **non-accountants**, so ease of use is the main goal. The app does the accounting automatically. Debit and credit are filled in behind each entry, and the books always balance.
- Three things are fixed and cannot be switched off: **double-entry bookkeeping, the audit log, and cancel with reversal**. Everything else is meant to be customisable, so you manage things your own way.
- There are **no hardcoded special rules**. The school incentive and the subscription year-end settlement are not built in. You enter them as ordinary expenses and entries.
- **Book Fair** is a tag you can attach to any entry in any business. Reports can be viewed fair by fair.
- The language is English only, the currency is INR, and there is a financial year setting.
- It is a real, working product. You will use it yourself first. Giving it away, donating or selling it stays possible. Ask a lawyer before you do.
- QuickBooks Online and Invoice Ninja are **references only** for screens, fields and ideas. The accounting engine and everything else is built on our own design.

## 2. Phases

**Phase 1 (build first): Admin only.** Admin is the only full-access role, and only Admin can delete records.

- **Setup:** company, businesses, fairs (as a tag), customers and items, with Track stock Yes/No on each item.
- **Documents:** invoices, quotations (convertible to invoices), credit notes, challans, and recurring invoices.
- **Money entries:** bills, payments received, bill payments, day-to-day expenses, stock purchases and adjustments, refunds, sales returns, bad-debt write-off, and a simple entry screen for moving amounts between accounts.
- **Accounting engine:** every entry becomes double-entry bookkeeping automatically.
- **Reports:** the 8 reports, per business, combined, and fair by fair.
- **Data:** Excel and CSV import, Excel, CSV and PDF export, backup and restore, custom fields.
- **Login:** Admin only. Google sign-in at first-time setup and password recovery, then a password for daily use.
- **Audit log:** records every action, including who did it, from day one.
- **Optional extras:** email sending (reminders, bulk email) and tax. Email needs internet and an email account in Settings. Everything else works offline.

**Phase 2 (designed later): invoicing-only users.**

- The invoicing-only role. These users can never delete an invoice, only cancel it, which reverses the sale.
- Other devices on the same network.
- The role test and the two-device test.

**Kept for a later version:** one challan covering several invoices.

My assessment (opinion, not a sourced fact): recording "who did it" from day one should let Phase 2 add a role instead of reworking the app.

## 3. Decisions already made

**Company and businesses**

- A company holds one or more businesses. There is one database file per company, and every entry is tagged with its business. There is one company per install in v1.
- There is one shared chart of accounts per company. You can preview and pick a ready-made set, or build your own.
- Reports can be run for one business or combined across the company. One backup covers the whole company.

**Login and audit**

- Google sign-in is used only at first-time setup and password recovery. Daily login uses a password set in the app, which works offline.
- The password needs at least 8 characters, with letters and numbers. After 5 wrong tries the app locks for 15 minutes.
- If you forget the password, you sign in with the same Google account and set a new one. This needs internet.
- The app signs you out after 1 hour of no use, with a 1-minute warning and a "Stay signed in" button. Autosaved drafts stay saved.
- Every action is logged in a read-only audit log.

**Fairs and buyers**

- A fair is linked to a host customer. Each fair invoice belongs to one fair, and fair invoices are part of the overall books.
- Fair buyers pay at once by UPI or Cash, and the invoice records the payment mode.
- Buyer name and one contact (email or WhatsApp) are optional and stored on that invoice only.

**Customers**

- Duplicate names are warned about but allowed. There are up to 2 contacts by default, with more if needed.
- Billing and Shipping addresses are separate, with a copy button.
- The customer number is app-given, with a prefix you define (for example SCH-0001).
- Classification is an optional fixed dropdown: Individual, Business, Company, Partnership, Trust, Charity, Government, Other.
- You can attach files (PDF, JPG/PNG, Word, Excel, CSV, up to 20 MB each). Customer statements (transactions, balance, aging) are included.

**Items and stock**

- Each item has a unit from a list you maintain, and a "Track stock: Yes/No" setting. Books are Yes. Magazines are No.
- Switching to No is blocked while the item still has stock.
- Which document reduces stock is one setting per business: the challan when issued, or the invoice when finalised. A linked challan and invoice never reduce stock twice.
- If a document asks for more than the available stock, the app blocks it and offers a quick "Add stock" step.
- Stock is valued by FIFO only. The cost of books sold is booked when the books leave. Magazine cost (no stock) is booked when the supplier's bill arrives or when you enter the stock details.

**Invoices and documents**

- Invoice numbers include the financial year and restart at 001 each year (for example INV-001/26-27). Each business has its own prefix and sequence.
- The next number appears when the screen opens and is used up when you save, even as a draft. Cancelled numbers are never reused.
- Quotations and payments have their own yearly sequences. Quotations convert to invoices.
- Due date is optional and fills in as 30 days from the invoice date. You can change or clear it.
- Each document has a terms and notes space, plus internal staff-only notes that are never printed.
- Extra charges, a lump-sum discount, price history by date, and a PO number with a reuse warning are all included.
- Totals are not rounded; exact paise are kept. Amount grouping (Indian or international) is chosen in Settings.
- Editing a finalised invoice is allowed, with the old version kept in history.
- Drafts autosave. Leaving an unfinalised draft shows a warning every time.
- The financial year can be locked. Once finalised, only Admin can correct entries.
- Bulk actions on the invoice list include Excel export. Delete stays Admin-only. Bulk "Mark paid" asks once for date and method.
- An invoice raised first for a full year's supply sits as unearned revenue until delivery. You manage this with your own accounts, a simple entry screen, and an optional repeat template. Nothing is automatic until you create one.
- Credit customers get a normal sales invoice, and you record the payment when it arrives.
- A challan is issued per delivery and records how many items from its invoice were delivered. In v1, each challan belongs to one invoice.

**Payments and money**

- The payment method list is editable. It starts with Cash, Bank Transfer, UPI, Cheque, Other.
- One payment can be split across several invoices of the same customer. Overpayment is kept as customer credit.
- Credit notes are a separate document with proper accounting effects and a note.
- Refunds, sales returns and bad-debt write-off are all in v1.

**Tax, reminders, import, backup**

- Tax is optional, in the Invoice Ninja style adapted for India. You create tax names and rates, apply them per item line, choose inclusive or exclusive, and mark items tax-exempt. Customers have an optional GSTIN field. I cannot confirm your GST position.
- Reminders are in the style of Invoice Ninja, together with the A/R aging report. Email sending and bulk email are optional and need internet.
- Import accepts real Excel (.xlsx) and CSV. Opening balances come by import or a simple typing screen.
- Backup lets you choose what to include: everything (database, attachments, logo, audit log) or the database only.

**Reports (v1):** Profit and Loss, Balance Sheet, A/R and A/P aging, Inventory Valuation Summary, Sales by item, General Ledger and Trial Balance, Cash Flow Statement. Each can be viewed per business, combined, and fair by fair.

## 4. How the pieces fit

- **One program on the PC** holds the accounting rules and the data.
- **One database file per company** holds all its records. A backup copies that file. If you choose "everything", it also copies attachments, the logo and the audit log.
- **The screens run in a browser on the same PC.** Internet is needed only for Google sign-in at first-time setup and password recovery, and for optional email sending. Everything else is meant to work offline. This must be tested on your setup.
- **Login decides what each person sees.** In Phase 1 there is only the Admin.
- **Making PDFs without internet** (invoices, statements) is something I cannot confirm yet. It must be decided and tested in the implementation plan.
- **Which database and tools to use** is not decided. It will be settled in the implementation plan, with plain-language reasons for you to check.
- **Phase 2 only:** a nearby device opens the PC's address in its own browser. I cannot confirm that your PC and network will allow this. It must be tested on your setup.

## 5. Building blocks

1. **Company and businesses:** one company, with one or more businesses you name. Every entry is tagged with its business. One shared chart of accounts.
2. **Users and login:** the Admin in Phase 1. Google sign-in at first-time setup and password recovery, and a password for daily use.
3. **Fairs:** create a fair, link it to a host customer, and attach it as a tag to entries. Fair invoices stay part of the overall books.
4. **Customers and items:** customer details, contacts, addresses, attached files and statements. Items carry a unit and a Track stock Yes/No setting.
5. **Documents:** invoices, quotations, credit notes, challans and recurring invoices. They have their own numbering, terms and notes, extra charges, discounts and PO numbers.
6. **Money entries:** bills, payments received, bill payments, day-to-day expenses, stock purchases and adjustments, refunds, sales returns and bad-debt write-off. There is also a simple screen for moving amounts between accounts, and optional repeat templates.
7. **Accounting engine:** turns every entry into double-entry bookkeeping automatically. It values stock by FIFO and applies the financial year lock. Books always balance.
8. **Reports:** the 8 v1 reports, per business, combined, and fair by fair.
9. **Import, export and backup:** Excel and CSV import, opening balances, Excel, CSV and PDF export, and backup and restore with the choice of what to include.
10. **Settings and custom fields:** your own fields, tags, numbering, prefixes, units, payment methods, tax names and rates, amount grouping, and the per-business stock setting.
11. **Audit log:** a read-only record of every action: who, what and when. Edited invoices keep their old versions in history.
12. **Email and reminders (optional):** payment reminders and bulk email. These need internet and an email account in Settings.

## 6. How data flows

1. **Create a fair.** You create a fair and link it to a host customer. It becomes a tag you can attach to any entry.
2. **Invoice at a fair.** You pick the fair, add items and quantities, and choose how the buyer paid: UPI or Cash. Buyer name and one contact are optional. The invoice number appears when the screen opens and is used up when you save, even as a draft.
3. **Finalising an invoice.** The accounting engine records the sale and the payment together. Stock leaves on the document set in Settings, Stock: the challan when issued, or the invoice when finalised. The cost of the books is booked at the moment the stock leaves.
4. **Sale on credit.** A normal invoice raises the amount the customer owes. You record the payment when it arrives. One payment can be split across several invoices of the same customer. Overpayment is kept as customer credit.
5. **Invoice raised first, supply later (for example, a full-year magazine subscription).** The invoice is made first. If the item is linked to your unearned revenue account, the amount sits there. Each delivery gets a challan, which notes how many items from that invoice were delivered. Moving amounts out of unearned revenue is your own entry, or an optional repeat template you create. Nothing is automatic until you set it up.
6. **Cancelling an invoice.** Cancelling reverses the sale, the payment and the stock. The cancelled invoice stays visible, marked Cancelled, and its number is never reused.
7. **Editing a finalised invoice.** The old version is kept in history. How the accounting entries follow an edit is something I cannot confirm yet. It will be settled in the implementation plan.
8. **Corrections after the sale.** Credit notes, refunds, sales returns and bad-debt write-off are each their own entry with their own accounting effect. The original invoice is never overwritten.
9. **End of fair.** The school incentive is not automatic. You work it out from the sales, enter it as an ordinary expense, and add a stock adjustment if books are handed over.
10. **Financial year lock.** Once you finalise a year, its entries are locked and only Admin can correct them.
11. **Reports.** All reports read the same records. The overall view shows everything, and the fair-wise view is the same data filtered to one fair, so the two always agree.
12. **Audit log.** Every action is logged, and the log is read-only.

## 7. When things go wrong

1. **Bad entries are caught before saving**, with a plain message. Examples: no items, a zero quantity, or more stock requested than is available. For stock, the app blocks the document and offers a quick "Add stock" step.
2. **A save is all-or-nothing.** An invoice, its accounting entries and its stock change are either all recorded or none are. This relies on the database being transactional, and it will be tested.
3. **Numbers are given by the app,** so two documents cannot get the same number. A number is used up when you save, even as a draft. A deleted draft leaves a gap, and a cancelled number is never reused.
4. **Drafts are autosaved.** Leaving an unfinalised draft shows a warning every time. Autosaved drafts stay saved when the app signs you out, and you continue from the Drafts list.
5. **Login protection:** 5 wrong passwords lock the app for 15 minutes. It signs you out after 1 hour of no use, with a 1-minute warning.
6. **Locked years are protected.** Once a financial year is finalised, only Admin can correct its entries, and every correction is logged.
7. **Excel and CSV import checks first.** It shows any problem rows before importing anything.
8. **Backup and restore.** The app reminds you to back up and can restore from a backup file. You choose what to include: everything, or the database only.
9. **Email problems.** Sending needs internet and an email account in Settings. If email fails, you see a message and nothing else stops working.
10. **Two logs, kept separate.** The audit log records business actions: who, what and when. A technical error log records crashes and failures for the developer or AI tool. It does not record business actions.
11. **Phase 2 only:** if a nearby device loses its connection, an unsaved invoice is not recorded. The user sees a message and saves again.

## 8. How we check it works

The tests are written separately in the file **Testing.md**. In short, there are 16 tests:

1. Books always balance
2. Known-answer test (your hand-worked figures)
3. Cancel test
4. Stock test
5. Challan test
6. Credit sale test
7. Correction test
8. Numbering test
9. Edit and lock test
10. Fair-wise test
11. Audit test
12. Login test
13. Import test (your real Excel data)
14. Backup test
15. Offline test
16. Phase 2 only: role test and two-device test

The AI tool writes the technical tests. Your job is to check the results against your own figures. Before accepting any build, we also ask the AI the three questions listed in Testing.md.

## 9. Open items to settle

**Checks that are not mine to confirm (CA or lawyer)**

1. **Buyers' personal data** (name and contact stored on fair invoices). India's DPDP Rules 2025 start in stages. Sources differ on when the main duties begin (13 or 14 May 2027), and I cannot confirm the date or whether your use is covered. Check with a lawyer before giving the app to others. Sources: https://www.scconline.com/blog/post/2025/11/14/meity-notified-digital-personal-data-protection-rules-2025/ and https://bhattandjoshiassociates.com/?p=33581
2. **GST.** Your magazine PRD records "GST: Exempt" as your stated scope. I cannot confirm your GST position. Tax in the app is optional, so this does not block the build. Ask your CA.
3. **Magazines as a reseller.** Ask your CA whether you book the full sale or only your margin. The sources I found describe a publisher selling its own magazine.
4. **Giving away or selling the app.** Ask a lawyer first.

**To be settled in the implementation plan**

5. Which database and tools to use.
6. How PDFs are made without internet.
7. How the accounting entries follow an edit of a finalised invoice.

**Kept for a later version**

8. One challan covering several invoices.

## 10. Sources

I read these on earlier dates and did not reopen them when assembling this document. They are software vendor, help or community pages, not accounting standards or Indian rules.

**Accounting treatment**

- Prepaid income is a liability until delivered: https://www.superfastcpa.com/what-is-prepaid-income/
- Invoice raised before cash is debit receivable or cash, credit deferred revenue: https://ms3.enertiv.com/?p=20331
- Tally, delivery note linked to an invoice: https://tallysolutions.com/accounting/delivery-challan-invoice-conversion-setup/
- QuickBooks Online recurring journal entry for unearned revenue (community answer): https://quickbooks.intuit.com/learn-support/en-us/reports-and-accounting/re-can-quickbooks-automatically-recognize-revenue-monthly-for/01/1026323

**References for screens and features**

- QuickBooks Online, duplicate names are blocked: https://quickbooks.intuit.com/learn-support/en-us/help-articles/error-the-name-supplied-already-exists-another-customer-supplier/00/238831
- Invoice Ninja, customer classification: https://invoiceninja.github.io/en/user-guide/clients
- Invoice Ninja, line-item taxes: https://invoiceninja.github.io/en/user-guide/faq
- Invoice Ninja, reminders: https://invoice-ninja.readthedocs.io/en/latest/templates\_and\_reminders.html
- Invoice Ninja, bulk actions: https://invoice-ninja.readthedocs.io/en/v5.0/invoices.html
- Invoice Ninja, its cancellation code (no debit and credit counter-entries): https://github.com/invoiceninja/invoiceninja/blob/v5-stable/app/Services/Invoice/HandleCancellation.php

**Legal**

- DPDP Rules 2025: the two links in section 9.

**Testing**

- Beginner's backend guide, used only for the three pre-build questions. I could not verify its other claims: https://sunny-starburst-914291.netlify.app/
