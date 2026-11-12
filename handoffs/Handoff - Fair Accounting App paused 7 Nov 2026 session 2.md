# Handoff – Fair Accounting App (paused 7 Nov 2026, session 2)

Paste or share this at the start of a new chat in the Billing Project so we can continue without repeating anything. It replaces the earlier handoffs (31 Oct, 1 Nov, 2 Nov, 4 Nov, 5 Nov, 6 Nov, 7 Nov first session) where they differ.

## 1. Where we stopped

We are in the **superpowers brainstorming** process. Nothing is built, and nothing is built until you approve the full design and the implementation plan.

- On 7 Nov (second session) we settled the four pending magazine accounting questions and then wrote and approved **all ten sections of the design document** in chat, one at a time.
- The ten sections are assembled in **Design Document, Draft 2** (link in section 6). **You have not yet said whether you approve Draft 2 as a whole.** I asked twice; the question is still open.
- The tests are written separately in **Testing.md** (16 tests, in section 6).
- You will resume with the **App flow document** in the next session. It has not been created yet.

Resume by asking one short question: do you approve Design Document Draft 2, or do you have changes? Then start the App flow, section 1.

## 2. How to work with me (your instructions)

- Keep answers short and give one step at a time; confirm before moving on. When I say "in brief", answer in a few lines.
- Always tell the truth, cite real sources for factual claims, and say "I cannot confirm this" when something cannot be verified. No guessing.
- I am a finance professional with a no-code background and limited AI knowledge (I am not an engineer), so guide accordingly.
- Use the superpowers brainstorming skill for planning. Do not start building until the design is approved.
- Put the full content of a section in the message itself. End long drafts with a plain-text question, not a tappable question card.
- When I paste another AI's answer, check it against real sources and tell me what is verified and what is not.
- Ask questions in **sets of 5**, one decision per question, no sub-questions, with lettered options (A, B, C). I answer like "1A, 2B, 3C". (During the design sections we went one question at a time; either is fine, follow what I ask for.)
- When I ask "what is suggested as per accounting logic?", search for sources, cite them, label any opinion as opinion, and say what could not be confirmed.
- When I say "go the Invoice Ninja way", check Invoice Ninja's documentation, tell me what it does, and flag any conflict with my earlier decisions.
- When I say "check what the magazine PRD says", read the project file PRD_Magazine_Subscription_Management_v4 and report exactly what it says and what it does not say.
- When I say "see how any accounting software does it", check how standard accounting software (for example QBO, Tally, Zoho Books) handles it and cite the pages.
- When I explain an accounting effect, I am describing the accounting only, not asking to change how the app works. If unsure, ask me before treating it as a design change.
- **Design principle:** the app must leave me free to manage things my own way and leave room for the business to change. Do not bind me to strict built-in rules. The fixed parts stay: double-entry, audit log, cancel with reversal.
- **New on 7 Nov:** once all sections and documents are approved, write the implementation plan with the writing-plans skill, **in very, very great detail**, so it can be built one step at a time with as few bugs as possible.
- Stop raising the Invoice Ninja licence key. Only one note stays: ask a lawyer before giving away or selling the app.

## 3. Confirmed decisions

The full list is in Design Document Draft 2, sections 1 to 3, 5 and 6. Short version:

### 3.1 Direction and build

- A **general accounting app**, "Book Buddha" (my understanding: the name of our app; I could not find a product by that name online). "SaaS" is only my word. The confirmed build is a **local web app on one PC**: one program, one database file, screens in a browser, mostly one user, offline use preferred.
- It starts blank. I create Business 1, Business 2 and so on, and name them. I set fields, layouts, numbering, chart of accounts and tags.
- Fixed and not switchable: double-entry (debit and credit filled in automatically, books always balance), audit log, cancel with reversal.
- No hardcoded special rules: the school incentive and the subscription year-end settlement are entered by me as ordinary expenses and entries.
- Book Fair is a tag attached to any entry in any business. Reports can be viewed fair by fair.
- QBO and Invoice Ninja are references only. The accounting engine and everything else is our own design.
- Non-accountant users, ease of use is the main goal. English only, INR, a financial year setting.

### 3.2 Company, login, phases

