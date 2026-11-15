# DESIGN.md — Book Buddha

> **Status:** DRAFT for owner review (15 Nov 2026). This is the visual source of truth.
> **Reading the markers:**
> **✅ CONFIRMED** — decided (by you, the handoff, or the spec).
> **🟡 PROPOSAL** — my recommendation, **not yet approved** — do not treat as a rule.
> **⬜ OPEN** — genuinely undecided, needs your input.
>
> Rule from the handoff, honoured here: *never silently convert a proposal into a
> requirement.* Colour, type, spacing, icons and brand are **owner decisions** — the
> spec fixes almost no visual design (`design-system.md`). Nothing below is invented as
> fact.

---

## 1. Brand personality & philosophy ✅ CONFIRMED
*(handoff §3)*

**Modern premium — quiet confidence, exceptional clarity.** Sophisticated,
thoughtfully engineered, professional **and** approachable. Never flashy, over-decorated,
or minimalist to the point of losing information.

**Six pillars** (the test every screen must pass):
1. **Visual restraint** — purposeful whitespace, controlled colour, subtle borders,
   carefully controlled elevation; every element earns its place.
2. **Information excellence** — complex data made easy; strong hierarchy; excellent
   tables, dashboards, reports, charts; numbers kept readable.
3. **Typographic sophistication** — distinctive, disciplined type; controlled sizes,
   weights, line-heights, line-lengths; type carries the brand.
4. **Effortless usability** — predictable navigation, intuitive workflows, discoverable
   actions, minimal cognitive friction.
5. **Refined interactions** — immediate feedback; purposeful motion; careful hover/focus/
   active states; clear loading/success/empty/error states.
6. **Consistency without monotony** — one design language; reusable tokens and
   components; but dashboards, tables, forms and reports get layouts suited to purpose.

## 2. Voice & tone ✅ CONFIRMED (direction) / ⬜ OPEN (detailed guide)
Calm, plain, non-technical — follows from the non-accountant principle. **No accounting
jargon on the surface** (no "debit/credit/deferral"). Messages are plain and actionable.
*(design-system §1–§2; PRD §4)* — a detailed tone guide is OPEN.

## 3. Visual direction (the subtype) ⬜ OPEN — decided by looking, not words
*(handoff §5)*

**✅ CONFIRMED:** Modern premium. **⬜ OPEN:** which expression —

| Direction | Character |
|---|---|
| **Warm minimal** | warm neutrals, charcoal type, restrained accents |
| **Cool minimal** | crisp whites, cool greys, subtle blue undertones |
| **Bold minimal** | neutral foundation, strong type, one distinctive accent |
| **Dark premium** | deep charcoal surfaces, refined contrast |

**How we will decide:** at the pilot stage I render the **Invoice List** in 2–3 of these
on the real screen; you pick by eye. The handoff forbids finalising a palette before this
is seen and approved — so §4–§8 below stay **PROPOSAL** until you choose.

## 4. Colour 🟡 PROPOSAL (structure) / ⬜ OPEN (values)
- **Method ✅ CONFIRMED:** semantic tokens only — never raw hex in components.
  *(handoff §9A)*
- **Token structure 🟡 PROPOSAL:** `--bg`, `--surface`, `--surface-raised`, `--border`,
  `--text`, `--text-muted`, `--primary`, `--primary-contrast`, plus semantic
  `--success` / `--warning` / `--danger` / `--info`, each with light **and** dark values.
- **Actual palette ⬜ OPEN** — set once the subtype is chosen.
- **Fixed by spec ✅:** **tags** are user-chosen name + colour, rendered as pills.
  *(design-system §3; PRD §5.11)*
- **Contrast target 🟡 PROPOSAL:** WCAG 2.2 AA — the handoff *recommends* this level
  (§9E, "Recommended target"); accessibility *as a goal* is confirmed (handoff §2), the
  specific level is owner-to-confirm.
- **Anti-pattern ✅:** no "always green" — Book Buddha gets its own palette. *(handoff §10)*

## 5. Typography 🟡 PROPOSAL / ⬜ OPEN (families)
- **Families ⬜ OPEN** — a distinctive UI face + a **tabular-numeral** face (or tabular
  feature) for money. *(handoff §3 pillar 3, §9D)*
- **Type scale 🟡 PROPOSAL:** a disciplined scale (e.g. 12 / 13 / 14 / 16 / 20 / 24 / 32)
  with set line-heights; **headings restrained** (anti-pattern: oversized headings that
  waste workspace). *(handoff §4)*
- **Money numerals ✅ CONFIRMED need:** tabular / aligned figures so columns line up. *(design-system §4; handoff §9D)*

