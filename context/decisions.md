# decisions.md — Book Buddha

*On-demand allied file. Seeded 2026-11-14 from the repo docs (DD = Design Document,
DEC = plan/Decisions — the 15 questions, FD = Feature Design V1, H13 = 13 Nov handoff).
These pre-date this harness, so they keep their original IDs. **Future** decisions made
in a session use the harness convention `S<session>-<n>` (e.g. S1-1), newest at the top.*

## Session decisions (harness convention, newest first)
- **S2-2 (2026-11-16) — A credit note on an unpaid/part-paid invoice RE-BASES the
  remainder.** The note reduces what is still owed; the rest of the invoice is then
  recognised against that smaller balance as cash arrives, and **nothing hits the cash P&L
  on the note date**. Owner chose this over "settle on the note date" and over "no effect
  until money moves". Reason: it is the only one of the three that converges to the accrual
  figure when the returned goods carry a **different margin** from those kept — the other
  two leave COGS permanently wrong on a part-paid invoice. Fills the gap in S1-6, which did
  not cover the commonest case (a note raised before the invoice is settled).
- **S2-1 (2026-11-16) — SUPERSEDES S1-4. Build a real `chart_accounts` table; do NOT
  hardcode the account list.** Owner asked whether the app lets a user create accounts; the
  spec says it must, in five places: DD line 14 ("starts blank — you create … chart of
  accounts") and §3.4; Features List ("pick a ready-made set **or** build your own; add/
  rename anytime"); APP_FLOW §1.4 ("blank list with 'Add account'") and §11.4; DD line 138
  ("create an account and set its opening balance directly"). `ARCHITECTURE_AND_DATABASE.md`
  line 299 already specifies the table: `chart_accounts (company_id, code, name, type,
  parent_id, active)`. The prototype's fixed 13-code SQL `CHECK` therefore **contradicts the
  approved spec**, and is self-defeating: a CHECK value cannot be added at runtime, so
  "add/rename anytime" is impossible by construction. Shape:
  - `journal_lines.account` **stays the TEXT code** — no data rewrite, existing queries keep
    working. `code` is immutable and UNIQUE; renaming changes `name` only.
  - Drop the code `CHECK`; enforce with a `BEFORE INSERT` **trigger** plus an FK. A trigger
    fires on every connection whatever `PRAGMA foreign_keys` says — the one property the
    CHECK had. `postJournalEntry` must look the account up in the DB, not a static set.
  - Reports group by the table's `type` through a JOIN, **never** a hardcoded code list, so
    "a new code is silently dropped and unbalances the sheet" becomes structurally impossible.
  - **DEPARTURE from the architecture doc, recorded deliberately:** system accounts are
    seeded ONCE with `company_id` NULL, not per company. The prototype allows several
    companies; per-company seeding would duplicate codes and make an FK on `code` impossible.
    User accounts carry their own `company_id`.
  - Seeded accounts (owner-approved this session): the existing 13 plus `UNEARNED_REVENUE`,
    `BANK`, `UNCATEGORIZED`, `OPENING_BALANCE_EQUITY`, `CAPITAL`, `LOANS`, `OTHER_ASSETS`,
    `OTHER_LIABILITIES`, `OTHER_INCOME`.
  - A user account picks exactly one of the five classes; normal side, cash-view inclusion
    and cash-flow bucket are DERIVED from the class, never chosen. Control accounts (cash,
    bank, receivables, payables, inventory, GST) cannot be user-created.
  - The account-creation **page** is UI, deferred with all other UI; the backend lands now.
- **S1-6 (2026-11-15) — Credit notes in the cash view are recognised when the adjustment
  ACTUALLY happens, never retroactively.** Owner's wording: recognise on the date a note is
  **refunded or applied**, not pro rata against the original invoice's collections. Issued
  but not refunded/applied → **no** cash-P&L impact. Refund issued → reduce revenue **in the
  refund month**. Credit applied to a later invoice/payment → reduce revenue **when used**.
  A previously collected invoice → **never rewrite an earlier month's cash figures**.
  Principle: cash reports reflect the period the adjustment occurs in. Same principle as
  S1-1's reversal dating. **The code currently does the OPPOSITE** (`deriveCashView` folds a
  note into its invoice pro rata), so this is a build item — `REMAINING_BUILD_PLAN.md` S3,
  which also needs a refund path.
