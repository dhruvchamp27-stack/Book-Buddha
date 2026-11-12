# Book Buddha — Testing Specification (v1 draft)

*Spec stage — nothing is built yet. These are **test specifications** to run once the app exists.
Acceptance = your hand-worked figures (design document §19), not a passing technical test.
This file covers every functionality across the app (design §3–17), with §18 reliability and §19
acceptance woven in. §20 is CA/legal — nothing to functionally test.*

*Every functionality is checked from four points of view:*
- **Backend** — the engine, data and postings behave correctly
- **Frontend** — the screen validates, warns and shows the right state
- **Accounting** — debits = credits, correct accounts, Trial Balance matches, cancel reverses exactly
- **User** — plain-language steps you can verify yourself

---

## Area 1 — Accounting engine (design §4)

### 1.1 Automatic double-entry
- **Backend:** finalising any document writes exactly one **balanced** journal entry (sum of debits = sum of credits), stamped with date, business, accounts, amounts, tags and the source document. A save that would not balance is rejected.
- **Frontend:** normal screens never show debit/credit fields; opening the ledger view shows the posted entry. A forced unbalanced state produces a plain error message, not a crash.
- **Accounting:** a cash sale of ₹100 (untracked item, no tax) posts Dr Cash 100 / Cr Sales 100; the Trial Balance stays balanced.
- **User:** issue an invoice, open its ledger view, confirm the two sides match and equal the invoice total.

### 1.2 Draft vs posted
- **Backend:** a draft writes **no** ledger postings and **no** stock movement, but **reserves** stock quantity; finalising posts everything **all-or-nothing**.
- **Frontend:** a saved draft shows status "Draft"; balances and reports do not change; the item's "available" quantity drops by the reserved amount.
- **Accounting:** P&L, Balance Sheet and Trial Balance are unchanged while the document is a draft; they change only on finalise.
- **User:** save an invoice as a draft → check P&L is unchanged → finalise → check the sale now appears.

### 1.3 General ledger — the single source
- **Backend:** every report reads from the same GL postings; each posting carries its business and tags, so any report can be sliced business-by-business and fair-by-fair.
- **Frontend:** changing a report's business or fair-tag filter changes the figures accordingly.
- **Accounting:** the sum of a report's lines reconciles exactly to the underlying GL postings.
- **User:** run P&L for "all", then filter by one fair tag; the fair's P&L is a subset that ties back to the whole.

### 1.4 Cancel & edit
- **Backend:** Cancel posts the **exact reverse** entry and returns stock; the document is marked Cancelled and its number is never reused. Editing a finalised document keeps the prior version in history.
- **Frontend:** a cancelled document stays visible, muted, badged "Cancelled"; an edited document shows its version history.
- **Accounting:** after a cancel, the affected account balances and stock return **exactly** to their pre-document values (net zero effect).
- **User:** issue an invoice, note the P&L and stock figures; cancel it; confirm both return to the earlier figures.

### 1.5 Cash vs accrual
- **Backend:** accrual reads postings directly; cash derives revenue/expense from **actual payment allocations**.
- **Frontend:** a report's basis toggle switches between the two; the figure changes for an unpaid invoice.
- **Accounting:** an issued-but-unpaid sale appears in the accrual P&L but not in the cash P&L until it is paid.
- **User:** issue an unpaid invoice → accrual P&L shows the sale, cash P&L does not → record payment → cash P&L now shows it.

### 1.6 Financial year & FY-lock
- **Backend:** numbering resets each financial year per document type; once a year is finalised its entries are **locked**; only Admin can correct into a locked period.
- **Frontend:** editing a locked-period entry is blocked with a plain message; Admin is offered a correction path.
- **Accounting:** an Admin correction into a locked year is itself a posted, audited entry, and the books stay balanced.
- **User:** lock a year → try to edit an entry in it (blocked) → as Admin make a correction → confirm it is logged.

### 1.7 Opening balances
- **Backend:** opening balances entered by import or typing must balance; any difference is held in a standard **Opening Balance Equity** account.
- **Frontend:** an unbalanced opening-balance entry is flagged before it can be saved.
- **Accounting:** after entry the Trial Balance balances; Opening Balance Equity holds any pending difference until everything is entered.
- **User:** enter opening balances for a couple of accounts; confirm the Trial Balance balances.

