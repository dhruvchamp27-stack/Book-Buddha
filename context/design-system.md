# Design System — Book Buddha

> **Filled 2026-11-15 from the project's own docs.** Honest note: the spec describes
> **UX behaviour and principles** in detail but specifies **almost no visual design** —
> colour, typography, spacing, iconography and brand styling are **genuine owner
> decisions and are NOT invented here**. Every such gap is marked **OWNER DECISION — not
> in docs**. The only UI reference material is the `reference/` Invoice Ninja teardown,
> which is **inspiration only, never a rule** *(DEC "Not a decision")*. Overarching
> constraint: the user is a **non-accountant**, so the UI hides accounting mechanics and
> speaks plain English *(DD §1.1, §2.2, §4.1; PRD §4)*.

## 1. Principles (stated in the spec)
- **Ease of use is the main goal** — easy for a non-accountant; plain-language screens,
  few steps, accounting handled underneath *(DD §1.1, §2.2; PRD §4)*.
- **Never show debits/credits or deferral** to the normal user unless they deliberately
  open the ledger *(DD §4.1)*.
- **Generic, not industry-specific** — no hardcoded special-case rules in the UI
  *(DD §2.2)*.
- **Flat, plainly named navigation** — about **2 clicks to any tab** *(DD §17; AF §2.3,
  §11.1)*.
- **Plain, actionable messages** for validation and errors — no accounting jargon
  *(DD §18; AF Part D)*.
- *"One primary action per screen"* — **not stated in docs**; propose as a working
  principle, owner to confirm.

## 2. Brand & tone
- **Name:** Book Buddha (wordmark/logo styling: **OWNER DECISION — not in docs**; business
  logo is user-uploaded — DD §17).
- **Voice:** calm, plain, non-technical — follows directly from the non-accountant
  principle *(DD §1.1; PRD §4)*. Exact tone guidelines: **OWNER DECISION — not in docs**.
- **Locale:** English only; INR; India-adapted defaults *(DD §1.7; PRD §2)*.
- **Number grouping:** user-chosen Indian (`10,00,000.00`) or international
  (`1,000,000.00`) *(DD §17)*.
- **Date format:** user-chosen display; compact `DD/MM/YY` entry *(DD §7.8, §17)*.

## 3. Color
- Palette (primary / neutrals / semantic success-warning-error), light/dark, contrast
  targets: **OWNER DECISION — not in docs.** Nothing in the spec fixes a colour system.
- The one colour behaviour that *is* specified: **tags** are user-chosen name + colour,
  shown as pills *(DD §13.3)*. Status-chip colours: **not in docs**.
- Recommendation to the owner (not a decision): target **WCAG AA** contrast when the
  palette is chosen.

## 4. Typography
- Font family / scale / weights: **OWNER DECISION — not in docs.**
- Money numerals: integer-paise storage means totals display needs a consistent money
  format (tabular/aligned figures recommended); the **rounding display** rule is still
  **DECISION PENDING** (whole-rupee shows amount-before-rounding + round-off line + final
  total; receipts keep paise) *(DD §7.4 — contested, see `todos.md`)*.

## 5. Layout & spacing
- Grid / spacing scale / density: **OWNER DECISION — not in docs.**
- Primary layouts the UI must support (from named screens, §6): list screens, a document
  editor (invoice/bill/credit note/challan), a reports viewer with a Customize panel, and
  Settings/Admin screens *(AF §3–§12)*.

## 6. Components & screens
Visual specs (anatomy/variants/states) are **owner decisions**; what the docs fix is
**which screens and document types exist** and **how they behave**:

**Document types** *(DD §8, §11.6; PRD §5.9; AF §5–§9)*: invoice · quotation · credit note
(visually distinct) · challan (linked/standalone, distinct badge) · recurring invoice ·
bill · expense · purchase order · payment (PMT) · settlement statement · customer
statement · balance-due invoice.

