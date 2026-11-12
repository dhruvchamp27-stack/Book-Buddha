# Product Requirements Document — Book Buddha

*Local, offline-first, double-entry accounting app for one PC. Rebuilt 12 Nov 2026 to match `Design Document - Book Buddha (9 Nov 2026).md` (source of truth) and `APP_FLOW.md`. Supersedes `PRD – Fair Accounting App (Draft v0.1)` and folds in `PRD_Magazine_Subscription_Management_v4` (subscriptions → §5.9). Spec stage — nothing is built.*

## 1. Vision & goals
A general-purpose, double-entry accounting app run as a local web app on one PC (one program, one database file per company, browser screens, mostly one user, offline preferred). The user is a non-accountant; the app does the accounting automatically and **ease of use is the main goal**. It starts blank — you create and name businesses, set your own fields, layouts, numbering, chart of accounts and tags. A Book Fair is just one kind of **Project** (the generic, customer-linked dimension). The only fixed parts are double-entry, the audit log, and cancel-with-reversal; everything else bends to how the user works.

## 2. Users
- **v1 (Phase 1):** a single **Admin** on one PC — full access; only Admin can delete (no-accounting items only).
- **v2 (Phase 2):** additional **invoicing-only** users on other devices / a tablet at a fair (create + cancel invoices only; scoped data; never delete). Designed when Phase 1 is an accepted MVP.
- Interface: English only; INR; India-adapted defaults.

## 3. Scope
**In scope (v1, Phase 1):** company → businesses → shared chart of accounts (tagged by business); accounting engine (double-entry, posting, FY lock, opening balances); customers; items & basic inventory (per-item stock, duplicate-check key, MRP, per-supplier pricing); documents (invoices, quotations, credit notes, challans, recurring invoices, bills/expenses, POs); payments & money (methods, split allocation, overpayment/credit, refunds, returns, write-off); Projects/Fairs; subscriptions & deferred revenue (advance invoicing, delivery-driven recognition via challans, period-end variance/settlement); reports (fixed set + simple builder); tax (optional, India-adapted), date tokens, custom fields, tags, notes; data-entry accelerators; import/export/backup; login, audit log + technical error log, Settings.

**Out of scope / deferred (v2):** invoicing-only users & tablet-at-fair (Phase 2); more than one company per install; online/multi-customer SaaS; gateways, live bank feeds, portal, e-invoicing; archive as a third record state; full pivot/group-by-3/custom-field report builder; shared book catalogue across businesses; bank transactions via PDF import + OCR; OCR capture to avoid re-keying.

## 4. Core principles
**Three fixed parts (never bend):** (1) double-entry, automatic — every transaction posts balanced debits/credits; a save that wouldn't balance is rejected; (2) audit log — every data-changing action recorded (who/what/when), read-only, tamper-evident via a hash chain, from day one; (3) cancel-with-reversal — issued/posted documents are never erased, only cancelled (posts the exact reverse, returns stock, stays visible, number never reused); hard delete is limited to no-accounting items and is Admin-only.

**Design philosophy:** generic, not industry-specific (starts blank); no hardcoded special rules (recurring accounting patterns offered as generic, configurable capabilities); easy for a non-accountant (plain language, accounting handled underneath); local and offline-first (internet only for optional Google sign-in and email).

## 5. Functional requirements

### 5.1 Company → businesses → chart of accounts
- One company per install (holds chart of accounts, businesses, audit log, backup); one database file; one backup covers the whole company.
- One or more user-named businesses; **every record tagged to exactly one business on the whole entry** (header + detail), so a business can carry even a Balance Sheet.
- Businesses share one chart of accounts but keep **their own numbering sequences and prefixes** (e.g. `INV-001/26-27`, `MAG-001/26-27`).
- At setup: preview and pick a ready-made chart **or** build your own; add/rename accounts anytime (including liability accounts such as Unearned Revenue); items can be linked to the accounts they post to.
- Reports run per business or combined.