---

## Area 2 — Company, businesses, tags, chart of accounts (design §3)

### 2.1 One company, one database, one backup
- **Backend:** one company per install; one database file; one backup covers the whole company.
- **Frontend:** setup creates exactly one company; no "add company" in v1.
- **Accounting:** all businesses roll up into one company-wide set of books.
- **User:** create the company; confirm a single backup captures everything.

### 2.2 Businesses under the company
- **Backend:** every record is tagged to exactly one business; businesses share the company chart of accounts but keep their own numbering sequences/prefixes.
- **Frontend:** a business selector is present; each business shows its own numbering (e.g. INV- vs MAG-).
- **Accounting:** reports run per business or combined; combined adds up with no double counting.
- **User:** create two businesses (Books, Magazines); issue one invoice in each; run combined P&L and confirm it equals the two added together.

### 2.3 Book Fair tag (and tags generally)
- **Backend:** a tag is a label (name + colour) attachable to any entry in any business; filterable across the app.
- **Frontend:** tags show as coloured pills; a report can filter/group by a tag.
- **Accounting:** filtering the books by a fair tag produces that fair's slice, traceable to documents.
- **User:** tag two invoices "Fair A"; filter P&L by "Fair A"; confirm only those appear.

### 2.4 Shared chart of accounts
- **Backend:** one chart shared by all businesses; an account can be company-wide or restricted to one business; items can link to posting accounts (incl. Unearned Revenue).
- **Frontend:** at setup you preview/pick a ready-made set or build your own; add/rename any time.
- **Accounting:** combined reports total cleanly; the business tag keeps each business separable.
- **User:** add a new liability account (Unearned Revenue); confirm it's available to link on an item.

---

## Area 3 — Customers (design §5)

*Section 5 of the design document is not yet written; these tests follow the confirmed customer behaviour (PRD §4.11, Q1 two-ledger credit, Q2 merge).*

### 3.1 Customer fields & classification
- **Backend:** Name + Classification required; classification list configurable; optional GSTIN, email, up to two contacts, Bill To / Ship To; saving a profile creates no subscription/balance/payment.
- **Frontend:** required fields block save; a copy button copies billing to shipping, then shipping stays editable.
- **Accounting:** creating a customer posts nothing.
- **User:** create a customer with only Name + Classification; confirm it saves and no balance appears.

### 3.2 Customer numbering by category
- **Backend:** numbering category (SCH/LIB/CLG/RET/GEN) drives an independent sequence from 0001; no manual number editing.
- **Frontend:** picking a category shows the next number; it can't be hand-edited.
- **Accounting:** none.
- **User:** create two customers in one category; confirm sequential numbers.

### 3.3 Duplicate warn-but-allow
- **Backend:** a likely duplicate triggers a warning + suggestion, but the save can proceed.
- **Frontend:** the warning shows the existing record; override or go to it.
- **Accounting:** none.
- **User:** create a near-duplicate name; confirm the warning, then override.

### 3.4 Customer merge (Q2)
- **Backend:** primary + duplicate → transfers all invoices, payments, credit notes, advances, quotations, attachments, notes, history → keeps original IDs/dates/numbers → never creates/alters accounting entries → recalculates combined balance → full audit trail → old ID kept as alias → undo when safe.
- **Frontend:** a preview shows both before merge; conflicts resolved by you; confirmation required.
- **Accounting:** **no accounting figure changes** — Trial Balance and every account balance are identical before and after.
- **User:** merge two customers; confirm all documents moved and the books are unchanged.

### 3.5 Two-ledger customer credit (Q1)
- **Backend:** surplus held in two ledgers — Customer Advances/Excess Payments (cash liability) and Credit Notes/Sales Returns & Allowances — while one combined credit balance is shown.
- **Frontend:** the customer shows one combined credit figure; drill-down shows the two sources.
- **Accounting:** each ledger carries the correct liability; the combined figure equals their sum.
- **User:** record an overpayment and a credit note; confirm one combined credit, two parts underneath.

### 3.6 Statements
- **Backend:** account statement lists transactions, balances, receivables aging.
- **Frontend:** viewable and exportable (PDF/Excel).
- **Accounting:** statement figures tie to the ledger.
- **User:** run a statement; confirm it matches the customer's ledger.

