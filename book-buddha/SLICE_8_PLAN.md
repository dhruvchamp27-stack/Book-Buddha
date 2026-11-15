# Slice 8 plan — Projects (Fairs) as a first-class dimension

**Status: PLAN ONLY. Nothing in this slice is built.** Written 2026-11-15, straight after
Slice 7 landed. Per the fixed method (spec → plan → build), **no code until the owner
confirms this plan.**

Branch: `autonomous/book-buddha-finish`. Backend only. Work only in `book-buddha/`.
Money = integer paise. Every posted journal balances. Finalized records immutable
(corrections via reversal). Never negative stock. One commit = one idea, staged by explicit
path. Never push.

Sources read for this plan: DD **§3.3** (project vs tag), **§6.9** (fair stock tagging,
decision 1A), **§7.1** (invoice carries its fair), **§10** (Projects/Fairs in full),
**§12.1** (every report except the Balance Sheet is viewable fair by fair);
`CLAUDE_FINISHING_PLAN.md` **§13** ("Sales by fair" report, Fair filter, *filters must be
applied in SQL, not only visually*) and **§25B** Phase 2 ("project dimensions").

---

## Why this slice exists

A **Project** is the app's first-class, QBO-style grouping: tied to **one host customer**,
with invoices and costs belonging to it and **its own P&L**. A **Book Fair** is the primary
project type; the concept stays generic. On screen it is called a **Fair**. A record carries
one business, **optionally one project**, and any number of tags.

Slice 7c added the `business_id` + `entry_date` dimension to `journal_entries` and the
filter machinery on top of it. **This slice is the same shape, for the project dimension** —
which is why it comes next and should be markedly cheaper than 7c was.

---

## Current prototype reality (verified in code, not assumed)

Already present:
- **`fairs` table exists** — `id, company_id, host_customer_id, name, starts_at, ends_at,
  created_at` (`schema.ts`).
- **`invoices.fair_id` exists**, plus `buyer_name` / `buyer_contact` (DD §10.3 is already
  satisfied: buyer details live on the invoice only, never as a customer).
- **`createFair()`** validates that the host customer belongs to the fair's company.
- **`getFairSales(fairId?)`** exists and is exposed at `GET /reports/sales-by-fair`.

Missing — this is the actual work:
- `journal_entries` has **no** project dimension (7c added business + date only).
- `stock_movements` has **no** `fair_id`, so DD §6.9 fair-tagged stock/COGS is impossible.
- `purchase_bills` and `expenses` have **no** `fair_id`, so fair **costs** cannot be
  attributed — only fair sales can. Without this a fair P&L is revenue-only and misleading.
- No fair filter on any report.

---

## Sub-slices (each one commit; build in order)

### 8a — Migration v6: the project dimension *(do first; everything else needs it)*
Additive and transactional, modelled directly on v5 (`journal-dimensions-schema.ts`).
- Add nullable `fair_id TEXT REFERENCES fairs(id)` to **`journal_entries`**,
  **`stock_movements`**, **`purchase_bills`** and **`expenses`**. Idempotent
  `PRAGMA table_info` guards, as v5 does.
- **Nullable permanently, and deliberately so** — unlike 7c's `business_id`, a project is
  *optional* on every record (DD §3.3). So there is **no zero-NULL gate** here; that gate
  would be wrong. The correct gate is the conditional one below.
