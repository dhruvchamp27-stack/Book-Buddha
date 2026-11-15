# STATUS — UI / Design-docs track (Book Buddha)

> **This is the handoff for the UI/design work only.** It is a *parallel* track to the
> autonomous backend finish. The backend track's live status is `context/HOT.md` — it is
> **owned by the autonomous backend sessions and was NOT touched here.** All UI/design work
> is on the **`Prototype` branch only**; the `autonomous/book-buddha-finish` branch is
> backend-only and off-limits to this track.

## Last session (design track)
**2026-11-15:** Drafted the three design source-of-truth docs (`PRODUCT.md`, `DESIGN.md`,
`WORKFLOW.md`) from the ChatGPT design conversation + `saas_design_development_handoff.md` +
`context/app-flow.md` / `PRD.md`. Ran two Fable advisor critique passes and applied every
flagged fix (corrected over-marked ✅ items; verified the Prototype API actually has real
list/detail/report GET endpoints, so screens use real data, not mocks). Session paused
before the docs were revised for the two owner decisions below.

## Where the docs are
`context/design/PRODUCT.md`, `DESIGN.md`, `WORKFLOW.md` — **DRAFTS for owner review.**
They do **not** yet reflect the two 15-Nov decisions:
- `WORKFLOW.md §4` still proposes **bespoke CSS tokens / no Tailwind** — now superseded
  (see decision 2).
- `WORKFLOW.md §5` still says "use installed skill equivalents, install nothing" — now
  superseded (see decision 3).
These two sections must be rewritten before the docs go for final approval.

## Owner decisions made this session (to fold into the docs)
1. **Quality = QBO, Option B.** Match QuickBooks Online's polish/completeness/consistency as
   the *benchmark*, but keep Book Buddha's own **modern-premium** identity — **not** QBO's
   green/utilitarian look. *(already in PRODUCT.md §1)*
2. **Component & motion stack = shadcn/ui + 21st.dev.** All components, blocks, motions and
   animations are sourced from **shadcn/ui** and **21st.dev**. This requires **Tailwind CSS**
   (shadcn's base). Overrides the earlier bespoke-CSS proposal. Our design tokens still
   govern the look (shadcn themes via CSS variables), so it does **not** become default
   generic-shadcn — that "generic AI SaaS dashboard" look is an explicit anti-pattern.
3. **Install the handoff's skills stack** (handoff §6: Impeccable, Vercel Web Interface
   Guidelines, UI UX Pro Max, Taste, Unslop, Cube Motion) — **on the Prototype branch only.**

## Open one-liners (owner to settle — elaborate before/while revising the docs)
1. **Rounding display** — already resolved in the PRD (12 Nov 2026): whole-rupee rounding
   shown as amount-before-rounding + round-off line + final total; receipts keep paise.
   `HOT.md`/`todos.md` carry a stale "pending" flag → just needs a one-line reconfirm.
2. **Build pace** — CLAUDE.md says one small step + confirm; the handoff (§7) says don't stop
   for routine tweaks. Need the rule for *this* UI work.
3. **Doc precedence** — if `context/design/DESIGN.md` and `context/design-system.md` disagree,
   which wins? (Proposal: DESIGN.md is the design source of truth; design-system.md is prior art.)
4. **Light / dark mode** — handoff leaves it open; tokens currently assume both. One or both for v1?

## Gated — needs owner approval before any of it happens (brainstorming HARD GATE + ask-before-install)
- **Approve the 3 docs** (after the decision-2/3 revisions) — nothing gets built until then.
- **Land the docs on Prototype:** they are saved here as untracked files while the tree is on
  the `autonomous` branch. Committing them onto **Prototype** still needs a safe mechanism —
  a sibling-folder worktree was declined earlier (it sits outside the project folder); options
  are an in-project worktree or a clean branch switch. **Unresolved — propose and get approval.**
- **Installs (all Prototype-only):** Tailwind CSS + shadcn/ui + 21st.dev components; the
  6-skill stack. Each needs explicit approval per the ask-before-install rule.

## Next session — first step
Revise `WORKFLOW.md` §4 (→ shadcn/ui + 21st.dev + Tailwind) and §5 (→ install the handoff
skills stack), reconcile `DESIGN.md` colour/components/motion to the same stack, and elaborate
the four one-liners above — then take the three docs to the owner for approval. Only after
approval: propose the Prototype-save mechanism and the installs.