---

## Area 4 — Items & stock (design §6)

### 4.1 Item fields
- **Backend:** only name mandatory; holds key/description/unit/selling price/cost/MRP/Track-stock/linked accounts/threshold/image/custom fields (any can be a duplicate-check key)/per-supplier price list.
- **Frontend:** "Save & Add Another" supports bulk cataloguing.
- **Accounting:** creating an item posts nothing.
- **User:** add an item with only a name; confirm it saves.

### 4.2 Track stock = Yes (tracked), FIFO
- **Backend:** buy → qty up, cost to Inventory asset; sell (at invoice or linked challan) → qty down, FIFO cost moves Inventory→COGS; FIFO layers per lot keep supplier + cost.
- **Frontend:** negative stock blocked with an "Add stock" step; a draft reserves qty.
- **Accounting:** buy 10 @ ₹50 then 10 @ ₹60; sell 15 → COGS = 10×50 + 5×60 = ₹800; Inventory left = 5×60 = ₹300.
- **User:** enter those purchases, sell 15, open the item ledger; confirm COGS ₹800 and stock value ₹300.

### 4.3 Track stock = No (untracked)
- **Backend:** no quantity, no asset; cost to expense/COGS at the purchase bill; revenue at the sale; a challan for it is non-posting.
- **Frontend:** no stock fields; no negative-stock block.
- **Accounting:** profit = revenue − cost by period; no COGS-matching at the sale.
- **User:** buy an untracked item (cost hits expense now); sell it; confirm revenue at the sale and no stock movement.

### 4.4 Switching Yes → No
- **Backend:** blocked while stock remains; reduce to 0 via a stock adjustment first.
- **Frontend:** the toggle is disabled with a clear reason while stock > 0.
- **Accounting:** the adjustment to 0 is a posted, audited entry.
- **User:** try to switch an item with stock (blocked); zero it; switch succeeds.

### 4.5 Duplicate-check key (e.g. ISBN)
- **Backend:** any custom field markable unique; a likely duplicate warns + suggests, override allowed.
- **Frontend:** the warning names the existing record; different editions stay separate.
- **Accounting:** none.
- **User:** add two items with the same ISBN; confirm the warning.

### 4.6 Pricing & price history
- **Backend:** MRP/cost/selling price are fields; price history by date applies; a per-supplier default purchase price sits beside FIFO lots.
- **Frontend:** a document pulls the price effective on its date; editable per line.
- **Accounting:** an older document keeps its original price; a newer one uses the new price.
- **User:** change an item's price with a future effective date; confirm old documents unchanged, new ones use the new price.

### 4.7 Low-stock alert (Q10)
- **Backend:** threshold per item with a business-level fallback.
- **Frontend:** an alert shows when stock crosses the threshold.
- **Accounting:** none.
- **User:** set a threshold; sell down to it; confirm the alert.

---

## Area 5 — Invoices (design §7)

### 5.1 Fields & validation
- **Backend:** customer + ≥1 line with qty required; due date defaults 30 days (changeable/clearable); PO warns on reuse; Deliver now/over time switch pre-filled by the customer's Subscription flag.
- **Frontend:** incomplete rows block the save (no silent dropping); PO reuse warns non-blockingly.
- **Accounting:** a draft posts nothing.
- **User:** try to save with an empty line (blocked); complete it; save.

### 5.2 Numbering
- **Backend:** INV-001/26-27, per-business sequence + prefix, resets each FY; number appears on open, used on first save/autosave (deleted draft leaves a gap).
- **Frontend:** the next number shows when the screen opens.
- **Accounting:** none.
- **User:** open a new invoice; note the number; save a draft; confirm it's used.

### 5.3 Lines, charges, discounts, tax
- **Backend:** line price from item (editable); line discount + document lump-sum discount; extra charges (name+amount); optional per-line tax; date tokens in line text; totals exact paise (not rounded); grouping per Settings.
- **Frontend:** incomplete rows block save; MRP shown.
- **Accounting:** tax posts to the tax account; discounts reduce revenue correctly.
- **User:** add a line with a discount, a postage charge, and a tax; confirm the totals and postings.