- **Backfill:** set `journal_entries.fair_id` from the source document's fair, using the same
  exact-id entry-shape mapping v5 established (invoice entries, its COGS/inventory entry, its
  payments, reversals and credit notes all take the invoice's fair). Bills/expenses have no
  fair yet, so they backfill to NULL.
- **Gates:** entry and line counts unchanged · `foreign_key_check` clean · **every journal
  entry whose source invoice has a `fair_id` has that same `fair_id`** (the conditional
  replacement for v5's zero-NULL gate) · no entry carries a fair its source document does not.
- Tests: fresh DB; backfill across all entry shapes; an invoice *without* a fair stays NULL;
  two fairs don't cross-contaminate; idempotent re-run.

### 8b — Project tagging on documents, stock and COGS
- `insertJournalEntry`'s required dimensions argument gains **optional `fairId`**, set from
  the document at every call site (the compiler already forces review of each one).
- **Stock movements carry the fair** (DD §6.9): `PURCHASE`, `SALE`, `SALE_REVERSAL` tag the
  fair of their source document. **One shared stock pool** — quantity-on-hand stays a single
  figure and FIFO is untouched. This is a reporting tag only; **it must not change FIFO
  consumption order or valuation.** A test must prove FIFO output is byte-identical.
- `createPurchaseBill` / `createExpense` accept an optional `fairId`, validated to belong to
  the same company as the document's business.
- Validation: a document's fair must belong to the business's company; a fair cannot be
  attached to a finalized document (immutability).

### 8c — Fair filter on reports + ledger-based fair P&L
- Add `fairId?` to `PeriodReportFilter` and `AsAtReportFilter`, threaded through
  `reportConditions` in SQL (§13: in the query, not visually).
- **P&L, Trial Balance and General Ledger** accept it. **`getBalanceSheet` must REFUSE a
  `fairId`** with a clear error rather than silently ignoring it — DD §12.1 decided
  (12 Nov 2026) there is **no per-fair Balance Sheet**. Mirrors 7c's `.strict()` stance:
  a filter that cannot be honoured is an error, not a silently wrong report.
- The **cash view** gains the fair filter too (documents carry `fair_id`, so `deriveCashView`
  needs only the extra condition) — a fair P&L must work on both bases.
- Expose `fairId` on the report endpoints as strict zod query params.
- Tests: two fairs under one business, each with sales *and* costs; per-fair P&L shows only
  its own; unfiltered totals unchanged (the 7c regression pattern); fair P&L on the cash
  basis; a `fairId` on the Balance Sheet is rejected.

---

## Decisions for the owner

1. **`getFairSales` vs a ledger-based fair P&L — these will disagree.** The existing
   `getFairSales` totals *invoice lines* directly, so it ignores credit notes and
   cancellations and cannot see costs. The new fair P&L reads the *ledger*. Recommendation:
   keep `getFairSales` as a sales listing, and treat the ledger-based fair P&L as the
   authoritative profit figure. The alternative is to rebuild `getFairSales` on the ledger
   and retire the line-based query. **Which?**
2. **Fair on a purchase bill — whole-document or per-line?** DD §10.4 tags *stock movements*
   to a fair, which implies a bill could serve two fairs. Recommendation for v1:
   **whole-document**, matching how `business_id` works, since a per-line project dimension
   is a much larger change. **Accept whole-document for v1?**
3. **Should an invoice's fair be editable after finalizing?** It is a reporting dimension,
   not a posted amount, but changing it silently moves a finalized sale between fair P&Ls.
   Recommendation: **no** — change it by cancel-and-reissue, consistent with immutability.

## Explicitly OUT of scope
- **Tags** — a separate, lighter system (DD §3.3: name + colour, any number per record).
  Its own slice.
- **Per-fair Balance Sheet** — decided against (DD §12.1).
- **The end-of-fair school incentive** — DD §10.5 says the owner enters it as an ordinary
  expense plus an optional stock adjustment. It is deliberately **not** an automatic rule,
  so there is **nothing to build**; it falls out of 8b once expenses carry a fair.
- All UI, and the per-line project dimension (see decision 2).

---

## Where this sits in the bigger plan
`CLAUDE_FINISHING_PLAN.md` §25B frames the whole project as **Phases 0–8**, where a phase is
done only when *backend, API, UI, reports, tests, migration and documentation* are all
complete. This run is **backend-only by the owner's instruction**, so Slice 8 advances
Phase 2's "project dimensions" and Phase 3/5 reporting — it does not complete a phase.
After this: Subscriptions / deferred revenue (the largest remaining slice, with three
sub-decisions still open in DD §11.6).
