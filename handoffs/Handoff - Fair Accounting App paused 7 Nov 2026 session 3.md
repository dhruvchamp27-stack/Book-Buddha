# Handoff – Fair Accounting App / "Book Buddha" (paused 7 Nov 2026, session 3)

Paste or share this at the start of a new chat in the Billing Project so we can continue
without repeating anything. It replaces the earlier handoffs (31 Oct, 1 Nov, 2 Nov, 4 Nov,
5 Nov, 6 Nov, 7 Nov session 2) where they differ.

## 1. Where we stopped

We are in the **superpowers brainstorming** process: nothing is built until I approve the
full design.

Session 3 was spent setting up a proper reverse-engineering of Invoice Ninja, to use as the
reference for our App flow document. Three prompts were written. Batch 0 came back and was
accepted.

**Two things are waiting, in this order:**

1. **The Invoice Ninja inspection continues.** Batch 0 (the four conflicts) is delivered and
   accepted. **Next is Batch 1** (invoice creation as a flow), then Batches 2 to 12. Thirteen
   deliveries in all, so twelve remain. The other AI is waiting for "next".
2. **Four magazine accounting questions are still unanswered** (section 6). Question 1, the
   cost of the books sold, has been waiting since session 2. Questions 1 and 4 must be settled
   before App flow sections 4, 5 and 11 can be written.

Decided sequence: finish all batches, then run Prompt 3 (the UX pass), then restructure the
documents and write the App flow.

## 2. How to work with me (my instructions)

- Keep answers short and give one step at a time; confirm before moving on.
- Always tell the truth, cite real sources for factual claims, and say "I cannot confirm this"
  when something cannot be verified. No guessing.
- I am a finance professional with a no-code background and limited AI knowledge (I am not an
  engineer), so guide accordingly.
- Use the superpowers brainstorming skill for planning. Do not start building until the design
  is approved.
- Put the full content of a section in the message itself. End long drafts with a plain-text
  question, not a tappable question card.
- When I paste another AI's answer, check it against real sources and tell me what is verified
  and what is not. Judge the quality of its evidence, not just its content.
- Ask questions in **sets of 5**, one decision per question, no sub-questions, with lettered
  options (A, B, C). I answer like "1A, 2B, 3C".
- When I ask "what is suggested as per accounting logic?", search for sources, cite them, label
  any opinion as opinion, and say what could not be confirmed.
- When I say "go the Invoice Ninja way", check Invoice Ninja's documentation, tell me what it
  does, and flag any conflict with my earlier decisions.
- When I say "check what the magazine PRD says", read the project file
  PRD_Magazine_Subscription_Management_v4 and report exactly what it says and what it does not.
- When I say "see how any accounting software does it", check how standard accounting software
  (QBO, Tally, Zoho Books) handles it and cite the pages.
- When I explain an accounting effect, I am describing the accounting only, not asking to change
  how the app works. If unsure, ask me before treating it as a design change.
- **Design principle:** the app must leave me free to manage things my own way and leave room
  for the business to change. Do not bind me to strict built-in rules. The fixed parts stay:
  double-entry, audit log, cancel with reversal.
- Stop raising the Invoice Ninja licence key. Only one note stays: ask a lawyer before giving
  away or selling the app.
- Files for this work live in `C:\Users\Admin\Desktop\Book Buddha`. Save handoffs and prompts
  there, not as project files, unless I say otherwise.

## 3. The Invoice Ninja inspection (new in session 3)

### 3.1 Why we are doing it

To build our App flow document we need a reference for screens, flows, fields and small
functionality. Invoice Ninja is a mature **invoicing and receivables** product, not a full
accounting system, so the harvest is aimed at everything it does have; we filter afterwards
against our own decisions.

On the word "reverse engineer": per the LICENSE read on 4 Nov, Elastic License 2.0 has no
reverse-engineering prohibition - its limits are hosted services, the licence key and notices.
QBO's terms do prohibit it, which is why we never did this with QBO. I cannot confirm the legal
interpretation. The lawyer note before giving away or selling still stands.

### 3.2 The three prompts (all in this folder)

1. `Prompt - Invoice Ninja full flow and feature extraction.md` - round 1. One large prompt.
2. `Prompt 2 - Invoice Ninja re-inspection (batched).md` - round 2, the one now running.
   Batch 0 plus Batches 1 to 12, strict evidence rules, completeness checks, retractions.
3. **Prompt 3, not yet written** - the UX pass. See section 5.

### 3.3 Round 1 output: my verdict

The file is `Prompt output.MD` in this folder. Useful for the menu tree and the screens they
actually opened. Not usable as a flow document:

- They removed every file path on purpose, so all `[SOURCE: ...]` claims were uncheckable.
- Zero flows delivered, which was the main thing needed.
- "Complete inventory" lists came back summarised (settings, reports, import targets).
- Hedged answers (overpayment stored in "X or Y").
- Its Unverified list named only two trivial external items.

Still useful from round 1, now partly superseded by Batch 0: the full menu and settings tree
(13 basic + 13 advanced settings tabs with routes), the invoice editor layout, the client list
columns, and the confirmation that a **delivery note is only a PDF view of an invoice with
prices stripped** - it is not a document and it moves no stock, and there is no challan
lifecycle at all.

### 3.4 Batch 0: the four conflicts, settled

Quality accepted: repository-relative paths, quoted code, and before-and-after tests on the
live instance.

**1. Stock decrements on invoice save, including a draft.** Round 1's "only on Draft to Sent"
was retracted. Code: `app/Jobs/Inventory/AdjustProductInventory.php:L91-118` decrements
`products.in_stock_quantity`; called from `app/Http/Controllers/InvoiceController.php:L240-248`
on store. Condition: `company.track_inventory` is on and the line item is `type_id == '1'`.
Live test: stock 50, draft for 2 → 48 immediately; marking Sent left it at 48; deleting the
invoice restored 50. Eight callers were enumerated, including quote conversion, recurring
generation, client-portal purchase, delete (restores) and restore (re-decrements), and purchase
order receipt (increments).

**2. Overpayment.** Overpaying a single invoice line is blocked by a validator
(`app/Http/Requests/Payment/StorePaymentRequest.php:L99-101`). A payment total may exceed the
invoices it is allocated to. The surplus lives in **`clients.payment_balance`**, computed as
`SUM(payments.amount - payments.applied)` in
`app/Services/Client/ClientService.php:L137-152`. `clients.paid_to_date` rises by the full
amount received. No credit note is created. The UI badge reads "Partially Unapplied".
Live test: ₹1,500 received against a ₹1,000 invoice → applied 1,000, `payment_balance` 500,
`paid_to_date` +1,500.

**3. Import accepts csv, txt and zip only** (`app/Http/Requests/Import/ImportRequest.php:L35-46`).
JSON restore accepts a zip only. **`.xlsx` is not accepted for import anywhere** - it appears
only as a permitted file attachment and in report export.

**4. Session and password timeout.** The default frontend is a Flutter Web SPA, with a React
SPA also compiled; Blade templates serve only public flows. The API is token-authenticated, not
session-cookie based. `companies.default_password_timeout` defaults to 30 minutes; when it
lapses, `app/Http/Middleware/PasswordProtection.php:L43-64` returns HTTP 412 and the SPA shows
a password modal over the current screen, so typed form state is preserved. Separately,
`web_session_timeout` governs idle logout. Round 1's claim was therefore substantially right,
and is now evidenced.

### 3.5 One new conflict to watch

Round 1 described `track_inventory` as a **per-product checkbox** (with `stock_quantity` and
`notification_threshold`). Batch 0's code shows **`company.track_inventory`**, a company-level
toggle, with only the notification fields on the product. These cannot both be right as stated.
This matters because our 7 Nov decision gives every item its own "Track stock: Yes/No".
**Resolve this in Batch 5**, which already asks for every product field and every Product
Settings option. Round 1 also claimed a "Prevent Negative Stock" setting; Batch 5 asks them to
quote it or retract it.

### 3.6 What the inspection cannot give us

Invoice Ninja has no chart of accounts, no journal entries, no general ledger, no trial
balance, no balance sheet, no cash flow statement, no financial-year lock, no opening balances
and no inventory valuation method. It also has no challan. So our accounting engine, FY lock,
FIFO costing, opening balances, the challan document, the per-business stock setting and
fair-wise reporting have no counterpart there and are ours to design regardless of how good
the map turns out.

Also worth noting for our own design: their draft-reduces-stock behaviour is the **opposite**
of our 5 Nov decision (stock reduces only on finalising, draft shows as blocked). Nothing to
copy; useful to know.

## 4. Confirmed decisions (carried forward, still current)

### 4.1 Direction and build

- The app is a **general accounting app**. It starts blank with no built-in business types. The
  user creates Business 1, Business 2 and so on, and names them. The user sets fields, document
  layouts, numbering, chart of accounts and tags.
- I call it an accounting "SaaS" and refer to it as **"Book Buddha"**. "SaaS" is only my word.
  The confirmed build is a **local web app on one PC**: one program, one database file, screens
  in a browser, mostly one user, offline use preferred. Write "local web app on one PC" in the
  design documents.