- A company holds one or more businesses. **One database file per company** (re-confirmed 7 Nov), every entry tagged with its business. One company per install in v1. One shared chart of accounts. One backup covers the whole company.
- **Phase 1:** Admin only; Admin is the only full-access role; only Admin can delete. **Phase 2 (designed later):** invoicing-only users on other devices on the same network; they can only cancel invoices, never delete.
- Login: Google sign-in only at first-time setup and password recovery; daily login uses a password set in the app (offline). Password at least 8 characters with letters and numbers. Lock for 15 minutes after 5 wrong tries. Forgotten password: sign in with the same Google account, then set a new one (needs internet). Automatic sign-out after 1 hour of no use, with a 1-minute warning and a "Stay signed in" button. Autosaved drafts stay saved.
- Every action is logged in a read-only audit log.

### 3.3 Fairs, customers, items, stock

- A fair is linked to a host customer. Each fair invoice belongs to one fair and is part of the overall books. Fair buyers pay at once by UPI or Cash. Buyer name and one contact (email or WhatsApp) are optional, stored on that invoice only.
- Customers: duplicate names warned but allowed; up to 2 contacts by default; separate Billing and Shipping addresses with a copy button; app-given customer number with a prefix I define; optional classification dropdown (Individual, Business, Company, Partnership, Trust, Charity, Government, Other); attached files (PDF, JPG/PNG, Word, Excel, CSV, up to 20 MB each); customer statements.
- Items: a unit from a list I maintain; "Track stock: Yes/No" (books Yes, magazines No); switching to No is blocked while stock remains.
- One setting per business decides which document reduces stock: the challan when issued, or the invoice when finalised. A linked challan and invoice never reduce stock twice. A document asking for more than the available stock is blocked, with a quick "Add stock" step. FIFO only.

### 3.4 Documents and money

- Invoices, quotations (convertible to invoices), credit notes, challans, recurring invoices. Invoice numbers include the financial year (for example INV-001/26-27), one sequence and prefix per business; quotations and payments have their own yearly sequences. The number appears when the screen opens and is used up on save, even as a draft. Cancelled numbers are never reused.
- Optional due date, filled in as 30 days from the invoice date (changeable or clearable). Terms and notes space, internal staff-only notes, extra charges, lump-sum discount, price history by date, PO number with a reuse warning. Totals not rounded. Amount grouping (Indian or international) chosen in Settings.
- Editing a finalised invoice is allowed with the old version kept in history. Drafts autosave; leaving an unfinalised draft shows a warning every time. Financial year lock: once finalised, only Admin can correct entries.
- Bulk actions on the invoice list (all Invoice Ninja options plus Excel export; delete Admin-only; bulk "Mark paid" asks once for date and method).
- Payments: editable method list (Cash, Bank Transfer, UPI, Cheque, Other); one payment can be split across several invoices of the same customer; overpayment kept as customer credit. Refunds, sales returns and bad-debt write-off are in v1.
- Tax is optional (my own tax names and rates, per item line, inclusive or exclusive, tax-exempt option, optional GSTIN on customers). Reminders as Invoice Ninja does, with the A/R aging report; email sending and bulk email are optional and need internet and an email account in Settings.
- Import: real Excel (.xlsx) and CSV. Opening balances by import or a typing screen. Backup: I choose what to include (everything, or database only).
- Reports in v1: Profit and Loss, Balance Sheet, A/R and A/P aging, Inventory Valuation Summary, Sales by item, General Ledger and Trial Balance, Cash Flow Statement; per business, combined, and fair by fair.

### 3.5 Decided on 7 Nov (second session)

- **Cost of books sold (Track stock Yes):** booked when the books leave (option A). You described the accountant's treatment of an advance invoice and said it answers this: invoice raises receivable and unearned revenue; each delivery moves unearned revenue to sales; cost of goods sold and inventory move at delivery.
- **Magazine cost (no stock):** booked when the supplier's bill arrives, or when I enter the stock details.
- **Credit customers:** an ordinary sale on credit, with the payment recorded when received. No challan-first flow for them. (The magazine PRD matches this.)
- **Challan:** the invoice is always made first; each delivery gets a challan that notes how many items from that invoice were delivered. **In v1 each challan belongs to one invoice**; a challan covering several invoices is kept for a later version.
- The partial-payment example (invoice 10,000, receipts 6,000, delivered 3,000) is dropped: the app does not decide what sits in unearned revenue; I handle it with my own accounts and entries.
- Unearned revenue (magazine subscriptions) stays user-managed: my own accounts (including a liability account), items linked to the account they post to, a simple entry screen for moving amounts between accounts, and an optional repeat template. Nothing is automatic until I create one.