### 5.4 Save & posting
- **Backend:** pre-checks then all-or-nothing save; "Delivered now" posts the sale (+ stock/COGS for tracked direct sales); "Deliver over time" posts to Unearned Revenue; short stock blocked with "Add stock".
- **Frontend:** a short-stock save is blocked with the add-stock step.
- **Accounting:** a delivered-now tracked sale posts revenue + COGS + stock; a deliver-over-time posts AR + Unearned Revenue only.
- **User:** issue a normal sale (posts fully); issue a deliver-over-time invoice (sits in Unearned Revenue).

### 5.5 Lifecycle
- **Backend:** statuses Draft/Issued/Partial/Paid/Cancelled; Overdue/Unpaid calculated (no due date ⇒ never overdue); edit keeps old version; cancel reverses sale + stock.
- **Frontend:** status shows correctly; a cancelled invoice stays visible, badged.
- **Accounting:** cancel returns sale + stock exactly.
- **User:** issue, part-pay, pay; on another, cancel and confirm reversal.

### 5.6 Bulk actions
- **Backend:** all Invoice Ninja bulk actions + Excel export; bulk "Mark paid" records a proper payment per invoice; delete Admin-only.
- **Frontend:** bulk "Mark paid" asks once for date + method.
- **Accounting:** each marked-paid invoice gets a real payment posting.
- **User:** select three invoices, bulk mark paid; confirm three payments recorded.

---

## Area 6 — Other documents (design §8)

### 6.1 Quotations
- **Backend:** statuses Draft/Sent/Approved/Converted/Rejected/Expired (Expired calculated); convert copies lines, resets status/dates, links both ways; own sequence QUO-; posts nothing.
- **Frontend:** a convert button creates an editable invoice draft; option to carry quote terms.
- **Accounting:** no effect until converted and the invoice is issued.
- **User:** make a quote, convert it, issue the invoice; confirm the link and that only the invoice posts.

### 6.2 Credit notes
- **Backend:** separate document; issuance raises the credit pool; application creates a Credit-type payment linked to invoice + credit note.
- **Frontend:** entry screen visually distinct from an invoice.
- **Accounting:** issuance posts the credit; application reduces the invoice balance and the credit pool.
- **User:** raise a credit note, apply it to an invoice; confirm the invoice balance drops and the credit is used.

### 6.3 Challans
- **Backend:** linked challan posts the delivery and tracks delivered-vs-pending; standalone challan posts nothing; print substitutes shipping address and suppresses cost/totals.
- **Frontend:** standalone vs linked are visually distinct (badge, list filter).
- **Accounting:** a linked finalised challan recognises revenue (+ stock/COGS for tracked); standalone posts nothing.
- **User:** issue a standalone challan (no posting); issue a linked challan (recognises the delivery).

### 6.4 Recurring invoices
- **Backend:** frequencies incl. run-forever; interlock skips generation if an earlier child is unpaid; each child follows per-item posting + per-business numbering; date tokens write the period.
- **Frontend:** a child invoice shows the resolved period in its line text.
- **Accounting:** each generated child posts like a normal invoice.
- **User:** set a monthly recurring invoice; confirm a child generates and the interlock holds if unpaid.

### 6.5 Bills & expenses
- **Backend:** payables as bills; bill payments post properly; expense categories = chart of accounts; recurring expenses write the period.
- **Frontend:** expense category picks from the chart of accounts.
- **Accounting:** a bill posts the payable; its payment clears it.
- **User:** enter a bill, pay it; confirm payable raised then cleared.

### 6.6 Purchase orders
- **Backend:** statuses Draft/Sent/Accepted/Received/Cancelled; Received increments stock (never auto-creates the product); links to a bill/expense; cannot convert to a sales invoice.
- **Frontend:** Received increases stock; no convert-to-sales option.
- **Accounting:** receiving tracked stock raises Inventory asset at cost.
- **User:** raise a PO, mark Received; confirm stock up and no new product created.

---

## Area 7 — Payments & money (design §9)

### 7.1 Methods
- **Backend:** editable list (Cash, Bank Transfer, UPI, Cheque, Other).
- **Frontend:** methods editable in Settings.
- **Accounting:** each method posts to its linked account.
- **User:** add a method; confirm it appears on the payment screen.

