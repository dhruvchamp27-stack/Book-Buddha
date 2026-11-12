# Handoff – Fair Accounting App / "Book Buddha" (paused 8 Nov 2026)

Paste or share this at the start of a new chat in the Billing Project so we can continue without
repeating anything. It replaces the earlier handoffs (31 Oct, 1 Nov, 2 Nov, 4 Nov, 5 Nov, 6 Nov,
7 Nov session 2, 7 Nov session 3) where they differ.

---

## 1. Where we stopped

We are in the **superpowers brainstorming** process: nothing is built until I approve the full
design.

The Invoice Ninja inspection is **finished for now**. Four rounds have been run and all output
is on disk. Claude has read and reviewed rounds 1 and 2 in full. **Rounds 3 and 4 (the UX and
visual passes) have been delivered but Claude has NOT read them yet.** That review is the first
thing to do when I resume.

**Nothing is waiting on Claude.** Three things are waiting on me:

1. Bring the round 3 and round 4 reports to Claude for review (they are already on disk; Claude
   just has not opened them).
2. Answer the four magazine accounting questions in section 7. Questions 1 and 4 block App flow
   sections 4, 5 and 11.
3. Decide whether to ask the other AI for Batch 10 part 2 and the other top-ups in section 5.

Decided sequence from here: review rounds 3 and 4 → build the filter sheet → answer the four
pending questions → restructure the design document → write the App flow → update the PRD and
Features List → only then the implementation plan.

---

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
  `PRD_Magazine_Subscription_Management_v4` and report exactly what it says and what it does not.
- When I say "see how any accounting software does it", check how standard accounting software
  (QBO, Tally, Zoho Books) handles it and cite the pages.
- When I explain an accounting effect, I am describing the accounting only, not asking to change
  how the app works. If unsure, ask me before treating it as a design change.
- **Design principle:** the app must leave me free to manage things my own way and leave room for
  the business to change. Do not bind me to strict built-in rules. The fixed parts stay:
  double-entry, audit log, cancel with reversal.
- Stop raising the Invoice Ninja licence key. Only one note stays: ask a lawyer before giving
  away or selling the app.
- Files for this work live in `C:\Users\Admin\Desktop\Book Buddha`. Save handoffs and prompts
  there, not as project files, unless I say otherwise. Inspection output lives in the
  `invoice-ninja-reports` subfolder.

---

## 3. The Invoice Ninja inspection: why, and what exists now

### 3.1 Why we did it

To write the App flow document without inventing hundreds of small screen decisions badly.
Invoice Ninja is a mature invoicing and receivables product that has already made those
decisions and been corrected by real users for years. We harvest everything it does, then filter
each item against decisions I have already made: **Take / Adapt / Skip / Conflict.**

It is a **reference only**. The accounting engine and everything else is built on my own design.
I will not modify its files. Its licence (Elastic License 2.0, read 4 Nov) contains no
reverse-engineering prohibition; QBO's terms do, which is why we never did this with QBO. The
lawyer note before giving away or selling still stands.

### 3.2 The four rounds

| Round | Prompt file | Purpose | Status |
|---|---|---|---|
| 1 | `Prompt - Invoice Ninja full flow and feature extraction.md` | First broad map | Done; largely unusable |
| 2 | `Prompt 2 - Invoice Ninja re-inspection (batched).md` | Data, fields, side effects | Done, 13 batches, **reviewed** |
| 3 | `Prompt 3 - Invoice Ninja UX and daily-use pass.md` | How it feels; exact wording | Done, 10 passes, **not yet reviewed** |
| 4 | `Prompt 4 - Invoice Ninja visual and frontend layer.md` | Colours, type, components, PDFs | Done, 7 files, **not yet reviewed** |

Round 1 failed for specific reasons: it stripped every file path so nothing could be checked,
delivered no flows, summarised lists that had to be exhaustive, and hedged. Round 2 fixed all of
that: repository-relative paths with line numbers, quoted code, and before-and-after tests on a
live Docker instance (`craterninja-app-1`, v5.13.43).

### 3.3 Files on disk