## 4. App flow document (not created yet) – resume here

**Format (approved):** numbered steps, a simple diagram for each flow, and what happens on every tap. Written one section at a time; I approve each; no whole-document draft.

**Section list (12)**

1. **First-time setup** (approved on 1 Nov; **step 1 needs updating**: Google sign-in only at setup and recovery, then I set a password in the app; also company, business with address, logo and invoice prefix, chart of accounts, optional Excel import)
2. **Daily login** (now settled: password, 15-minute lock after 5 wrong tries, 1-hour sign-out with warning)
3. **Home screen** (earlier draft, not approved; must be rechecked)
4. **Normal invoice, outside a fair** (earlier draft, not approved; needs: number shown on open and used on save, autosave and exit warning every time, 30-day due date, terms and notes, internal notes, extra charges, lump-sum discount, price by date, PO number, optional tax, stock rules and the per-business stock setting, bulk actions)
5. **Everyday books:** customers, items (Track stock), bills, payments, expenses, stock; also quotations, credit notes, challans, recurring invoices, refunds, returns, bad-debt write-off, customer statements, reminders, the entry screen for moving amounts between accounts, repeat templates
6. **Import from Excel**
7. **Reports**
8. **Backup and restore**
9. **Create a fair**
10. **Invoice at a fair**
11. **Cancel an invoice** (stock comes back automatically)
12. **End of fair** (the incentive is entered by me as an ordinary expense, plus a stock adjustment if books are handed over)

**Earlier draft of section 3, Home screen (not approved):** opens on the last business used; business selector at top (a business or All businesses); **+ New** list (Invoice, Bill, Payment received, Bill payment, Expense, Stock purchase, Stock adjustment); three summary boxes in plain words (Money to receive, Money to pay, Sales this year); Open fairs list with a Create fair button; Recent entries (last 10); Menu (Customers, Items, Fairs, Reports, Import, Backup, Settings, Sign out). Rewrite it against the final decisions before showing it.

## 5. Open items (not decided)

**Not mine to confirm (CA or lawyer)**

- Buyers' personal data: I cannot confirm which rules apply. India's DPDP Rules 2025 start in stages and sources differ on the date (13 or 14 May 2027). Check with a lawyer before giving the app to others.
- GST: the magazine PRD records "GST: Exempt" as my stated scope. I cannot confirm my GST position. Tax in the app is optional.
- Ask my CA whether, as a reseller of magazines, I book the full sale or only my margin. The sources I found describe a publisher selling its own magazine.
- Ask a lawyer before giving away or selling the app.

**To be settled in the implementation plan:** which database and tools to use; how PDFs are made without internet; how the accounting entries follow an edit of a finalised invoice.

**Kept for a later version:** one challan covering several invoices.

## 6. Documents

- **Design Document, Draft 2** (all ten sections, approved in chat; whole-document approval pending): https://claude.ai/artifact/9m2T3HjzPX754EjeWPMvZg
- **Testing.md:** 16 tests (books balance, known-answer, cancel, stock, challan, credit sale, correction, numbering, edit and lock, fair-wise, audit, login, import, backup, offline, Phase 2 role and two-device test), plus the three pre-build questions. Sent as a file in this chat; add it to the project files.
- Design Document, Draft 1 (superseded): https://claude.ai/artifact/GMKkJ1j4ChRB3igrAbj9yH
- PRD v0.1 (outdated, to be updated): https://claude.ai/artifact/JAYjDq7GtqA7yuSMTThjin
- Features List v0.1 (outdated, to be updated): https://claude.ai/artifact/Ds8fKdPmsVpt2Rg8gQ5osU
- Magazine PRD v4.2 and the earlier handoffs: in the project files. Add this handoff, Testing.md and Draft 2 to the project files too.
- Sources for the design are listed in section 10 of Draft 2. I did not reopen them on 7 Nov. They are vendor, help or community pages, not accounting standards or Indian rules.

## 7. Next steps

1. Ask whether I approve Design Document Draft 2 (or what to change).
2. Write the App flow sections one at a time, starting with section 1, each approved by me.
3. Update the PRD and Features List with the final decisions.
4. Write the implementation plan with the writing-plans skill, in very great detail, for my review.
5. Only after I approve everything, start building, one step at a time.
