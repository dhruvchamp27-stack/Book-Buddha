# PRODUCT.md — Book Buddha

> **Status:** DRAFT for owner review (15 Nov 2026). Distilled from `context/PRD.md`
> and `context/app-flow.md` (which themselves cite the approved spec,
> `spec/Design Document - Book Buddha (9 Nov 2026).md` — not read directly here).
> **Nothing here is invented.** Each section cites its source. Where the spec leaves
> something open it is marked **OPEN**, not guessed.
>
> This is the product half of the source of truth. The design half is `DESIGN.md`;
> how we work together is `WORKFLOW.md`. External skills may advise but never
> override what these three files record.

---

## 1. What this is, in one line
A **local, offline-first, double-entry accounting app** that runs as a web app on
**one PC**, built so a **non-accountant** can run real books — the accounting happens
underneath, in plain language on the surface. *(PRD §1, §4)*

**Quality benchmark:** QuickBooks Online — its usability, polish, consistency and
reliability. **Not** its green/utilitarian look. Book Buddha has its own
modern-premium identity. *(handoff §1)*

## 2. Who uses it
- **v1 (Phase 1):** a **single Admin** on one PC — full access; only Admin can delete,
  and only no-accounting items. This is what we design for now. *(PRD §2)*
- **v2 (Phase 2, later):** extra **invoicing-only** users on other devices / a tablet
  at a fair (create + cancel invoices only, scoped data, never delete). Designed once
  Phase 1 is an accepted MVP. *(PRD §2; app-flow Part C)*
- **Locale:** English only · INR · India-adapted defaults. *(PRD §2)*

## 3. The value — what a non-accountant gets
- Create and name their own businesses, fields, layouts, numbering, chart of accounts,
  tags. Starts **blank and generic**, not industry-specific. *(PRD §1, §4)*
- Does correct double-entry books **without the user ever seeing debits/credits**. *(PRD §4; design-system §1)*
- Organised **fair-wise**: a Book Fair is one kind of **Project** (a customer-linked
  dimension with its own P&L), so the whole books can be sliced fair-by-fair. *(PRD §5.8)*

## 4. The three fixed parts (never bend — they shape the UI)
1. **Double-entry, automatic** — every transaction posts balanced debits/credits; a
   save that wouldn't balance is rejected. The user never types debits/credits. *(PRD §4)*
2. **Audit log** — every data-changing action recorded (who/what/when), read-only,
   tamper-evident hash chain, from day one. *(PRD §4, §5.14)*
3. **Cancel-with-reversal** — issued/posted documents are never erased, only cancelled
   (posts the exact reverse, returns stock, stays visible, number never reused). Hard
   delete is limited to no-accounting items, Admin-only. *(PRD §4; app-flow Part C)*

**UI consequence:** the surface hides accounting mechanics; "Cancel" (not "Delete")
is the norm on anything posted; every destructive action is logged.

## 5. Core objects (domain glossary — use these exact words in the UI)
- **Company** — top container, one per install, one database file. *(PRD §5.1)*
- **Business** — one or more under the company (e.g. Books, Magazines); every record is
  tagged to exactly one. Shared chart of accounts; own numbering per business. *(PRD §5.1)*
- **Customer** — Individual/Business/Company/Partnership/Trust/Charity/Government/Other;
  app-numbered by category (SCH/LIB/CLG/RET/GEN). *(PRD §5.3)*
- **Item** — catalogue entry, optional stock tracking (FIFO), MRP, per-supplier pricing. *(PRD §5.4)*
- **Fair** — the on-screen name for a **Project**: tied to one host customer, own P&L. *(PRD §5.8)*
- **Documents:** Invoice · Quotation · Credit note · Challan (delivery note) · Recurring
  invoice · Bill · Expense · Purchase order. *(PRD §5.5–5.6)*
- **Payment (PMT)** · **Settlement statement** · **Balance-due invoice** (subscriptions). *(PRD §5.7, §5.9)*
- **Tag** — name + colour pill, attachable to many record types, filterable. Lighter and
  separate from Projects. *(PRD §5.11)*

## 6. Core use cases (the journeys the UI must make effortless)
*(app-flow Part A)*
1. **First-run setup:** Google sign-in → company → business(es) → chart of accounts →
   financial year → numbering → opening balances → app password → Dashboard.
2. **Daily use:** app-password login → Dashboard → an area → work → Save → back to list.
3. **Make an invoice:** pick customer → add lines → Deliver now / over time → Save (posts)
   → optionally Receive payment.
4. **Run a fair:** new fair → link host customer → fair invoicing (Save & New) → end of
   fair incentive expense → view fair P&L.
5. **Subscription cycle:** advance invoice (Unearned Revenue) → each delivery = linked
   challan → finalise challan (recognises revenue + COGS) → period-end settlement
   (refund / carry-forward / balance-due invoice).

## 7. Functional scope (v1, Phase 1)
**In scope:** company → businesses → shared chart of accounts; accounting engine
(double-entry, posting, FY lock, opening balances); customers; items & basic inventory;
documents (invoices, quotations, credit notes, challans, recurring invoices,
bills/expenses, POs); payments & money (methods, split allocation, overpayment/credit,
refunds, returns, write-off); Projects/Fairs; subscriptions & deferred revenue; reports
(fixed set + simple builder); optional India-adapted tax; date tokens, custom fields,
tags, notes; data-entry accelerators; import/export/backup; login, audit log + error
log, Settings. *(PRD §3)*

