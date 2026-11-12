# Handoff – Book Buddha (paused 10 Nov 2026)

Paste or share this at the start of the next chat in the Billing Project. Carries forward the
9 Nov session 3 handoff. Full confirmed-decision history still lives in
`Handoff - Fair Accounting App paused 8 Nov 2026 session 2.md` §7 and
`Decisions - 9 Nov 2026 (the 15 questions).md`.

## 1. Where we stopped
We are in the superpowers brainstorming process. Nothing is built until the full spec is approved.
- We are reviewing Sections 6–20 of `Design Document - Book Buddha (9 Nov 2026).md`.
- This session resolved several specific items and produced the testing spec, but the **design
  document itself has NOT yet been edited** — the changes below are pending.
- **Resume point:** write the missing **Section 5 (Customers)**, then fold this session's changes
  into the design document and finalise.

## 2. How to work with me (unchanged)
- Short answers, one step at a time, confirm before moving on. Finance professional, no-code
  background, not an engineer.
- Always tell the truth, cite real sources, say "I cannot confirm this" when unverifiable. No guessing.
- Spec first, plan second, build third. No implementation plan until I confirm the spec; no code
  until I confirm the plan.
- Questions in sets of 5, one decision each, lettered options; I answer "1A, 2B".
- Put full section content in the message. Plain-text questions, not cards.
- Files live in `C:\Users\Admin\Desktop\Book Buddha`. Save handoffs/prompts there, not as project files.
- Design principle: the app must leave me free to manage things my own way; no strict built-in rules.
  Fixed parts: double-entry, audit log, cancel with reversal.

## 3. What was decided / done this session
- **Section 5 (Customers) is MISSING** from the saved design document — it jumps §4 → §6. The
  approved 20-section outline has §5 = Customers. It needs writing (from PRD §4.11, Q1, Q2). PENDING.
- **14.3 Restore** explained: a warned, reversible reload of a backup — takes a pre-restore backup
  first, sanitises incoming settings, can preserve users + counters.
- **Fair stock — decision 1A:** keep ONE stock pool; tag stock movements (purchase/sale/return) to
  the fair for per-fair reporting; NO separate fair stock bucket. To fold into §6/§10.
- **Section 17 (Settings) — Invoice Ninja re-inspection.** Used the existing code-verified report
  `invoice-ninja-reports/IN-batch-10-settings.md`. **Accepted 7 additions:** (1) richer number-pattern
  tokens + optional shared counter; (2) central custom-fields management; (3) product settings
  (default Track-stock for new items, show stock qty on challan/PDF, low-stock alert on/off);
  (4) date-format choice; (5) optional document-lock mode (alongside FY-lock); (6) email detail
  (reply-to, BCC, signature, attach-PDF); (7) bank-transaction rules. To fold into §17.
  Explicitly SKIPPED (out of scope): client portal, gateways, PEPPOL/e-invoicing/Veri*factu, group
  inheritance, payment links/subscriptions, task settings, multi-company tenant, live bank feeds,
  auto-compounding late fees.
- **Two new features requested, then PARKED to a future version:**
  1. Bank transactions via **PDF import + OCR** (offline; QBO-style but no live bank feed).
  2. **OCR capture** to avoid re-keying stock / bills / expenses.
  Honest caveat recorded: good OCR of varied PDFs usually needs a **cloud service (internet)**, which
  rubs against the offline-first principle; offline OCR (Tesseract) works but is weaker on tables.
- **Testing specification WRITTEN:** `testing/testing.md` (559 lines, 16 areas covering design §3–17).
  Every functionality is checked **Backend / Frontend / Accounting / User**; §18 reliability = Area 16;
  §19 acceptance (hand-worked figures) woven in; §20 (CA/legal) has no functional tests. Area 3
  (Customers) was built from confirmed behaviour because §5 is not yet written.

## 4. Files on disk (this session added two)
In `C:\Users\Admin\Desktop\Book Buddha\`:
- **`testing/testing.md`** — new, the full testing specification.
- **`Handoff - Fair Accounting App paused 10 Nov 2026.md`** — this file.
- Prior references unchanged: `Design Document - Book Buddha (9 Nov 2026).md`, the 9 Nov session-3 /
  session-2 handoffs, `Handoff - Fair Accounting App paused 8 Nov 2026 session 2.md`,
  `Decisions - 9 Nov 2026 (the 15 questions).md`, `Filter sheet - Book Buddha (8 Nov 2026).md`,
  `invoice-ninja-reports/`. Project file: `PRD_Magazine_Subscription_Management_v4`.

## 5. Changes to FOLD INTO the design document (not yet applied)
1. **Write Section 5 — Customers** (fields, classification, duplicates + merge, two-ledger credit, statements).
2. **§6 / §10** — fair-tagged stock (decision 1A).
3. **§17** — the 7 accepted settings additions.
4. **§1.5 / out-of-scope list** — add bank-import + OCR as future/v2 features.

## 6. Open items not mine alone to settle (unchanged)
- CA: principal vs agent (full sale vs margin) and GST classification/timing for the magazine resale.
- Lawyer: buyers' personal data (India DPDP Rules 2025, staged); and before giving away or selling the app.
- GST: the magazine PRD records "GST: Exempt" as the stated scope; unconfirmed.

## 7. Next steps
1. Write **Section 5 (Customers)**; I approve.
2. Fold in this session's changes (fair stock 1A, §17 additions, features → v2); finalise the design document.
3. Write the **App flow** (12 sections), one at a time, each approved.
4. Update the **PRD** and **Features List**.
5. I confirm the spec. **Only then** the implementation plan (writing-plans skill).
6. Only after I confirm the plan, build.