- Invoice Ninja is a **reference only** for screens, fields and ideas. The accounting engine and
  everything else is built on our own design.
- Book Fair is a tag (class, location or project-like) attached to any entry in any business.
  Reports can be viewed fair by fair.
- No hardcoded special rules. The school incentive and the subscription year-end settlement are
  not built in; the user enters them as ordinary expenses and stock adjustments.
- Debit and credit are filled in automatically. The user never enters them. Books must always
  balance.
- Users are non-accountants. Ease of use is the main goal. English only, currency INR, a
  financial year setting.
- A company holds one or more businesses. One database file per company, every entry tagged with
  its business. One company per install in v1. One shared chart of accounts per company
  (ready-made sets to preview and pick, or the user builds their own). One backup covers the
  whole company.
- Phase 1: Admin only, and Admin is the only full-access role. Only Admin can delete records.
  Phase 2 (design later): invoicing-only users on other devices on the same network; they can
  never delete an invoice, only cancel it.
- Every action is logged in a read-only audit log.
- A fair is linked to a host customer. Each fair invoice belongs to one fair. Fair buyers pay
  instantly by UPI or Cash. Buyer details: name and one contact (email or WhatsApp number),
  optional, stored on that invoice only.

### 4.2 Decided 5 Nov

- Optional due date, filled in automatically as 30 days from the invoice date; the user can
  change or clear it. A space for terms or notes on every invoice, quotation and similar document.
- Stock reduces only when an invoice is finalised; a draft shows its quantity as blocked.
  **Now refined by the 7 Nov stock setting below.**
- If an invoice asks for more than the available stock, the app **blocks** it, with a quick
  "Add stock" step.
- Cancelling an invoice reverses the sale and the stock comes back automatically.
- Stock valuation: **FIFO only**.
- Invoice numbers include the financial year and restart at 001 each year (for example
  INV-001/26-27). Each business has its own sequence and its own prefix, set by the user.
- Cancelled invoice numbers are never reused; the cancelled invoice stays visible, marked Cancelled.
- Invoice totals are **not rounded**; exact paise are kept.
- Amount grouping (Indian 10,00,000.00 or international 1,000,000.00) is chosen in Settings.
- Each item has a unit from a list the user maintains.

### 4.3 Decided 6 Nov

- **Customers:** duplicate names warned but allowed. Up to 2 contacts by default, more can be
  added. Separate Billing and Shipping addresses with a copy button. App-given customer number
  with a user-defined prefix (for example SCH-0001). Files can be attached to a customer (PDF,
  JPG/PNG, Word, Excel, CSV, up to 20 MB each). Customer statements: yes.
- **Payments:** an editable list of methods, starting with Cash, Bank Transfer, UPI, Cheque,
  Other. One payment can be split across several invoices of the same customer. Overpayment is
  kept as customer credit, which the user can adjust. Refunds, sales returns and bad-debt
  write-off are all in v1.
- **Documents:** credit notes (separate document with proper accounting effects and a note),
  quotations (convertible to an invoice), recurring invoices, and challans (delivery notes,
  available in any business): all yes.
- **Invoices:** editing a finalised invoice is allowed with the old version kept in history.
  The next number appears when a new invoice screen is opened and is used up when the invoice is
  saved, even as a draft (a deleted draft leaves a gap). Quotations and payments each have their
  own number sequence per financial year. Financial year lock: yes (once finalised, only Admin
  can correct entries). Autosave of drafts: yes. Extra charges, lump-sum discount, price history
  by date, PO number with a reuse warning, internal staff-only notes: all yes. Bulk actions on
  the invoice list: yes, plus Excel export of the list; delete stays Admin-only; bulk "Mark paid"
  asks once for date and method.
- **Tax:** optional, the Invoice Ninja way adapted for India: the user creates tax names and
  rates, applies them per item line, chooses inclusive or exclusive, with a tax-exempt option and
  an optional GSTIN on customers. This replaces "no tax fields for now".
- **Reminders:** the full reminder functionality Invoice Ninja offers, with the A/R aging report.
  Email sending is optional (needs internet and an email account in Settings).
- **Import:** both real Excel (.xlsx) and CSV. **Opening balances:** Excel import plus a simple
  screen to type them, and the user can create an account with its opening balance.
- **Backup:** the user chooses what to include (everything, or database only).

### 4.4 Decided 7 Nov (session 2)

**Login**

- Google sign-in only at first-time setup and password recovery; daily login uses a password set
  in the app (works offline).