### 5.2 Accounting engine
- Automatic balanced journal entry behind every action; users never type debits/credits.
- **Draft posts nothing** (only reserves stock); finalising/issuing posts (invoice → sale; bill → purchase; payment → receipt; subscription-linked challan → delivery recognition + COGS; standalone challan → nothing). Posting is all-or-nothing.
- Single **general ledger** every report reads from, stamped with date, business, project (fair), accounts, amounts, tags, source document — business and project carried on the whole entry, so every report (P&L included) can be sliced fair-by-fair and a Balance Sheet by business.
- Cancel posts the exact reverse (+ returns stock); edit of a finalised document keeps the prior version in history; no hard delete of posted records.
- **Accrual** basis engine; reports show cash or accrual (cash derives from actual payment allocations).
- Financial year configurable per business; numbering resets each FY; **FY lock** (only Admin corrects into a locked period).
- Opening balances by Excel import or a typing screen; must balance (Opening Balance Equity holds any difference).

### 5.3 Customers
- Required: Customer name; Classification (Individual/Business/Company/Partnership/Trust/Charity/Government/Other, starts unselected); numbering-category (SCH/LIB/CLG/RET/GEN → app auto-number from 0001, never hand-edited).
- Optional: GSTIN, website, one email, up to two contacts (one phone each), Bill To / Ship To (copy button, then independently editable), staff-only internal notes. Defaults India/+91/INR/English.
- Saving a profile only creates the record (no subscription/opening balance/payment). Every retail buyer gets an individual record (no shared Walk-in Customer).
- Duplicates (name/phone/email/GSTIN): **warn and suggest, allow continue**.
- **Merge** tool folds a duplicate into a primary: preview both → transfer all documents/payments/history → resolve conflicts → recalc combined balance → old ID kept as alias → audit-logged → undo while safe. Merges identities, not transactions; never alters an accounting entry.
- One combined credit balance shown, held in two ledgers underneath (Customer Advances/Excess, and Credit Notes/Returns).
- Customer page: five tabs (Invoices, Quotations, Payments, Documents, History/Activity); account statement exportable to PDF/Excel. *(Financial-summary panel: pending — not yet designed.)*
- Attachments under Documents (PDF/JPG/PNG/Word/Excel/CSV, ≤20 MB/file).
- Directory: search (name/number/phone/email/GSTIN), sort, Active/Inactive filter, column controls with saved prefs + Reset, page sizes 25/50/100; bulk Inactive allowed, bulk delete not; delete a single customer only if it has no linked documents/transactions. Payment terms live on each quotation/invoice.

### 5.4 Items & stock
- Fields: name/key, description, unit (user list), selling price, cost, MRP, **Track stock (Yes/No)**, linked accounts, reorder/low-stock threshold, image, custom fields (any can be a duplicate-check key, e.g. ISBN), per-supplier purchase price list. Only name mandatory; "Save & add another" for bulk cataloguing.
- Track stock per item; switching Yes→No blocked while stock remains.
- Tracked: buy → qty up, cost in Inventory asset; sell (at invoice or subscription-linked challan) → qty down, FIFO cost moves Inventory→COGS; negative stock blocked ("Add stock"); draft reserves qty; FIFO lots keep supplier + cost.
- Untracked: no qty/asset; cost to expense/COGS at the purchase bill; sale is revenue at the invoice; a challan for an untracked item is a non-posting delivery note.
- Duplicate-check key: warn and suggest, allow override.
- Pricing: MRP/cost/selling price are item fields with price history by date; per-supplier default purchase price alongside FIFO lots.
- Low-stock threshold per item with a business-level fallback.
- **Project (fair) stock tagging:** one shared stock pool; each stock movement (purchase/sale/return) taggable to a fair so stock and COGS report fair-by-fair while quantity-on-hand stays a single figure.