### 7.2 Allocation
- **Backend:** one payment splits across several invoices of the same customer; an invoice takes several partials; overpaying a single line blocked; "apply oldest first" one-click; checking a row auto-fills its balance.
- **Frontend:** checking an invoice row fills its exact balance.
- **Accounting:** allocations reconcile; money counted once.
- **User:** receive one payment, split it across two invoices; confirm both reduce correctly.

### 7.3 Payment immutability (Q5)
- **Backend:** amount + customer frozen once saved; editable: date, allocation, method, reference, notes; corrections by reverse-and-re-enter; originals preserved.
- **Frontend:** amount/customer fields locked after save.
- **Accounting:** a correction is a reverse + new entry; both kept.
- **User:** save a payment, try to change the amount (blocked), correct via reverse-and-re-enter.

### 7.4 Refunds, returns, write-off
- **Backend:** refund restores the invoice balance + reopens debt; sales return records returned goods vs original supply (paid return may create credit; refund needs its own entry); bad-debt write-off preserves history, later recovery links back.
- **Frontend:** each is a distinct action with its own screen.
- **Accounting:** a refund reopens AR; a write-off posts to bad-debt expense while keeping history.
- **User:** refund part of a paid invoice (balance reopens); write off a bad debt (history kept).

### 7.5 Partial / deposit on an invoice (Q6)
- **Backend:** supported with its own due date.
- **Frontend:** a deposit has its own due date.
- **Accounting:** the deposit posts as a part payment / advance correctly.
- **User:** take a deposit on an invoice with a separate due date; confirm the balance + due dates.

### 7.6 Numbering
- **Backend:** payments use PMT-001/26-27, own sequence per FY.
- **Frontend:** next payment number shows on the screen.
- **Accounting:** none.
- **User:** record two payments; confirm sequential PMT numbers.

---

## Area 8 — Fairs (design §10)

### 8.1 Create a fair
- **Backend:** a fair has a name and a linked host customer; acts as a tag/dimension across the books.
- **Frontend:** creating a fair adds it as a selectable tag.
- **Accounting:** creating a fair posts nothing.
- **User:** create a fair, link a host customer; confirm it's selectable on invoices.

### 8.2 Fair invoicing
- **Backend:** each fair invoice belongs to one fair; part of the overall books; records payment mode (UPI/Cash).
- **Frontend:** Save & New supports fast entry.
- **Accounting:** a fair invoice posts a normal sale, carrying the fair tag.
- **User:** issue several fair invoices with Save & New; confirm each carries the fair tag.

### 8.3 Buyer details
- **Backend:** buyer name + one contact optional, stored on that invoice only (not as a customer).
- **Frontend:** buyer fields optional; used to send the PDF.
- **Accounting:** no customer record created; no accounting effect from buyer details.
- **User:** issue a fair invoice with a buyer's WhatsApp number; confirm no new customer is created.

### 8.4 Fair-tagged stock (decision 1A)
- **Backend:** stock stays one pool per item; stock movements (purchase/sale/return) carry the fair tag so they can be reported per fair; no separate fair stock bucket.
- **Frontend:** a stock/quantity report can be filtered by the fair tag.
- **Accounting:** stock value is a single pool; the fair tag slices movements for reporting, never double-counts.
- **User:** tag stock bought for a fair and the fair's sales; run a stock-movement report filtered by the fair; confirm "bought / sold / returned at the fair" figures.

### 8.5 End of fair — school incentive
- **Backend:** the incentive is an ordinary expense you enter (+ a stock adjustment if books are handed over); not an automatic rule.
- **Frontend:** entered via the normal expense (and stock-adjustment) screens.
- **Accounting:** the expense posts to the chosen account; the stock adjustment reduces inventory.
- **User:** enter the incentive as an expense; confirm it hits the P&L and (if books given) stock drops.

---

## Area 9 — Subscriptions & settlement (design §11)

### 9.1 Advance invoice → Unearned Revenue
- **Backend:** "Deliver over time" invoice posts Dr AR / Cr Unearned Revenue; no sales to P&L, no COGS yet.
- **Frontend:** the Deliver-over-time switch is pre-filled by the customer's Subscription flag, overridable.
- **Accounting:** an advance invoice of ₹12,000 posts AR 12,000 / Unearned Revenue 12,000; P&L shows nothing yet.
- **User:** issue a yearly advance invoice; confirm it sits in Unearned Revenue, not Sales.

