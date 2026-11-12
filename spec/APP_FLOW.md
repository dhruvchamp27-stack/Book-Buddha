# Book Buddha — App Flow (Screen-by-Screen Checklist)

*Derived from `Design Document - Book Buddha (9 Nov 2026).md` (source of truth). Spec stage — nothing is built. Written 12 Nov 2026.*

**How to read this.** Every screen lists: **Purpose · Required content · Primary action · Secondary action · Loading state · Empty state · Error state.** Branch points are marked **→ branches**. Gaps the design doc does not yet settle are marked **⚠ GAP** inline and summarised at the end.

**Fixed rules that apply on every posting screen:** double-entry is automatic (you never type debits/credits); issued documents are cancelled-with-reversal, never deleted; every data-changing action is audit-logged. Saves are all-or-nothing. App-given numbers are used up on first save (even as a draft).

---

## PART A — PRIMARY JOURNEYS (arrow maps)

**First run:** Google sign-in → Create company → Create business(es) → Pick/build chart of accounts → Set financial year → Set numbering → Opening balances (import or type) → Set app password → Dashboard.

**Daily use:** App-password login → Dashboard → (Customers / Items / Invoices / Documents / Payments / Fairs / Reports / Settings) → work → Save → back to list.

**Make an invoice:** Dashboard → Invoices → New → pick customer → add lines → set Deliver now / over time → Save (posts) → Receive payment (optional) → Issued.

**Run a fair:** Fairs → New fair → link host customer → fair invoicing (Save & New) → End of fair → enter incentive expense → view fair P&L.

**Subscription cycle:** Customer (Subscription flag) → advance invoice (Deliver over time → Unearned Revenue) → each delivery = linked challan → finalise challan (recognises revenue + COGS) → period end → variance/settlement statement → refund / carry-forward / balance-due invoice.

---

## PART B — SCREEN DETAILS

### SECTION 1 — First-time setup & login

**1.1 Welcome / Google sign-in**
- Purpose: Verify the owner at first setup (and later for password recovery).
- Required content: Google account.
- Primary: "Continue with Google". Secondary: Exit.
- Loading: "Signing in…". Empty: n/a (first screen). Error: no internet → "Google sign-in needs internet"; sign-in failed → retry.

**1.2 Create company**
- Purpose: Create the top container (one company per install, one database file).
- Required: Company name. Optional: address, logo (can be added later in Settings).
- Primary: "Create company". Secondary: Back.
- Loading: "Creating…". Empty: n/a. Error: blank name blocked; database-create failure → plain message + retry.

**1.3 Create business(es)**
- Purpose: Create one or more businesses (e.g. Books, Magazines); every record is later tagged to exactly one.
- Required: at least one business name. Optional: add more now or later.
- Primary: "Add business" / "Next". Secondary: "Skip — add later".
- Loading: n/a (instant). Empty: prompt "Add your first business". Error: duplicate business name warned.

**1.4 Chart of accounts — preview & choose**
- Purpose: Pick a ready-made chart or build your own (one shared chart for all businesses).
- Required: a chart selected or started.
- Primary: "Use this chart". Secondary: "Build my own" / "Preview".
- Loading: "Loading preview…". Empty (build-own path): blank list with "Add account". Error: none expected; invalid custom account name blocked.

**1.5 Financial year**
- Purpose: Set FY per business (e.g. 1 Apr–31 Mar); numbering resets each FY.
- Required: FY start/end per business.
- Primary: "Save". Secondary: Back.
- Loading: n/a. Empty: pre-filled default (editable). Error: invalid range blocked.

**1.6 Numbering patterns**
- Purpose: Set prefix + FY + counter per document type per business (e.g. INV-001/26-27), with padding.
- Required: a pattern per document type (defaults offered).
- Primary: "Save". Secondary: "Reset to default".
- Loading: n/a. Empty: defaults shown. Error: a pattern that would collide is flagged.

**1.7 Opening balances**
- Purpose: Enter starting balances by Excel import or a typing screen; must balance (Opening Balance Equity holds any difference).
- Required: none to proceed (can start at zero). Optional: balances.
- Primary: "Import .xlsx" / "Save". Secondary: "Skip for now".
- Loading: "Importing…". Empty: "No opening balances yet". Error: out-of-balance shown with the difference parked in Opening Balance Equity; bad import rows skipped and listed.