## 6. Spacing, radius, elevation, motion 🟡 PROPOSAL
- **Spacing ⬜ OPEN (values) / 🟡 structure:** one scale (e.g. 4-based: 4/8/12/16/24/32),
  used everywhere — no arbitrary spacing. *(handoff §9A, §10)*
- **Radius 🟡 PROPOSAL:** one small set (e.g. 4 / 8 / pill) — consistent, no random radii.
- **Elevation 🟡 PROPOSAL:** shadows only where they communicate hierarchy — not banned,
  not everywhere. *(handoff §10)*
- **Motion ✅ principle / 🟡 values:** motion communicates state change, navigation,
  appearance, feedback, relationships; it must **never slow a frequent workflow**. Prefer
  CSS transitions; reach for a library only where it earns its place; honour
  reduced-motion. *(handoff §9G)*

## 7. Money, number & date rules (mostly fixed by spec)
*(PRD §5.5, §5.11, §9; app-flow §5.2)*
- **✅ CONFIRMED:** money stored in **integer paise**; **actual receipts keep paise**.
- **✅ resolved, 🟡 one-line reconfirm — rounding *display* rule:** the **PRD resolved this
  (12 Nov 2026)**: invoice/quotation totals round to the nearest whole rupee (≥50 p up,
  <50 down) and the document shows amount-before-rounding + round-off line + final total;
  receipts keep paise. `HOT.md` / `todos.md` still carry a **stale "pending" flag**. The
  maths isn't in doubt — I just want **one line from you confirming the display** before I
  build the invoice editor, so I'm not acting on a doc that contradicts itself.
- **Amount grouping:** Indian (`10,00,000.00`) or international (`1,000,000.00`), per Settings.
- **Dates:** compact `DD/MM/YY` entry (T = today, M = month start); display format per
  Settings; tokens `:MONTH :QUARTER :YEAR :WEEK` resolve on save.
- Right-align money and quantities; tabular numerals; handle long labels and large numbers.

## 8. Components — standards & states
**States to design & verify (not every component needs every one):** default · hover ·
focus · active · disabled · loading · success · error · empty · responsive. *(handoff §9C)*

**Core components** (anatomy/variants are 🟡 PROPOSAL until the pilot codifies them):
- **Buttons** — one primary per screen (🟡 working principle, owner to confirm —
  design-system §1); secondary, tertiary/ghost, destructive; sizes; loading state.
- **Inputs / selects / dropdowns** — with the gear-icon affordance for custom fields.
- **Data tables** ✅ *priority* — appropriate density, right-aligned tabular money,
  column reorder/resize/show-hide with saved prefs + Reset, page sizes 25/50/100, sort,
  bulk-action bar. *(PRD §5.3, §5.5; app-flow §3.1, §5.1)*
- **Status chips** ✅ fixed vocab: invoice **Draft / Issued / Partial / Paid / Cancelled**
  (Overdue/Unpaid calculated); quotation Draft/Sent/Approved/Converted/Rejected/Expired;
  PO Draft/Sent/Accepted/Received/Cancelled; plus **Locked**. Colours 🟡 PROPOSAL.
  *(design-system §6)* ⚠ settle "Issued" vs "Finalised" naming first.
- **Document editor** ✅ *priority* — the invoice/bill/credit-note/challan line-item
  editor: line add/remove, item picker, inline math, discounts, extra charges, per-line
  tax, running totals + round-off, autosave indicator, Save / Save & New / Save as draft.
- **Document-type visual distinction** ✅ (fixed by spec): a **credit note** must read as
  *visually distinct from an invoice* to prevent mis-entry (app-flow §6.2); a **standalone
  challan** carries a **distinct badge + list filter** and its print **suppresses unit
  cost / line totals / taxes** (app-flow §6.3). The *how* (colour/badge treatment) is
  🟡 PROPOSAL; the *requirement* is fixed.
- **Print / PDF output** ✅ need (app-flow §6.3, §3.4, §10): documents, statements and
  reports export to PDF/Excel — so each document and report needs a **print layout**, not
  only a screen layout (challan print substitutes the shipping address and hides costs).
  Treatment 🟡 PROPOSAL.
- **Modals / confirmations** — "Confirm before cancel"; match confirmation strength to
  risk and recoverability (anti-pattern: confirm *everything*). *(handoff §10)*
- **Toasts / inline messages** — plain, actionable; success/error; preserve typed work on
  network error. *(app-flow Part D)*
- **Empty / loading / error states** — every list and screen (see app-flow per-screen).

## 9. Layout patterns
- **App shell** — flat, plainly named nav (**~2 clicks to any tab**) + **business
  switcher** (single business / "All businesses"). *(PRD §5.15; app-flow §2.3)*