In `C:\Users\Admin\Desktop\Book Buddha\`:
- The four prompt files above, plus `Prompt output.MD` (round 1 result).
- `Inspection summary - what we have and how to use it.md` — **the full briefing: every batch,
  what it gave, and how we use it. Read this rather than re-reading the batches.**
- This handoff, plus the 7 Nov session 2 and session 3 handoffs.
- Stray duplicates of batches 1, 2 and 3 sit at the top level as well as in the subfolder. The
  subfolder copies are the ones to use.

In `invoice-ninja-reports\`:
- `IN-batch-0-conflicts.md` through `IN-batch-12-everything-else.md` (13 files, round 2).
- `IN-ux-0-first-impressions.md` through `IN-ux-9-annoyance-ledger.md` (10 files, round 3).
- `IN-ui-1-tokens-colour-type.md` through `IN-ui-7-visual-summary.md` (7 files, round 4).
- `IN-ux-screenshots\` (39 images) and `IN-ui-screenshots\` (16 images).

### 3.4 What the inspection can never give us

Invoice Ninja has **no chart of accounts, no journal entries, no general ledger, no trial
balance, no balance sheet, no cash flow statement, no financial-year lock, no opening balances,
no inventory valuation method and no challan.** Its "ledger" only logs customer balance
adjustments.

So these are mine to design regardless of how good the map is: the double-entry engine, the
financial-year lock, FIFO costing, opening balances, the challan as a real document, the
per-business stock setting, fair-wise reporting, the write-off, and the per-item Track stock
switch.

---

## 4. Known errors in the round 2 reports (settled; carry these forward)

1. **Stock column name.** Batch 1 says `products.quantity`. Batch 0 and Batch 5 say
   `in_stock_quantity`. **Batch 5 is right**; `quantity` is the default line quantity.
2. **Does cancel restore stock?** Batch 1 says yes in one line. Batch 2, Batch 5 and Batch 0's
   live test all say no. **Batch 1 is wrong.**
3. **Activity-log type numbers.** Batch 1 says invoice-created is type 5, sent is 9 or 10.
   Batch 11 lists the constants and tested it live: **created is 4, updated is 5, mark-sent is
   53.** Batch 11 is right.
4. **Batch 9's P&L expense figures are corrupt** — it printed roughly 4.6 quintillion rupees and
   did not flag it. Treat that run's expense numbers as meaningless. Its revenue figures and the
   accrual-versus-cash finding still stand.
5. **Keyboard shortcuts were contradictory** between Batch 1 and Batch 12, with no evidence on
   either side. Prompt 3 Pass 1 was told to settle this by pressing the keys. **Check whether it
   did.**
6. Batches 5 and 6 claimed "Could not verify: none" where every other batch named something, and
   Batch 8 added an "Architectural Insights and Best Practices" section the prompt had forbidden.
   The standard drifted late in the round.

---

## 5. Things to check or ask for when I resume

### 5.1 Round 3 and 4 evidence concerns, visible from the file listing alone

Claude has not read these reports yet, but three things in the folder listing are worth checking
first:

1. **Several screenshots are byte-for-byte identical in size, which usually means the same image
   was saved under different names.** In `IN-ui-screenshots`: `01-pass1-light-mode.png`,
   `02-pass1-dark-mode.png`, `03-pass2-shell-desktop.png` and `08-pass3-status-pills.png` are all
   127,339 bytes; `06-pass3-button-variants.png`, `07-pass3-form-inputs-states.png` and
   `12-pass4-form-validation-visual.png` are all 103,156 bytes. If light mode and dark mode are
   the same picture, the dark palette was not actually observed. In `IN-ux-screenshots`,
   `13-pass2-search-by-line-item.png` and `14-pass2-filter-dropdowns.png` are both 80,714 bytes,
   and `18-pass3-client-created.png` and `19-pass3-client-overview.png` are both 84,260.
2. **Pass 0 was written after Pass 1.** `IN-ux-1-invoice-creation.md` has an earlier timestamp
   than `IN-ux-0-first-impressions.md`. I had specifically told it to run Pass 0 first, before
   touching anything else, because the first-impressions value is destroyed once it refreshes its
   memory of the product. The pass may still be usable; treat its contents with that in mind.
3. **Round 4's file names do not match the passes it was given, and the files are small.**
   Prompt 4 asked for Pass 4 = forms and money rendering, Pass 5 = icons and motion, Pass 6 =
   printable documents, Pass 7 = accessibility with measured contrast ratios plus a catch-all.
   What came back is: 4 = icons/graphics/empty, 5 = document templates, 6 = theming mechanism,
   7 = visual summary. So **the forms-and-money pass and the accessibility pass may be missing
   or replaced by a summary.** The files also run 8 to 13 KB each, against 17 to 35 KB for the
   round 2 batches, for a prompt that demanded exhaustive values. Verify coverage before relying
   on it.

### 5.2 Top-ups worth requesting from the other AI

1. **Batch 10 part 2.** The settings enumeration, to the original rule: every setting in every
   one of the 26 tabs, with its options and its default, listed individually. It claimed 268
   properties in `CompanySettings` and listed roughly 90. It was also told to split it and did
   not. Those tabs are the reference for my own Settings screens, so this matters. Ready text:

   > Batch 10 part 2. The settings enumeration, done to the original rule: every setting in
   > every one of the 26 tabs, with its options and its default, listed individually. You
   > claimed 268 properties in CompanySettings and listed roughly 90. Enumerate all 268,
   > grouped by the tab they appear in, and name any that exist in the data mapper but appear
   > in no tab. Split it across as many messages as it takes.

2. Depending on what the round 4 review finds: the missing forms-and-money pass, the
   accessibility pass with measured contrast ratios, and genuine separate light and dark
   screenshots.

---

## 6. Confirmed decisions (carried forward, still current)

### 6.1 Direction and build

- The app is a **general accounting app**. It starts blank with no built-in business types. The
  user creates Business 1, Business 2 and so on, and names them. The user sets fields, document
  layouts, numbering, chart of accounts and tags.
- I call it an accounting "SaaS" and refer to it as **"Book Buddha"**. "SaaS" is only my word.
  The confirmed build is a **local web app on one PC**: one program, one database file, screens
  in a browser, mostly one user, offline use preferred. Write "local web app on one PC" in the
  design documents.
- Invoice Ninja is a **reference only** for screens, fields and ideas.
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

### 6.2 Decided 5 Nov

- Optional due date, filled in automatically as 30 days from the invoice date; the user can
  change or clear it. A space for terms or notes on every invoice, quotation and similar
  document.
- Stock reduces only when an invoice is finalised, and a draft shows its quantity as blocked.
  **Now refined by the 7 Nov stock setting below.**
- If an invoice asks for more than the available stock, the app **blocks** it, with a quick
  "Add stock" step.
- Cancelling an invoice reverses the sale and the stock comes back automatically.
- Stock valuation: **FIFO only**.
- Invoice numbers include the financial year and restart at 001 each year (for example
  INV-001/26-27). Each business has its own sequence and its own prefix, set by the user.
- Cancelled invoice numbers are never reused; the cancelled invoice stays visible, marked
  Cancelled.
- Invoice totals are **not rounded**; exact paise are kept.
- Amount grouping (Indian 10,00,000.00 or international 1,000,000.00) is chosen in Settings.
- Each item has a unit from a list the user maintains.

### 6.3 Decided 6 Nov

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
- **Invoices:** editing a finalised invoice is allowed with the old version kept in history. The
  next number appears when a new invoice screen is opened and is used up when the invoice is
  saved, even as a draft (a deleted draft leaves a gap). Quotations and payments each have their
  own number sequence per financial year. Financial year lock: yes (once finalised, only Admin
  can correct entries). Autosave of drafts: yes. Extra charges, lump-sum discount, price history
  by date, PO number with a reuse warning, internal staff-only notes: all yes. Bulk actions on
  the invoice list: yes, plus Excel export of the list; delete stays Admin-only; bulk "Mark
  paid" asks once for date and method.
- **Tax:** optional, the Invoice Ninja way adapted for India: the user creates tax names and
  rates, applies them per item line, chooses inclusive or exclusive, with a tax-exempt option
  and an optional GSTIN on customers. This replaces "no tax fields for now".
- **Reminders:** the full reminder functionality Invoice Ninja offers, with the A/R aging report.
  Email sending is optional (needs internet and an email account in Settings).
- **Import:** both real Excel (.xlsx) and CSV. **Opening balances:** Excel import plus a simple
  screen to type them, and the user can create an account with its opening balance.
- **Backup:** the user chooses what to include (everything, or database only).

### 6.4 Decided 7 Nov

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

### 6.5 Transactions, features and reports

- Invoices, bills, payments received, bill payments, day-to-day expenses, stock purchases and
  adjustments. Basic inventory.
- Custom fields (user-named, no limit), notes, customer details. Export to Excel, CSV and PDF.
- Reports in v1: Profit and Loss, Balance Sheet, A/R and A/P aging, Inventory Valuation Summary,
  Sales by item, General Ledger and Trial Balance, Cash Flow Statement. Each viewable per
  business, combined, and fair by fair.

### 6.6 How the magazine business works (my explanation, 6 Nov)

- The vendor issues a quote first, converted to an invoice when accepted. For subscription
  customers the invoice is for the full year.
- Magazines and journals are received from the supplier as each issue arrives and handed to the
  customer as they arrive. Nothing is held in stock.
- Details are in the project file `PRD_Magazine_Subscription_Management_v4` (v4.2, 30 Sep 2026):
  four billing models (Subscription prepaid, Credit, Retail, Order-based), two users, one PC.
  Verified earlier: one invoice for the period, a challan for each supply, and a settlement
  statement at period end; challans apply only to subscription customers; credit customers are
  invoiced weekly or monthly after supply; the words "stock" and "inventory" do not appear in it.

---

## 7. Pending questions (nothing here is decided)

1. **Cost of the books sold (items with Track stock: Yes). Waiting for my answer since 7 Nov.**
   - A. Book the cost at the same moment the stock leaves, so it follows the Settings, Stock
     choice: at the challan with the challan way, at invoice finalisation with the invoice way.
     (Claude's opinion, no source searched for it.)
   - B. Always book it when the invoice is finalised, as decided on 5 Nov. With the challan way,
     stock would leave at the challan and the cost would be booked later.
2. **Cost of magazines (no stock):** booked when the supplier's bill arrives, or when the
   magazine is delivered to the customer? The PRD (section 4.10) takes cost as quantity
   delivered times purchase cost.
3. **Credit customers:** the PRD bills them weekly or monthly based on what was supplied, so the
   amounts change each cycle. How should that cycle invoice be built, and how does it relate to
   the recurring invoices feature? (Partly informed now: Invoice Ninja's recurring engine has an
   interlock that skips generation when an earlier child invoice is still unpaid — Batch 6.)
4. **Linking a challan and an invoice:** can one invoice be created from one or several challans,
   and what happens when only part of a challan is invoiced? (The no-double-counting rule is
   already decided; this is about how the link works.)

**Questions 1 and 4 block App flow sections 4, 5 and 11.**

**Possibly no longer needed:** the partial payment example (invoice 10,000, receipts 6,000,
delivered 3,000, and what sits in unearned revenue). Because the user manages unearned revenue
with his own accounts and entries, the app may not need to decide it.

---

## 8. Other open items (not mine to settle alone)

- Ask my CA how revenue and cost apply to me as a reseller of magazines (full sale, or only my
  margin). The sources found describe a publisher selling its own magazine.
- Buyers' personal data: Claude cannot confirm which rules apply. India's DPDP Rules 2025 start
  in stages and sources differ on the date (13 or 14 May 2027). Check with a lawyer before giving
  the app to others.
- Ask a lawyer before giving away or selling the app.
- GST: my magazine PRD records "GST: Exempt" as my stated scope. Claude cannot confirm my GST
  position.

---

## 9. App flow document (not created yet)

**Format (approved):** numbered steps, a simple diagram for each flow, and what happens on every
tap.

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

**Documents still to restructure** (all outdated for the generic-core direction):

- Design document, Draft 1 (approved 1 Nov): https://claude.ai/artifact/GMKkJ1j4ChRB3igrAbj9yH
- PRD v0.1: https://claude.ai/artifact/JAYjDq7GtqA7yuSMTThjin
- Features List v0.1: https://claude.ai/artifact/Ds8fKdPmsVpt2Rg8gQ5osU

---

## 10. Next steps

1. Claude reads and reviews the round 3 reports (`IN-ux-0` to `IN-ux-9`) and the round 4 reports
   (`IN-ui-1` to `IN-ui-7`), judging evidence quality and flagging conflicts with my decisions.
   Start with the three concerns in section 5.1.
2. Decide which top-ups in section 5.2 to request, if any.
3. **Build the filter sheet:** every item the inspection returned, marked Take / Adapt / Skip /
   Conflict against my settled decisions. This is the thing that turns about 500 KB of reports
   into a design. Claude has offered this three times and it is still not made.
4. Answer the four pending magazine accounting questions (section 7).
5. Restructure the design document for the generic core and all decisions.
6. Write the App flow sections one at a time, each approved by me.
7. Update the PRD and Features List with the final decisions.
8. Only after I approve everything, write the implementation plan (writing-plans skill). Nothing
   is built before that.
