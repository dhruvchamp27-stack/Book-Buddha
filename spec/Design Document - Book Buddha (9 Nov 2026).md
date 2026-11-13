# Book Buddha — Design Document

*Restructured 9 November 2026. Local web app on one PC. **Spec stage — nothing is built.** Replaces Design Document Draft 1 (1 Nov 2026).*

> **Status note.** Sections 1–5 were written and **approved** in the 9 Nov (session 3) chat. Sections 6–20 are **first drafts for your review** — read them and bring back changes, queries, or approval next session. All five previously-OPEN items are now closed (stock tracking, subscription/M4, date tokens, archive, report builder); only CA/legal items remain (Section 20).
>
> **12 Nov 2026 update (reconciled into the body, not appended):** Section 5 (Customers) written; the **Fair → Project** model reconciled through §1–§13; fair-tagged stock (decision 1A) folded into §6/§10; the **7 accepted settings** added to §17; **bank-import + OCR** placed in the v2 list (§1.5); data-entry accelerators in §7.8; no per-fair Balance Sheet (§12.1); the earlier QBO-mapping appendix **dissolved into the relevant sections**.

---

## Section 1 — Purpose & scope

### 1.1–1.3 Core idea
A general-purpose, **double-entry** accounting app, run as a **local web app on one PC** (one program, one database file per company, browser screens, mostly one user, offline preferred). The user is a **non-accountant**; the app does the accounting automatically and **ease of use is the main goal**. It **starts blank** — you create and name businesses, set your own fields, layouts, numbering, chart of accounts and tags. A Book Fair is just one kind of **Project** — the app's generic, customer-linked dimension — so nothing is hardwired to book fairs. The only fixed parts are **double-entry, the audit log, and cancel-with-reversal**; everything else bends to how you work.

### 1.4 In scope for v1 (Phase 1 — Admin only)
- Company → businesses → shared chart of accounts, tagged by business
- Accounting engine: double-entry, posting, FY lock, opening balances
- Customers, items & basic inventory — with per-item stock tracking (Track stock Yes/No), a duplicate-check key (e.g. ISBN), MRP, and per-supplier purchase pricing
- Documents: invoices, quotations, credit notes, challans, recurring invoices, bills/expenses, POs
- Payments & money: methods, split allocation, overpayment/credit, refunds, returns, write-off
- **Projects / Fairs** (first-class, customer-linked; create, host customer, fair invoicing, buyer details)
- Subscriptions & deferred revenue: advance invoicing, delivery-driven revenue recognition via challans, and a period-end variance / settlement engine
- Reports: the fixed set (per business, combined, project/fair by fair) plus a simple report builder
- Tax (optional, India-adapted), line-item date tokens, custom fields, tags, notes
- Data-entry accelerators: inline math in amount/qty fields, fast date entry, keyboard shortcuts, transaction attachments (Section 7.8)
- Import (.xlsx, CSV) / export (Excel, CSV, PDF) / backup
- Login, audit log + technical error log, Settings

### 1.5 Out of scope / deferred
- Phase 2: invoicing-only users on other devices, tablet-at-fair use (begins once the Admin MVP is working)
- More than one company per install; online/multi-customer SaaS; gateways, live bank feeds, portal, e-invoicing
- Archive as a third record state (v2)
- The full pivot / group-by-3 / custom-field report builder (v2 — v1 ships the simple builder)
- Shared/centralised book catalogue across businesses
- **Bank transactions via PDF import + OCR** (offline, QBO-style, no live bank feed) — **v2**
- **OCR capture** to avoid re-keying stock / bills / expenses — **v2**
  - *Caveat:* reliable OCR of varied PDFs usually needs a **cloud service (internet)**, which rubs against offline-first; offline OCR (e.g. Tesseract) works but is weaker on tables. For v1, **Excel/CSV import** (§14.1) is the bulk-entry path.

