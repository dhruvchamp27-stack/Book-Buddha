# Features List — Book Buddha

*Companion to `PRD - Book Buddha.md`. Rebuilt 12 Nov 2026 from `Design Document - Book Buddha (9 Nov 2026).md` + `APP_FLOW.md`; magazine features folded in. Supersedes `Features List – Fair Accounting App (Draft v0.1)`. Status: **v1** = build now (Phase 1, Admin), **v2** = deferred, **(fixed)** = never bends.*

## 0. Fixed foundations (never bend)
- Double-entry, automatic — books always balance; user never types debits/credits. **(fixed)**
- Audit log — every data-changing action (who/what/when), read-only, tamper-evident hash chain. **(fixed)**
- Cancel-with-reversal — posted documents cancelled (exact reverse + stock return), never erased; number never reused. **(fixed)**

## 1. Setup, company & structure — v1
- One company per install; one database file; one backup for the whole company.
- Create/name one or more businesses; every record tagged to exactly one business (whole entry).
- Per-business numbering sequences + prefixes; shared one chart of accounts.
- Chart of accounts: pick a ready-made set **or** build your own; add/rename anytime; link items to accounts.
- Financial year per business; numbering resets each FY.
- Opening balances via Excel import or typing screen (must balance; Opening Balance Equity holds difference).

## 2. Accounting engine — v1
- Automatic balanced journal entry on every posting; save rejected if unbalanced.
- Draft posts nothing (reserves stock only); finalise/issue posts; all-or-nothing.
- Single general ledger every report reads; sliceable by business, fair, tag, combined.
- Accrual engine; cash/accrual choice on reports.
- FY lock (Admin-only correction into a locked period).

## 3. Customers — v1
- Create/edit: name + classification + numbering-category (SCH/LIB/CLG/RET/GEN, auto-number from 0001).
- Optional: GSTIN, website, one email, up to two contacts, Bill To/Ship To (copy button), internal notes.
- Duplicate warn-but-allow (name/phone/email/GSTIN).
- Merge tool (identities not transactions; preview, transfer all, recalc balance, alias, undo).
- One combined credit balance (two ledgers underneath).
- Customer page: 5 tabs (Invoices/Quotations/Payments/Documents/History); account statement (PDF/Excel).
- Attachments ≤20 MB; directory with search/sort/filter/column controls/saved prefs; bulk Inactive.
- **Deferred:** customer financial-summary panel (not yet designed).

## 4. Items & stock — v1
- Item fields: name, unit, selling/cost/MRP, Track stock Yes/No, linked accounts, thresholds, image, custom fields (duplicate-check key e.g. ISBN), per-supplier price list; "Save & add another".
- Tracked items: FIFO cost layers; buy→Inventory asset, sell→COGS; negative stock blocked; draft reserves qty.
- Untracked items: cost at bill, revenue at invoice; non-posting challan.
- Price history by date; per-supplier default purchase price.
- Low-stock threshold per item + business-level fallback.
- Fair-tagged stock movements (one shared pool; per-fair stock/COGS reporting).

## 5. Invoices — v1
- Create direct or Deliver-over-time (switch pre-filled by customer Subscription flag).
- Lines: item+qty, line discount, document lump-sum discount, extra charges, optional per-line tax, date tokens, MRP shown; **totals exact to paise**.
- Per-business numbering `INV-001/26-27`, resets each FY; number used on first save; autosave + draft warning.
- Lifecycle Draft/Issued/Partial/Paid/Cancelled; Overdue/Unpaid calculated; edit keeps old version; cancel reverses + returns stock; receive payment on header.
- Bulk actions + Excel list export; bulk Mark paid; delete Admin-only.
- Data-entry accelerators: inline math, fast date entry (compact DD/MM/YY, T/M keys), keyboard shortcuts, transaction attachments.

## 6. Other documents — v1
- Quotations (own sequence; convert to invoice, links both ways, optional term carry-over).
- Credit notes (separate, visually distinct; issuance + application).
- Challans: linked (posts delivery, delivered-vs-pending) and standalone (non-posting, distinct badge); print suppresses cost/totals, substitutes shipping address.
- Recurring invoices (frequencies + run-forever; interlock skips if a child is unpaid; date tokens).
- Bills & expenses (categories = chart of accounts; recurring auto-writes period).
- Purchase orders (Received increments stock; links to bill/expense; no sales-invoice conversion).

