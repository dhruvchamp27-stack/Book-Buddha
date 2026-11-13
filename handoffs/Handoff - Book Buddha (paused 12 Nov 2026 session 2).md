# Handoff — Book Buddha (paused 12 Nov 2026, session 2)

Paste `prompts/Prompt - next session (Foundation build) - 12 Nov 2026.md` to start the next chat.
Carries forward the 12 Nov (session 1) handoff. Source of truth: `spec/Design Document - Book Buddha (9 Nov 2026).md`.

## 1. Where we stopped
- **Spec is complete and approved:** design document + app flow + PRD + features list.
- **Resume point:** open the **Foundation build slice** — but first answer the **4 technology gaps** (§4 below). No implementation plan until those are answered; no code until the plan is confirmed.

## 2. How to work with me (unchanged)
- Short answers, one step at a time, confirm before moving on. Finance professional, no-code background, not an engineer. No guessing; cite real sources; say "I cannot confirm this" when unverifiable.
- Spec → plan → build, in that order.
- Questions in sets of up to 5, one decision each, lettered options; I answer "1A, 2B".
- Put full section content in the message. Save handoffs/prompts to the Book Buddha folder.
- Fixed parts: double-entry, audit log, cancel-with-reversal. No hardcoded rules.
- Key model: "Fair" is a first-class Project (customer-linked, own P&L); a Book Fair is a type of project; tags are separate. No per-fair Balance Sheet.

## 3. What was done this session (12 Nov, session 2)
- **APP_FLOW.md written** — 12 sections, screen-by-screen (purpose / content / primary / secondary / loading / empty / error), primary journeys, secondary flows, global states, and 8 flagged gaps. In `spec/`.
- **PRD + Features List rebuilt** from the design doc + app flow, retitled **Book Buddha**; the Magazine PRD v4 was **folded into PRD §5.9** and retired. In `spec/`.
- **Rounding decision resolved → whole rupee.** Invoice/quotation totals round to the nearest whole rupee (≥50 paise up, <50 down), showing amount-before-rounding, the round-off adjustment and the final total; actual receipts keep paise. Applied to design doc, APP_FLOW, PRD, Features List, and the Project copy.
- **Build approach locked → vertical slices.** Per slice: short flow review → lock mini-spec → mini build-plan → build → test → accept → next.
- **Build order locked:** Foundation → Customers → Items & stock → Invoices → Payments → Other documents → Fairs → Subscriptions → Reports → Settings → Admin (import/export/backup).
- **Invoice Ninja actual-flow reference received** from the other AI (1000 lines, 13 modules, click/link map) → `reference/`.
- **Repo reorganised** into `spec/ plan/ handoffs/ reference/ prompts/ testing/`; root `README.md` added.
- **Stale Project files deleted:** old `PRD – Fair Accounting App (Draft v0.1)`, `Features List – Fair Accounting App (Draft v0.1)`, `PRD_Magazine_Subscription_Management_v4`. The Project now holds only `Design Document - Book Buddha (current).md` (kept in sync with the folder copy).

## 4. The 4 technology gaps — next decision (from Build phase plan §2.0)
These block the implementation plan. Each is a real decision:
1. **Technology / stack** — language, framework, database. "Local web app on one PC" is a shape, not a stack. The inspection AI suggested SQLite; not adopted.
2. **Who builds the code** — which AI tool (Claude Code / Antigravity) and how it's driven.
3. **Install & launch** — how it installs on the PC and what a non-engineer clicks to start it.
4. **What tests run against** — test data, given nothing exists yet.

## 5. The 8 app-flow gaps (resolve during the relevant slice)
1. Dashboard/Home content (undefined). 2. Customer financial-summary panel (not designed). 3. Custom-fields coverage beyond invoices/bills/items/customers/reports (+ gear-icon per record). 4. "Save & add another" on customers. 5. Subscription settlement build details. 6. Keyboard shortcut keys. 7. Buyer personal data at fairs (DPDP). 8. CA/GST items.

## 6. Open items not mine alone (unchanged)
- CA: principal vs agent; GST classification/timing for the magazine resale.
- Lawyer: buyers' personal data (India DPDP Rules 2025, staged); giving away / selling the app.
- GST: magazine scope recorded "Exempt" — unconfirmed.

## 7. Folder structure
`spec/` (Design Document, APP_FLOW, PRD, Features List) · `plan/` (Build phase plan, Decisions) · `handoffs/` · `reference/` (Invoice Ninja inspection + actual-flow reference) · `prompts/` · `testing/` · `README.md`.

## 8. Next steps
1. Answer the 4 technology gaps (§4).
2. Open the Foundation slice: flow review → mini build-plan → confirm → build → test (5 acceptance checks) → accept.
3. Then the next slice in order. No code before a confirmed plan.
