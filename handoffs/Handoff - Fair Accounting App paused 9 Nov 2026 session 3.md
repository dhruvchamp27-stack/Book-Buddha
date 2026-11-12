# Handoff – Book Buddha (paused 9 Nov 2026, session 3)

Paste or share this at the start of the next chat in the Billing Project. It carries forward the
9 Nov session 2 handoff and adds this session's work. Full confirmed-decision history still lives in
`Handoff - Fair Accounting App paused 8 Nov 2026 session 2.md` §7 and
`Decisions - 9 Nov 2026 (the 15 questions).md`.

## 1. Where we stopped

We are in the superpowers brainstorming process. Nothing is built until the full spec is approved.

- **The five previously-OPEN items were all resolved this session** (details in §3).
- **The restructured design document was written in full (all 20 sections) and saved to disk** as
  `Design Document - Book Buddha (9 Nov 2026).md`.
- **Sections 1–5 are APPROVED** (in-chat, this session). **Sections 6–20 are first drafts awaiting
  the user's review** — the user will read the saved file and bring back changes/queries/approval.

**Resume point:** the user reviews Sections 6–20 of the saved design document and returns edits or
approval, section by section. Then: App flow (12 sections) → update PRD & Features List → user
confirms the spec → only then the implementation plan.

## 2. How to work with me (unchanged)

- Short answers, one step at a time, confirm before moving on. Finance professional, no-code
  background, not an engineer.
- Always tell the truth, cite real sources, say "I cannot confirm this" when unverifiable. No guessing.
- Spec first, plan second, build third. No implementation plan until I confirm the spec; no code
  until I confirm the plan.
- Questions in sets of 5, one decision each, lettered options; I answer "1A, 2B".
- Put full section content in the message. Plain-text questions, not cards.
- "What is suggested as per accounting logic?" → search, cite, label opinion.
- When I paste another AI's answer, verify it against real sources; say what is verified and what is not.
- "Check the magazine PRD" → read `PRD_Magazine_Subscription_Management_v4` and report exactly what it
  says and does not. "See how any accounting software does it" → check QBO / Tally / Zoho, cite pages.
- Files live in `C:\Users\Admin\Desktop\Book Buddha`. Save handoffs/prompts there, not as project files.
- Design principle: the app must leave me free to manage things my own way; no strict built-in rules.
  Fixed parts: double-entry, audit log, cancel with reversal.
- When I explain an accounting effect, I'm describing accounting, not asking to change the app — ask
  before treating it as a design change.

## 3. What was decided this session (the five OPEN items + extras)

### 3.1 Items & stock (Topic 1)
- **Track stock Yes/No is per item** (QBO Inventory vs Non-inventory), the user's free choice,
  changeable; switching Yes→No blocked while stock remains. Not tied to a business or item kind.
- **Adapt QBO directly:** tracked items move stock + COGS at the **invoice** (FIFO); a **challan is a
  non-posting delivery note** *except* a subscription-linked one (see 3.2). The old per-business
  "who reduces stock" setting is **dropped** — posting is determined by the document.
- **Cost:** tracked → COGS auto-posts at the sale via FIFO; untracked → cost at the **purchase bill**,
  revenue at the sale, no COGS-matching.
- **Book Master "catalogue" dropped** (no shared/centralised cross-business catalogue). Items stay
  per business. But three **generic** item additions are **IN v1**: a **duplicate-check key** on any
  custom field (e.g. ISBN; warn + suggest), an **MRP** field, and a **per-supplier purchase price list**
  (alongside FIFO lots).

### 3.2 Subscriptions / M4 (Topic 2) — a deliberate, confirmed change from the 7 Nov "fully manual" stance
- **Posting:** advance ("Deliver over time") invoice → AR + **Unearned Revenue**; a finalised
  **linked challan** recognises the delivered portion (Unearned → Sales) and, for tracked items,
  reduces stock + books COGS (FIFO); **standalone challan** posts nothing; **direct invoice** posts all.
- **Deferral trigger (hybrid):** a per-invoice **"Delivered now / Deliver over time"** switch,
  pre-filled by a **Subscription flag on the customer**, overridable per invoice. Driven by
  item/account config — no hardcoded "magazine" type.
- **Recognition:** both the finalised-challan auto-recognition **and** an optional manual repeat
  template are available.
- **M4 link:** advance invoice first → one invoice → many challans; one challan → one invoice
  (multi-invoice challan is v2); tracks delivered vs pending.
- **Variance / settlement engine is IN v1** (period-end/early-closure prepaid-vs-delivered at selling
  rates; two statement formats; refund / carry-forward / balance-due; configurable subscription
  periods; mid-period rate changes via price history by date). Sub-decisions (early-closure specifics,
  statement layouts, refund defaults) to finalise during the build.
- Subscription accounting verified vs **AS 9 / Ind AS 115** (session 2); principal-vs-agent and GST → CA.

### 3.3 The other three OPEN items
- **Q8 line-item date tokens:** YES (`:MONTH` / `:QUARTER` / `:YEAR` / `:WEEK`, resolved on save).
- **Q7 archive as a third state:** SKIP in v1 (v2 item).
- **Q4 report builder:** **B for v1** (simple builder: pick entity/columns, filter, group+subtotals,
  export) **and C for v2** (pivot / group-by-3 / custom-field grouping). The 8 fixed reports + the
  accepted extra reports + the Customize panel are in v1.

### 3.4 Design-document progress
- 20-section document written and saved. §1–5 approved in chat; §6–20 drafted for review.
- Phase 2 is written **in detail** in §2.4 (user's request), flagging what's decided vs designed later.

## 4. Files on disk (this session added two)
In `C:\Users\Admin\Desktop\Book Buddha\`:
- **`Design Document - Book Buddha (9 Nov 2026).md`** — new, the full 20-section spec (the deliverable).
- **`Handoff - Fair Accounting App paused 9 Nov 2026 session 3.md`** — this file.
- Prior references: `Handoff - Fair Accounting App paused 9 Nov 2026 session 2.md`,
  `Handoff - Fair Accounting App paused 8 Nov 2026 session 2.md`,
  `Decisions - 9 Nov 2026 (the 15 questions).md`, `Filter sheet - Book Buddha (8 Nov 2026).md`.
- Project file: `PRD_Magazine_Subscription_Management_v4`.

## 5. Open items not mine alone to settle (unchanged)
- CA: principal vs agent (full sale vs margin) and GST classification/timing for the magazine resale.
- Lawyer: buyers' personal data (India DPDP Rules 2025, staged, 13/14 May 2027); and before giving
  away or selling the app.
- GST: the magazine PRD records "GST: Exempt" as the stated scope; unconfirmed.

## 6. Next steps
1. User reviews Sections 6–20 of the saved design document; returns changes/queries/approval.
2. Fold in any changes; finalise the design document.
3. Write the App flow (12 sections), one at a time, each approved.
4. Update the PRD and Features List.
5. User confirms the spec. **Only then** the implementation plan (writing-plans skill).
6. Only after the plan is confirmed, build.