### 9.2 Advance payment
- **Backend:** payment posts Dr Cash / Cr AR.
- **Frontend:** recorded on the invoice header.
- **Accounting:** cash received clears AR; Unearned Revenue stays until delivery.
- **User:** record the advance payment; confirm AR clears, Unearned Revenue unchanged.

### 9.3 Delivery via linked challan
- **Backend:** finalising a linked challan posts Dr Unearned Revenue / Cr Sales (delivered portion); tracked item also Dr COGS / Cr Stock (FIFO), qty down.
- **Frontend:** the challan tracks delivered-vs-pending against the invoice.
- **Accounting:** one month's delivery (₹1,000) posts Unearned Revenue 1,000 / Sales 1,000 (+ COGS/stock if tracked).
- **User:** deliver one issue via a linked challan; confirm ₹1,000 moves from Unearned to Sales.

### 9.4 Cardinality (M4)
- **Backend:** advance invoice first; one invoice → many challans; one challan → one invoice (multi-invoice challan is v2); stock/revenue never double-counted.
- **Frontend:** challans list against their invoice; pending reduces as they're delivered.
- **Accounting:** total recognised across challans never exceeds the invoice.
- **User:** deliver in several challans; confirm pending reduces and totals tie out.

### 9.5 Price variance (mid-period rate change)
- **Backend:** supply-date rate used; earlier supplies keep their rate (price history by date).
- **Frontend:** each challan uses the rate effective on its date.
- **Accounting:** a mid-year rate change values later deliveries at the new rate, earlier at the old.
- **User:** change the rate mid-year; confirm later challans use the new rate.

### 9.6 Variance / settlement engine
- **Backend:** at period end/early closure, compares prepaid received vs delivered value at selling rates; produces a settlement statement (customer-narrative + internal per-magazine/per-rate-period table); over/under handled by refund / carry-forward / balance-due invoice; per-customer periods configurable.
- **Frontend:** two statement formats; export PDF/Excel.
- **Accounting:** statement figures tie to Unearned Revenue, Sales and payments; a balance-due invoice or refund posts correctly.
- **User:** close a subscription with a mid-period rate change; confirm the statement matches your hand-worked prepaid-vs-delivered figures.

### 9.7 Credit customers (M3)
- **Backend:** ordinary credit sale — normal invoice, payment when received; no challan-first billing.
- **Frontend:** a normal invoice flow.
- **Accounting:** posts a normal credit sale.
- **User:** bill a credit customer normally; confirm no deferral.

---

## Area 10 — Reports (design §12)

### 10.1 Fixed reports
- **Backend:** P&L, Balance Sheet, A/R + A/P aging, Inventory Valuation (summary + detail), Sales by item/customer, General Ledger, Trial Balance, Cash Flow, plus accepted additions; all read from GL postings.
- **Frontend:** each viewable per business, combined, fair-by-fair, with cash/accrual where relevant; shown on screen.
- **Accounting:** every report reconciles to the ledger and agrees with the others (P&L net profit ties to Balance Sheet / Trial Balance).
- **User:** run P&L and Trial Balance for the same period; confirm they agree.

### 10.2 Customize panel
- **Backend:** filters (customer, account, vendor, product, Book Fair tag, business); save + re-run; group with subtotals; schedule by email (needs internet); export PDF/Excel.
- **Frontend:** General / Rows-Columns / Filter / Header-Footer tabs.
- **Accounting:** filtering never changes the figures, only the slice.
- **User:** filter a report by a fair tag, save the customization, re-run it.

### 10.3 Simple report builder (Q4=B)
- **Backend:** pick entity → columns → filter → group with subtotals → export.
- **Frontend:** a guided builder, no code.
- **Accounting:** builder output reconciles to the source data.
- **User:** build a simple report (sales by customer for a fair); export it.

---

## Area 11 — Tax, custom fields, tags, notes (design §13)