### 5.5 Invoices
- Required: customer + at least one line with a quantity. Fields: invoice date (today default); due date (30 days default, changeable/clearable); printed terms/notes + internal notes; PO number (warns on reuse); custom fields; project (fair); tags; **Deliver now / Deliver over time** switch (pre-filled by the customer Subscription flag).
- Numbering `INV-001/26-27` per-business, resets each FY; next number shown on open, used up on first save (even as a draft).
- Autosave on; leaving an unfinalised autosaved draft warns every time.
- Lines: item + qty (price fills, editable); line discount + document lump-sum discount; extra charges (name + amount, e.g. postage/freight); optional per-line tax; date tokens in line text; MRP shown. **Totals exact to paise (not rounded);** amount grouping per Settings. Incomplete rows block the save.
- Save is all-or-nothing after pre-checks. Deliver-now posts the sale (+ stock/COGS for tracked direct); Deliver-over-time posts to Unearned Revenue. Short stock blocked with "Add stock".
- Lifecycle: Draft/Issued/Partial/Paid/Cancelled; Overdue/Unpaid calculated (no due date ⇒ never overdue). Edit a finalised invoice keeps the old version. Cancel reverses the sale and returns stock. Receive payment on the header.
- Bulk actions (Invoice-Ninja set) + Excel export of the list; delete Admin-only; bulk Mark paid records a real payment each.
- Data-entry accelerators app-wide: inline math in amount/qty fields; fast date entry (compact DD/MM/YY, T=today, M=month start); keyboard shortcuts (Save, Save & New, etc.); transaction attachments.

### 5.6 Other documents
- **Quotations:** Draft/Sent/Approved/Converted/Rejected/Expired; own sequence `QUO-…`; Convert to invoice copies lines, resets status/dates, links both ways, optional carry-over of terms.
- **Credit notes:** separate document, visually distinct from an invoice; issuance raises the credit pool, application creates a payment of type Credit attached to both documents.
- **Challans:** linked (against a subscription invoice — posts the delivery, tracks delivered vs pending) or standalone (posts nothing, visually distinct); print substitutes shipping address and suppresses cost/totals.
- **Recurring invoices:** monthly/quarterly/half-yearly/annually/run-forever; generation skipped if an earlier child is unpaid; date tokens write the period into line text.
- **Bills & expenses:** payables as bills; bill payments post properly; expense categories are the chart of accounts; recurring expenses auto-write the period.
- **Purchase orders:** Draft/Sent/Accepted/Received/Cancelled; Received increments stock (never auto-creates the product); links to a bill/expense; cannot convert to a sales invoice.

### 5.7 Payments & money
- Methods: editable list (Cash/Bank Transfer/UPI/Cheque/Other).
- One payment splits across several invoices of the same customer; an invoice takes several partials; overpaying a single line blocked; "apply oldest first"; checking a row auto-fills its exact balance.
- Customer credit: two ledgers (Customer Advances/Excess; Credit Notes/Returns), one combined balance shown.
- Payment immutability: amount + customer frozen after save; editable date/allocation/method/reference/notes; corrections by reverse-and-re-enter.
- Refund (restores balance, reopens debt); sales return (records goods against the supply; paid return may create credit; a cash refund needs its own entry); bad-debt write-off (preserves history; later recovery links back).
- Deleting a payment rolls back every balance it touched (archive, not force-delete). Numbering `PMT-001/26-27`.

### 5.8 Projects (Fairs)
- A Project is first-class, QBO-style: tied to one host customer (an ordinary customer — a host school is not a special field), with its own P&L; invoices and costs belong to it; the whole books can be sliced fair-by-fair. On screen it is called a **Fair**. (No per-fair Balance Sheet.)
- Fair invoicing: each invoice belongs to one fair; **Save & New** for speed; fair buyers pay instantly by UPI/Cash (mode recorded).
- Buyer details: name + one contact (email/WhatsApp) optional, stored on the invoice only, used to send the PDF / future offers *(personal-data → §9 legal)*.
- Fair stock & costs: one shared pool; movements + COGS tagged to the fair.
- End of fair: the school incentive is entered as an ordinary expense (+ a stock adjustment if books are handed over) — not an automatic rule.

### 5.9 Subscriptions / magazine handling *(folded from Magazine PRD v4)*
Delivered as **generic, configurable** deferred-revenue behaviour — not a hardcoded "magazine" mode; normal users and normal sales never see it. Verified against AS 9 / Ind AS 115 and accepted.

