# WORKFLOW.md — Book Buddha (how we design & build the UI)

> **Status:** DRAFT for owner review (15 Nov 2026). This file governs **how we work**
> on the UI — collaboration, conventions, tooling, and the screen-by-screen roadmap.
> `PRODUCT.md` = what it is; `DESIGN.md` = how it looks; this = how we build it.
> Markers: **✅ CONFIRMED** · **🟡 PROPOSAL** (my recommendation, not yet approved) ·
> **⬜ OPEN**.

---

## 1. The one rule that overrides everything ✅ CONFIRMED
**Branch isolation.** All UI work happens on **`Prototype`** (via an isolated **git
worktree**). The **`autonomous/book-buddha-finish`** branch is doing active backend work
and is **off-limits** — never commit, switch, or build there. *(owner instruction; HOT.md)*
The three docs in this folder are the UI source of truth; an external skill may advise but
never overrides them. *(handoff §8)*
- **⬜ OPEN — precedence vs the existing `context/design-system.md`:** that file was the
  scaffold (it's mostly "OWNER DECISION — not in docs" placeholders). Once these three docs
  are promoted into `Prototype`'s `design/` folder, **`design/DESIGN.md` becomes the visual
  source of truth** and `context/design-system.md` should point to it (or be retired) so we
  don't keep two. Owner to confirm which file wins.

## 2. QBO-grade means Option B ✅ CONFIRMED
Match QBO's **quality** — polish, completeness, consistency, reliability — as the
**benchmark**. Keep Book Buddha's own **modern-premium** identity. **Do not** copy QBO's
green/utilitarian visual style. *(owner decision; handoff §1, §13)*

## 3. How we collaborate *(handoff §2, §7)*
- **✅ CONFIRMED — two review modes** (handoff §2 confirms "direct UI comments, immediate
  small edits and batch processing"):
  - **Direct** — small, clear changes: I make them and show you.
  - **Batch review** — a screen or system change: I render it, you look, you give grouped
    comments, I apply them in one pass. The pilot uses batch review.
- **⬜ OPEN — the click-to-comment *mechanism*:** the handoff (§7 "Technical limitation",
  §12) notes a comment-enabled preview tool is **not yet chosen**, and this setup has none.
  So in practice "batch review" = **you tell me, in plain words, what to change on which
  screen** (not clicking on a live mockup). We can revisit a comment tool later.
- **🟡 When to ASK (stop and wait)** — my proposed line, confirm it: any unmade **visual**
  decision (palette, type, the subtype), any **product** OPEN item (`PRODUCT.md` §11),
  anything touching the three fixed parts, money/rounding display, status-label naming,
  anything irreversible (installs, deps, commits, pushes), or any conflict between a
  reference and our rules.
- **🟡 When to ACT (then report)** — my proposed line: applying agreed tokens/components,
  building an approved screen, wiring to the existing Prototype API, writing to the
  scratchpad, read-only exploration.
- **⚠ Pace conflict to settle:** the handoff (§7) says *don't* ask confirmation for routine,
  reversible UI tweaks (prefer working results over explanations); your `CLAUDE.md` says
  *wait for confirmation before continuing each step* and give WHY/WHAT/RISK/VERIFY on
  non-trivial actions. **Which governs UI work?** My proposal: `CLAUDE.md` wins on anything
  that writes files, installs, or commits; handoff-style fast iteration applies to
  look-and-feel tweaks on an already-approved screen. Your call.
- **✅ Verify in the browser:** every screen is checked rendered — real states (empty /
  loading / error / long values / large numbers), keyboard path, focus, contrast — not
  just "the code compiles." *(handoff §7, §9C, §9E)*
- **✅ Report** after each slice: what changed, what to look at, what's still OPEN.
- **✅ Model split (owner-set):** per HOT.md the backend loop is **Sonnet builds · Haiku
  does routine search/extraction · Opus verifies & commits**; your instruction **this
  session** adds **Fable 5.2 as the advisor/critique** layer. Same split applies to UI work.
- **⚠ Pushes are blocked (HOT.md):** `git push` can't authenticate right now, so all
  commits are **local only** until you run one push to cache the token. UI commits will sit
  locally on `Prototype` the same way the backend slices sit on `autonomous`.

## 4. Coding conventions
Grounded in what Prototype **already is** (React 19 + Vite 7 + TypeScript; a real `/api`
via an `api<T>()` helper; **no** Tailwind, **no** shadcn, **no** UI library yet — App.tsx).
The handoff leaves "framework, styling approach and component library" **open** (§12:
Tailwind "Not confirmed", shadcn "Not confirmed"), so these are genuine choices, not
things the handoff decided.
- **Styling — my engineering call (you can veto): bespoke CSS with design tokens** (CSS
  custom properties / CSS Modules), **not** Tailwind or a prebuilt component kit. Per
  `CLAUDE.md` you're a non-engineer and I carry the engineering, so I'm **making this
  call** rather than asking you to referee a technical yes/no. *Why:* the premium bar wants
  a distinctive, controlled look; semantic tokens are mandated (`DESIGN.md` §4); a utility
  framework or prebuilt kit works against both and adds a dependency.
  - **⚠ The real cost, named honestly:** bespoke means **hand-building interactive
    behaviour** — comboboxes, modals, date pickers, resizable/reorderable tables. That's
    more work, and at some screen I may recommend adding **one** small headless library
    (e.g. Radix — behaviour only, no styling) for a hard widget. **That surfaces later as a
    specific install approval**, not a blanket decision now. If you'd rather start from
    Tailwind or a kit instead, say so and I'll lay out the full trade-off.
- **Components 🟡:** small, typed, reusable React components; one component = one file;
  shared primitives (Button, Table, Field, StatusChip, Money) built first in the pilot.
- **State/data 🟡:** reuse the existing `api<T>()` client and types; no new data layer
  unless a screen needs it; keep server shapes as the source of truth.
- **Accessibility ✅:** semantic HTML first; every interactive element keyboard-reachable
  with visible focus; WCAG 2.2 AA. *(DESIGN.md §10)*
- **No installs without approval ✅** — any new dependency is proposed first (CLAUDE.md).
- **Money/dates ✅:** render through shared helpers that enforce the paise/rounding/grouping
  and date-token rules (`DESIGN.md` §7) — never ad-hoc formatting in a component.

## 5. Skills map — use, don't install 🟡 PROPOSAL *(handoff §6, §13.6–7)*
**⚠ Honest divergence from the handoff.** The handoff (§6) recommends a specific stack of
**six external skills**: *Impeccable* (its #1 critique skill), *Vercel Web Interface
Guidelines*, *UI UX Pro Max*, *Taste*, *Unslop*, *Cube Motion* — these are GitHub repos,
and **none is installed in this session** except a *UI UX Pro Max* equivalent. The
handoff's own resource strategy (§6, §13.6) says **do not blindly install every resource**
and product docs take precedence. **My proposal: install nothing; use the installed
equivalents below**, with our three docs as the override layer. If you specifically want
the handoff's stack (notably *Impeccable* for critique), that's a deliberate **install
decision** — your call, not something I'll do silently.

| Need | Handoff names | Use instead (installed) | Note |
|---|---|---|---|
| Critique a rendered screen | *Impeccable* | `design:design-critique` | closest installed substitute |
| Interface-quality / a11y / forms reference | *Vercel Guidelines* | `design:accessibility-review` + `design:design-system` | see a11y caveat ↓ |
| Design patterns, palettes, type, charts | *UI UX Pro Max* | `anthropic-skills:ui-ux-pro-max` | direct match; advice, not authority |
| Anti-generic / art direction | *Unslop*, *Taste* | (judgement + `DESIGN.md` §12 anti-patterns) | no install match |
| Motion | *Cube Motion* | `anthropic-skills:premium-motion-frontend` | ⚠ see override ↓ |
| UX copy — buttons, errors, empty states | — | `design:ux-copy` | plain, non-accountant voice |
| Dev handoff spec for a screen | — | `design:design-handoff` | per-screen spec when useful |
| **Charts** (reports & dashboard) | — | `dataviz` | load before any chart/graph |
| Process gate before building | — | `superpowers:brainstorming` → `writing-plans` | the HARD GATE below |

**Caveats:**
- `design:accessibility-review` audits **WCAG 2.1 AA**, not 2.2 — the 2.2-specific
  additions (`DESIGN.md` §10) need a **manual check** on top.
- `anthropic-skills:premium-motion-frontend` **defaults to glassmorphism / 3D / heavy
  motion** — those are our **anti-patterns** (`DESIGN.md` §12). Use it only for mechanics;
  **`DESIGN.md` overrides its aesthetic defaults.**

**Figma (mcp) ⬜ OPEN:** available but not assumed — use only if you want a Figma-first
mockup step. Default is render-in-browser, no Figma.

## 6. The HARD GATE (process) ✅ CONFIRMED
Per `superpowers:brainstorming`: **nothing is built in the repo** — no product code,
scaffolding, installs, or project files — **until you approve the design doc** (these three
files). Reading, exploring, and drafting to the scratchpad are allowed (that's all we've
done so far). After approval the sequence is: **writing-plans → build**.

## 7. Build method — hybrid *(owner-approved "Hybrid + worktree"; matches handoff §11)*
This mirrors the handoff's recommended sequence (§11): design docs → design system →
**one reference screen** → critique → iterative refinement → expansion → verification. The
handoff explicitly warns: *"Do not build many screens using an untested design system."*

**Alternatives considered** (you picked hybrid; these two are my reconstruction — the exact
earlier discussion was before a context compaction, so confirm if I've mischaracterised):
**(A)** build the full design system up-front, then screens — rejected: that's building on
an untested system, the thing §11 warns against. **(B)** Figma-first mockups, then code —
rejected for now: adds a tool and a translation step when we can render real React
in-browser. **Hybrid** = codify just enough, prove it on one real screen, then scale.

1. **Thin design/ folder** (these three docs + a tokens file) promoted into `Prototype`.
2. **One pilot screen — Invoice List, with minimal nav chrome** — rendered in 2–3 subtype
   directions so you choose the look **by eye** (`DESIGN.md` §3). *Why Invoice List:* it
   exercises the table, money formatting, status chips, toolbar and empty/loading/error
   states at once — its columns and states come straight from **app-flow §5.1** (statuses
   Draft/Issued/Partial/Paid/Cancelled; New invoice; bulk + Excel export; "No invoices yet"
   empty; skeleton loading; retry on error). *Why include nav chrome:* the app shell sits at
   roadmap #3; judging a look without the surrounding frame is half the picture.
   - **✅ Data note (verified):** `GET /invoices?businessId=` **exists on Prototype** and the
     current App.tsx already calls it — so the pilot renders on **real data**, not mock.
3. **Codify** the chosen tokens + shared primitives from the pilot into the design system.
4. **Expand screen-by-screen** down the roadmap, reusing primitives; each screen verified
   in-browser before the next.

## 8. Roadmap — screen by screen 🟡 PROPOSAL (order; scope & screens = PRODUCT.md §8 + app-flow)

**✅ Backend-data reality (verified 15 Nov 2026 by read-only `git show` of `server.ts` +
`web/src/App.tsx` on `Prototype`).** The Prototype API is richer than a first grep
suggested — it has **real GET list + detail + report endpoints**. The working App.tsx
already fetches them. Confirmed **real on Prototype**: `GET /companies`, `/businesses`,
`/customers`, `/items`, `/fairs`, `/invoices` (+ `/:id`, `/:id/payments`), `/quotations`,
`/credit-notes` (+ `/:id`), `/inventory/stock`, `/journal-entries`, `/audit-events`, and
`/reports/{trial-balance, profit-and-loss, balance-sheet, general-ledger, receivables,
fair-sales}`. **So most early screens render on REAL data now — no mock needed.**

**Not on Prototype** (so these screens are mock-first until a merge/build): challans,
bills/expenses, POs, recurring (app-flow §6.3–6.6); login/auth (§1–2, autonomous); full
subscription settlement (§9) and cash/accrual + full fair **P&L** (§8.3, §10 — only
`fair-sales` exists today); import/export/backup (§12.4–6). Audit log viewer (§12.1) **is**
real (`GET /audit-events`).

Ordered by value + data-readiness. Each row cites its app-flow §; big groups are split so
it's genuinely screen-by-screen.

| # | Screen (app-flow §) | Data today |
|---|---|---|
| **Pilot** | **Invoice list** (§5.1) + minimal nav shell (§2.3) | ✅ real `GET /invoices` |
| 1 | Invoice editor (§5.2) + draft/autosave (§5.3) | ✅ real (`GET/POST /invoices`, `/:id`) |
| 2 | Receive payment (§5.4) + cancel/edit (§5.5) | ✅ real (`/invoices/:id/payments`, `/cancel`) |
| 3 | App shell + nav + business switcher (§2.3) | ✅ `GET /companies`,`/businesses` |
| 4 | Reports home (§10.1) + viewer (§10.2) + Customize (§10.3) | ✅ real `GET /reports/*` (cash/accrual + full fair-by-fair = partial) |
| 5 | Customer directory (§3.1) | ✅ real `GET /customers` |
| 6 | Customer detail — 5 tabs (§3.3) + create/edit (§3.2) + statement (§3.4) | ✅ list real; financial-summary panel = **OPEN** (§3.3) |
| 7 | Item list (§4.1) + create/edit (§4.2) + stock-in/adjust (§4.3) + low-stock (§4.4) | ✅ `GET /items`, `/inventory/stock` |
| 8 | Dashboard / Home (§2.2) | ✅ reports real; **content undesigned — OPEN** |
| 9 | Quotations (§6.1) | ✅ real `GET /quotations` |
| 10 | Credit notes (§6.2) | ✅ real `GET /credit-notes` — **render visually distinct** (DESIGN §8) |
| 11 | Payments list (§7.1) + allocation (§7.2) + credit (§7.3) + refund/return/write-off (§7.4) | ✅ payment data real; allocation UI new |
| 12 | Fair list (§8.1) + create/edit (§8.2) + detail/P&L (§8.3) + fair invoicing (§8.4) + incentive (§8.5) | fairs + `fair-sales` real; **full P&L partial (Slice 7)** |
| 13 | Challans (§6.3) | ⚠ not on Prototype → mock / needs backend |
| 14 | Bills & expenses (§6.5) + Purchase orders (§6.6) | ⚠ autonomous (Slice 6) → merge |
| 15 | Recurring invoices (§6.4) | ⚠ autonomous (Slice 2) → merge |
| 16 | Subscriptions: flag/advance/linked challan/settlement (§9) | ⚠ not built (Slice 7) |
| 17 | Settings — home/numbering/FY/lists/custom-fields/defaults/email/identity/other (§11.1–11.9) | mostly new UI; some config |
| 18 | Admin — audit log (§12.1) · error log (§12.2) · FY lock (§12.3) · import (§12.4) · export (§12.5) · backup/restore (§12.6) | audit real; rest mock/backend |
| 19 | First-run setup (§1.1–1.9) + login (§2.1) + forgot (§2.5) + session expiry (§2.4) | ⚠ auth autonomous; live OAuth deferred (HOT) |

**⬜ OPEN for you:**
1. Confirm this order. I put **Reports viewer at #4** (real data, distinct layout, exercises
   the money/table system) and pushed challans/bills/recurring/subscriptions/auth later
   because they're not on Prototype yet.
2. The **not-on-Prototype** screens (13–16, 18–19): build on mock data now, or wait for the
   backend/merge? My lean: build the ones with real data first; mock the rest only when we
   reach them.
3. **When to merge `autonomous` → `Prototype`** (auth, bills/POs, recurring) — its own
   gated, owner-run step; backend work there is still active.

## 9. Definition of done (per screen) 🟡 PROPOSAL (my standard — confirm/trim)
Renders with real data · all relevant states built (default/hover/focus/active/disabled/
loading/success/error/empty) · keyboard + focus + WCAG 2.2 AA checked in-browser · money/
date/rounding via shared helpers · plain non-accountant copy · matches the tokens · no new
dependency added without approval · reported to you with what to look at. *(handoff §7, §9)*

## 10. Git discipline (unchanged from CLAUDE.md) ✅ CONFIRMED
`Prototype` only · stage by **explicit path** (never `-A`/`.`/`-u`) · one commit = one idea
· announce before commit, **ask again before push** · never force-push / reset --hard /
rewrite pushed history · never touch `main` or `autonomous`.

---
*Sources: `saas_design_development_handoff.md` (§1,§6,§7,§9,§13), `CLAUDE.md`, `context/HOT.md`,
Prototype `book-buddha/web/src/App.tsx`, `context/design-system.md`. Companions: `PRODUCT.md`,
`DESIGN.md`.*