- **S1-5 (2026-11-15) — Subscriptions / deferred revenue DEFERRED; a new "all report
  formats" slice added.** DD §11.6 still has three open items (early-closure behaviour,
  statement layouts, refund-vs-carry-forward default). Owner instead wants a slice building
  out the full report set (§13) — `REMAINING_BUILD_PLAN.md` S7.
- **S1-4 (2026-11-15) — Chart of accounts: add ALL FOUR new codes in ONE migration.**
  `UNEARNED_REVENUE`, `BANK`, `UNCATEGORIZED`, `OPENING_BALANCE_EQUITY`. The `journal_lines`
  account `CHECK` is a fixed list rebuilt by migration, so one rebuild beats three or four.
  Answers the long-open gate question (3). This also forces a latent fix: the hardcoded
  account lists in `getBalanceSheet` / `getProfitAndLoss` / `deriveCashView` must become one
  classification map, because a code missing from one of them silently unbalances the sheet.
- **S1-3 (2026-11-15) — No more per-slice plan files.** One consolidated
  `book-buddha/REMAINING_BUILD_PLAN.md` replaces `SLICE_n_PLAN.md`; the assistant scopes the
  work itself and builds, rather than gating each slice on a written plan.
- **S1-1 (2026-11-15) — Cash vs accrual = ACCRUAL-ALWAYS posting + a Cash/Accrual toggle
  at the report level.** Resolves conflict **#10** (`todos.md`) toward DD §4.5 / QBO. The
  engine **always** posts accrual (AR/AP kept accurate) regardless of a company's preferred
  method; the company's preference is only the **default report setting**, never a posting
  restriction. Cash-basis reports are **derived from actual payment allocations** (partial
  payments supported); no duplicate journals. This **supersedes** the per-company
  posting-time deferral built in Slices 1–6 and in commit `5576a21`, which is refactored
  away in **Slice 7b**; existing data preserved, regression tests added.
  **BUILT 2026-11-15** as Slice 7 (`5fc5aa8`, `4db437a`, `fbd358c`, `710d4f6`): the toggle
  applies to the **P&L only** — Trial Balance and Balance Sheet stay accrual-only, because
  keeping AR/AP on the books (owner's rule) means a cash Balance Sheet cannot balance until
  there is an Unearned Revenue account (Subscriptions). Acceptance figures reproduced but
  **not yet confirmed** by the owner.
- **S1-2 (2026-11-15) — Banking is its own slice; bank categorization + bill OCR live
  there.** Confirms conflict **#4** toward V1 scope, but the Feature Design (FD) is still
  **UNAPPROVED** with 3 open items (FD §H, below) — recorded as blocked on the owner, not
  scheduled, until those are settled.

## Foundational / scope (DD)
- **One company per install**, one DB file. Phase 1 = single-user **Admin**; Phase 2 =
  invoicing-only users (create & cancel, never delete, scoped data). (DD §1.4, §2.3–2.4)
- **Auth:** Google sign-in for setup/recovery; app password daily, ≥8 chars with
  letters+numbers; lockout 15 min after 5 tries; auto sign-out after 1 h idle. (DD §15.2)
- **Fair = a first-class Project** tied to one customer, with its own P&L (no per-fair
  Balance Sheet). Tags are a separate, lighter system. (DD §3.3, §10, §12.1, §13.3)

## The 15 questions (DEC, 9 Nov)
- **M1** — track-stock books: stock arrives by ordinary data entry; leaves via a
  challan for subscriptions, else at the invoice.
- **M2** — no-stock magazines: handled like M1 under subscription accounting.
- **M3** — credit customers: ordinary credit sale, payment when received, no
  challan-first.
- **M4** — challan↔invoice link: **DEC marks PENDING**, but DD §11.4 records it as
  DECIDED (invoice first; one invoice→many challans; one challan→one invoice;
  multi-invoice challans in v2). → **conflict, see `todos.md`.**
- **Q1** — customer credit: two ledgers (advances + credit notes), one combined
  balance shown.
- **Q2** — customer **merge is in V1** (merges identities, not transactions).
- **Q3** — P&L supports both **cash and accrual**.
- **Q4** — eight fixed reports + a simple report builder. *(DD §12 later lists ~17
  fixed reports; Build Plan still says 8 → conflict.)*
- **Q5** — payment amount & customer **frozen after save**; corrections are
  reverse-and-re-enter.
- **Q6** — partial / deposit on an invoice allowed, with its own due date.
- **Q7** — archive as a third state **skipped in v1 (DEC)** — **FD later reverses this
  into V1** → conflict.
- **Q8** — date tokens `:MONTH`, `:QUARTER`, `:YEAR` in v1 (also `:WEEK`, DD §13.5).
- **Q9** — tamper-evident **hash-chain audit log in v1**.
- **Q10** — low-stock threshold per item, business-level fallback.
- **Q11** — numbering resets with the FY, per document type.
- *(1A, 3C, 4A, 5A are referenced by DEC but DEFINED in DD/FD, not DEC.)*

## Other settled decisions (DD)
- **Stock:** per-item Track Yes/No; Yes→No blocked while stock remains. FIFO for
  tracked; untracked expensed at purchase. Negative stock blocked. (DD §6)
- **Posting source:** the document decides who posts — direct invoice posts all;
  linked challan recognises delivery; standalone challan posts nothing. (DD §6.5)
- **Rounding:** invoice/quotation totals round to the nearest whole rupee (≥50p up);
  receipts keep paise. *(DD §7.4, "adopted 12 Nov from Magazine PRD v4" — CONTESTED;
  ANTI & TEST say exact paise → conflict, see `todos.md`.)*
- **Invoice numbering:** `INV-001/26-27`, per business, reset each FY; number used on
  first save even as draft. Autosave with a leave-warning on unfinalised drafts.
  (DD §7.2–7.3)
- **Customers:** classification required; category SCH/LIB/CLG/RET/GEN auto-numbered
  from 0001; duplicate warn-but-allow; up to two contacts. (DD §5)
- **Payments:** methods Cash / Bank Transfer / UPI / Cheque / Other; `PMT-001/26-27`.
  (DD §9)
- **Subscriptions:** generic deferred revenue (not a magazine mode); price history by
  date; supply-date rate applies; **settlement/variance engine in V1** (refund /
  carry-forward / balance-due). (DD §11)
- **Credit notes:** separate, visually distinct document; issuance raises the credit
  pool, application creates a Credit-type payment. (DD §8.2)
- **Challan:** a real document, linked or standalone. (DD §8.3)
- **Import/Export:** real .xlsx + CSV; two-phase preview→column-map; failed rows
  skipped & collected. Backup scope user-selectable; restore sanitises settings.
  (DD §14)

## Bank categorization / OCR / archive (FD, 13 Nov — AWAITING OWNER APPROVAL)
- Moved **v2 → V1** (FD §A; H13 §3). Rationale: cut repetitive data entry.
- **Intake (D1):** CSV/Excel (primary, offline) · digital PDF (offline, no OCR) ·
  scanned PDF (offline Tesseract fallback, flagged "please check") · optional cloud OCR
  only when online and chosen.
- **Review queue (D2–D3):** imported lines aren't in the books until accepted; each
  line → **Add** (new bill/income) or **Match** (to open invoice/bill = a payment, or
  to an existing entry); app suggests, user confirms.
- **Bank rules (D5):** pre-fill only, **no auto-post in V1**. Helpers: split, transfer,
  Uncategorized holding account, exclude+undo (D6).
- **OCR for supplier bills (E):** same engine pre-fills a Bill for review; source file
  attached; never auto-posts.
- **Archive (F):** third state (Active/Inactive/**Archived**) — hidden, retained,
  reversible, audit-logged; blocked while live stock or an open balance exists.
- **Rejected (G):** live bank feed, reconciler-only role, auto-posting, one bank
  account per business.

## Not a decision
`reference/` (Invoice Ninja inspection) is **reference-only** — where it differs from
our rules (their cancel doesn't restore stock; they edit locked invoices; they recycle
numbers), **our rules win**. See `reference/Inspection summary …`.