- **List screen** — toolbar (new · search · filters · bulk · export) + dense table +
  empty/loading states. Pattern reused across customers, items, invoices, documents,
  payments, fairs.
- **Document editor** — header fields + line-item grid + totals panel + action bar.
- **Report viewer** — on-screen result (never export-only) + **Customize panel** (General
  / Rows-Columns / Filter / Header-Footer) + Refresh + export; per business / combined /
  **fair-by-fair**. *(app-flow §10)*
- **Settings / Admin** — plainly named sections; save-in-place.
- **Setup wizard** — the first-run step sequence (company → business → chart → FY →
  numbering → opening balances → password), each step its own focused screen with
  Back/Next (app-flow §1).
- **Record-detail with tabs** — the customer detail page: header + **five tabs**
  (Invoices / Quotations / Payments / Documents / History), per-tab empty/loading, a
  combined-balance figure (app-flow §3.3). Reused anywhere a record has sub-records.
- **Allocation / split editor** — receive-payment screen: one payment split across several
  invoices, "apply oldest first", check-a-row-fills-balance (app-flow §7.2).
- **Two-phase import** — preview (delimiter/encoding) → column-map → ingest, with a
  skipped-rows report (app-flow §12.4).
- **Statement view** — transactions + balance + aging for one customer, date-range +
  export (app-flow §3.4).
- **Dashboard** — ⬜ OPEN (content undesigned).

## 10. Accessibility — goal ✅ CONFIRMED · level 🟡 PROPOSAL (WCAG 2.2 AA)
*(handoff §2 confirms accessibility matters; §9E **recommends** WCAG 2.2 AA — owner to
confirm the level.)* Keyboard navigation; visible focus; sufficient contrast; accessible
labels; semantic HTML; screen-reader feedback; reduced-motion; accessible charts;
adequate touch targets (matters for Phase-2 tablet).

## 11. Responsive stance 🟡 PROPOSAL — ⚠ handoff vs project spec conflict
Two sources disagree: the **generic handoff** (§9F) recommends adapting to desktop,
tablet **and mobile**; the **project spec** scopes **v1 to one PC, desktop-first, no phone
breakpoints** (design-system §9). **Proposal — follow the project spec:** build
desktop-first with clean, non-brittle layout so Phase-2 tablet (larger touch targets,
Save & New) is reachable without a rewrite; **do not** invest in phone layouts in v1. The
project spec governs scope over the generic handoff. Owner to confirm.

## 12. Anti-patterns ✅ CONFIRMED (avoid unless a clear product reason)
*(handoff §4)* Generic AI-SaaS dashboards · excessive gradients · unnecessary
glassmorphism · glowing/decorative gimmicks · cards-inside-cards everywhere · oversized
headings · random colours / inconsistent radii · arbitrary spacing · excessive animation ·
minimalism that sacrifices information · every screen looking identical. *(These are
judgement calls, not absolute bans — handoff §4, §10.)*

## 13. References
- **QBO** = **quality benchmark, not a visual template**; do **not** copy Intuit's
  branding or layouts. *(handoff §1, §13)*
- **Invoice Ninja** teardown in `reference/` = **inspiration only, never a rule**; where
  it conflicts with our fixed rules (cancel-with-reversal, locked edits, no number
  reuse), **our rules win**. *(design-system §10; decisions.md)*

## 14. Decision log (snapshot — keep current as we decide)
| Item | State |
|---|---|
| QBO = quality bar, not template | ✅ CONFIRMED |
| Modern premium / quiet confidence | ✅ CONFIRMED |
| Semantic tokens, tabular money, accessibility-as-goal | ✅ CONFIRMED |
| WCAG **2.2 AA** as the level | 🟡 PROPOSAL (handoff-recommended) |
| Paise storage / receipts keep paise | ✅ CONFIRMED |
| Rounding **display** rule | ⬜ OPEN (contested — confirm before invoice editor) |
| Status-chip vocabulary | ✅ CONFIRMED (settle Issued/Finalised label) |
| Visual subtype (warm/cool/bold/dark) | ⬜ OPEN — decide by mockups |
| Palette · type families · logo | ⬜ OPEN |
| Light / dark mode (both? one?) | ⬜ OPEN (handoff §12 undecided; tokens assume both) |
| Spacing/radius/elevation values | 🟡 PROPOSAL until pilot |
| Tailwind / shadcn vs bespoke CSS | 🟡 PROPOSAL: bespoke (see `WORKFLOW.md`) |
| Dashboard content · financial-summary panel | ⬜ OPEN (product) |

---
*Sources: `saas_design_development_handoff.md`, `context/design-system.md`,
`context/PRD.md`, `context/app-flow.md`. Companions: `PRODUCT.md`, `WORKFLOW.md`.*