### 11.1 Tax
- **Backend:** user-created tax names/rates, per-line, inclusive/exclusive, tax-exempt option, optional GSTIN on customers.
- **Frontend:** tax applied per line; inclusive/exclusive chosen.
- **Accounting:** tax posts to the tax account; inclusive vs exclusive compute the right base and tax.
- **User:** apply a 5% exclusive tax to a line; confirm the tax amount and posting.

### 11.2 Custom fields
- **Backend:** user-named, no limit, across invoices/bills/items/customers/reports; five types (text, multiline, dropdown, switch, date); any can be a duplicate-check key.
- **Frontend:** each type renders the right control.
- **Accounting:** custom fields carry no accounting effect.
- **User:** add a dropdown custom field to items; confirm it appears and filters in a report.

### 11.3 Tags
- **Backend:** name + colour, attachable to many record types, filterable across the app.
- **Frontend:** pills; filter by tag.
- **Accounting:** none (tags slice reports).
- **User:** create a tag, attach to a few records, filter by it.

### 11.4 Notes
- **Backend:** printed notes/terms on documents + internal staff-only notes that never print.
- **Frontend:** internal notes clearly marked staff-only.
- **Accounting:** none.
- **User:** add a printed note and an internal note; confirm only the printed one appears on the PDF.

### 11.5 Date tokens (Q8)
- **Backend:** :MONTH/:QUARTER/:YEAR/:WEEK in line text/notes, resolved on save.
- **Frontend:** typing a token resolves on save.
- **Accounting:** none.
- **User:** type "Subscription – :MONTH :YEAR"; confirm it resolves on save.

---

## Area 12 — Import / export / backup (design §14)

### 12.1 Import
- **Backend:** real .xlsx + CSV; two-phase (preview with delimiter/encoding auto-detect, then ingest with a column map); duplicate products update not duplicate; multi-row invoices grouped by document number; a failed row is skipped + collected, import does not abort; maps for customers/items/opening balances/past invoices/bills/credit notes.
- **Frontend:** a preview + column-map step; a skipped-rows report.
- **Accounting:** imported opening balances must balance; imported documents post correctly (or come in as historical, per the map).
- **User:** import a copy of your real Excel; confirm totals match and bad rows are listed, not silently dropped.

### 12.2 Export
- **Backend:** Excel, CSV, PDF across lists and reports.
- **Frontend:** export buttons on lists/reports.
- **Accounting:** exported figures match on-screen.
- **User:** export a report to Excel; confirm it matches the screen.

### 12.3 Backup & restore
- **Backend:** choose scope (everything vs database only); screen states what's included; restore warns, offers a pre-restore backup, sanitises incoming settings, can preserve users + counters.
- **Frontend:** scope selector + plain inclusion statement; restore warning.
- **Accounting:** a restored set of books shows the same numbers as before backup.
- **User:** back up, change some data, restore; confirm the books return to the backup state and the pre-restore backup exists.

---

## Area 13 — Login, users & roles (design §15)

### 13.1 Login
- **Backend:** Google sign-in at first-time setup + password recovery; daily login an app password (offline); ≥8 chars letters+numbers; lock 15 min after 5 wrong tries.
- **Frontend:** a clear lockout message; a "Stay signed in" prompt.
- **Accounting:** none.
- **User:** sign in with the app password; confirm 5 wrong tries lock for 15 minutes.

### 13.2 Idle sign-out
- **Backend:** auto sign-out after 1 hour idle, 1-minute warning, autosaved drafts preserved.
- **Frontend:** a warning with a "Stay signed in" button; typed work preserved on expiry.
- **Accounting:** none.
- **User:** leave idle; confirm the warning and that typed work survives.

### 13.3 Roles (Phase 1)
- **Backend:** one Admin role, full access; only Admin deletes (no-accounting items only).
- **Frontend:** delete available only to Admin and only on deletable items.
- **Accounting:** posted records can't be deleted, only cancelled.
- **User:** try to delete a posted invoice (blocked — cancel instead); delete an unissued draft (allowed).

---

## Area 14 — Audit & error logs (design §16)

### 14.1 Audit log
- **Backend:** every data-changing action recorded (who/what/when), read-only, tamper-evident via a hash chain; covers settings, tax-rate and product changes; line-item edits covered by kept prior versions.
- **Frontend:** the log is read-only in the app.
- **Accounting:** every posting traces to an audited action.
- **User:** make a change; confirm it's logged with who/what/when and can't be edited in the app.

