# decisions.md — Book Buddha

*On-demand allied file. Seeded 2026-11-14 from the repo docs (DD = Design Document,
DEC = plan/Decisions — the 15 questions, FD = Feature Design V1, H13 = 13 Nov handoff).
These pre-date this harness, so they keep their original IDs. **Future** decisions made
in a session use the harness convention `S<session>-<n>` (e.g. S1-1), newest at the top.*

## Session decisions (harness convention, newest first)
- **S1-1 (2026-11-15) — Cash vs accrual = ACCRUAL-ALWAYS posting + a Cash/Accrual toggle
  at the report level.** Resolves conflict **#10** (`todos.md`) toward DD §4.5 / QBO. The
  engine **always** posts accrual (AR/AP kept accurate) regardless of a company's preferred
  method; the company's preference is only the **default report setting**, never a posting
  restriction. Cash-basis reports are **derived from actual payment allocations** (partial
  payments supported); no duplicate journals. This **supersedes** the per-company
  posting-time deferral built in Slices 1–6 and in commit `5576a21`, which is refactored
  away in **Slice 7b** (see `book-buddha/SLICE_7_PLAN.md`); existing data preserved,
  regression tests added. Owner paused Slice 7 at the **plan phase** — build next session.
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