**Screen groups** *(AF §1–§12)*: Setup (Google sign-in → company → business → chart of
accounts → FY → numbering → opening balances → app password → dashboard) · Login / Forgot
password / Session expiry · Customers (directory, detail w/ 5 tabs, statement, merge) ·
Items (list, stock-in/adjust, low-stock alerts) · Invoices (list, editor, Drafts, receive
payment, cancel/edit) · Quotations / Credit notes / Challans / Recurring / Bills /
Expenses / POs · Payments (allocation, credit, refund/return/write-off) · Fairs (list,
P&L, fair invoicing, end-of-fair incentive) · Subscriptions (advance invoice, linked
challan, variance, settlement) · Reports (home, viewer, Customize, simple builder) ·
Settings · Admin (audit log, error log, FY lock, import/export, backup/restore).

- **Status chips** *(DD §7.6, §8.1, §8.6)*: invoice **Draft / Issued / Partial / Paid /
  Cancelled** (overdue/unpaid are calculated); quotation Draft / Sent / Approved /
  Converted / Rejected / Expired; PO Draft / Sent / Accepted / Received / Cancelled; plus
  a **Locked** state. ⚠ **Naming inconsistency:** DD §4.2/PRD say "Finalised" while
  DD §7.6 names the invoice state "Issued" — pick one label. **Archived** chip is **v2 /
  awaiting owner approval** *(DD §1.5 vs DEC FD)*.
- **Dashboard / Home content:** **GAP — undesigned** *(AF §2.2; PRD §9)*.
- **Bank/OCR review queue (Add vs Match):** exists only in DEC FD, **awaiting owner
  approval**, not in AF — design only if approved for V1.
- Buttons, forms/inputs, data tables, empty/loading/error states, toasts: **visual specs
  are OWNER DECISIONS**; their required *behaviours* are in §7.

## 7. Interaction patterns (stated)
- **Autosave** on; the document number is taken at first autosave *(DD §7.2, §7.3;
  AF §5.3)*.
- **Leave-warning** every time on an unfinalised autosaved draft *(DD §7.3; AF §5.3)*.
- **Save & New** for invoices / fair invoicing *(DD §10.2; AF §5.2, §8.4)*; **Save & Add
  Another** for items *(DD §6.1; AF §4.2)*. For **customers** it's a **GAP** *(PRD §9)*.
- **Duplicate = warn-but-allow** for customers and items (suggests the existing record,
  lets you continue) *(DD §5.4, §6.6; AF §3.2, §4.2)*.
- **Keyboard shortcuts:** a small documented set exists (Save, Save & New, new
  invoice/bill, help key); **exact keys are a GAP**, fixed at build time *(DD §7.8;
  AF Part E)*.
- **Inline math** in amount/qty fields; fast date entry; date tokens `:MONTH :QUARTER
  :YEAR :WEEK` *(DD §7.8, §13.5; AF §5.2)*.
- **Confirm before cancel**; typed work preserved on session expiry; form state survives
  an API/network error *(AF §5.5; DD §15.2, §18)*.
- **Two-phase import** (preview → column map) *(DD §14.1)*; bulk "Mark paid" asks once for
  date + method *(DD §7.7)*; a checked payment row auto-fills the balance, applying oldest
  first *(DD §9.2)*.
- **Custom fields** via a **gear icon** on a record page *(PRD §5.11; AF §3.2, §11.5)* —
  which record types beyond invoices/bills/items/customers/reports is a **GAP**.

## 8. Iconography
- Icon set & usage rules: **OWNER DECISION — not in docs.** The only icon the spec names
  is the **gear** for inline custom fields *(PRD §5.11; AF §11.5)*.

## 9. Responsive / devices
- **Phase 1:** one PC, browser screens — no phone/responsive breakpoints stated
  *(DD §1.1, §2.3)*.
- **Phase 2:** tablet at the fair + other devices on the same LAN (each opens the PC's
  address in its own browser); larger touch targets, Save & New — **to be designed**
  *(DD §2.4 — OWNER DECISION PENDING)*. Phone layout: **not in docs**.

## 10. References (inspiration only — not rules)
- `reference/Invoice Ninja — Actual App Flow (reference).md`, `reference/IN-ui-*`,
  `reference/IN-ux-*`, and the screenshots folders.
- Where Invoice Ninja differs from our rules (cancel-with-reversal, locked edits, no
  number reuse), **our rules win** — see `decisions.md`.
