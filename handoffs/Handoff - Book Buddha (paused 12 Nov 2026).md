# Handoff – Book Buddha (paused 12 Nov 2026)

Paste the companion prompt (`Prompt - next session (App flow) - 12 Nov 2026.md`) at the start of the
next chat in the Billing Project. Carries forward the 10 Nov handoff. Full decision history still
lives in `Handoff - Fair Accounting App paused 8 Nov 2026 session 2.md` §7,
`Decisions - 9 Nov 2026 (the 15 questions).md`, and `Handoff - Fair Accounting App paused 10 Nov 2026.md`.

## 1. Where we stopped
- The **design document is now reconciled and finalised** (pending only your final read / approval):
  `Design Document - Book Buddha (9 Nov 2026).md`. Every decision from this session is folded **into
  the body** — no loose appendix at the end.
- **Resume point:** your final approval of the design doc, then write the **App flow (12 sections)**,
  one at a time.
- Nothing is built. Spec → plan → build, in that order.

## 2. How to work with me (unchanged)
- Short answers, one step at a time, confirm before moving on. Finance professional, no-code
  background, not an engineer.
- Always tell the truth, cite real sources, say "I cannot confirm this" when unverifiable. No guessing.
- Spec first, plan second, build third. No implementation plan until I confirm the spec; no code
  until I confirm the plan.
- Questions in sets of up to 5, one decision each, lettered options; I answer "1A, 2B".
- Put full section content in the message. Plain-text questions, not cards.
- Files live in `C:\Users\Admin\Desktop\Book Buddha`. Save handoffs/prompts there, not as project files.
- Design principle: the app must leave me free to manage things my own way; no strict built-in rules.
  Fixed parts: double-entry, audit log, cancel with reversal.

## 3. What was decided / done this session (12 Nov)
- **Fair → Project model (decision 1A).** A **Project** is now a first-class, QBO-style dimension —
  **tied to ONE customer**, its own **P&L**, invoices and costs **belong to it**. A **Book Fair is a
  *type* of project**. On screen the word stays **"Fair."** **Tags** are a separate, lighter
  free-label system — a Book Fair is NOT a tag. Reconciled through §1–§4, §7, §10, §12, §13.
- **Host school = an ordinary customer** (no special "school" field).
- **Section 5 (Customers) — WRITTEN and APPROVED**, inserted at its real slot (§5). Built from
  PRD §4.11 + **Q1** (two-ledger credit: Customer Advances + Credit Notes, one combined balance shown)
  + **Q2** (merge: merges identities not transactions, never alters accounting, keeps original
  IDs/dates/numbers, old ID kept as alias, audit-logged, undo when safe).
- **No per-fair Balance Sheet.** QBO Projects give P&L only, not a per-project Balance Sheet.
  Fair-level reporting = P&L + A/R + income/cost views; the Balance Sheet stays at business/company
  level. (§12.1, §10.1.)
- **Data-entry accelerators — new §7.8:** inline math in amount/qty fields (`500/2`→`250`, with
  parentheses); **fast date entry** (compact DD/MM/YY — `121126`→12/11/2026, `121125`→12/11/2025,
  `1211`→12/11 current year; plus `T`=today, `M`=month start); keyboard shortcuts (Save, Save & New,
  etc.); transaction attachments. Plus a **Refresh button** on reports (§12.2).
- **7 settings additions accepted → §17:** (1) richer numbering tokens + optional shared counter;
  (2) central custom-fields management; (3) product defaults (default Track-stock, show qty on
  challan/PDF, low-stock on/off); (4) date-format choice; (5) optional document-lock; (6) email
  detail (reply-to/BCC/signature/attach-PDF); (7) bank-transaction rules. Skipped list recorded.
- **Fair-tagged stock (1A) → §6.9 + §10.4:** ONE stock pool; tag movements (purchase/sale/return)
  to the fair for per-fair stock/COGS; no separate fair bucket.
- **Bank-import (PDF + OCR, offline, no live feed) and OCR capture → v2** (§1.5), with the honest
  caveat that reliable OCR usually needs a cloud service (internet), which rubs against offline-first.
- **QBO research done** (Intuit + reputable sources): confirmed the inline-math field calculator,
  Receipt Capture does header-only OCR (vendor/date/total, no line items → third-party needed for
  line items), 50+ keyboard shortcuts, recurring/delayed charges. The earlier "QBO mapping" appendix
  was **dissolved into the body** (business = whole-entry tagging → §3.2/§4.3; magazine "why QBO isn't
  enough" → §11; no per-fair BS → §12.1).
- **Saved:** design doc written to the laptop folder AND to the Project as
  `Design Document - Book Buddha (current).md`; the stale Project `Fair Accounting App – Design
  Document (Draft 1)` was deleted. One current copy in each place.

## 4. Files on disk (this session touched these)
In `C:\Users\Admin\Desktop\Book Buddha\`:
- `Design Document - Book Buddha (9 Nov 2026).md` — **UPDATED** (reconciled 12 Nov; source of truth).
- `Handoff - Book Buddha (paused 12 Nov 2026).md` — this file.
- `Prompt - next session (App flow) - 12 Nov 2026.md` — paste at next session start.
- Prior references unchanged: `testing/testing.md`, the 9/10 Nov handoffs,
  `Decisions - 9 Nov 2026 (the 15 questions).md`, `Filter sheet - Book Buddha (8 Nov 2026).md`,
  `invoice-ninja-reports/`. Project file: `PRD_Magazine_Subscription_Management_v4`.
- The Project (Billing Project) now also holds `Design Document - Book Buddha (current).md`.

## 5. Pending on the design doc
Nothing. All four fold-ins are done and the doc is internally consistent on the project model.
The only thing left is your final read / approval.

## 6. Open items not mine alone to settle (unchanged)
- CA: principal vs agent (full sale vs margin) and GST classification/timing for the magazine resale.
- Lawyer: buyers' personal data (India DPDP Rules 2025, staged); and before giving away or selling the app.
- GST: the magazine PRD records "GST: Exempt" as the stated scope; unconfirmed.

## 7. Next steps
1. Final read / approval of the design doc.
2. Write the **App flow (12 sections)**, one at a time, each approved. Propose the 12-section list
   first, then write section 1.
3. Update the **PRD** and **Features List** to match the finalised design.
4. I confirm the spec. **Only then** the implementation plan (writing-plans skill).
5. Only after I confirm the plan, build.