- **Billing models** the generic design covers: *Subscription (prepaid)* → advance invoice (Deliver over time) + challan per supply + period-end settlement; *Credit* → ordinary credit sale (normal invoice, payment when received); *Retail* → ordinary invoice per sale; *Order-based* → ordinary invoice per order. Every customer gets a documented invoice/challan for each transaction.
- **Posting model:** advance invoice → Dr A/R, Cr Unearned Revenue (no sale/COGS yet); advance payment → Dr Cash, Cr A/R; each delivery via a finalised **linked challan** → Dr Unearned Revenue, Cr Sales (delivered portion), and for a tracked item Dr COGS, Cr Stock (FIFO); standalone challan posts nothing; direct invoice posts everything at once.
- **Advance detection (hybrid):** per-invoice Deliver-now/over-time switch pre-filled by a Subscription flag on the customer, overridable per invoice; the item carries its linked Unearned Revenue account.
- **Recognition:** delivery-driven (finalising a linked challan) is primary; an optional manual recurring journal template is available.
- **Subscription periods:** per-customer, configurable, non-calendar, editable at renewal.
- **Mid-period price change:** price history by date — the supply-date rate is used; earlier supplies keep their rate; every rate change is logged (old/new/effective date/user).
- **Challan ↔ invoice link:** advance invoice first, then one-or-many challans against it; v1 cardinality one invoice → many challans, one challan → one invoice (challan spanning invoices is v2); tracks delivered vs pending; stock/revenue never double-counted.
- **Variance / settlement engine (v1):** at period end or early closure, compare prepaid received vs delivered value at selling rates; produce a settlement statement in two forms — a customer-facing narrative and an internal per-magazine/per-rate-period table — exportable PDF/Excel. Over/under handled by refund, carry-forward, or a **balance-due invoice** (a standalone document for an owed amount, traceable to the variance report, never creating the debt twice). *(Build-time: exact early-closure behaviour, statement layouts, refund-vs-carry-forward defaults.)*
- **Rate/cost history & audit:** magazine purchase cost tracked with effective-dated history; rate changes and applied rates auditable per challan.

### 5.10 Reports
- Fixed set (per business and combined; every report except Balance Sheet also fair-by-fair; cash/accrual where relevant; all shown on screen): P&L, Balance Sheet, A/R aging, A/P aging, Inventory Valuation Summary, Sales by item, General Ledger, Trial Balance, Cash Flow, Customer Balance Detail, Open Invoices, Collections, Sales by Customer, Transaction Detail by Account, Transaction List by Date, Inventory Valuation Detail, stock/qty-on-hand.
- Customize panel per report: General (method/period/number format), Rows/Columns, Filter (customer/account/vendor/product/fair/tags/business), Header/Footer; save a customization; group with subtotals; schedule by email (needs internet); export PDF/Excel; Refresh; fast date entry on date filters.
- Simple report builder (v1): pick entity → columns → filter → group with subtotals → export. Full pivot/group-by-3/custom-field builder is v2.

### 5.11 Tax, custom fields, tags, notes
- Tax (optional, India-adapted): user-created names/rates, per-item-line, inclusive/exclusive, tax-exempt option, optional GSTIN on customers. *(GST position → CA/§9.)*
- Custom fields: user-named, no limit, across invoices/bills/items/customers/reports; five types (text, multiline, dropdown, switch, date); any can be a duplicate-check key; managed centrally in Settings **and** addable inline via a gear icon on each record page. *(Open: confirm which records beyond the named four carry custom fields.)*
- Tags: name + colour (pills), attachable to many record types, filterable across the app; separate, lighter system from Projects (a Book Fair is a project, not a tag).
- Notes: printed notes/terms on documents + internal staff-only notes. Date tokens (`:MONTH`/`:QUARTER`/`:YEAR`/`:WEEK`) resolved on save.

### 5.12 Import / export / backup
- Import real .xlsx and CSV, two-phase (preview with auto-detected delimiter/encoding, then ingestion with a column map); duplicate products update not duplicate; multi-row invoices grouped by document number; a failed row is skipped and collected (import does not abort). Maps for customers, items (with stock), opening balances, past invoices/bills, credit notes.
- Export Excel/CSV/PDF across lists and reports.
- Backup/restore: choose scope (everything — database/attachments/logo/audit log; or database only); screen states what's in/out; restore warns, offers a pre-restore backup, sanitises incoming settings, can preserve users + counters.