**Out of scope / deferred (v2):** invoicing-only users & tablet-at-fair; more than one
company per install; online/SaaS; payment gateways, live bank feeds, portal,
e-invoicing; archive as a third record state; full pivot report builder; bank PDF import
+ OCR. *(PRD §3)*

## 8. Screen inventory (what the UI must cover)
*(design-system §6; app-flow §1–§12). The build order lives in `WORKFLOW.md`.*

| Group | Screens |
|---|---|
| **Setup & login** | Google sign-in · create company · businesses · chart of accounts · FY · numbering · opening balances · app password · login · forgot password · session-expiry |
| **Dashboard** | Home — **content undesigned (OPEN)** |
| **Customers** | directory · create/edit · detail (5 tabs) · statement · merge · delete/deactivate |
| **Items & stock** | list · create/edit · stock-in/adjust · low-stock alerts |
| **Invoices** | list · editor · drafts/autosave · receive payment · cancel/edit |
| **Other documents** | quotations · credit notes · challans · recurring · bills/expenses · POs |
| **Payments** | list · receive/allocate · customer credit · refund/return/write-off |
| **Fairs (Projects)** | list · create/edit · detail + P&L · fair invoicing · end-of-fair incentive |
| **Subscriptions** | subscription flag · advance invoice · linked challan · variance/settlement |
| **Reports** | home · viewer · Customize panel · simple builder |
| **Settings** | numbering · FY · lists · custom fields · product defaults · email · identity · other |
| **Admin & safety** | audit log · error log · FY lock · import (two-phase) · export · backup/restore |

## 9. Cross-cutting rules that touch almost every screen
- **Never show debits/credits** (or "deferral") to the normal user unless they
  deliberately open the ledger. *(design-system §1; PRD §4)*
- **Flat, plainly named navigation — ~2 clicks to any tab.** *(PRD §5.15; app-flow §2.3)*
- **Autosave on;** the document number is taken at first autosave; leaving an unfinalised
  draft warns **every time**. *(PRD §5.5; app-flow §5.3)*
- **Duplicate = warn-and-allow** (customers, items): suggest the existing record, let the
  user continue. *(PRD §5.3, §5.4)*
- **Plain, actionable** validation/error messages — no accounting jargon. *(design-system §1)*
- **Money:** stored in integer paise; invoice/quotation **totals round to the nearest
  whole rupee** (≥50 p up, <50 down) showing amount-before-rounding + round-off line +
  final total; **actual receipts keep paise**; grouping Indian or international per
  Settings. *(PRD §5.5, §9)*
- **Dates:** compact `DD/MM/YY` entry (T=today, M=month start), display format chosen in
  Settings; date tokens `:MONTH :QUARTER :YEAR :WEEK` resolve on save. *(PRD §5.11; app-flow §5.2)*
- **Data-entry accelerators app-wide:** inline math in amount/qty fields; Save & New;
  Save & Add Another; keyboard shortcuts (exact keys OPEN). *(PRD §5.5)*
- **Custom fields** added inline via a **gear icon** on a record page, plus central
  management in Settings. *(PRD §5.11)*

## 10. Constraints & non-functionals
- **Platform:** local web app on one PC; one DB file per company; no cloud for daily use;
  internet only for optional Google sign-in and email. *(PRD §6)*
- **Scale:** comfortable at a small business's volumes (hundreds of customers,
  tens-of-thousands of ledger lines). *(PRD §6)*
- **Reliability:** committed records survive an unexpected shutdown; in-progress typed
  work is preserved; drafts respect the draft-vs-issuance boundary; all-or-nothing saves;
  a double-click never makes two invoices. *(PRD §6, §7)*
- **Phase 1 devices:** one PC, browser screens — **no phone/responsive breakpoints are
  specified for v1.** Tablet-at-fair is Phase 2. *(design-system §9)* — see `DESIGN.md` for
  our responsive stance.

## 11. OPEN product decisions (affect specific screens — do not invent)
*(PRD §9; app-flow Part E)*
1. **Dashboard / Home content** — undefined. What figures / shortcuts / alerts?
2. **Customer financial-summary panel** — "pending, not yet designed."
3. **Custom-fields coverage** — confirmed on invoices/bills/items/customers/reports;
   quotations/credit notes/challans/POs not yet confirmed.
4. **"Save & add another" on customers** — named for items, not customers; include it?
5. **Subscription settlement build details** — early-closure behaviour, statement
   layouts, refund-vs-carry-forward defaults.
6. **Keyboard shortcut keys** — exact keys fixed at build time.
7. **Rounding display** — **resolved in the PRD (12 Nov 2026)**: whole-rupee rounding shown
   as amount-before-rounding + round-off + final total; receipts keep paise. `HOT.md` /
   `todos.md` carry a **stale "pending" flag** — just need a one-line reconfirm before the
   invoice editor, not a fresh decision.
8. **Status-label naming** — "Issued" vs "Finalised" inconsistency to settle. *(design-system §6)*
9. **Archive as a third record state** — v2 / awaiting owner approval. *(design-system §6)*

---
*Sources: `context/PRD.md`, `context/app-flow.md`, `context/design-system.md`,
`saas_design_development_handoff.md`. Companion files: `DESIGN.md`, `WORKFLOW.md`.*