### 1.6 Open items
No design-level items remain open. The only outstanding items need your **CA** (principal-vs-agent and GST on magazine resale) or a **lawyer** (buyers' personal data; giving away/selling the app) — listed in Section 20.

### 1.7–1.8 What it is not / constraints
Not a hosted SaaS; QBO and Invoice Ninja are **references only**. English only · INR · configurable financial year · offline-preferred · one PC.

---

## Section 2 — Core principles & the two phases

### 2.1 The three fixed parts (these never bend)
1. **Double-entry, automatic.** Every transaction posts balanced debits and credits behind the scenes. You never type a debit or credit, and the books always balance.
2. **Audit log.** Every action that changes data is recorded — who, what, when — in a read-only log, from day one. It is tamper-evident: each entry carries a hash of the one before it, so any later change or deletion breaks the chain (Q9).
3. **Cancel with reversal.** Issued/posted documents are never erased — only cancelled. Cancelling reverses the accounting (and stock) exactly and leaves the document visible, marked Cancelled; a cancelled number is never reused. Deleting is limited to things with no accounting effect (e.g. an unissued draft) and is Admin-only.

### 2.2 The design philosophy (everything else bends to you)
- **Generic, not industry-specific.** Starts blank, no built-in business types. You set your own fields, layouts, numbering, chart of accounts and tags. "Book Fair" is just one kind of Project (§3.3).
- **No hardcoded special rules.** Where a genuine accounting *pattern* recurs — such as deferred revenue on advance sales — it's offered as a generic, configurable capability (a per-invoice setting, linked accounts, challans), not a special "magazine" mode. One-off arrangements, like the school incentive, stay as ordinary entries you make yourself.
- **Easy for a non-accountant.** Plain-language screens, few steps, the accounting handled underneath. A normal user never sees deferral, debits/credits, or machinery they don't need.
- **Local and offline-first.** One program, one database file per company, browser screens on one PC. Internet only for optional things (Google sign-in at setup/recovery, optional email).

### 2.3 Phase 1 — build first (Admin only)
- One full-access role: **Admin**. Only Admin can delete (and only where no accounting is affected).
- Everything in Section 1.4 — engine, all documents, payments, projects/fairs, subscriptions, reports, import/export/backup, tax, settings, audit log.
- Single user, one PC.

### 2.4 Phase 2 — in detail (begins once the Phase 1 Admin app is a working, accepted MVP)
**Purpose:** let extra people help with **invoicing** — especially at a fair — from their own devices, without giving them the books.

**Decided for Phase 2:**
- A second role, **Invoicing-only user**, each with their own login.
- They can **create** invoices and **cancel** them (cancelling reverses the sale and returns stock, as always); they can **never delete** anything.
- They see **only fairs and invoicing** — not the chart of accounts, reports, settings, other businesses' books, or money screens beyond what invoicing needs.
- They work from **other devices on the same local network**, including a **tablet at the fair**; the device opens the PC's address in its own browser.
- Access is enforced at the **data level**, not just hidden on screen — their queries are scoped so they can only ever reach their permitted fairs and invoices ("view assigned only").
- The **audit log** already attributes every action from Phase 1, so each invoicing-only user's actions are tracked with no rework.
- **Acceptance tests:** a **role test** (cannot open the books, see other businesses, or delete anything) and a **two-device test** (PC and a second device on the same data without clashes or lost invoices).

**To be designed when Phase 2 starts (not decided now):** the invoicing-only user's own login/recovery flow; the exact permission matrix (view/create/edit/cancel per screen); the tablet/touch layout (larger touch targets, Save & New); how a device reaches the PC over the network, and what happens if the connection drops mid-invoice (unsaved work preserved).

---

## Section 3 — Company → businesses → Projects (Fairs) → chart of accounts

### 3.1 Company (the top container)
- **One company per install** in v1. The company holds the chart of accounts, all its businesses, the audit log and the backup.
- **One database file per company**; **one backup** covers the whole company.

### 3.2 Businesses
- A company holds **one or more businesses**, which you create and name (e.g. "Books", "Magazines").
- **Every transaction and record is tagged to exactly one business** — on the **whole entry** (header and detail), so a business can carry even a Balance Sheet (the QBO *Location* pattern, not the weaker *Class* one).
- Businesses **share the company's one chart of accounts**, but each keeps its **own document numbering sequences and prefixes** (e.g. `INV-001/26-27`, `MAG-001/26-27`).
- Reports run for **one business**, or **combined** across all businesses.

### 3.3 Projects (Fairs) and tags — two different things
- A **Project** is a **first-class dimension**, QBO-style: it is **tied to one customer**, invoices and costs **belong to it**, and it carries **its own P&L**. The whole books can be viewed **project by project** (fair by fair). A **Book Fair** is the primary **type of project** (full detail in Section 10); the app stays generic, so a project can be any job or event. On screen it is called a **Fair**.
- **Tags** are a separate, **lighter** system: free labels you create (name + colour, shown as pills), attachable to **any entry in any business** and filterable across the app — for cross-cutting slices that are *not* a project (e.g. a campaign, a season). A Book Fair is a **project**, not a tag.
- A record carries **one business**, optionally **one project (fair)**, and **any number of tags**.

### 3.4 Chart of accounts
- **One chart of accounts, shared** by all businesses in the company.
- At setup you **preview and pick a ready-made set**, or **build your own**.
- Add or rename accounts any time — including the **liability accounts** the subscription handling uses (e.g. **Unearned Revenue**). Items can be **linked to the accounts they post to**.
- A **shared pool**: an account can be used by every business or just one. Combined company reports add up cleanly; the business tag keeps each business separable.

### 3.5 How it fits together
Every entry carries its **business**, its **accounts** (via automatic double-entry), optionally its **project (fair)**, and any **tags**. Any report can be sliced by business, by project (fair), by tag, or combined (Section 12).

---

## Section 4 — The accounting engine

### 4.1 Double-entry, automatic
Behind every action the app writes a **balanced journal entry** (debits = credits). You never see or type debits and credits unless you open the ledger. A save that wouldn't balance is rejected.

### 4.2 Draft vs posted — when things hit the books
- A **draft posts nothing** (no effect on balances, P&L, or stock — a draft only *reserves* stock, per Section 6).
- **Finalising/issuing** posts it: an invoice posts the sale, a bill the purchase, a payment the receipt, a **subscription-linked challan** the delivery recognition + COGS. A **standalone challan posts nothing**.
- Posting is **all-or-nothing**.

### 4.3 The general ledger — the single source every report reads
- Every posting lands in the **general ledger** stamped with date, **business**, **project (fair)**, accounts, amounts, any **tags**, and the source document — the business and project are carried on the **whole entry** (header and detail).
- **All reports** read from these same postings, so every report agrees and traces back to a document. Because each posting carries its business and project on the whole entry, **every report (P&L included) can be sliced project by project (fair by fair)**, and a Balance Sheet can be sliced by business — without QBO's header/detail limitation.

### 4.4 Cancel & edit
- **Cancel:** posts the **exact reverse** (and returns stock), marks the document **Cancelled**, keeps it visible; number never reused.
- **Edit a finalised document:** allowed, with the **prior version kept in history** for audit; the correction keeps the books balanced.
- **No hard delete** of posted records.

### 4.5 Cash vs accrual
The engine records on an **accrual** basis. Reports can be shown on **cash or accrual** (Q3 = both): accrual reads postings directly; **cash** derives revenue/expense from **actual payment allocations**. You choose the basis on the report.

### 4.6 Financial year & the FY lock
- The **financial year is configurable per business** (e.g. 1 Apr – 31 Mar).
- Numbering **resets each financial year**, per document type.
- **FY lock:** once a year is finalised its entries are **locked**; only **Admin** can make a correction into a locked period.

### 4.7 Opening balances
- Enter them by **Excel import** or a **simple typing screen**; you can also create an account and set its opening balance directly.
- Opening balances must **balance**; a standard **Opening Balance Equity** account holds any difference until everything is entered.

---

## Section 5 — Customers

### 5.1 What a customer holds
Required: **Customer name** and **Classification** (starts unselected — Individual, Business, Company, Partnership, Trust, Charity, Government, Other). A separate **numbering-category** dropdown — **SCH** (schools), **LIB** (libraries), **CLG** (colleges), **RET** (retail), **GEN** (everyone else) — gives each customer an independent auto-number from `0001`; numbers are app-given, never hand-edited. Optional: **GSTIN**, website, **one** customer email, **up to two** contact people (one phone each), **Bill To** / **Ship To**, and **staff-only Internal Notes**. Defaults: country India, phone code +91, currency INR, language English. (No third general phone, no separate contact emails.)

### 5.2 Addresses
Exactly **one Bill To** and **one Ship To**. A small **copy button** copies the whole billing address into shipping; shipping then stays **independently editable**. Issued documents keep the address saved on them; later edits apply to new documents and are kept in audit history (old/new, who, when).

### 5.3 Saving a customer does nothing else
Saving a profile **only** creates the record — never a subscription, opening balance or payment. **Every retail buyer gets their own record** (no shared "Walk-in Customer"). A prospective customer uses the same normal record, from quotation onward.

### 5.4 Duplicates (warn, don't block)
On a likely duplicate (matching name / phone / email / GSTIN) the app **warns and suggests** the existing customer but lets you continue — the same "warn but allow" rule as items (§6.6).

### 5.5 Merge (Q2)
A **merge tool** folds a duplicate into a primary customer: pick primary + duplicate → **preview both** → transfer **all** invoices, payments, credit notes, advances, quotations, attachments, notes and history → you resolve any contact / custom-field conflicts → the **combined balance is recalculated**. It **merges identities, not transactions**: it never creates or alters an accounting entry — original IDs, dates and document numbers are kept — the old ID stays as an **alias/redirect**, every step is **audit-logged**, and an **undo** is offered while safe. (Permission check, confirmation and concurrency safeguards apply.)

### 5.6 Customer credit — one figure, two ledgers (Q1)
A customer shows **one combined credit balance**, held underneath in **two separate ledgers**: (1) **Customer Advances / Excess Payments** (a cash liability) and (2) **Credit Notes / Sales Returns & Allowances**. (Mechanics in §9.3.)

### 5.7 Customer page — tabs & statements
Five tabs: **Invoices, Quotations, Payments, Documents, History/Activity**. (A financial-summary panel is **pending** — not yet designed.) A customer can be issued an **account statement** (transactions, balance, receivables aging), exportable to PDF/Excel.

### 5.8 Attachments
Per customer, under **Documents**: PDF, JPG/PNG, Word, Excel, CSV; **max 20 MB/file**. Removal is confirmed; linked PO history is preserved.

### 5.9 Directory (the customer list)
Search by **name, number, phone, email or GSTIN**; sort; **Active/Inactive** filter; column reorder / resize / show-hide with **shared saved preferences** and **Reset columns**. Default columns: Customer Number, Name, Classification, Phone, Email, Status. Page sizes **25 / 50 / 100** (default 25). **Bulk Inactive** is allowed; **bulk delete is not**. A single customer can be deleted **only if it has no linked documents or transactions** — no cascading financial deletion. **Payment terms** live on each quotation/invoice, not on the customer.

### 5.10 Not included (Invoice-Ninja controls dropped)
Client portal, Group, Assigned User, ID Number, VAT fields, Routing ID, Tax-Exempt controls, Company Size, Industry, Public Notes, Quote-Valid-Until, Task Rate. *(App-wide tags per §13.3 can still attach to a customer.)*

---

## Section 6 — Items & stock

### 6.1 What an item holds
Name/key, description, **unit** (from a user-maintained list), **selling price**, **cost**, **MRP**, **Track stock (Yes/No)**, **linked accounts**, reorder/low-stock threshold, image, custom fields (any of which can be a **duplicate-check key**, e.g. ISBN), and a **per-supplier purchase price list**. Only the name is mandatory. A **"Save & Add Another"** option supports bulk cataloguing.

### 6.2 Track stock — per item, your free choice (QBO Inventory vs Non-inventory)
- Each item is **Track stock = Yes** or **No**; you decide per item and can change it later. Nothing is tied to a business or item kind.
- **Switching Yes → No is blocked while stock remains** — reduce to 0 with a stock adjustment first.

### 6.3 Tracked item (Track stock = Yes)
- **Buy** → quantity up, cost sits in the **Inventory asset** (not expense yet).
- **Sell** (stock leaves at the invoice, or at a subscription-linked challan) → quantity down, and the cost of those units (**FIFO**) moves from Inventory asset to **COGS** at that moment.
- **Negative stock is blocked** with a quick "Add stock" step. A **draft reserves** its quantity.
- FIFO cost layers are held per purchase lot (each lot keeps its own supplier + cost).

### 6.4 Untracked item (Track stock = No)
- **No quantity, no asset.** Cost goes to an **expense/COGS account at the purchase bill**; the sale is revenue at the invoice. Profit = revenue − cost, by period.
- A **challan for an untracked item is a non-posting delivery note**.

### 6.5 Who posts (no per-business setting — determined by the document)
- **Direct invoice** (no challan): posts everything — stock + COGS for tracked items; revenue for untracked (cost already at the bill).
- **Subscription-linked challan** (finalised): posts the delivery — recognises revenue and, for tracked items, reduces stock + books COGS.
- **Standalone challan:** posts nothing; a later invoice posts.

### 6.6 Duplicate-check key
Any custom field can be marked a **unique / duplicate-check key** (e.g. ISBN): on a likely duplicate the app **warns and suggests** the existing record, but lets you override (consistent with the customer "warn but allow" rule). Genuinely different editions/formats stay separate records.

### 6.7 Pricing
- **MRP**, **cost** and **selling price** are item fields; **price history by date** applies (a document uses the price effective on its date).
- A **per-supplier default purchase price** (a mini price list) sits alongside the FIFO lots, so each supplier's usual cost is remembered.

### 6.8 Low-stock alert
A **low-stock threshold per item**, with a **business-level fallback** (Q10) — useful before a fair.

### 6.9 Project (fair) stock tagging (decision 1A)
There is **one stock pool** — not a separate bucket per fair. Each **stock movement** (purchase, sale, return) can be **tagged to a project (fair)**, so stock and COGS can be **reported fair by fair** while quantity-on-hand stays a single shared figure. (Used by Section 10.)

---

## Section 7 — Invoices

### 7.1 Fields
Customer (required) + at least one line with a quantity; invoice date (today by default); **due date** (30 days by default, changeable or clearable); **terms/notes** (printed) and **internal staff-only notes**; **PO number** (warns on reuse); custom fields; its **project (fair)** and any **tags**; **Deliver now / Deliver over time** switch (pre-filled by the customer's Subscription flag).

### 7.2 Numbering
`INV-001/26-27` — **per-business sequence and prefix**, **resets each financial year**. The next number **appears when the screen opens** and is **used up when saved, even as a draft** (a deleted draft leaves a gap; with autosave, the number is used at the first autosave).

### 7.3 Drafts & autosave
Autosave is on. Leaving an unfinalised autosaved draft **warns every time** (the draft is saved, its number is used, continue from the Drafts list).

### 7.4 Lines & money
Item + quantity (price fills from the item, editable); **line discount** and a **document-level lump-sum discount**; **extra charges** (name + amount typed, e.g. postage, freight); **optional tax per line**; **date tokens** in line text; MRP shown. **Invoice/quotation totals round to the nearest whole rupee** (≥50 paise up, <50 down); the document shows amount-before-rounding, the round-off adjustment and the final total; **actual receipts keep paise**. **Amount grouping** per Settings. *(Rounding adopted 12 Nov 2026, from Magazine PRD v4.)* Incomplete rows **block the save** (no silent dropping).

### 7.5 Save & posting
Pre-checks run, then an **all-or-nothing** save. A "Delivered now" invoice posts the sale (+ stock/COGS for tracked direct sales); a "Deliver over time" invoice posts to **Unearned Revenue** (Section 11). Short stock is **blocked** with an "Add stock" step.

### 7.6 Lifecycle
Stored statuses: **Draft, Issued, Partial, Paid, Cancelled**; **Overdue/Unpaid** are calculated (no due date ⇒ never overdue). **Edit a finalised invoice** is allowed with the **old version kept**. **Cancel** reverses the sale and returns stock. **Receive payment** sits on the invoice header.

### 7.7 Bulk actions
All the bulk actions Invoice Ninja offers **plus Excel export of the list**; **delete stays Admin-only**; **bulk "Mark paid"** asks once for date + method, then records a proper payment for each.

### 7.8 Data-entry accelerators (app-wide)
Small speed features borrowed from QBO, applied across entry screens (invoices, bills, expenses, and report date filters). *(Added 12 Nov 2026.)*
- **Inline math in number fields.** Any amount or quantity field accepts a calculation — `+ − × ÷` and parentheses, normal precedence — evaluated when you press Tab/Enter or click away (e.g. `500/2` → `250`, `(3*120)+45` → `405`). Basic arithmetic only (no exponents), matching QBO's built-in field calculator.
- **Fast date entry.** Any date field accepts:
  - **Compact numbers in Indian order (DD/MM/YY):** `121126` → 12/11/2026 · `121125` → 12/11/2025 · a 4-digit `1211` → 12/11 of the **current year**. Expanded on Enter/Tab; an invalid date is rejected with a plain message.
  - **Letter keys:** `T` = today, `M` = first day of the current month (extendable).
- **Keyboard shortcuts.** A small, documented set for the common actions — Save, **Save & New**, new invoice/bill, and a help key that shows the list — so routine entry needs no mouse. (Exact keys fixed during the build.)
- **Attachments on transactions.** A bill or invoice can carry an attached file (the scanned supplier bill, a PO, a photo), stored with the record and included in backup (Section 14.3) — useful for audit even without OCR. *(Automatic OCR extraction is a v2 item — Section 1.5.)*

---

## Section 8 — Other documents

### 8.1 Quotations
Statuses: Draft, Sent, Approved, Converted, Rejected, Expired (Expired is calculated from a valid-until date). **Convert to invoice** copies the lines, resets status/dates, and links both ways. Own sequence `QUO-001/26-27`. Option to carry quote terms onto the invoice.

### 8.2 Credit notes
A **separate document** with proper accounting effects and a note. Two phases: **issuance** raises the credit pool; **application** creates a payment of type *Credit* attached to both the invoice and the credit note. The entry screen is **visually distinct from an invoice** to prevent mis-entry.

### 8.3 Challans (delivery notes)
A **real document**, available in any business.
- **Linked challan** (against a subscription invoice): posts the delivery (Section 11); tracks **delivered vs pending** against the invoice's quantities.
- **Standalone challan:** a plain, non-posting delivery note — **visually distinct** from a linked challan (clear badge, own list filter).
- Print layout: shipping address substituted for billing; unit cost, line totals, taxes and totals block suppressed.

### 8.4 Recurring invoices
Frequencies (monthly, quarterly, half-yearly, annually; a "run forever" option). **Interlock:** generation is skipped if an earlier child invoice is still unpaid. Each child follows the per-item posting and the per-business numbering; **date tokens** write the period into the line text.

### 8.5 Bills & expenses
Payables as **bills**; **bill payments** post to the ledger properly. Expense categories are the **chart of accounts** (not a separate list). Recurring expenses write the period into the note automatically.

### 8.6 Purchase orders
Statuses: Draft, Sent, Accepted, Received, Cancelled. **Received increments stock** (never auto-creating the product). A PO links to a **bill/expense**; it **cannot** convert to a sales invoice.

---

## Section 9 — Payments & money

### 9.1 Methods
An **editable list**, starting Cash, Bank Transfer, UPI, Cheque, Other.

### 9.2 Allocation
One payment can be **split across several invoices of the same customer**; an invoice can take several partial payments. Overpaying a single invoice line is **blocked**. A one-click "**apply oldest first**" is offered. Checking an invoice row auto-fills its exact balance.

### 9.3 Customer credit — two ledgers, one shown figure (Q1)
Surplus/credit is held in **two separate ledgers** — (1) *Customer Advances / Excess Payments* (cash liability), (2) *Credit Notes / Sales Returns & Allowances* — while the customer shows **one combined credit balance**. You apply or adjust it as needed.

### 9.4 Payment immutability (Q5)
Once saved, **amount and customer are frozen**; editable: date, invoice allocation, method, reference, notes. Corrections are by **reverse-and-re-enter**; the original payment and all changes are preserved.

### 9.5 Refunds, returns, write-off (all v1)
- **Refund** (partial/full): restores the invoice balance and reopens the customer's debt.
- **Sales return:** records returned goods/quantities against the original supply; a paid return may create customer credit; an actual refund needs its own entry.
- **Bad-debt write-off:** a real write-off that preserves invoice/payment/goods history; a later recovery links back to the original.

### 9.6 Deleting a payment
Rolls back every balance it touched; **never force-deletes** in the audited book (archive instead).

### 9.7 Partial / deposit on an invoice (Q6)
Supported, **with its own due date** — relevant to magazine prepayments.

### 9.8 Numbering
Payments use `PMT-001/26-27`, their own sequence per financial year.

---

## Section 10 — Projects (Fairs)

*A **Project** is the app's first-class, QBO-style grouping: tied to one customer, with its own P&L, invoices and costs belonging to it. A **Book Fair** is the primary project type; the concept stays generic so a project can be any job or event. On screen it is called a **Fair**.*

### 10.1 Creating a project (fair)
You **create a fair**, give it a name, and **link it to one host customer** (an ordinary customer — §5). The fair is a **first-class dimension**, not a tag: every entry made in it carries it, so the whole books can be sliced **fair by fair** (P&L and other income/cost views — not a separate Balance Sheet, §12.1).

### 10.2 Fair invoicing
Each fair invoice **belongs to one fair** and is part of the overall books, viewable **fair by fair**. **Save & New** supports fast fair invoicing. Fair buyers pay **instantly by UPI or Cash**; the invoice records the mode.

### 10.3 Buyer details
A buyer's **name and one contact** (email or WhatsApp number) are **optional**, stored **on that invoice only** (not as customers), and used to send the invoice PDF and for future offers. *(Personal-data rules → Section 20.)*

### 10.4 Project (fair) stock & costs (decision 1A)
Stock is **one shared pool** (§6.9) — no separate per-fair bucket. Stock movements (purchase, sale, return) and their COGS are **tagged to the fair**, so a fair's **stock and profit** report correctly without splitting quantity-on-hand.

### 10.5 End of fair — the school incentive
The school incentive is **entered by you** as an ordinary **expense** (plus a **stock adjustment** if books are handed over) — it is **not** an automatic rule.

---

## Section 11 — Subscriptions / magazine handling

*The subscription accounting was verified against AS 9 / Ind AS 115 and accepted. It is delivered as **generic, configurable** behaviour — not a hardcoded "magazine" mode. (QBO can hold deferred revenue only **by hand** and has **no** per-subscriber periods, effective-dated rates or delivery-driven recognition — which is why this engine exists.)*

### 11.1 The posting model (confirmed)
- **Advance invoice** ("Deliver over time"): Dr Accounts Receivable · Cr **Unearned Revenue**. No sales to P&L, no COGS yet.
- **Advance payment:** Dr Cash · Cr Accounts Receivable.
- **Each delivery → a linked challan → finalise it:** Dr Unearned Revenue · Cr **Sales** (delivered portion). For a **tracked** item also: Dr COGS · Cr Stock (FIFO), quantity drops. For an **untracked** item: no stock move; cost already sits as expense from the purchase bill.
- **Standalone challan:** posts nothing. **Direct invoice:** posts everything at once.

### 11.2 How the app knows an invoice is an advance (hybrid)
A per-invoice **"Delivered now / Deliver over time"** switch, **pre-filled by a Subscription flag on the customer**, overridable on any single invoice (so a subscription customer's one-off retail purchase, or a renewal model-switch, is handled correctly). The item carries the **linked Unearned Revenue account** used while deferred. Normal users and normal sales never see any of this.

### 11.3 Recognition mechanisms (both available)
- **Delivery-driven:** finalising a linked challan recognises the delivered portion (the primary mechanism, matching AS 9's "sale value of items delivered" basis).
- **Manual repeat template:** an optional recurring journal template (amount, start/end), QBO-style, for when you'd rather post on a schedule. Nothing posts until you create one.

### 11.4 Challan ↔ invoice link (M4)
- Model: **advance invoice first**, then **one or many challans against it**.
- Cardinality in v1: **one invoice → many challans; one challan → one invoice**. A challan spanning several invoices is a **v2** item.
- The challan tracks **delivered vs pending** against the invoice's quantities; stock/revenue are **never counted twice**.

### 11.5 Price variance (mid-period rate change)
**Price history by date** applies: the **supply-date rate** is used, and earlier supplies keep their rate.

### 11.6 Variance / settlement engine (in v1)
At **period end or early closure**, the engine compares **prepaid received vs delivered value at selling rates** and produces a **settlement statement** in two forms — a **customer-facing narrative** and an **internal per-magazine / per-rate-period table** — exportable to PDF/Excel. Over/under is handled by a **refund**, a **carry-forward** to the next period, or a **balance-due invoice**. Per-customer **subscription periods** are configurable (non-calendar, editable at renewal).
*Sub-decisions to finalise during the build:* exact early-closure behaviour, statement layouts, refund-vs-carry-forward defaults.

### 11.7 Credit customers (M3)
Ordinary **credit sale** — a normal sales invoice, payment recorded when received. No challan-first billing in v1.

### 11.8 For your CA (Section 20)
Principal vs agent (full sale value vs only your margin) and GST classification/timing for the magazine resale.

---

## Section 12 — Reports

### 12.1 Fixed reports (v1)
Profit & Loss · Balance Sheet · A/R aging · A/P aging · Inventory Valuation Summary · Sales by item · General Ledger · Trial Balance · Cash Flow — **plus the accepted additions**: Customer Balance Detail, Open Invoices, Collections, Sales by Customer, Transaction Detail by Account, Transaction List by Date, Inventory Valuation Detail, and a stock / quantity-on-hand report. Each is viewable **per business and combined**; every report **except the Balance Sheet** is also viewable **fair by fair** (decided 12 Nov 2026 — no per-fair Balance Sheet; fair-level reporting stops at P&L, A/R and other income/cost views). A **cash/accrual** choice applies where relevant, and all are **shown on screen** (not export-only).

### 12.2 The Customize panel (every report)
**General** (accounting method, period, number format) · **Rows/Columns** · **Filter** (customer, account, vendor, product/service, **project (fair)**, tags, business) · **Header/Footer**. **Save** a customization and re-run; **group** with subtotals; **schedule by email** (needs internet); **export** to PDF and Excel. A **Refresh** button re-runs the open report against the latest data, and date filters use the **fast date entry** of Section 7.8 (type a compact date — e.g. `121126` → 12/11/2026 — and Enter to re-run the report for that date).

### 12.3 Simple report builder (v1 — Q4 = B)
Pick an **entity**, pick **columns**, **filter**, **group with subtotals**, **export**.

### 12.4 Full report builder (v2 — Q4 = C)
Pivot tables, group by up to 3 columns, and grouping/filtering by custom fields — **deferred to v2**.

---

## Section 13 — Tax, custom fields, tags, notes

### 13.1 Tax (optional, India-adapted)
You create your own **tax names and rates**, apply them **per item line**, choose **inclusive or exclusive**, with a **tax-exempt** option and an **optional GSTIN** on customers. *(GST position → your CA / Section 20.)*

### 13.2 Custom fields
**User-named, no limit**, across invoices, bills, items, customers and reports. Five types: **text, multiline, dropdown, switch, date**. Any field can be a **duplicate-check key** (Section 6.6). *(Managed centrally in Settings — §17.)*

### 13.3 Tags
Name + colour, shown as pills, attachable to many record types, **filterable across the app**. Tags are a **separate, lighter** system from Projects (§3.3): a Book Fair is a **project**, not a tag.

### 13.4 Notes
**Printed** notes/terms on documents, plus **internal staff-only** notes that never print.

### 13.5 Date tokens (Q8)
`:MONTH` / `:QUARTER` / `:YEAR` / `:WEEK` in line text and notes, **resolved on save** (e.g. "Magazine subscription – :MONTH :YEAR" → "…November 2026").

---

## Section 14 — Import / export / backup

### 14.1 Import
Both **real .xlsx and CSV**. **Two-phase**: a pre-import preview (delimiter/encoding auto-detected) then ingestion with a **column map**. Duplicate products **update rather than duplicate**; multi-row invoices are **grouped by document number**; a failed row is **skipped and collected**, the import does not abort. Import maps for customers, items (with stock), **opening balances**, past invoices and bills; **credit notes and opening balances are importable**.

### 14.2 Export
**Excel, CSV and PDF** across lists and reports.

### 14.3 Backup & restore
You **choose the scope** (everything — database, attachments, logo, audit log; or database only), and the backup screen **states plainly what is and isn't included**. **Restore warns** and offers a **pre-restore backup** first, **sanitises** incoming settings, and can **preserve users and counters**.

---

## Section 15 — Login, users & roles

### 15.1 Phase 1 — Admin
- One role, **Admin**, full access; only Admin deletes (no-accounting items only).

### 15.2 Login (settled)
- **Google sign-in** at first-time setup and password recovery; **daily login is an app password** (works offline).
- Password: **≥ 8 characters, letters + numbers**.
- **Lock for 15 minutes after 5 wrong tries.**
- **Forgot password:** sign in with the same Google account, then set a new one (needs internet).
- **Auto sign-out after 1 hour idle**, with a 1-minute warning and a "Stay signed in" button; autosaved drafts stay saved. A session-expiry prompt **preserves typed work**.

### 15.3 Phase 2
Invoicing-only users — see Section 2.4.

---

## Section 16 — Audit log & technical error log

### 16.1 Audit log
Every data-changing action recorded (**who, what, when**), **read-only**, **tamper-evident** via a hash chain (Q9). It covers **settings, tax-rate and product changes** too (unlike Invoice Ninja). Line-item edits are covered by the kept prior document versions.

### 16.2 Technical error log
A **separate developer log** for crashes and failures (PDF, mail, security categories) — not business actions.

---

## Section 17 — Settings

- **Numbering patterns** per document type per business: prefix + financial-year + counter, with **counter padding**, **resetting per financial year** (following the financial year, **not** 1 January — Q11).
- **Financial year** per business.
- **Amount grouping** (Indian `10,00,000.00` or international `1,000,000.00`).
- **Lists:** payment methods, tax names/rates, units, chart of accounts, classification list.
- **Email account** (optional, enables reminders/scheduled reports/bulk email — needs internet).
- **Business identity:** name, address, logo.
- **Low-stock** business-level fallback threshold.
- Navigation is **flat and plainly named** (about 2 clicks to any tab). *(There is no per-business "who reduces stock" setting — posting is determined by the document; see Section 6.5.)*

**Accepted additions (Invoice-Ninja re-inspection, 10 Nov):**
- **Richer numbering tokens** (more prefix / date / counter tokens) and an **optional shared counter** across document types.
- **Central custom-fields management** — define and edit all custom fields (§13.2) in one place.
- **Product defaults:** default **Track-stock** for new items, **show stock qty** on challan/PDF, **low-stock alert** on/off.
- **Date-format choice.**
- **Optional document-lock mode** — lock individual issued documents, alongside the FY-lock.
- **Email detail:** reply-to, BCC, signature, attach-PDF.
- **Bank-transaction rules** — categorisation rules for imported bank data (pairs with the v2 bank import, §1.5).

*(Explicitly skipped as out of scope — client portal, payment gateways, e-invoicing / PEPPOL, group inheritance, payment links / subscriptions, task settings, multi-company tenant, live bank feeds, auto-compounding late fees; see §1.5.)*

---

## Section 18 — Reliability (when things go wrong)

Pre-save checks (block incomplete rows and zero quantities, plain messages); **all-or-nothing** saves; **app-given numbers** with a collision-retry and an atomic save lock (a double-click never makes two invoices); login lockout; import pre-check; **backup/restore with warnings**; a session-expiry prompt that **preserves typed work**; form state that **survives an API/network error**; **negative stock blocked**; a stock **concurrency guard**; and the separate **technical error log** for the developer.

---

## Section 19 — How we verify it works (testing)

- **Books always balance** — every entry balances and the Trial Balance always matches.
- **Known-answer test** — you prepare samples and work the expected figures by hand; the reports must match **exactly**. *Acceptance is your hand-worked figures, not a passing technical test.*
- **Cancel test** — after cancelling, sales, payment and stock return exactly to where they were.
- **Subscription test** — advance invoice sits in Unearned Revenue; each finalised challan recognises the right portion; delivered-vs-pending is correct.
- **Variance/settlement test** — period-end statement matches hand-worked prepaid-vs-delivered figures, including a mid-period rate change.
- **Project (fair) test** — invoices, stock and COGS tagged to a fair report correctly fair by fair, and the overall books still tie out.
- **Audit test** — every action is logged and the hash chain is intact.
- **Import test** — a copy of your real Excel data imports and totals match.
- **Backup/restore test** — restored books show the same numbers.
- **FY-lock test** — a locked year refuses edits except an Admin correction.
- **Duplicate/merge test** — a customer merge moves everything and changes no accounting figure.
- **Phase 2 (later)** — role test and two-device test.

---

## Section 20 — Open items (CA / legal — not decided by the app)

- **CA:** principal vs agent (full sale value vs only your margin) for the magazine resale; **GST classification and timing**.
- **Lawyer:** buyers' personal data (India's **DPDP Rules 2025**, staged start; sources differ on 13/14 May 2027); and before **giving away or selling** the app.
- **GST position:** the magazine PRD records "GST: Exempt" as your stated scope; this is unconfirmed.
- **No design-level items remain open.**

---

*End of design document (v1 draft for review). Prepared with the superpowers brainstorming/spec process. Next after approval: the App flow (12 sections), then the PRD and Features List update, then — only once the spec is confirmed — the implementation plan.*