### 5.13 Login, users & roles
- Phase 1: one Admin, full access; only Admin deletes (no-accounting items only).
- Google sign-in at first-time setup and password recovery; daily login is an app password (offline). Password ≥ 8 chars, letters + numbers; lock 15 min after 5 wrong tries; forgot-password via the same Google account; auto sign-out after 1 hr idle (1-min warning, Stay-signed-in, typed work preserved).
- Phase 2: invoicing-only users (see §2 / design doc §2.4).

### 5.14 Audit log & technical error log
- Audit log: every data-changing action (who/what/when), read-only, tamper-evident hash chain, covering settings/tax-rate/product changes; line-item edits covered by kept prior document versions.
- Technical error log: a separate developer log (PDF/mail/security crashes), not business actions.

### 5.15 Settings
Numbering patterns per document type per business (prefix + FY + counter, padding, resets per FY, richer tokens + optional shared counter); financial year per business; amount grouping (Indian/international); lists (payment methods, tax names/rates, units, chart of accounts, classification); central custom-fields management; product defaults (default Track-stock, show qty on challan/PDF, low-stock on/off); date-format choice; optional document-lock; email account (optional — reply-to/BCC/signature/attach-PDF, needs internet); business identity (name/address/logo); low-stock business-level fallback; bank-transaction rules (pairs with v2 bank import). Navigation flat (~2 clicks to any tab).

## 6. Non-functional requirements
- **Scale:** comfortably handle a small business's volumes (e.g. hundreds of customers, tens-of-thousands of ledger lines) without degradation. *(Design doc gives no hard numbers; magazine PRD cited 50–300 customers, 20–100 magazines, ~500–1000 bills.)*
- **Platform:** local web app on one PC; one database file per company; no cloud dependency for day-to-day use; internet only for optional Google sign-in and email.
- **Usability:** no technical background assumed; plain-language forms; minimal steps for routine tasks.
- **Reliability:** committed records preserved on unexpected shutdown; in-progress work saved as entered; drafts respect the draft-vs-issuance boundary.

## 7. Reliability (when things go wrong)
Pre-save checks (block incomplete rows/zero qty, plain messages); all-or-nothing saves; app-given numbers with collision-retry + atomic save lock (a double-click never makes two invoices); login lockout; import pre-check; backup/restore with warnings; session-expiry prompt preserving typed work; form state surviving an API/network error; negative stock blocked; stock concurrency guard; separate technical error log.

## 8. Testing / acceptance
Books always balance (Trial Balance matches); known-answer test (your hand-worked figures are the acceptance, not a passing technical test); cancel test; subscription test; variance/settlement test (incl. mid-period rate change); project (fair) test; audit test (hash chain intact); import test; backup/restore test; FY-lock test; duplicate/merge test. Phase 2 (later): role test + two-device test.

## 9. Open items & reconciliation notes
**CA:** principal vs agent (full sale value vs margin) and GST classification/timing for the magazine resale. **Lawyer:** buyers' personal data (India DPDP Rules 2025, staged start); and before giving away or selling the app. **GST:** magazine scope recorded as "Exempt" — unconfirmed.

**Reconciliation / to confirm:**
1. **Rounding conflict:** design doc (source of truth, 9 Nov) = totals exact to paise, not rounded. Magazine PRD v4 (30 Sep) = round invoice/quote totals to the nearest whole rupee. This PRD uses exact paise; whole-rupee rounding is treated as **superseded** pending your confirmation.
2. **Custom fields coverage:** confirmed on invoices/bills/items/customers/reports; quotations/credit notes/challans/POs not yet confirmed.
3. **Dashboard/Home content, customer financial-summary panel, "Save & add another" on customers** — undecided (see APP_FLOW gaps).
4. **Scale numbers** — design doc states none; magazine-PRD figures carried as a reference only.

## 10. Sources
`Design Document - Book Buddha (9 Nov 2026).md` (source of truth); `APP_FLOW.md`; `PRD_Magazine_Subscription_Management_v4.md` (subscriptions, folded); `Decisions - 9 Nov 2026 (the 15 questions).md`; Invoice Ninja reference docs. Superseded: `PRD – Fair Accounting App (Draft v0.1)`.

*End of PRD. Features List is the companion document.*