## 7. Payments & money — v1
- Methods editable (Cash/Bank/UPI/Cheque/Other).
- Split one payment across invoices of one customer; multiple partials; overpay-single-line blocked; apply-oldest-first; auto-fill balance.
- Customer credit: two ledgers, one shown figure; apply/adjust.
- Payment immutability (amount + customer frozen; reverse-and-re-enter).
- Refunds, sales returns, bad-debt write-off (all v1; history preserved; recovery links back).
- Numbering `PMT-001/26-27`.

## 8. Projects (Fairs) — v1
- Create a fair tied to one host customer (ordinary customer); first-class dimension, own P&L.
- Fair invoicing with Save & New; UPI/Cash mode recorded.
- Buyer details optional, stored on the invoice only (name + one contact).
- Fair stock & COGS tagged (one shared pool).
- End-of-fair school incentive entered as an ordinary expense (+ stock adjustment if handed over).
- **No per-fair Balance Sheet.**

## 9. Subscriptions / magazines — v1
- Generic deferred-revenue behaviour (not a hardcoded mode).
- Billing models covered: Subscription (advance invoice + challans + settlement), Credit, Retail, Order-based (ordinary invoices).
- Advance invoice → Unearned Revenue; linked challan finalise → recognise revenue + COGS.
- Per-customer subscription periods (non-calendar, editable at renewal).
- Mid-period price change by supply-date rate; rate-change log.
- One invoice → many challans (one challan → one invoice); delivered-vs-pending.
- Variance/settlement engine: prepaid vs delivered-at-selling-rate; two statement forms (narrative + per-magazine table); refund / carry-forward / balance-due invoice.
- Magazine purchase-cost history + rate audit per challan.
- **Deferred (v2):** one challan spanning several invoices.
- **Build-time to finalise:** early-closure behaviour, statement layouts, refund-vs-carry-forward defaults.

## 10. Reports — v1
- Fixed set (17 reports incl. P&L, Balance Sheet, A/R & A/P aging, Inventory Valuation, GL, Trial Balance, Cash Flow, Sales by customer/item, stock/qty-on-hand).
- Per business / combined / fair-by-fair (all except Balance Sheet); cash/accrual; shown on screen.
- Customize panel (filters incl. fair/tags/business), save customization, group+subtotals, schedule by email, export PDF/Excel, Refresh.
- Simple report builder (entity → columns → filter → group → export).
- **Deferred (v2):** full pivot / group-by-3 / group-by-custom-field builder.

## 11. Tax, custom fields, tags, notes — v1
- Tax optional (user names/rates, per-line, inclusive/exclusive, tax-exempt, optional GSTIN).
- Custom fields: no limit, five types, duplicate-check key; central management + **gear icon on each record page**.
- Tags: name+colour pills, filterable; separate from Projects.
- Printed + internal notes; date tokens resolved on save.
- **Open:** which records beyond invoices/bills/items/customers/reports carry custom fields.

## 12. Import / export / backup — v1
- Import .xlsx + CSV, two-phase, column map; duplicates update; failed rows skipped+collected.
- Import maps: customers, items (with stock), opening balances, past invoices/bills, credit notes.
- Export Excel/CSV/PDF across lists and reports.
- Backup/restore with chosen scope, plain statement of contents, pre-restore backup, settings sanitised, preserve users+counters.

## 13. Login, users & roles
- v1: single Admin; Google sign-in (setup + recovery); app password daily (offline); lockout; auto sign-out.
- **v2:** invoicing-only users on other devices / tablet at fair (scoped data, create+cancel only, role + two-device tests).

## 14. Audit & safety — v1
- Audit log (covers settings/tax/product changes); technical error log (separate).
- Reliability: pre-save checks, atomic numbering lock, session-expiry preserving work, negative-stock block, stock concurrency guard.

## 15. Settings — v1
- Numbering patterns (+ richer tokens, optional shared counter); FY per business; amount grouping; lists; central custom fields; product defaults; date-format; optional document-lock; email account (optional); business identity (logo); low-stock fallback; bank-transaction rules (pairs with v2 bank import).

## 16. Explicitly deferred (v2)
Invoicing-only users & tablet-at-fair; multi-company; online/SaaS; payment gateways, live bank feeds, portal, e-invoicing; archive as a third record state; full report builder; shared book catalogue; **bank transactions via PDF import + OCR**; OCR capture to avoid re-keying; challan spanning several invoices.

## 17. Not the app's to decide (CA / legal)
Principal-vs-agent & GST classification/timing (CA); buyers' personal data under DPDP Rules 2025 & giving-away/selling the app (lawyer); GST-Exempt scope unconfirmed.

*End of Features List.*
