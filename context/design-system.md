# Design System — Book Buddha

> **TEMPLATE — to be completed by the owner / build team.** No design-system doc
> existed in the repo. The only UI material is the `reference/` Invoice Ninja
> inspection (**reference-only** — a competitor teardown, not our decisions). Fill the
> sections below; cite `reference/IN-ui-*` / `IN-ux-*` only as inspiration, never as a
> rule. Guiding constraint from the spec: the user is a **non-accountant**, so the UI
> must hide accounting mechanics and speak plain English *(DD; CLAUDE.md)*.

## 1. Principles
- `TODO` — e.g. plain-English labels (no "debit/credit" in the UI); the app does the
  accounting underneath; one clear next action per screen.

## 2. Brand & tone
- Name / wordmark: Book Buddha — `TODO`
- Voice: calm, plain, non-technical — `TODO`

## 3. Color
- Palette (primary / neutrals / semantic success-warning-error): `TODO`
- Light/dark: `TODO`
- Accessibility: contrast targets (WCAG AA) — `TODO`

## 4. Typography
- Font family / scale / weights: `TODO`
- Numeric style for money (tabular figures, paise handling): `TODO`

## 5. Layout & spacing
- Grid / spacing scale / density: `TODO`
- Primary layouts: list screens, document editor (invoice/bill), review queue: `TODO`

## 6. Components
For each: anatomy, variants, states (default/hover/focus/disabled), rules.
- Buttons & primary actions: `TODO`
- Forms & inputs (validation, inline errors): `TODO`
- Data tables (sort/filter/pagination): `TODO`
- Document screens (invoice, bill, credit note, challan): `TODO`
- Bank/OCR **review queue** (Add vs Match, suggestions): `TODO` *(FD D2–D3)*
- Status chips (Draft / Finalised / Cancelled / Archived): `TODO`
- Empty / loading / error states: `TODO`
- Toasts & confirmations (esp. cancel-with-reversal confirm): `TODO`

## 7. Interaction patterns
- Autosave + leave-warning on unfinalised drafts *(DD §7.3)* — `TODO: visual treatment`
- "Save & add another" (open AF gap) — `TODO`
- Keyboard shortcuts (open AF gap) — `TODO`
- Duplicate warn-but-allow (customers) *(DD §5)* — `TODO`

## 8. Iconography
- Icon set / usage rules: `TODO`

## 9. Responsive / devices
- Phase 1: desktop (single PC). Phase 2: tablet/touch layout for invoicing users
  *(DD §2.4 — undesigned)* — `TODO`

## 10. References (inspiration only — not rules)
- `reference/Invoice Ninja — Actual App Flow (reference).md`
- `reference/IN-ui-*`, `reference/IN-ux-*`, screenshots in
  `reference/IN-ui-screenshots/` & `IN-ux-screenshots/`
- Where Invoice Ninja differs from our rules (cancel, locked edits, number reuse),
  **our rules win** — see `decisions.md`.