**1.8 Set app password**
- Purpose: The daily offline login (Google is only setup/recovery).
- Required: password ≥ 8 chars, letters + numbers; confirm.
- Primary: "Set password". Secondary: Back.
- Loading: n/a. Empty: n/a. Error: too weak / mismatch → plain message.

**1.9 Setup complete → Dashboard**
- Purpose: Confirm setup done, land on Dashboard.
- Primary: "Go to Dashboard". ⚠ **GAP:** Dashboard content is not defined in the design doc.

---

### SECTION 2 — Daily start & navigation

**2.1 App-password login**
- Purpose: Daily sign-in, works offline.
- Required: app password.
- Primary: "Sign in". Secondary: "Forgot password".
- Loading: "Signing in…". Empty: n/a. Error: wrong password → attempts remaining; **locks 15 min after 5 wrong tries**.

**2.2 Dashboard / Home**
- Purpose: Starting point and jumping-off to all areas.
- Required content: ⚠ **GAP** — not specified. (Suggest: today's figures, shortcuts, low-stock alert, overdue invoices — to decide.)
- Primary: open any area. Secondary: business switcher.
- Loading: "Loading…". Empty (fresh company): "Nothing yet — create your first customer/item/invoice". Error: data-load failure → retry.

**2.3 Navigation + business switcher**
- Purpose: Flat, plainly named menu (~2 clicks to any tab); switch active business or view combined.
- Primary: select a tab. Secondary: switch business / "All businesses".
- States: n/a (instant).

**2.4 Session expiry**
- Purpose: Auto sign-out after 1 hour idle, protecting unsaved work.
- Flow: 1-minute warning → "Stay signed in" button; autosaved drafts stay saved; typed work preserved on the expiry prompt.
- Error: if ignored → signed out; re-login returns to saved state.

**2.5 Forgot password**
- Purpose: Reset via the same Google account (needs internet).
- Required: Google sign-in → new password (≥8, letters+numbers).
- Primary: "Set new password". Secondary: Cancel.
- Loading: "Verifying…". Error: no internet → message; wrong Google account → blocked.

---

### SECTION 3 — Customers

**3.1 Customer directory (list)**
- Purpose: Find and manage customers.
- Content: columns Customer Number, Name, Classification, Phone, Email, Status; search by name/number/phone/email/GSTIN; Active/Inactive filter; column reorder/resize/show-hide with saved prefs + Reset columns; page size 25/50/100.
- Primary: "New customer". Secondary: Bulk Inactive; Export (PDF/Excel). (Bulk delete NOT allowed.)
- Loading: list skeleton. Empty: "No customers yet — add your first". Error: load failure → retry.

**3.2 Create / edit customer**
- Purpose: Create or edit a customer record (saving does nothing else — no subscription/balance/payment).
- Required: Customer name; Classification (Individual/Business/Company/Partnership/Trust/Charity/Government/Other — starts unselected); numbering-category (SCH/LIB/CLG/RET/GEN → app auto-number from 0001).
- Optional: GSTIN, website, one email, up to two contacts (one phone each), Bill To / Ship To (copy-to-shipping button, then independently editable), internal notes. Defaults India/+91/INR/English. Custom fields via **gear icon** on this page (plus central management in Settings).
- Primary: "Save". Secondary: "Save & add another"? ⚠ **GAP** (named for items, not customers). Cancel.
- Loading: "Saving…". Empty: blank form. Error: missing name/classification blocked; **duplicate (name/phone/email/GSTIN) → warn + suggest existing, allow continue**.

**3.3 Customer detail page**
- Purpose: Everything about one customer.
- Content: five tabs — Invoices, Quotations, Payments, Documents, History/Activity; one combined credit balance shown (two ledgers underneath). Financial-summary panel ⚠ **GAP — "pending, not yet designed."**
- Primary: "New invoice for this customer". Secondary: "Statement", "Merge", "Edit", "Mark Inactive".
- Loading: per-tab load. Empty per tab: "No invoices/quotations/payments/documents yet". Error: tab load failure → retry.

**3.4 Account statement**
- Purpose: Transactions, balance, receivables aging for one customer.
- Primary: "Export PDF/Excel". Secondary: date range.
- Loading: "Building statement…". Empty: "No transactions in range". Error: export failure → retry.

**3.5 Merge tool**
- Purpose: Fold a duplicate into a primary customer (merges identities, not transactions).
- Required: pick primary + duplicate.
- Flow: preview both → transfer all invoices/payments/credit notes/advances/quotations/attachments/notes/history → resolve contact/custom-field conflicts → combined balance recalculated → old ID kept as alias → audit-logged → undo offered while safe.
- Primary: "Merge". Secondary: "Preview", Cancel.
- Loading: "Merging…". Empty: n/a. Error: permission/concurrency conflict blocked; never alters an accounting entry.

**3.6 Delete / deactivate customer**
- Purpose: Remove or hide a customer.
- Rule: delete only if **no linked documents/transactions**; otherwise Mark Inactive.
- Primary: "Mark Inactive". Secondary: "Delete" (only when eligible, Admin).
- Error: delete blocked with reason if linked records exist.

---

### SECTION 4 — Items & stock

**4.1 Item list**
- Purpose: Browse the catalogue.
- Content: item name/key, price, stock qty (tracked items), low-stock flag. Search; filter.
- Primary: "New item". Secondary: Export; stock adjustment.
- Loading: skeleton. Empty: "No items yet — add your first". Error: load failure → retry.

**4.2 Create / edit item**
- Purpose: Add/edit an item.
- Required: Name only. Optional: description, unit (user list), selling price, cost, MRP, **Track stock Yes/No**, linked accounts, reorder/low-stock threshold, image, custom fields (any can be a duplicate-check key, e.g. ISBN), per-supplier purchase price list.
- Primary: "Save". Secondary: "Save & add another".
- Loading: "Saving…". Empty: blank form. Error: duplicate-key match (e.g. ISBN) → **warn + suggest, allow override**; **Track stock Yes→No blocked while stock remains** (reduce to 0 first).

**4.3 Stock-in / purchase / adjustment**
- Purpose: Increase or correct stock for tracked items (buy → qty up, cost sits in Inventory asset; FIFO lots per lot keep supplier + cost).
- Required: item, quantity, cost. Optional: supplier, fair tag (stock movement taggable to a fair).
- Primary: "Save". Secondary: Cancel.
- Loading: "Saving…". Error: negative result blocked; incomplete row blocks save.

**4.4 Low-stock alerts**
- Purpose: Warn before a fair.
- Content: per-item threshold with business-level fallback.
- Primary: open the item to restock. States: Empty = "Nothing low". (Alert on/off is a product default in Settings.)

*Behind the scenes (no screen): on a sale, FIFO cost moves Inventory→COGS; draft reserves stock; negative stock blocked with an "Add stock" step.*

---

### SECTION 5 — Invoices

**5.1 Invoice list**
- Purpose: Browse/manage invoices.
- Content: statuses Draft/Issued/Partial/Paid/Cancelled; Overdue/Unpaid calculated.
- Primary: "New invoice". Secondary: Bulk actions (Invoice-Ninja set) + **Excel export of the list**; bulk "Mark paid" (asks once for date+method, records a real payment each). Delete Admin-only.
- Loading: skeleton. Empty: "No invoices yet". Error: load failure → retry.

**5.2 Create / edit invoice**
- Purpose: Raise an invoice.
- Required: customer; at least one line with a quantity.
- Content: invoice date (today default); due date (30 days default, changeable/clearable); terms/notes (printed) + internal notes; PO number (warns on reuse); custom fields (gear icon); project (fair); tags; **Deliver now / Deliver over time** switch (pre-filled by customer Subscription flag); lines = item + qty (price fills, editable), line discount, document lump-sum discount, extra charges (name+amount), optional per-line tax, date tokens in line text, MRP shown; totals exact to paise, grouping per Settings. Inline math + fast date entry on fields.
- Primary: "Save" (posts). Secondary: "Save & New", "Save as draft", Cancel.
- Loading: "Saving…". Empty: blank form; next number shown on open. Error: incomplete rows **block save** (no silent drop); short stock **blocked** with "Add stock"; all-or-nothing.
- → branches: Deliver now → posts sale (+stock/COGS for tracked direct); Deliver over time → posts to Unearned Revenue (Section 9/11).

**5.3 Draft & autosave**
- Autosave on; leaving an unfinalised autosaved draft **warns every time** (number already used; continue from Drafts list).

**5.4 Receive payment (on invoice header)**
- Purpose: Record payment against this invoice.
- Required: amount, date, method. Primary: "Save payment". Secondary: Cancel.
- Error: overpaying a single line blocked.

**5.5 Cancel / edit finalised invoice**
- Cancel: posts exact reverse, returns stock, marks Cancelled, number never reused. Edit: allowed, **prior version kept** in history.
- Primary: "Cancel invoice" (confirm). Error: confirmation required; reversal all-or-nothing.

---

### SECTION 6 — Other documents

**6.1 Quotations**
- Purpose: Quotes that can convert to invoices.
- Content: statuses Draft/Sent/Approved/Converted/Rejected/Expired (Expired calculated from valid-until); own sequence QUO-…; custom fields (gear icon).
- Primary: "New quotation" / "Convert to invoice" (copies lines, resets status/dates, links both ways, option to carry terms). Secondary: Send, Export.
- Loading/Empty/Error: as per lists; convert failure → retry, nothing double-posted.

**6.2 Credit notes**
- Purpose: Issue credit (visually distinct from an invoice to prevent mis-entry).
- Flow: issuance raises the credit pool → application creates a payment of type Credit attached to both invoice and credit note.
- Primary: "New credit note" / "Apply". Secondary: Cancel. Error: incomplete rows blocked.

**6.3 Challans (delivery notes)**
- Purpose: Delivery documents.
- Branches: **Linked challan** (against a subscription invoice) posts the delivery, tracks delivered vs pending; **Standalone challan** posts nothing, visually distinct (badge + list filter).
- Print: shipping address substituted; unit cost/line totals/taxes/totals suppressed.
- Primary: "New challan" → choose linked/standalone. Error: cannot over-deliver vs invoice quantities.

**6.4 Recurring invoices**
- Purpose: Auto-generate invoices on a schedule (monthly/quarterly/half-yearly/annually; run-forever).
- Rule: **generation skipped if an earlier child is still unpaid**; date tokens write the period into line text.
- Primary: "New recurring". Secondary: pause/stop. Error: interlock message when skipped.

**6.5 Bills & expenses**
- Purpose: Record payables and expenses (categories = chart of accounts).
- Primary: "New bill" / "New expense" / "Pay bill". Secondary: attach file; recurring (period auto-written).
- Error: incomplete rows blocked.

**6.6 Purchase orders**
- Purpose: Order stock from suppliers.
- Content: statuses Draft/Sent/Accepted/Received/Cancelled; **Received increments stock** (never auto-creates the product); PO links to a bill/expense; cannot convert to a sales invoice.
- Primary: "New PO" / "Mark received". Error: receiving an item not in catalogue → prompt to add it first.

---

### SECTION 7 — Payments & money

**7.1 Payments list**
- Purpose: Browse payments (sequence PMT-…).
- Primary: "Receive payment". Secondary: Export. Empty: "No payments yet".

**7.2 Receive payment / allocation**
- Purpose: Take a payment and split it.
- Content: one payment split across several invoices of the **same customer**; invoice can take several partials; "apply oldest first" one-click; checking a row auto-fills its exact balance; methods list (Cash/Bank/UPI/Cheque/Other, editable).
- Primary: "Save payment". Secondary: Cancel. Error: overpaying a single invoice line blocked.

**7.3 Customer credit (two ledgers, one figure)**
- Purpose: Hold/apply surplus — Customer Advances/Excess (cash liability) + Credit Notes/Returns; one combined balance shown.
- Primary: "Apply credit". States: Empty = "No credit".

**7.4 Refund / sales return / write-off**
- Refund: restores invoice balance, reopens debt. Sales return: records returned goods against the supply; paid return may create credit; a cash refund needs its own entry. Bad-debt write-off: preserves history; later recovery links back.
- Primary: the chosen action (confirm). Error: confirmation required; reversal all-or-nothing.

**7.5 Payment immutability**
- Once saved, amount + customer frozen; editable: date, allocation, method, reference, notes. Corrections by reverse-and-re-enter (originals preserved). Deleting a payment rolls back every balance it touched (archive, not force-delete).

---

### SECTION 8 — Projects (Fairs)

**8.1 Fair list**
- Purpose: Browse fairs (projects).
- Primary: "New fair". Secondary: filter. Empty: "No fairs yet".

**8.2 Create / edit fair**
- Purpose: Create a project tied to ONE host customer.
- Required: fair name; one host customer (ordinary customer). 
- Primary: "Save". Secondary: Cancel. Error: missing name/host blocked. (Host school is just an ordinary customer — no special field.)

**8.3 Fair detail / P&L**
- Purpose: View one fair's own P&L, invoices, costs, stock/COGS (tagged movements; one shared stock pool). No per-fair Balance Sheet.
- Primary: "New fair invoice". Secondary: view reports fair-by-fair.
- Loading: "Loading fair…". Empty: "No activity yet". Error: load failure → retry.

**8.4 Fair invoicing**
- Purpose: Fast at-fair billing.
- Content: each invoice belongs to one fair; **Save & New**; buyers pay instantly by UPI/Cash (mode recorded); buyer name + one contact (email/WhatsApp) **optional, stored on the invoice only**, used to send PDF/future offers.
- Primary: "Save & New". Secondary: "Save". Error: short stock blocked with "Add stock".
- ⚠ **GAP:** buyer personal data handling is a legal open item (DPDP, Section 20).

**8.5 End of fair — incentive**
- Purpose: Record the school incentive yourself — an ordinary expense (+ a stock adjustment if books are handed over). Not an automatic rule.
- Primary: "New expense". Secondary: "Stock adjustment".

---

### SECTION 9 — Subscriptions / magazines

*Generic, configurable deferred-revenue behaviour — not a hardcoded "magazine" mode. Normal users/sales never see this.*

**9.1 Subscription flag (on customer)**
- Purpose: Pre-fill the Deliver-over-time switch for this customer. Set on the customer record.

**9.2 Advance invoice**
- Purpose: Bill in advance (Deliver over time): Dr A/R, Cr **Unearned Revenue**; no sale/COGS yet. Item carries its linked Unearned Revenue account.
- Primary: "Save". Error: as invoices.

**9.3 Linked challan (delivery)**
- Purpose: Each delivery recognises revenue: Dr Unearned Revenue, Cr Sales (delivered portion); tracked item also Dr COGS Cr Stock (FIFO).
- Content: tracks delivered vs pending; one invoice → many challans; one challan → one invoice (challan spanning invoices is v2).
- Primary: "Finalise challan" (posts). Error: cannot over-deliver; never double-counts.

**9.4 Price variance**
- Supply-date rate used; earlier supplies keep their rate (price history by date).

**9.5 Variance / settlement engine (period end or early closure)**
- Purpose: Compare prepaid received vs delivered value at selling rates → settlement statement in two forms (customer-facing narrative + internal per-magazine/per-rate table), export PDF/Excel. Over/under → refund, carry-forward, or balance-due invoice. Per-customer periods configurable (non-calendar, editable at renewal).
- Primary: "Generate settlement". Secondary: choose refund/carry-forward/invoice.
- ⚠ **GAP (build-time):** exact early-closure behaviour, statement layouts, refund-vs-carry-forward defaults.

---

### SECTION 10 — Reports

**10.1 Reports home**
- Purpose: Pick a report. Fixed set: P&L, Balance Sheet, A/R aging, A/P aging, Inventory Valuation Summary, Sales by item, General Ledger, Trial Balance, Cash Flow + Customer Balance Detail, Open Invoices, Collections, Sales by Customer, Transaction Detail by Account, Transaction List by Date, Inventory Valuation Detail, stock/qty-on-hand.
- Primary: open a report. Secondary: report builder. Empty: n/a. 

**10.2 Report viewer**
- Purpose: Show on screen (never export-only); per business / combined / **fair-by-fair** (every report except Balance Sheet); cash/accrual where relevant.
- Primary: "Customize". Secondary: Export PDF/Excel; **Refresh** (re-runs against latest data).
- Loading: "Running report…". Empty: "No data for this period". Error: run failure → retry.

**10.3 Customize panel**
- Content: General (method/period/number format) · Rows/Columns · Filter (customer/account/vendor/product/**fair**/tags/business) · Header/Footer; Save a customization + re-run; group with subtotals; schedule by email (needs internet); export. Date filters use fast date entry.
- Primary: "Run". Secondary: "Save customization".

**10.4 Simple report builder (v1)**
- Flow: pick entity → pick columns → filter → group with subtotals → export.
- ⚠ Full pivot / group-by-3 / group-by-custom-field builder is **v2**.

---

### SECTION 11 — Settings

**11.1 Settings home** — flat, plainly named; ~2 clicks to any tab.

**11.2 Numbering patterns** — per document type per business; prefix + FY + counter; padding; resets per FY (not 1 Jan); richer tokens + optional shared counter.

**11.3 Financial year** — per business.

**11.4 Lists** — payment methods, tax names/rates, units, chart of accounts, classification list. Primary: add/edit/reorder. Error: in-use item delete warned.

**11.5 Central custom fields** — define/edit all custom fields in one place: five types (text, multiline, dropdown, switch, date); any can be a duplicate-check key. Pairs with the **gear icon on each record page** (invoice, quote, bill, item, customer, etc.) to add a field inline.
- ⚠ **GAP:** design doc names custom fields on invoices/bills/items/customers/reports only; quotations/credit notes/challans/POs not confirmed. (Your intent: gear icon on each record page — to confirm which records.)

**11.6 Product defaults** — default Track-stock for new items; show stock qty on challan/PDF; low-stock alert on/off.

**11.7 Email account** (optional, needs internet) — enables reminders/scheduled reports/bulk email; reply-to, BCC, signature, attach-PDF.

**11.8 Business identity** — name, address, logo.

**11.9 Other** — amount grouping (Indian/international); date-format choice; low-stock business-level fallback; optional document-lock mode; bank-transaction rules (pairs with v2 bank import).
- Loading/Empty/Error on all Settings: "Saving…" / defaults shown / invalid value blocked with a plain message.

---

### SECTION 12 — Admin & safety

**12.1 Audit log viewer**
- Purpose: Read-only record of every data-changing action (who/what/when), tamper-evident hash chain; covers settings/tax-rate/product changes too.
- Primary: filter/search. Secondary: export. Empty: "No entries". (Read-only — no edit/delete.)

**12.2 Technical error log** — separate developer log (PDF/mail/security crashes), not business actions.

**12.3 FY lock** — finalise a year → entries locked; only Admin can correct into a locked period. Error: non-admin edit refused.

**12.4 Import (two-phase)**
- Flow: pre-import preview (delimiter/encoding auto-detected) → column map → ingestion. Duplicate products update (not duplicate); multi-row invoices grouped by document number; a failed row is skipped and collected (import does not abort). Maps: customers, items (with stock), opening balances, past invoices/bills, credit notes.
- Primary: "Preview" → "Import". Loading: "Importing…". Error: failed rows listed; totals shown to reconcile.

**12.5 Export** — Excel/CSV/PDF across lists and reports.

**12.6 Backup & restore**
- Backup: choose scope (everything — database/attachments/logo/audit log; or database only); screen states plainly what's in/out.
- Restore: warns, offers a pre-restore backup first, sanitises incoming settings, can preserve users + counters.
- Primary: "Back up now" / "Restore". Loading: progress. Error: restore failure → pre-restore backup intact.

**12.7 Reliability states (global)** — pre-save checks (block incomplete rows/zero qty, plain messages); all-or-nothing saves; app-given numbers with collision-retry + atomic save lock (double-click never makes two invoices); login lockout; import pre-check; session-expiry prompt preserving typed work; form state surviving an API/network error; negative stock blocked; stock concurrency guard.

---

## PART C — SECONDARY FLOWS

- **Returning user:** App-password login → Dashboard → area → work.
- **Forgot password:** Login → Forgot → Google sign-in → new password → Login.
- **Session timeout:** idle 1 hr → 1-min warning → Stay signed in / signed out (work preserved).
- **Merge duplicates:** Customer → Merge → preview → transfer → undo-while-safe.
- **Cancel-with-reversal:** any posted document → Cancel → exact reverse + stock return → marked Cancelled.
- **Phase 2 (later, not built):** invoicing-only users on other devices/tablet-at-fair — own login, scoped data access, role + two-device tests.

## PART D — IMPORTANT STATES (global)
Loading · Empty (fresh-company and per-list) · Validation error (incomplete row/zero qty) · Short-stock blocked · Duplicate warn-but-allow · Network/API error (form state preserved) · Saved/Posted · Cancelled · Locked (FY/document) · Session-expiry.

---

## PART E — FLAGGED GAPS / MISSING STEPS (to decide)

1. **Dashboard/Home screen** — not defined. What should it show (figures, shortcuts, alerts)? (§2.2, §1.9)
2. **Customer financial-summary panel** — design doc says "pending, not yet designed." (§5.7)
3. **Custom fields coverage** — confirmed only on invoices/bills/items/customers/reports; quotations/credit notes/challans/POs not confirmed. Confirm which records get the gear icon. (§13.2, your note)
4. **"Save & add another" on customers** — named for items, not customers. Include for customers? (§5.3 vs §6.1)
5. **Subscription settlement build details** — early-closure behaviour, statement layouts, refund-vs-carry-forward defaults. (§11.6)
6. **Keyboard shortcut keys** — exact keys fixed during build. (§7.8)
7. **Buyer personal data at fairs** — legal open item (DPDP Rules 2025). (§8.4, §20)
8. **CA/GST items** — principal vs agent, GST classification/timing. (§20)

*End of App Flow (v1 draft). Next: Invoice Ninja flow-extraction prompt, then PRD + Features List update to match.*