- Password: at least 8 characters, with letters and numbers.
- Lock for 15 minutes after 5 wrong tries.
- Forgotten password: sign in with the same Google account, then set a new password (needs
  internet).
- Automatic sign-out fixed at 1 hour of no use, with a 1-minute warning and a "Stay signed in"
  button. Autosaved drafts stay saved.
- Step 1 of the first-time setup flow still needs updating for this when we write the App flow.

**Small design details**

- Customer classification: a fixed, optional dropdown: Individual, Business, Company,
  Partnership, Trust, Charity, Government, Other.
- Leaving an unfinalised autosaved draft shows a warning every time: the draft is saved, its
  number is used, and you can continue from the Drafts list.
- Bulk email of invoices: in v1, optional, needs internet and an email account in Settings.

**Items and stock**

- Each item has a "Track stock: Yes/No" setting. Books: Yes. Magazines: No. It is on the item's
  own page and also when creating an item. The user can change it later.
- Switching an item to No is blocked while it still has stock; reduce stock to 0 first with a
  stock adjustment.
- **Who reduces stock is a user choice.** One setting per business (Settings, Stock): either
  "Challan reduces stock when issued" (a draft challan does not) or "Invoice reduces stock when
  finalised". A linked challan and invoice never reduce stock twice.

**Unearned revenue (magazine subscriptions)**

- The accounting effect (explanation only, not an app rule): an invoice issued at the start of
  the subscription period and paid in advance sits as unearned revenue on the liability side;
  revenue is released as deliveries happen.