### 14.2 Hash-chain integrity
- **Backend:** altering or deleting any entry breaks the chain; a verify step detects the break.
- **Frontend:** a verification result is shown.
- **Accounting:** an intact chain evidences an untampered book.
- **User:** run the integrity check on a clean log; confirm it reports intact.

### 14.3 Technical error log
- **Backend:** a separate developer log for crashes/failures (PDF, mail, security) — not business actions.
- **Frontend:** separate from the audit log.
- **Accounting:** none.
- **User:** (developer) confirm a forced PDF failure is recorded in the technical log, not the audit log.

---

## Area 15 — Settings (design §17, incl. the new additions)

### 15.1 Numbering patterns
- **Backend:** per document type per business — prefix + FY + counter, with padding, resetting per financial year (follows the FY, not 1 January — Q11); plus the new richer tokens + optional shared counter.
- **Frontend:** a pattern builder; a preview of the next number.
- **Accounting:** none.
- **User:** set a pattern with a year token; confirm the preview and that it resets at FY start.

### 15.2 Financial year & amount grouping
- **Backend:** FY per business; amount grouping Indian (10,00,000.00) or international (1,000,000.00).
- **Frontend:** a grouping toggle changes displayed amounts.
- **Accounting:** grouping is display-only; figures unchanged.
- **User:** switch grouping; confirm amounts re-format but totals are identical.

### 15.3 Lists & identity
- **Backend:** editable lists (payment methods, tax names/rates, units, chart of accounts, classification); business identity (name, address, logo); low-stock business fallback; optional email account.
- **Frontend:** each list is add/edit; identity shows on documents.
- **Accounting:** linked accounts affect postings.
- **User:** add a unit and a payment method; confirm both appear where used.

### 15.4 New §17 additions
- **Backend:** central custom-fields management; product settings (default Track-stock for new items, show stock qty on challan/PDF, low-stock alert on/off); date-format choice; optional document-lock mode; email detail (reply-to, BCC, signature, attach-PDF); bank-transaction rules placeholder (for the future bank-import feature).
- **Frontend:** each is a settings control with a sensible default.
- **Accounting:** a document-lock mode (if on) freezes an issued/paid document, consistent with FY-lock.
- **User:** set new items to default Track-stock = Yes; create an item; confirm it defaults correctly.

---

## Area 16 — Reliability, cross-cutting (design §18)

### 16.1 Pre-save checks
- **Backend:** incomplete rows and zero quantities blocked with plain messages.
- **Frontend:** the message names the problem row.
- **Accounting:** nothing posts until the document is valid.
- **User:** try to save a zero-quantity line (blocked).

### 16.2 Atomic save & number collision
- **Backend:** app-given numbers with a collision-retry and an atomic save lock; a double-click never makes two invoices.
- **Frontend:** a double-click on Save produces one document.
- **Accounting:** exactly one posting results.
- **User:** double-click Save; confirm one invoice, one number.

### 16.3 Negative stock & concurrency
- **Backend:** negative stock blocked; a stock concurrency guard prevents two sales overselling the same units.
- **Frontend:** a short-stock save blocked with "Add stock".
- **Accounting:** stock never goes below zero in the books.
- **User:** try to sell more than on hand (blocked).

### 16.4 Network / session resilience
- **Backend:** form state survives an API/network error; a session-expiry prompt preserves typed work; import pre-check; backup/restore warnings.
- **Frontend:** after a dropped connection, the form still holds your entries.
- **Accounting:** no partial posting from an interrupted save (all-or-nothing).
- **User:** simulate a connection drop mid-entry; confirm your typed work is still there.

### 16.5 Acceptance (design §19)
- The master acceptance test for every area above is **your hand-worked figures**: you prepare samples, work the expected numbers by hand, and the reports must match exactly. The §19 scenarios — books-always-balance, cancel, subscription, variance/settlement, audit, import, backup/restore, FY-lock, duplicate/merge — are covered within their areas above. Phase-2 role and two-device tests are deferred with Phase 2.

---

*End of testing specification (v1 draft). §20 (CA/legal) has no functional tests. Next in the queue after this: write the missing Section 5 (Customers) into the design document.*