- In the app the user manages this himself: he creates his own accounts including a liability
  account for unearned revenue; items can be linked to the account they post to; a simple entry
  screen moves amounts between accounts; and an optional repeat template (amount, start and end
  dates, like QBO's recurring journal entry) posts on its own schedule once he creates one.
  Nothing is automatic until he does.

### 4.5 Transactions, features and reports

- Invoices, bills, payments received, bill payments, day-to-day expenses, stock purchases and
  adjustments. Basic inventory.
- Custom fields (user-named, no limit), notes, customer details. Export to Excel, CSV and PDF.
- Reports in v1: Profit and Loss, Balance Sheet, A/R and A/P aging, Inventory Valuation Summary,
  Sales by item, General Ledger and Trial Balance, Cash Flow Statement. Each viewable per
  business, combined, and fair by fair.

### 4.6 How the magazine business works (my explanation, 6 Nov)

- The vendor issues a quote first, converted to an invoice when accepted. For subscription
  customers the invoice is for the full year.
- Magazines and journals are received from the supplier as each issue arrives and handed to the
  customer as they arrive. Nothing is held in stock.
- Details are in the project file PRD_Magazine_Subscription_Management_v4 (v4.2, 30 Sep 2026):
  four billing models (Subscription prepaid, Credit, Retail, Order-based), two users, one PC.
  Verified earlier: one invoice for the period, a challan for each supply, and a settlement
  statement at period end; challans apply only to subscription customers; credit customers are
  invoiced weekly or monthly after supply; the words "stock" and "inventory" do not appear in it.

## 5. Prompt 3: the UX pass (planned, not written)

Identified in session 3: Prompts 1 and 2 ask for fields, tables and side effects - the
engineer's view. They barely ask what using the product feels like. Prompt 3 is to be written
after the batches finish, and must cover, per screen:

- Layout: what sits where, how a long form is broken up, what is visible without scrolling.
- Interaction feel: what happens as you type, tab order, what autocompletes, how many clicks a
  routine task takes, what can be done with the keyboard alone.
- Wording: the actual labels, button text, help text, error messages, empty-state text.
- Friction and rescue: what warns, what confirms, what can be undone, what happens when the
  user does something wrong.
- Mobile and narrow screens.
- Where it is annoying - the steps a daily user would resent.

To be run by clicking and using the product as a daily user, with screenshots, not by reading
code. Noted cost: a daily-use pass is sharpest when the product is still unfamiliar, and by
then they will know it well, so some first-impression value is lost. Accepted trade.

## 6. Pending questions (nothing here is decided)

1. **Cost of the books sold (items with Track stock: Yes). Waiting for my answer since
   session 2.**
   - A. Book the cost at the same moment the stock leaves, so it follows the Settings, Stock
     choice: at the challan with the challan way, at invoice finalisation with the invoice way.
     (Claude's opinion, no source searched for it.)
   - B. Always book it when the invoice is finalised, as decided on 5 Nov. With the challan way,
     stock would leave at the challan and the cost would be booked later.
2. **Cost of magazines (no stock):** booked when the supplier's bill arrives, or when the
   magazine is delivered to the customer? The PRD (section 4.10) takes cost as quantity delivered
   times purchase cost.
3. **Credit customers:** the PRD bills them weekly or monthly based on what was supplied, so the
   amounts change each cycle. How should that cycle invoice be built, and how does it relate to
   the recurring invoices feature?
4. **Linking a challan and an invoice:** can one invoice be created from one or several challans,
   and what happens when only part of a challan is invoiced? (The no-double-counting rule is
   already decided; this is about how the link works.)

Questions 1 and 4 block App flow sections 4, 5 and 11.

**Possibly no longer needed:** the partial payment example (invoice 10,000, receipts 6,000,
delivered 3,000, and what sits in unearned revenue). Because the user manages unearned revenue
with his own accounts and entries, the app may not need to decide it.

## 7. Other open items (not mine to settle)

- Ask my CA how revenue and cost apply to me as a reseller of magazines (full sale, or only my
  margin). The sources found describe a publisher selling its own magazine.
- Buyers' personal data: I cannot confirm which rules apply. India's DPDP Rules 2025 start in
  stages and sources differ on the date (13 or 14 May 2027). Check with a lawyer before giving
  the app to others.
- Ask a lawyer before giving away or selling the app.
- GST: my magazine PRD records "GST: Exempt" as my stated scope. Claude cannot confirm my GST
  position.

## 8. Files

**In this folder (`C:\Users\Admin\Desktop\Book Buddha`):**

- `Handoff - Fair Accounting App paused 7 Nov 2026 session 2.md`
- `Handoff - Fair Accounting App paused 7 Nov 2026 session 3.md` (this file)
- `Prompt - Invoice Ninja full flow and feature extraction.md` (round 1)
- `Prompt output.MD` (round 1 result)
- `Prompt 2 - Invoice Ninja re-inspection (batched).md` (round 2, running)
- Batch 0 result: delivered in chat; save it here as `IN-batch-0-conflicts.md` if not already.

**In the Billing Project files:** handoffs of 31 Oct to 7 Nov session 2, the magazine PRD v4.2,
PRD v0.1, Features List v0.1 and the Design Document Draft 1.

**Documents still to restructure** (all outdated for the generic-core direction):

- Design document, Draft 1 (approved 1 Nov): https://claude.ai/artifact/GMKkJ1j4ChRB3igrAbj9yH
- PRD v0.1: https://claude.ai/artifact/JAYjDq7GtqA7yuSMTThjin
- Features List v0.1: https://claude.ai/artifact/Ds8fKdPmsVpt2Rg8gQ5osU

## 9. App flow document (not created yet)

**Format (approved):** numbered steps, a simple diagram for each flow, and what happens on
every tap.

**Section list**

1. First-time setup (approved 1 Nov; step 1 needs updating for the login decision)
2. Daily login (settled: password, 15-minute lock, 1-hour sign-out with warning)
3. Home screen (draft awaiting approval)
4. Normal invoice, outside a fair (draft awaiting approval; needs: number shown on open and used
   on save, autosave and exit warning every time, 30-day due date, terms and notes, internal
   notes, extra charges, lump-sum discount, price by date, PO number, optional tax, stock rules
   and the per-business stock setting, bulk actions)
5. Everyday books: customers, items (with Track stock), bills, payments, expenses, stock (also:
   quotations, credit notes, challans, recurring invoices, refunds, returns, bad-debt write-off,
   customer statements, reminders, the entry screen for moving amounts between accounts, repeat
   templates)
6. Import from Excel
7. Reports
8. Backup and restore
9. Create a fair
10. Invoice at a fair
11. Cancel an invoice (stock comes back automatically)
12. End of fair (the incentive is entered by the user)

All existing drafts were written before the generic-core direction and need rechecking.

## 10. Next steps

1. Tell the other AI "next" and collect Batches 1 to 12. Claude checks each one's evidence
   quality as it arrives, and flags conflicts with decisions already made.
2. Resolve the `track_inventory` conflict in Batch 5 (section 3.5).
3. Write and run Prompt 3, the UX pass.
4. Answer the four pending magazine accounting questions (section 6).
5. Build the filter sheet: every item the inspection returns marked Take / Adapt / Skip /
   Conflict against our settled decisions. (Claude offered this twice; not yet made.)
6. Restructure the design document for the generic core and all decisions.
7. Write the App flow sections one at a time, each approved by me.
8. Update the PRD and Features List with the final decisions.
9. Only after I approve everything, write the implementation plan (writing-plans skill).
   Nothing is built before that.
